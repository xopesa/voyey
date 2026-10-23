# VOYEY Backend — этап 2.4C3B

23 октября 2026. Ветка: `chore/voyey-bootstrap`.
Исходный чистый HEAD: `a932c88efbbd771101fa5d308252e85280aae9df`.
Итоговый SHA локального коммита указан в сообщении о завершении.

Изменения локальные. COMMERCE_ENABLED=0 сохранён. Нет push/merge/deployment,
удалённых миграций, реальных банковских операций, новых ресурсов или Telegram.
Frontend, Admin UI, Mini App, дизайн, брендинг и исходный STENZO не менялись.

## А. Реализованный процесс

`apps/api/src/modules/checkout/refunds.ts:LinkedCheckoutRefunds` — внутренняя
служба с выключенным по умолчанию конструктором. Маршрутов и environment switch
для включения нет. Методы: request, confirm, reconcileStock и owner-only state.

1. Владелец вызывает request с ID одного CheckoutOrder, ключом и причиной.
2. В одной atomic/CAS операции проверяются личный JWT и актуальные права владельца,
   sealed CheckoutGroup, допустимый новый заказ, подтверждённый ledger и pending-чеки.
3. Суммы вычисляются только из неизменяемых CheckoutPaymentLedger. Создаются
   immutable заявка, полный набор ссылок на исходные allocations и audit.
4. Заказ становится REFUND_REQUESTED и блокируется для финансовых writers.
   Деньги ещё НЕ считаются возвращёнными, stock НЕ освобождается.
5. Владелец самостоятельно исполняет перевод через банк вне Backend и проверяет его.
6. confirm получает точную confirmedAmount, НОВЫЙ исходящий bankOperationReference,
   bankTransferVerified=true и отдельный idempotency key. После свежей проверки
   владельца создаются immutable CheckoutRefundLedger и обязательный SQL-аудит.
7. Проекция показывает COMPLETED / CANCELLED_REFUNDED. Поступления не уменьшаются
   и не переписываются; отдельно появляются фактический refund и чистая позиция.
8. Только после денежного commit запускается независимая складская сверка.

Backend не отправляет деньги, не обращается к банку, не проверяет банк автоматически
и не считает сам запрос на возврат исполненным переводом. bankTransferVerified —
явное личное подтверждение владельца, а не результат интеграции с банком.

### Суммы и сценарии

| Сценарий для товара 101 UZS, CARGO 17 | GOODS refund | CARGO refund | Всего |
| --- | --- | --- | --- |
| IN_STOCK с подтверждённым FIRST | 101 | 0 | 101 |
| PREORDER 50%, подтверждён только FIRST | 51 | 0 | 51 |
| PREORDER 100%, подтверждён только FIRST | 101 | 0 | 101 |
| PREORDER 50%/100%, подтверждены FIRST и FINAL | 101 | 17 | 118 |
| FIRST подтверждён, FINAL отклонён | Только подтверждённый FIRST | 0 | Сумма FIRST |
| Нет подтверждённого ledger | Возврат запрещён | — | — |
| Есть любой SUBMITTED чек | Сначала законно завершить проверку | — | — |

Неоплаченные долги, неподтверждённый CARGO, текущие цены и изменения каталога
в сумму возврата не входят. Уже применённая скидка учтена в исходных allocations;
она не рассчитывается заново. Частичные суммы, сверхвозврат, комиссии/удержания,
отмена заявки или reopening не поддерживаются. Подтверждение неполной/лишней суммы
получает 409. Отсутствующая/ложная отметка проверки банка получает 400.

## Схема и SQL

Новая миграция `apps/worker/migrations/0025_linked_checkout_refunds.sql` применяется
одним атомарным D1 batch. Миграции 0001–0024 и их данные не переписываются.
Добавлен UNIQUE индекс `(id,orderId)` исходного payment ledger для composite FK;
сам ledger не изменяется. Prisma — scalar type/generate контракт, runtime остаётся D1.

| Таблица | Назначение |
| --- | --- |
| CheckoutRefund | Один full refund request на заказ: причина, внутренний actor, время, key/fingerprint, GOODS/CARGO/total, финансовый снимок до заявки, sealed. |
| CheckoutRefundAllocation | Ссылки на ВСЕ подтверждённые FIRST/FINAL ledger этого заказа и точные исходные GOODS/CARGO. paymentLedgerId уникален. |
| CheckoutRefundLedger | Один фактический денежный возврат на refund/order: UZS, суммы, исходящий bank digest, confirmedBy/At, key/fingerprint, verified=true. |
| CheckoutRefundStockReconciliation | Отдельная запечатываемая операция освобождения IN_STOCK после completed refund. |
| CheckoutRefundStockRelease | Одно событие на исходный item с количеством, stockBefore/After, SKU и временем. |

FK связывают allocation с payment ledger И тем же orderId, completion с request,
reconciliation с completion и release с reconciliation. UNIQUE(orderId/refundId),
UNIQUE(paymentLedgerId), UNIQUE(itemId), actor/key и банковский digest исключают
повторный учёт. CHECK ограничивают положительный total, целые GOODS/CARGO/int32,
валюту и переход stockAfter=stockBefore+reserved.

SQL при request сверяет полные суммы и APPROVED payment для каждой исходной
ledger-записи, не допускает pending, существующую отмену/старый Refund и
проверяет финансовый снимок по актуальной VIEW. Пока sealed=0, финансовые записи
по заказу уже запрещены. Sealing требует все allocations, суммы и audit.
Запечатанные заявки и allocations неизменяемы; completion и release всегда
неизменяемы. UPDATE/DELETE истории запрещены.

SQL completion требует sealed request и ТОЧНО его GOODS/CARGO/total. AFTER INSERT
создаёт обязательный audit linked-refund.completed; ошибка audit откатывает весь
денежный batch. Нет отдельного изменяемого флага «оплачено/возвращено», который
мог бы расходиться с ledger. REQUESTED/COMPLETED выводятся по наличию completion.
На всех пяти новых таблицах — revision INSERT/UPDATE/DELETE triggers.

### Финансовая проекция и отмена оплаченного заказа

`checkout/payment-state.ts:CheckoutFinancialState` и SQL CheckoutOrderFinance:

- goodsPaid/cargoPaid/receivedTotal — исходные подтверждённые поступления.
- goodsRefunded/cargoRefunded/refundedTotal — только completed outgoing ledger.
- netGoodsReceived/netCargoReceived/netReceivedTotal — поступления минус возвраты.
- refundId/refundStatus/refundCompletedAt — состояние нового процесса.
- orderState=REFUND_REQUESTED до исполнения; CANCELLED_REFUNDED после подтверждения.
- paymentAllowed/finalPaymentEnabled/cargoEnabled/fulfillmentAllowed=0 после заявки.

Старые unpaidGoods/firstPaymentDue/finalDue остаются историческими обязательствами
на основе исходных полученных денег. Возврат не уменьшает goodsPaid и не открывает
долг повторно; актуальное разрешение действия определяется терминальным orderState.
financiallySettled=0 при заявке/возврате, чтобы не разрешить выдачу товара.

Исходные CheckoutOrder.state=PAYMENTS_BLOCKED и их snapshots неизменны. Group reader
уже накладывает текущую VIEW; использовать нужно orderState, а не первоначальный
state контракта. Paid cancellation не записывается в unpaid CheckoutCancellation:
его историю и состояние образуют refund request + completion. Старые проверки
2.4C3A, запрещающие unpaid cancellation при подтверждённых деньгах, сохранены.
Добавлена явная защита от использования unpaid lifecycle при refund.

В shared assertCheckoutOpen новые состояния блокируют существующие submit/review
ДО replay и все arrival/CARGO/invoice writers. SQL дополнительно блокирует INSERT
Payment/Ledger/Arrival/CargoCharge/FinalInvoice/Cancellation/старый StockRelease
и UPDATE CheckoutPayment при наличии любого refund request. Нельзя обойти запрет
старым repository, повтором approve или прямым разрешённым SQL-переходом.
Исторические proof/state reads сохраняются с прежними проверками доступа.

Выполненного нового fulfillment пока нет; включение возвратов после передачи товара
не реализовано. Перед будущим fulfillment нужно добавить явную согласованную
границу handover и обновить взаимные SQL guards. Сейчас новый fulfillmentAllowed=0.

### Склад: отдельная атомарная операция

Деньги и склад намеренно имеют две последовательные атомарные границы.
Это необходимо: фактически исполненный банковский возврат нельзя терять из-за SKU.

После денежного commit confirm пытается reconcileStock с детерминированным ключом
`refund-stock:<refundId>`. При безопасном IN_STOCK одна atomic/CAS операция:
проверяет текущего владельца, completed ledger, весь набор сохранённых items,
активную связь SKU/productId, конечный целый stock и overflow; создаёт reconciliation,
release events, увеличивает текущий stock только на inventoryReservedQuantity,
пишет audit и запечатывает операцию. Никакого сброса к старому остатку.

Если SKU inactive/перепривязан, stock=null/дробный/переполняющийся, деньги остаются
COMPLETED, orderState остаётся CANCELLED_REFUNDED. Stock не меняется, отображается
REQUIRES_RECONCILIATION, фиксируется безопасная причина в audit. Искусственная
ошибка release/audit/seal откатывает весь складской batch, сохраняя денежный commit.
Даже технический сбой складской фазы не возвращает денежную операцию в REQUESTED.

Владелец может отдельно повторить reconcileStock после расследования/восстановления
корректной конфигурации SKU. Этот метод не записывает денежный ledger и не вызывает
банк. UNIQUE(itemId), sealing и cross-guards обоих журналов запрещают двойной release.
Повтор confirm с исходным ключом/reference также может повторить только незавершённую
складскую фазу; второй возврат денег не создаётся.

Состояния склада: NONE без refund; AWAITING_REFUND при request;
REQUIRES_RECONCILIATION после completed IN_STOCK без успешной сверки;
RELEASED после неё. PREORDER — NOT_APPLICABLE после completion: никаких release
или увеличений stock, arrival/CARGO/invoice остаются историей.

### Банк, идемпотентность и отказы

Исходящий reference нормализуется отдельно: убираются пробелы и разделители,
регистр приводится к верхнему, проверяется минимальная длина. Сохраняется только
SHA-256 с отдельным domain prefix VOYEY_BANK_REFUND_V1; digest уникален среди
новых refund completions. Сырой reference не хранится в БД, DTO или audit.
Входящий reference автоматически не переносится и не используется для возврата.
Полные реквизиты покупателя/карты, токены и личные банковские данные не добавляются.

Request fingerprint: версия операции, orderId и нормализованная reason. Confirm
fingerprint: версия, refundId, точная сумма, исходящий digest и verified=true.
Совместимый повтор возвращает тот же экономический результат; изменение намерения,
ключа, суммы или исходящего перевода — 409. Успешный request replay после completion
не открывает заказ. Свежая проверка owner может добавлять authorization audit;
это не повтор возврата или складского освобождения.

Если банк уже исполнил перевод, а completion batch упал, в БД остаётся REQUESTED,
исходные деньги и полная блокировка заказа. **Повторять нужно регистрацию того же
перевода с тем же ключом и исходящим reference, НЕ банковский перевод.** При потере
ответа после commit нужно прочитать state или повторить confirm: UNIQUE и fingerprint
сохраняют один completion. Нет автоматической банковской сверки и способа доказать,
что владелец не назвал один реальный перевод двумя разными reference. Одного
domain-separated digest недостаточно для защиты от ошибочной ручной идентификации.

FAILED для денежного факта не вводился: недоступная БД не может надёжно записать
состояние о собственном сбое. REQUESTED безопасно остаётся закрытым; completed
факт определяется только immutable ledger. При утере доступа владельца требуется
восстановить законную owner-конфигурацию; обход авторизации не предусмотрен.

### Права и гонки

Каждое request/confirm/reconcile/read и каждый CAS retry вызывают
VoyeyOwnerAuthority.identify/inspect внутри callback. Требуются личный JWT,
активные User и TelegramAdmin, точный серверный VOYEY_OWNER_TELEGRAM_ID.
Добавлены действия REFUND_REQUEST/READ/STOCK_RECONCILE, используется REFUND_CONFIRM.
Общая Admin cookie, обычный сотрудник и покупатель не получают полномочия.
SQL проверяет активного User/Admin; серверный owner ID и JWT недоступны SQL,
поэтому точное owner-сопоставление обязательно в writer, а прямой D1 доступ не API.

Pending FIRST/FINAL запрещает request. При гонке успешный review может завершиться
раньше следующего CAS retry: тогда request заново читает ВСЕ уже подтверждённые
allocations. Если request победил submit, новый чек и private media откатываются;
если submit победил, pending блокирует request. Request/confirmation/reconciliation
имеют отдельные уникальные ключи, а конкурентные одинаковые намерения дают один
экономический результат. Отзыв owner-admin при batch меняет revision и приводит
к свежему отказу без частичной финансовой записи.

### Группы, скидки и LEGACY

Обрабатывается один CheckoutOrder. Соседний ребёнок группы, его платежи, stock
и обязательства не изменяются. CheckoutPromoUse, PromoCode, распределение скидки,
лимиты, promo API/Admin и политика 2.4C3A не изменены. Квота не освобождается;
возврат берётся из подтверждённых сумм после исторической скидки.

LEGACY LifecycleService/RefundService и их прежний Admin perimeter сохранены.
Старый Refund связан FK только со старым Order. Новые refund IDs и CheckoutOrder
не обслуживаются прежними маршрутами. Локальные тесты проверяют старые cancel/refund
и новую unpaid cancellation 2.4C3A после миграции 0025.

## Изменённые файлы

Новые:

- apps/api/src/modules/checkout/refunds.ts
- apps/worker/migrations/0025_linked_checkout_refunds.sql
- apps/worker/tests/linked-refunds.test.ts
- docs/VOYEY_REFUNDS_STAGE_2_4C3B.md

Изменённые:

- apps/api/src/modules/admin/owner.ts — новые внутренние действия владельца.
- apps/api/src/modules/checkout/payment-state.ts — refund/stock/net projection и guard.
- apps/api/src/modules/checkout/cancellations.ts — дополнительный запрет refund bypass;
  исходный запрет подтверждённых денег не снят.
- packages/database/prisma/schema.prisma — пять scalar-моделей для generate/types.
- packages/database/src/checkout-payment-d1-schema.ts — read facade metadata.

Конфигурации, Worker runtime, зависимости, pnpm-lock.yaml, scripts, UI/Bot, старые
тесты и миграции не менялись. Имена @stenzo/* и STZ- сохраняются намеренно.

## Проверки

50 новых сценариев проверяют все 26 обязательных пунктов: полный GOODS/CARGO refund,
неподтверждённые деньги/over/partial/pending, replay/conflicts/concurrency, нормализацию
reference, FIRST/FINAL review и submit гонки, owner/staff/revocation, rollback request/
ledger/audit, terminal writers и SQL, stock exactly once/unsafe/retry, mixed sibling,
скидки, private history, LEGACY и default-off/no-routes/no-outbound.

Миграция проверена на заполненной 0024 SQLite базе с FIRST/FINAL, CARGO, чеками,
private media, unpaid cancellations и release: значения всех прежних таблиц
сохраняются, FK check чистый. Искусственный сбой откатывает DDL/данные целиком.
Отдельный настоящий локальный D1 Miniflare подтверждает populated upgrade/rollback,
completion audit failure и повтор регистрации перевода, независимый rollback
склада при уже completed деньгах, закрытые HTTP/Admin routes. Внешних вызовов 0.

Build, typecheck, lint, Prisma generate/validate, security/config preflight прошли.
Полный набор: **1286 passed, 5 skipped, 0 failed**: Worker/D1 692, API 249,
Admin 150, Mini App 169, Bot 16, config/security 10. Пять исторических PostgreSQL
integration tests остаются пропущенными; production не проверялся. Turbo использовал
cache для четырёх неизменившихся test-задач; новый Worker набор выполнен заново.
Остались прежние Vite use-client/sourcemap и package.json#prisma deprecated warnings;
они не блокируют успешную сборку.

SHA-256 сверка всех 657 прежних tracked файлов с исходным HEAD с нормализацией
CRLF/LF для текста: 652 неизменны, 5 изменены по заданию, потерянных 0.
Frontend/Admin/Mini App/Bot, Worker runtime/config, scripts/зависимости/lockfile,
промокоды и все 24 прежние миграции неизменны. Добавлено 4 файла, итог — 661.
Gitleaks: no leaks found, существующие ignore/allowlist не расширялись.
Git fsck и diff --check прошли.
Локальные игнорируемые логи: `.cache/voyey-stage-2-4c3b/`.
Ни один тест не использует реальных банковских операций, клиентов или ресурсов.

## Б. Актуальная карта Backend

«Работает» означает реализацию и локальные тесты, а не проверенную production-среду.

| Модуль | Работает | Внутренне / новое | Ещё нет / закрыто |
| --- | --- | --- | --- |
| Каталог | Универсальные категории, Product/SKU attributes, цена Product, stock, preorderEnabled | Исторические snapshots/мерки | SKU prices, marketplace |
| Корзина | LEGACY/IN_STOCK/PREORDER, общий лимит 99, два режима одного SKU | Mixed checkout data | Новый публичный checkout/UI |
| CheckoutGroup | Связанные 1–2 заказа, atomic/CAS, одна скидка/key | Независимые отмены/refund детей | Публичные routes/представление группы |
| Заказы | LEGACY lifecycle, новые immutable contracts | REFUND_REQUESTED/CANCELLED_REFUNDED projection | Выдача/передача/новый fulfillment, reopening |
| Склад | Резерв IN_STOCK, PREORDER reserve=0, unpaid exactly-once release | Отдельная сверка после refund, REQUIRES_RECONCILIATION | TTL, исправление каталога/stock по догадке |
| FIRST/FINAL | Manual card, private proof, owner review, исходный ledger | Gross/refunded/net отдельно, блокировка при request | Bank API, публичные новые платежи, cross-LEGACY bank dedup |
| CARGO | Arrival, immutable CARGO/final invoice | Возвращается только подтверждённая CARGO allocation | Частичные поступления и correction snapshots |
| Отмены | Owner-only unpaid; новая paid cancellation через полный refund | Терминальность и история, независимость детей | Автоотмена, частичные/после передачи товара |
| Возвраты | LEGACY Refund сохранён | Full linked request/allocations/outgoing ledger/stock retry | Частичные, комиссии, отмена request, автоматический банк |
| Сотрудники | Старые Admin/TelegramAdmin, проверенный личный owner | Свежие owner checks в каждом финансовом CAS | Персональные роли операторов, ревизия LEGACY perimeter |
| Telegram | Прежние auth/bot/RU-UZ исходники | Новые службы без Telegram calls | @askVoyey, новые notifications/operator attachment |
| D1 | Worker + Fastify + D1, private media, CAS, 25 миграций | Additive 0025 и immutable финансовая история | Реальная отдельная инфраструктура, rollout/backup/load tests |

## В. План 2.4C3C — не реализован

1. Согласовать точное начало срока первой оплаты 24 часа, единую UTC clock policy,
   границу deadline и поведение уже поданного вовремя чека. Использовать неизменяемое
   время/отдельный контракт срока; не переписывать historical order snapshots.
2. Кандидаты на auto-cancel: только новые sealed CheckoutOrder без любого FIRST/FINAL
   ledger/APPROVED, refund request, cancellation и SUBMITTED. Проверять заново
   внутри CAS, а не доверять предварительной выборке cron.
3. Pending proof сохранять для законной проверки; не отменять и не освобождать stock
   параллельно approve. После reject просроченного чека — отдельно согласованная
   политика повторной оплаты/отмены, без автоматического возврата денег.
4. Оплаченные/частично оплаченные, REFUND_REQUESTED/COMPLETED и терминальные заказы
   исключать. Поздний платёж после auto-cancel не превращать в обычную оплату;
   нужен отдельный согласованный разбор, без reopening старого долга.
5. Ввести узкую системную capability для cron отдельно от личного owner. Не подделывать
   JWT владельца и не обходить нынешний owner-only writer через общую Admin cookie.
6. Уникальный ключ auto-cancel/order, SQL guards, exactly-once stock release,
   ограниченные batch/retry/backoff и audit. Повтор cron/падение/истечение времени
   обработки не должны создавать вторую отмену или частичный stock release.
7. Проверить fake clock, submit/approve на границе срока, reject после срока,
   параллельный cron, refund, два ребёнка группы, unsafe SKU, outage и повторную
   доставку scheduled event. Не менять политику promo quota этим этапом.

Никакого cron, TTL, новых scheduled ресурсов или 24-часовой auto-cancel сейчас нет.

## Г. Риски и заблокированные переходы перед запуском

- Новые процессы остаются internal/default-off, COMMERCE_ENABLED=0. Нужны отдельное
  разрешение, VOYEY owner/card/JWT/origins, независимая инфраструктура и rollout с
  backup/проверкой применённых миграций. Реальные базы здесь не трогались.
- Банковская проверка ручная. Ошибочный reference/сумма/два фактических перевода
  не исправляются автоматически. Если банк исполнил перевод, нельзя переводить
  повторно из-за backend ошибки: сначала state и повтор регистрации операции.
- Частичный/сверхперевод, комиссии/удержания, отмена refund request и возврат после
  передачи товара заблокированы: для них нужны отдельные бизнес-правила и процесс.
- COMPLETED с REQUIRES_RECONCILIATION — финансовый успех и отдельная складская
  проблема. Будущий UI/мониторинг должен показывать её явно; нет фоновой автокоррекции.
- Старая LEGACY финансовая модель и общий Admin perimeter требуют отдельного аудита.
  Нет общей дедупликации банковских операций между историческими и новыми моделями.
- Не готовы новый fulfillment, публичные APIs/DTO/UI и защита их границ, private
  no-store responses/retention, operator roles/notifications, наблюдаемость и
  нагрузочные/восстановительные проверки Workers/D1 перед открытием магазина.

После 2.4C3B работа остановлена. Следующий этап не начат.
