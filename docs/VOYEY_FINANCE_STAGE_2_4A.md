# VOYEY Backend — этап 2.4A: расчётный финансовый контракт

23 октября 2026. Корень `C:/Users/USER/Desktop/Voyey`, ветка `chore/voyey-bootstrap`.
Исходный HEAD `51e0c5a3a2701f878cbd5bc98db053a4adca4734`; дерево перед работой чистое.
Итоговый локальный SHA указан в сообщении о завершении. Push/merge/deployment
не выполнялись. Реальные данные, платежи, Telegram и инфраструктура не использовались.

## А. Реализовано

Добавлен изолированный модуль расчёта `modules/checkout/finance.ts` и внутренняя
служба `finance-quote.ts`. Ни один существующий исходный файл не изменён.
Связанные заказы не сохраняются, текущий payment engine не переписан.

| Режим        | Первый платёж      | Ожидаемый остаток товара после его подтверждения | CARGO                                                 |
| ------------ | ------------------ | ------------------------------------------------ | ----------------------------------------------------- |
| IN_STOCK     | 100% goodsTotal    | 0                                                | Не применяется; такси не включается в оплату магазина |
| PREORDER 50  | ceil(goodsTotal/2) | goodsTotal − первый платёж                       | Неизвестен до поступления, отдельно                   |
| PREORDER 100 | 100% goodsTotal    | 0                                                | После поступления оплачивается только CARGO           |
| LEGACY       | Существующие 50%   | Существующий расчёт                              | Существующие правила без изменений                    |

Пример: goodsTotal=101 UZS. PREORDER 50% → 51 + 50; PREORDER 100% → 101 + 0.
После подтверждённых 101 UZS и определения CARGO=17 UZS остаток к оплате — 17,
а не 118. После подтверждения этих 17 остаток 0.

### Контракт и валидация

- Внутренняя selection schema принимает только optional `preorderPercent: 50|100`
  и `promoCode`. Для группы PREORDER выбор обязателен; для одного IN_STOCK поле
  выбора PREORDER запрещено. Строки "50", дроби, произвольные суммы, cargoAmount,
  paidAmount, discountAmount и дополнительные поля в клиентском выборе отвергаются.
- `calculateSplitFinance` получает серверный SplitCheckoutPlan из 2.3C и одну
  проверенную скидку. Перепроверяет режимы, уникальность групп, цены/количество,
  произведения строк, суммы групп и общего плана. Сохраняет отдельную скидку/итог
  каждой группы и immutable schedule первого платежа/остатка.
- Все денежные значения — целые UZS в диапазоне 0..2147483647. Переполнение строки,
  общего оформления, подтверждённых сумм и товаров+CARGO отвергается.
  Для пропорциональной скидки используются промежуточные BigInt, без float rounding.
- Финансовый контракт version=1/executable=false связан с checkoutGroupId и snapshot
  fingerprint из 2.3C. financialFingerprint включает выбор процента и скидку;
  quoteFingerprint также включает нормализованный promo code. Это quote, не durable
  idempotency запись: актуализация каталога/условий меняет предложение.
- Исторические снимки цен/характеристик берутся из плана 2.3C, не из клиентских сумм.
  Сам контракт не резервирует stock. Будущий reserve допустим только при commit.

### Подтверждённые деньги и остатки

`calculateOutstanding` — чистая проекция **доверенного серверного ledger активного
нового заказа**, не операция approval и не публичный input. ReceiptAllocation
содержит ID, status, общую amount и разложение goodsAmount/cargoAmount. Их сумма
обязана совпадать с amount; отрицательные, переполненные и повторные IDs запрещены.

Только APPROVED allocations входят в goodsPaid/cargoPaid. SUBMITTED/REJECTED не
увеличивают поступления. Подтверждённые суммы не могут превышать обязательство.
Это не проверка владельца: будущая запись APPROVED должна поступать исключительно
из owner-authorized transactional writer; сейчас такого writer нет.

CARGO передаётся как одна **абсолютная сумма**, не команда прибавления. До поступления
его нельзя определить, при unknown final amount остаётся null. После поступления
можно задать в том числе 0. Повторный расчёт с тем же ledger/суммой ничего не начисляет.
Результат включает firstPaymentDue, goodsOutstanding, cargoOutstanding,
totalOutstanding и finalAmountDue. firstPaymentDue — часть непогашенного обязательства,
его нельзя складывать с totalOutstanding как два разных начисления.
У IN_STOCK finalAmountDue=0: второго платежа за те же товары нет. PREORDER final
доступен только после поступления и определения CARGO. Нулевой остаток не создаёт
фиктивную запись платежа.

Проекция не пересчитывает возвраты/прибыль и не открывает долг повторно после refund.
Она не подключена к отменённым/историческим заказам. Правила новых возвратов и
распределения refund остаются зависимостью 2.4B; прежний RefundService не менялся.

### Скидки и промокоды

Внутренний quote использует существующий `marketing/promo-codes.ts:promoForCheckout`
один раз на общий товарный subtotal. Сохранены нормализация, active/start/end,
минимальная сумма, maxDiscount, usage/per-user limits, PERCENT/FIXED и ограничения
старого promoDiscount. Redemption и аудит применения скидки не записываются.

Проверенная общая скидка распределяется между режимами методом наибольших остатков
из 2.3C, с детерминированной развязкой по ключу режима. Сумма долей точно совпадает
со скидкой, распределение не зависит от порядка групп/строк. CARGO не дисконтируется.

Неподдерживаемый/неприменимый код отклоняется, без обхода лимитов и без повторного
вычисления скидки отдельно на каждый заказ. Тест подтверждает, что legacy redemption
учитывается при новом quote. Расчёт не резервирует лимит промокода: перед реальной
записью в 2.4B необходимо перепроверять условия в том же atomic commit.

Чистый helper может представить нулевую стоимость товаров после скидки для проверки
арифметики. Это не отменяет старую promo policy: реальный promoDiscount запрещает
скидку >= subtotal, поэтому серверный quote не разрешает бесплатную покупку кодом.
Новых mode/category-specific promo rules не добавлено. Для таких правил и возврата
одной группы нужны отдельные продуктовые решения; они сейчас не активированы.

### Полномочия владельца и отключённые операции

Изучены `admin/web-session.ts` (общий voyey_admin principal), `admin/telegram.ts`
(isAdmin/TelegramAdmin, без достоверной owner роли), `admin/finance/procurement.ts`
(financePrincipal — идентификатор аудита, не доказательство owner полномочий).
Они не позволяют надёжно утверждать, что произвольный администратор — владелец.

Поэтому новая служба quotes по умолчанию выключена. Внутренний opt-in разрешает
только согласованный D1 atomic/CAS read: пользователь, Cart, снимки, цены, promo.
Внешнего маршрута/env toggle нет. `confirmPayment()` и `commit()` безусловно
отклоняются 503 даже при opt-in. Строка роли от клиента не может их включить.

Legacy цепочка карта → private proof → review остаётся прежней. Новых чеков,
payment instructions, APPROVED статусов или уведомлений не создано. Существующие
legacy Admin permissions не менялись; исключительность владельца ещё не объявлена
реализованной для работающего старого механизма.

## Б. Проверки и границы этапа

Build, typecheck, lint, Prisma generate/validate и полный набор тестов выполнены.
Итог: **1111 passed, 5 skipped, 0 failed**. API 249, Worker/D1 517, Admin 150,
Mini App 169, Bot 16, config/security 10. Добавлены 16 серверных тестов.
Последний Turbo прогон: 7 успешных задач, 6 из cache; новый Worker набор выполнен.
Прежнее предупреждение Prisma о package.json#prisma оставлено без изменения.
Точные результаты последнего прогона — в сообщении о завершении и логах
`.cache/voyey-stage-2-4a/`. PostgreSQL integration tests намеренно отключены;
неизменённые задачи могут использовать Turbo cache.

Новые серверные тесты охватывают 100% IN_STOCK, 50%/100% PREORDER, нечётные суммы,
нулевой goods remainder, поздний CARGO, повторную проекцию, duplicate receipt IDs,
overpayment, submitted/rejected, смешанную скидку, подмену сумм, unsafe money,
legacy promo/50% compatibility, per-user promo limit, отсутствие новых маршрутов,
запрет financial writes и default disabled quote.

Изменённых старых файлов нет. Добавлены:

- `apps/api/src/modules/checkout/finance.ts` — чистые финансовые контракты/расчёты.
- `apps/api/src/modules/checkout/finance-quote.ts` — внутренняя отключённая quote служба.
- `apps/worker/tests/split-finance.test.ts` — новые серверные проверки.
- `docs/VOYEY_FINANCE_STAGE_2_4A.md` — этот отчёт и план.

Сохраняемые модели не расширялись: миграции не нужны, 0001–0020 сохранены. Старые
миграции выполняются только во временных SQLite/Miniflare тестах. Ни реальная D1,
ни реальные пользователи/платежи не затронуты. COMMERCE_ENABLED=0 сохранён.
SHA-256 сверка всех 632 файлов предыдущего коммита (с учётом CRLF/LF): все неизменны,
пропавших нет. Добавлены 4 файла, всего отслеживаемых 636. Gitleaks: новых находок
нет, прежние исключения не менялись. Git diff --check прошёл.

## В. Актуальная карта Backend

| Модуль                  | Уже работает                                              | Добавлено в 2.4A                                  | Пока заблокировано/не хватает                        |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| Каталог/SKU             | Категории, атрибуты, Product price, stock/preorderEnabled | Без изменений                                     | UI атрибутов, реальные новые order modes             |
| Корзина                 | Режимные строки, группы, суммы, общий 99/stock лимит      | Без изменений                                     | UI выбора режима/процента                            |
| Checkout                | Legacy 50%, snapshots, CAS; split plan из 2.3C            | Финансовый quote на плане, без reserve            | Единый group commit, durable replay                  |
| Заказы/склад            | Старые snapshots/status/reserve/release                   | Только расчётный контракт                         | Group/model constraints, IN_STOCK reserve при commit |
| Оплата                  | Legacy карта/чек/review/final                             | 100%/50% schedules, проекция APPROVED allocations | Owner-authorized writer, новые receipts/endpoints    |
| Скидки                  | Старые promo условия/лимиты                               | Один quote, точные доли между группами            | Одно group redemption, refund policy долей           |
| CARGO                   | Прежний amount при final                                  | Расчёт отдельного обязательства после поступления | Сохранение/изменение суммы только владельцем         |
| Финансы/возвраты        | Старые approved cash/profit/refund                        | Без изменений                                     | Новые policies/cancellation/refund allocation        |
| Сотрудники/Auth         | Web sessions, Telegram admins, JWT/CSRF                   | Owner-зависимость явно блокирует новые действия   | Достоверная серверная owner identity/права           |
| Telegram/инфраструктура | Прежний код, изоляция и D1 media                          | Без новых уведомлений/ресурсов                    | Отдельное разрешение на активацию                    |
| Database                | 20 миграций, D1 Batch/CAS, Prisma types                   | Без изменений                                     | Миграция 0021 при сохранении модели 2.4B             |

## Г. Точный план 2.4B — не реализован

1. Утвердить owner identity на сервере: уникальный субъект, способ проверки сессии/
   Telegram ID, права подтверждения, изменения CARGO и refund. Нельзя выводить owner
   из shared web-admin логина, label TelegramAdmin или client role. Закрыть новые
   финансовые writes default-deny и проверить разрешённого/чужого/отозванного owner.
2. Добавить CheckoutGroup: owner userId, operation, один client key, fingerprint
   исходного выбора/получателя/promo/процента; unique(userId,key). Сохранять первоначальные
   quote/snapshot отдельно от request fingerprint, чтобы replay не зависел от текущего
   каталога. Прежний legacy key namespace не должен конфликтовать молча.
3. Order: saleMode/financialPolicy/version/group FK, unique(group,mode); default LEGACY
   для истории. OrderItem: mode и согласованность с parent, исторические snapshots.
   PREORDER reserve=0; IN_STOCK reserve=quantity с конечным stock. Подготовить 0021
   без backfill новых политик для старых заказов и без ослабления финансовых CHECK.
4. В одной D1 atomic/CAS операции сначала replay/conflict группы, затем user/Cart/
   availability/мерки/цены/promo/процент. Создать **все** Order и OrderItem, обязательства,
   reserve только IN_STOCK, одно redemption/audit, удалить только выбранные CartItem IDs.
   Ошибка второй группы откатывает всё. Read-only quote не заменяет повторную валидацию.
5. Сохранять immutable schedules: IN_STOCK first=goodsTotal; PREORDER first=ceil(50%)
   либо goodsTotal; ожидаемый остаток отдельно от фактического goodsPaid. Не выставлять
   деньги полученными при создании заказа или при загрузке чека.
6. Реальные Payment allocations должны суммироваться в expectedAmount и связываться
   с конкретным обязательством. Только owner APPROVED transaction увеличивает
   goodsPaid/cargoPaid, погашает долг, пишет аудит. Idempotent approve/reject, проверка
   текущего due/права/статуса и запрет повторного зачёта — в одном guarded commit.
7. IN_STOCK после подтверждения 100% — подготовка к выдаче/самовывозу, без ложной
   supplier purchase стадии. Такси не начислять автоматически. PREORDER после первого
   подтверждения — закупочный процесс. Адаптировать payment/status transitions отдельно
   по mode, не изменяя старый LEGACY lifecycle.
8. После поступления PREORDER владелец устанавливает одно absolute CARGO obligation.
   При 50% final=фактический unpaid goods + unpaid CARGO; при 100% — unpaid CARGO.
   Изменения уже оплаченного CARGO требуют согласованного adjustment, не повторного
   начисления. При due=0 не создавать fake payment/receipt.
9. Утвердить per-group/whole-checkout redemption, доли скидок на отмене одной группы,
   cargo refund и денежные возвраты. Существующий Refund отдельно хранит возврат;
   нельзя автоматически уменьшить paid и снова открыть долг отменённого заказа.
10. Тесты до включения: ошибка второго INSERT, конкурентный stock/permission/promo,
    повтор ключа/несовместимый выбор, новая Cart после replay, все проценты/округления,
    два approve/reject, owner revocation, fake roles, receipt amount mismatch,
    cargo unknown/0/повтор/изменение после оплаты, частичная отмена/refund и отсутствие
    двойной скидки/резерва/поступления. Notifications — после commit с idempotent keys.
11. Только после проверок и отдельного разрешения — gated HTTP/manual endpoints,
    UI/Bot и применение своей БД. На этом этапе сохранение/подтверждение всё ещё закрыты.

Этап 2.4B не начинался.
