# VOYEY Backend — этап 2.4C2

23 октября 2026. Ветка `chore/voyey-bootstrap`, папка
`C:/Users/USER/Desktop/Voyey`. Исходный чистый HEAD:
`b6a865ed58b69f64701e543bb195da322662d336`.
Итоговый локальный SHA приведён в сообщении о завершении.

Архитектура: Cloudflare Worker + Fastify + D1, прежние приватные MediaObject/MediaChunk.
Работа исключительно локальная. COMMERCE_ENABLED=0 сохранён. Реальные банки,
карты, клиенты, Telegram и Cloudflare не подключались. Push/merge/deployment
и реальные миграции не выполнялись. Этап 2.4C3 не реализовывался.

## А. Итог 2.4C2

### Поступление всего PREORDER

Новая внутренняя служба `checkout/preorder-finance.ts:PreorderFinance` по умолчанию
выключена и не имеет HTTP/Admin-маршрутов или env-переключателя включения.
`arrive` принимает ISO UTC дату фактического поступления и полный перечень
OrderItem ID с количеством. Сервер сопоставляет их с историческими позициями
CheckoutOrderItem, а не с текущим каталогом.

Проверяются PREORDER, sealed CheckoutGroup, отсутствие пропущенных/дублированных
строк, точные количества всех SKU и дата между созданием заказа и текущим временем.
Владелец вручную подтверждает физический факт; Backend проверяет согласованность
этого подтверждения. Частичный список, неправильное количество или произвольный
флаг allItemsReceived не открывают финальный процесс.

В CheckoutArrival сохраняются orderId, arrivedAt, immutable snapshot всех item/SKU/quantity,
createdBy, createdAt, operationKey и requestFingerprint. Создаётся AuditLog.
Одна запись на заказ: replay того же ключа/параметров возвращает её, новый ключ
или несовместимые параметры отклоняются. Отдельных поставок, партий и частичного
поступления не добавлено. При поступлении PREORDER склад ProductVariant не увеличивается:
это подтверждение товаров конкретного заказа, не приёмка общего склада.

### CARGO

`assignCargo` требует полного поступления и текущих owner permissions. В
CheckoutCargoCharge сохраняется первая и единственная неизменяемая версия:
orderId, arrivalId, version=1, amount, owner, время, ключ/fingerprint и аудит.

- null в финансовом состоянии: сумма ещё не назначена.
- 0: владелец явно назначил нулевой CARGO.
- >0: известная стоимость доставки предзаказа до Ташкента.

CARGO не входит в goodsTotal, не является такси до покупателя и не применяется
к IN_STOCK. Все UZS целые, неотрицательные, без переполнения. Сумма goodsTotal+CARGO
ограничена 2147483647, как и прежний финансовый расчёт 2.4A.

Повтор ключа/параметров не прибавляет долг. Любая корректировка после назначения,
включая попытку сменить сумму до выставления счёта, сейчас запрещена. Новый ключ
не создаёт следующую версию. Это сознательное ограничение до отдельной политики
корректировок, особенно после выставления/оплаты счёта.

### Финальный счёт

`issueInvoice` требует одновременно:

1. PREORDER и полное подтверждённое поступление.
2. Известный CARGO, включая явно назначенный 0.
3. Подтверждённый FIRST в существующем CheckoutPaymentLedger.

Используется сохранённая financialPolicy и прежний `finance.ts:calculateOutstanding`.
Цены, скидка и характеристики из сегодняшнего каталога не перечитываются для суммы.

В immutable CheckoutFinalInvoice сохраняются версия/валюта, arrivalId, cargoChargeId,
firstLedgerId, исходный goodsTotal, firstGoodsPaid, goodsDue, cargoDue, totalDue,
выставивший owner, время и idempotency данные. Это snapshot обязательства, не quote.
Один invoice на заказ; повтор возвращает тот же snapshot даже после оплаты.

| Сценарий для goodsTotal=101 UZS | FIRST | Финальный GOODS | CARGO | FINAL |
| --- | ---: | ---: | ---: | ---: |
| PREORDER 50%, CARGO=17 | 51 | 50 | 17 | 67 |
| PREORDER 100%, CARGO=17 | 101 | 0 | 17 | 17 |
| PREORDER 50%, CARGO=0 | 51 | 50 | 0 | 50 |
| PREORDER 100%, CARGO=0 | 101 | 0 | 0 | 0 |

Неизвестный CARGO не превращается в 0. Пока invoice отсутствует, finalDue=null.
Для нулевого invoice сохраняется погашенное обязательство SETTLED_ZERO, без
CheckoutPayment на 0, без фиктивного чека и без нулевой ledger-записи.
Выдача товара по-прежнему запрещена.

### FINAL: прежний ручной платёжный процесс

Существующий `LinkedCheckoutPayments` расширен минимально:

- Старые `instructions` и `submit` обслуживают только FIRST, как раньше.
- `finalInstructions` и `submitFinal` явно выбирают FINAL; автоматически переключать
  оплаченный FIRST на новую оплату невозможно.
- `review`, private proof, claim validation, owner audit, idempotency и media writer
  переиспользуются. Нового storage/provider нет.
- FINAL связывается с invoiceId. Клиент не задаёт allocations или серверные суммы.
- Поддерживается один полный положительный FINAL, частичные переводы отклоняются.

Подтверждённая сумма распределяется строго по invoice snapshot:
goodsAmount=goodsDue, cargoAmount=cargoDue; их сумма равна confirmedAmount и expectedAmount.
Для PREORDER 100% FINAL имеет goodsAmount=0 и только cargoAmount.
Переизбыток, частичная сумма, неверная фаза/счёт и попытки прислать allocations из
клиента отклоняются. Промокод не применяется и не расходуется повторно.

SUBMITTED/REJECTED FINAL не меняет полученные деньги. Отклонённый чек остаётся в
истории; можно подать новую попытку. Повтор submit key не создаёт нового файла,
а один pending-чек на (order,phase) защищает от параллельных подач.
История FIRST сохраняется независимо от последующих FINAL-чеков.

### Ledger и финансовое состояние

Источник истины остался **тот же CheckoutPaymentLedger**. FIRST и FINAL находятся
в одной таблице, с единым UNIQUE(bankOperationDigest). Банковскую операцию FIRST
нельзя повторно зачесть в FINAL или в другой заказ. SHA-256 и нормализация
банковского reference из 2.4C1 не менялись; исходные реквизиты не сохраняются.

UNIQUE(paymentId), UNIQUE(orderId,phase), проверки allocation/phase/invoice и
неизменяемые terminal decisions защищают от двойного подтверждения. SQL transition
APPROVED по-прежнему выполняется только после вставки соответствующего ledger.
Финансовая запись, решение и аудит коммитятся вместе или откатываются полностью.

CheckoutOrderFinance расширен совместимо:

- goodsPaid = сумма подтверждённых FIRST/FINAL GOODS.
- unpaidGoods = сохранённый goodsTotal − goodsPaid.
- cargoPaid = подтверждённый FINAL CARGO.
- unpaidCargo = назначенный CARGO − cargoPaid; при unknown остаётся null.
- finalDue = immutable invoice.totalDue − подтверждённые FINAL allocations.
- firstPaymentDue/State относятся только к FIRST и не зависят от pending FINAL.
- finalPaymentState: UNAVAILABLE / AWAITING_PAYMENT / PENDING_REVIEW / REJECTED /
  CONFIRMED / SETTLED_ZERO.
- financiallySettled учитывает известное и погашенное финальное обязательство.
- orderState=PAYMENTS_BLOCKED и fulfillmentAllowed=0 остаются неизменными.

Поля finalPaymentEnabled/cargoEnabled обозначают только внутреннюю готовность
соответствующей операции. Они не включают публичные routes, checkout или магазин.
Существующие group/payment readers используют view; устаревшие исходные
CheckoutOrder.goodsPaid=0 не применяются как текущий баланс.

Для IN_STOCK нет ни arrival, ни нового CARGO, ни invoice/FINAL. Его 100% FIRST
остаётся единственным платежом за товары. Смешанная CheckoutGroup сохраняет
независимые дочерние обязательства.

### Owner permissions, приватность и атомарность

Для поступления, CARGO, invoice и review деньги проверяются внутри одного
`atomic` callback: личный JWT VOYEY, User ACTIVE, TelegramAdmin active и совпадение
с серверным VOYEY_OWNER_TELEGRAM_ID. JWT проверяется заново при CAS retry.
Пустая конфигурация → 503, сотрудник/обычный Admin/посторонний → 403.
Реального owner ID не назначалось. Проверенный owner сохраняется в записи/аудите.

Ревокация TelegramAdmin между чтением прав и commit меняет _Revision, старый
batch откатывается; retry фиксирует отказ без финансовой операции. Это проверено
отдельно для arrival, cargo, invoice и FINAL. SQL дополнительно проверяет активность
reviewer; обычная web-admin cookie не стала owner identity.

Каждая операция процесса самостоятельна и атомарна. Ошибка invoice не удаляет
ранее правомерно подтверждённое поступление/CARGO, но не оставляет полусохранённого
счёта. Ошибка review откатывает ledger, решение и audit; исходный чек остаётся pending.
В CAS callbacks нет Telegram/bank/network side effects.

Приватный механизм 2.4C1 сохранён: MIME/структура JPEG/PNG/WebP, максимум 5 MiB,
ownership, MediaObject+chunks+CheckoutPayment+audit одним batch, случайные private keys,
запрет прямого /media/payment-proofs URL и SQL-неизменяемость привязанного файла.
Сотрудник не может читать чужой чек или подтвердить деньги. Источник TELEGRAM_OPERATOR
и operator attachment по-прежнему заблокированы; @askVoyey не подключён.
Audit не содержит токенов, изображений, полного банковского reference или карточных данных.

### Миграция 0023 и сохранность FIRST

Добавлена `0023_linked_checkout_final_payment.sql`. Миграции 0001–0022 неизменны.
0021 contracts/guards не менялись. В 0022 phase CHECK был жёстко FIRST, поэтому
для совместимого расширения SQLite требуется transactional rebuild двух таблиц:

1. Копирование Payment/Ledger в служебные таблицы внутри той же миграции.
2. Создание arrival/cargo/invoice; пересоздание Payment/Ledger с FIRST/FINAL,
   nullable invoiceId для старых FIRST, прежними проверками и расширенными allocations.
3. Побайтово эквивалентное по прежним значениям восстановление FIRST rows,
   включая ID, status, fingerprints, bank digests, actor/timestamps и proof links.
4. Восстановление SQL guards, indexes, revision triggers; расширение finance view.
5. Удаление служебных копий и увеличение _Revision, чтобы старый CAS не прошёл.

**Файл 0023 должен применяться целиком одним атомарным migration/D1 batch.**
Нельзя исполнять его вручную по отдельным statements на рабочей базе.
Все проверки выполнены исключительно в изолированных SQLite/Miniflare.
Тестовые adapters применяют 0023 одним batch/transaction и поддерживают fixture
с состоянием до 0023 для проверки upgrade.

На заполненном состоянии проверены APPROVED/SUBMITTED/REJECTED FIRST, ledger,
банковские digests, приватные bytes и LEGACY rows: прежние значения сохранены,
добавлено только invoiceId=NULL. Старый FIRST replay работает после upgrade.
Ошибка в конце migration batch полностью восстанавливает прежние данные/схему;
проверено и на настоящем локальном D1. FK check чистый, служебных копий не остаётся.
Общий UPDATE/DELETE финансовых записей не открыт; новые arrival/cargo/invoice
неизменяемы. Прежние private/LEGACY isolation guards сохранены.

### Результаты и файлы

Добавлены 30 серверных тестов в `apps/worker/tests/preorder-finance.test.ts`:
все варианты 50/100%/CARGO 0/null, preconditions, full/partial arrival, immutable replay,
concurrent arrival/cargo/invoice/review, банковская дедупликация между фазами/заказами,
точные allocations, скидки, owner denial/revocation, rollback row/audit/media/invoice,
populated migration upgrade/rollback, SQL guards и закрытые публичные/Admin routes.

Build, typecheck, lint, Prisma generate/validate, полный набор тестов и config/security
preflight прошли. Итог: **1195 passed, 5 skipped, 0 failed**: Worker/D1 601,
API 249, Admin 150, Mini App 169, Bot 16, config/security 10. Последний Turbo прогон:
7 успешных задач, 6 неизменившихся из cache; новый Worker набор выполнен заново.
PostgreSQL integration tests исторические и намеренно пропущены; PostgreSQL
для VOYEY runtime не требуется. Production не проверялся.
Прежние предупреждения package.json#prisma и Vite use-client/sourcemap сохранены.
Gitleaks не обнаружил секретов; исключения сканера не расширялись.
Git fsck и diff check без ошибок. Итоговый SHA указан в сообщении о завершении;
логи в игнорируемой `.cache/voyey-stage-2-4c2/`.

Новые файлы:

- `apps/api/src/modules/checkout/preorder-finance.ts` — owner operations и snapshots.
- `apps/worker/migrations/0023_linked_checkout_final_payment.sql`.
- `apps/worker/tests/preorder-finance.test.ts`.
- Этот отчёт.

Изменены:

- `apps/api/src/modules/checkout/linked-payments.ts` — совместимые FIRST/FINAL helpers,
  единый review/ledger/proof, проверка JWT внутри review atomic.
- `apps/api/src/modules/checkout/payment-state.ts` — расширенный finance view contract.
- `apps/api/src/modules/admin/owner.ts` — новые owner action codes.
- `packages/database/prisma/schema.prisma` — invoiceId и три scalar-модели.
- `packages/database/src/checkout-payment-d1-schema.ts` — read metadata.
- `apps/worker/tests/helpers/sqlite.ts` и `helpers/marketing-runtime.ts` — atomic
  application 0023 и fixtures до миграции для безопасных upgrade/rollback тестов.

Проверены SHA-256 всех 649 файлов исходного HEAD с нормализацией CRLF/LF:
642 неизменны, 7 изменены по задаче, отсутствующих нет. Добавлены 4 файла;
после локального коммита — 653 отслеживаемых файла. Frontend/Admin/Mini App/Bot,
Worker src/config, .env.example, зависимости/lockfile и исходный STENZO не менялись.
Прежние @stenzo package names и STZ- номера сохранены намеренно.

## Б. Актуальная карта Backend

| Модуль | Реализовано и локально проверено | Пока закрыто / отсутствует |
| --- | --- | --- |
| Каталог/SKU | Универсальные атрибуты, цена Product, размеры/цвет, preorderEnabled | Цены SKU, marketplace; UI этим этапом не менялся |
| Корзина | LEGACY/IN_STOCK/PREORDER, два режима SKU, общий cap99, stock checks | Публичный split checkout и новые UI flows |
| CheckoutGroup | Атомарные 1–2 заказа, snapshots, discount once, durable replay | Commit default-off, внешних/Admin routes нет |
| Заказы | LEGACY; immutable новые контракты и ledger finance | Новый fulfillment/status lifecycle, выдача/завершение |
| Склад | Резерв IN_STOCK; PREORDER без резерва; full arrival snapshots | Частичные поставки, release/TTL новых резервов |
| Платежи | Ручные FIRST и FINAL, owner review, единый bank digest ledger | Всё новое внутреннее/default-off; публичные оплаты закрыты |
| Чеки | Приватный D1 для обеих фаз, история/replay/ownership/atomic writes | UI/публичные proof routes, operator attachment |
| CARGO | Owner-only version 1 после полного поступления, unknown/0/>0, FINAL allocation | Корректировки/следующие версии/такси не реализованы |
| Возвраты | LEGACY сохранён | Новые cancel/refund/expiry/release не реализованы |
| Сотрудники | Прежние sessions/JWT/TelegramAdmin и transactional owner guard | Реальный owner не настроен, staff roles/legacy rights audit впереди |
| Telegram | Прежние RU/UZ механизмы в коде сохранены | Новый чат/bot/callbacks/уведомления/кнопка не подключены |
| База | Worker + Fastify + D1, 0023, FK/CHECK/UNIQUE/guards и revision | Реальные миграции и production rollout не выполнялись |

## В. План 2.4C3 — не реализован

1. Согласовать cancellation lifecycle и причины. Отменённый заказ больше не принимает
   платежи и не возвращается в активный flow после refund. Сохранять actor/time/key
   и неизменяемую историю, не удалять CheckoutOrder/Payment/Ledger.
2. Refund делать отдельным owner-authorized журналом возврата, связанным с исходными
   подтверждёнными allocations. Возвращать не больше полученного минус уже возвращённое,
   отдельно GOODS/CARGO по согласованной политике. Не удалять credit ledger и не
   открывать оплаченный долг повторно. CAS/UNIQUE защищают повторы и конкурентные решения.
3. Освобождать только фактически сохранённый IN_STOCK inventoryReservedQuantity,
   однократно, с явным release event/key. PREORDER с резервом 0 не увеличивает общий
   stock. Новые cancel/refund/stock operations коммитить в согласованной границе.
4. Для CheckoutPromoUse выбрать правила всей группы: частичная отмена одного ребёнка
   не освобождает автоматически общий код. Консервативно сохранять usage, пока
   другой заказ/полученная выгода остаётся действующим; полное освобождение только
   по согласованному правилу и однократному событию после проверки обеих частей.
5. Pending checks требуют отдельной политики: блокировать competing approval после
   финальной отмены, не удалять чек, решать гонку cancel/approve/refund транзакционно.
   Нельзя автоматически считать неподтверждённый чек оплаченным или безопасно отсутствующим.
6. Для 24 часов определить точку отсчёта FIRST и FINAL, хранить абсолютный expiresAt
   и идемпотентный expiry key. Повтор cron не повторяет отмену/release/refund.
   Pending proof и уже оплаченный FIRST требуют специальных правил; не возвращать
   деньги/не отменять оплаченный предзаказ молча из-за неоплаченного FINAL.
7. Тестировать double cancel/refund/release, mixed CheckoutGroup, ревокацию owner,
   late proof/approval против expiry, возврат после разных процентов и CARGO,
   rollback каждого журнала, отказ после terminal cancellation и сохранение истории.

Сейчас ни одно из этих действий не включено. Новых cron/24h scheduler нет.

## Г. Перед запуском покупателям

- Завершить 2.4C3 и отдельный fulfillment-процесс. Полная оплата сама по себе
  не разрешает отгрузку, выдачу или завершение.
- Согласовать корректировки ошибочного CARGO/invoice, частичные поставки и
  обработку исключений. Текущие snapshots нельзя просто редактировать SQL UPDATE.
- Настроить отдельные VOYEY owner/JWT/card/origins, инфраструктуру и базу;
  проверить её фактическую migration history. 0023 применять только атомарно
  и после отдельного разрешённого rollout с backup/проверкой данных.
- Организовать канонический bank reference и ручную сверку поступлений. Backend
  не подключён к банку и не докажет тождество перевода, которому вручную присвоили
  разные фиктивные идентификаторы. Дедупликация с историческим LEGACY ledger
  не реализована: нужен общий процесс для всех реально работающих каналов оплаты.
- Отдельно проверить LEGACY финансовые полномочия: approve/reject, CARGO/final request,
  статусы выдачи/завершения, cancel/refund/procurement/expenses остаются в прежнем
  Admin perimeter. Этот этап их не сделал owner-only.
- Персональные operator roles до Telegram attachment; реальную переписку @askVoyey
  и уведомления подключать отдельно. Общая Admin cookie не заменяет личный JWT.
- Добавить защищённые HTTP APIs/DTO, rate/multipart limits, private no-store proof
  responses, подходящую CSRF-защиту и UI двух заказов/двух фаз. Сейчас routes отсутствуют.
- Проверить Workers/D1 нагрузку/CPU/размеры файлов, восстановление, сверку ledger,
  private proof retention и безопасное включение commerce в независимой среде.

Простыми словами: внутренний Backend уже умеет подтвердить поступление всего
предзаказа, отдельно назначить CARGO, выставить точный остаток и один раз зачесть
финальную оплату по чеку владельцем. Заказ может стать полностью оплаченным,
но покупателям новый процесс ещё закрыт, а выдача, отмены и возвраты пока не включены.
