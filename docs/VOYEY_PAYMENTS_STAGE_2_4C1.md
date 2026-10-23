# VOYEY Backend — этап 2.4C1

23 октября 2026. Папка: `C:/Users/USER/Desktop/Voyey`.
Ветка: `chore/voyey-bootstrap`. Исходный чистый HEAD:
`998d710bd35960faea1f4c525d4d5f4b6927065b`.
Итоговый локальный SHA указан в сообщении о завершении.

Архитектура остаётся Cloudflare Worker + Fastify + D1. PostgreSQL не требуется
для запуска; Prisma используется для типов/генерации, runtime — D1 facade.
COMMERCE_ENABLED=0 сохранён. Реальные карты, платежи, данные клиентов, Telegram
и инфраструктура не использовались. Push/merge/deployment/remote migrations отсутствуют.

## А. Реализовано

### Внутренняя служба первого платежа

`apps/api/src/modules/checkout/linked-payments.ts:LinkedCheckoutPayments`:

| Операция | Проверки и результат |
| --- | --- |
| state | Личный JWT, активный User, принадлежность заказа. Финансовая проекция из ledger. |
| instructions | Те же проверки, непогашенный первый платёж, отдельная серверная конфигурация карты. |
| submit | Чек собственного заказа, строгая claim schema, проверка файла, одна pending-подача, atomic media + metadata + audit. |
| reviewState | Актуальный owner в atomic, безопасные метаданные платежа и финансовое состояние до решения. |
| proof | Собственный чек покупателя либо актуальный owner. Байты приватного файла без публичного URL. |
| review | Только актуальный owner внутри той же atomic-операции; APPROVE или REJECT, общий аудит и ledger. |
| attachTelegramProof | Всегда 503: личные staff permissions и безопасный Admin workflow ещё не реализованы. |

Служба по умолчанию выключена. Внутренний opt-in — явный конструктор в доверенном
серверном коде/тестах; ни HTTP routes, ни env-переключателя включения не добавлено.
Публичный split checkout и обычные Admin endpoints не вызывают эти операции,
даже в тестовой среде с commerce=1. Реальные карточные реквизиты не настроены.
Существующий старый confirmNewPayment stub не стал обходным путём: он по-прежнему 503.

### Финансовая модель и источники истины

`0022_linked_checkout_payments.sql` **не удаляет, не меняет и не ослабляет**
таблицы/триггеры 0021. Поля CheckoutOrder.goodsPaid=0/unpaidGoods=goodsTotal
сохраняются как исходный снимок на момент создания, зафиксированный в 2.4B.
Они не являются текущим балансом после подтверждения платежей.

Текущие деньги и долг определяются только SQL view **CheckoutOrderFinance**:

- goodsPaid = подтверждённая goodsAmount из нового неизменяемого ledger;
- unpaidGoods = сохранённая goodsTotal − goodsPaid;
- firstPaymentDue = сохранённая firstPaymentAmount − goodsPaid;
- cargoAmount=null, cargoPaid=0, fulfillmentAllowed=0, finalPaymentEnabled=0;
- firstPaymentState: AWAITING_PAYMENT / PENDING_REVIEW / REJECTED / CONFIRMED;
- goodsPaymentState: UNPAID / PARTIALLY_PAID / PAID;
- orderState остаётся PAYMENTS_BLOCKED независимо от проверки чека и оплаты.

`payment-state.ts:readOrderFinance` — низкоуровневый reader для защищённых callers.
`group-store.ts:readCheckoutGroup` теперь отдаёт актуальные goodsPaid/unpaidGoods
из view поверх исходного контракта. Чтение группы и ответа платежа согласовано
через atomic/CAS; история цен, характеристик, скидки и политика не меняются.

**Для будущего кода:** нельзя брать текущие деньги из прямого Prisma-чтения
CheckoutOrder.goodsPaid. Использовать защищённый финансовый reader/view.
Отдельного изменяемого счётчика денег нет, поэтому он не может разойтись с ledger.

| Режим | Подтверждаемый первый платёж | goodsPaid после подтверждения | Непогашенный товар |
| --- | --- | --- | --- |
| IN_STOCK | 100% goodsTotal | Вся стоимость товара | 0 |
| PREORDER 50% | ceil(goodsTotal/2) | Первый платёж | goodsTotal − первый |
| PREORDER 100% | 100% goodsTotal | Вся стоимость товара | 0 |

Для 101 UZS: IN_STOCK 101→0, PREORDER 50% 51→50, PREORDER 100% 101→0.
Полная оплата товара не разрешает выдачу или завершение заказа на этом этапе.
SUBMITTED и REJECTED не увеличивают ни goodsPaid, ни cargoPaid.
PREORDER 100% не создаёт повторную стоимость товара; будущим остаётся только CARGO.

Заявленная declaredAmount сохраняется отдельно от expectedAmount и confirmedAmount.
Клиентская заявленная сумма не меняет серверное обязательство. Owner подтверждает
**ровно весь первый платёж** по сохранённой политике. Переплата, отрицательные,
дробные, переполненные и частичные первые платежи не принимаются. Поддержка
нескольких частичных переводов для одной первой оплаты не реализована.
Текущие каталог/промокод не пересчитываются при review, скидка не применяется снова.

### Таблицы, SQL и ledger

| Сущность | Что хранит / защищает |
| --- | --- |
| CheckoutPayment | ID, FK на новый заказ, FIRST phase, источник, submitter/attachedBy, declared/expected/confirmed amounts, приватный proof key/MIME/size/SHA256, SUBMITTED/APPROVED/REJECTED, reviewer/time/reason, submit/review keys и fingerprints. |
| CheckoutPaymentLedger | Неизменяемая подтверждённая операция MANUAL_CARD_TRANSFER: payment/order, FIRST, goodsAmount, cargoAmount=0, bankOperationDigest, verifiedBy/At и review key/fingerprint. |
| CheckoutOrderFinance | Согласованная текущая финансовая проекция, без изменения исходного 0021 контракта. |

FK/UNIQUE/CHECK и триггеры обеспечивают:

- Один pending-чек и одно APPROVED подтверждение FIRST на заказ.
- UNIQUE(submittedBy,submitKey), UNIQUE(reviewedBy,reviewKey).
- Один ledger на payment и на (order,FIRST).
- UNIQUE(bankOperationDigest) на весь новый ledger, независимо от покупателя/заказа.
- Только целые положительные UZS; сумма ledger равна сохранённому первому платежу.
- Нельзя напрямую выставить APPROVED без соответствующего ledger.
- INSERT ledger атомарным SQL-триггером переводит ровно связанный чек в APPROVED;
  проверяются согласованность суммы, владельца решения, timestamp/key/fingerprint.
- Review допускается только из SUBMITTED. Терминальные решения и ledger неизменяемы.
- Нет CARGO/final phase, удаления истории, отмен или возвратов.
- Приватный proof должен существовать полностью и соответствовать MIME/размеру.
- Новые и LEGACY payment IDs/proof keys не могут пересекаться.
- Чек после привязки нельзя переписать, сделать публичным или удалить.
- Revision triggers покрывают новые payment/ledger и MediaObject/MediaChunk.

Цена, режим, скидка, получатель и строки заказа остаются в защищённой 0021 модели.
Никаких старых requiredPrepayment=50% для IN_STOCK не используется.

### Защита от повторного перевода

Для APPROVE owner обязан указать исходный уникальный банковский идентификатор
операции bankOperationReference и фактически проверенную confirmedAmount.
Без банковского reference подтверждение не принимается. Регистр и разделители
нормализуются; сохраняется только domain-separated SHA-256 digest, без исходного
банковского reference, номера карты, счёта, имени плательщика или выписки.
Digest не возвращается покупателю и не пишется в audit metadata.

Изображение, его SHA-256, источник WEBSITE/Telegram и заявленная сумма **не являются**
доказательством банковского поступления. Повторно пересланная/перекодированная
картинка не разрешает повторное использование проверенной банковской операции:
её UNIQUE digest допускает ровно одно зачисление в новом ledger. Не запрещено
само существование двух заявлений с одинаковой картинкой у разных заказов;
раздельные зачисления требуют независимых реально проверенных банковских операций.

Проверки лимита/обязательства, актуальных owner прав, bank digest, terminal status,
вставка ledger, SQL-transition и аудит находятся в одном revision-guarded D1 batch.
Конкурентные подтверждения одного чека либо одного банковского reference не удваивают деньги.
Повтор с тем же review key и намерением возвращает состояние без новой финансовой
записи; другой ключ/решение/сумма/reference после решения дают 409.
Review key нельзя переносить на другой платёж.

Важная граница: Backend не подключён к банку и не проверяет фактическое поступление
автоматически. Владелец должен сверить его вручную и использовать один и тот же
канонический bank reference. Если вручную присвоить одному переводу разные
фиктивные identifiers, система без банковской интеграции не сможет доказать их
тождество. Процедура owner review до открытия должна это исключать.
У исторических LEGACY-платежей нет такого банковского реестра: межконтурная
дедупликация с ними не заявляется реализованной. До совместного реального запуска
нужна согласованная проверка/регистрация операций всех активных каналов оплаты.

### Владелец и атомарность

`admin/owner.ts:VoyeyOwnerAuthority` сохранён и расширен:

- identify проверяет личный VOYEY JWT, без доверия клиентской роли/ID.
- inspect выполняется внутри payment atomic callback при каждой CAS-попытке:
  актуальный User ACTIVE, TelegramAdmin active и серверный VOYEY_OWNER_TELEGRAM_ID.
- Отказ возвращается из callback с audit, без financial writes, и затем выдаётся
  403/503. Отсутствующий owner не назначается автоматически.
- APPROVE/REJECT и их аудит находятся в той же batch-границе, что inspect.
- Изменение User/TelegramAdmin после чтения прав меняет _Revision: старый batch
  отклоняется, повторная попытка перечитывает отзыв и фиксирует отказ.
- Ledger/decision SQL дополнительно проверяет активность reviewer.
- Даже replay проверяет актуальные права; отозванный owner не проходит.

Серверная конфигурация owner в текущем проекте остаётся пустой; реальных ID нет.
Будущий Worker должен получать отдельную конфигурацию VOYEY из доверенного
серверного binding. Runtime env текущего изолированного проекта не активировался.
Для немедленного отзыва используется User/TelegramAdmin в БД; конфигурация
развёртывания считается неизменяемой для обслуживаемого запроса.

Audit содержит внутренние actor/payment/order ID, действие, phase и код причины.
Токенов, изображений, полных реквизитов, банковского reference и комментариев
со свободным чувствительным текстом в metadata нет. Повторы могут добавлять
аудит попытки авторизации; финансовая запись и financial action не дублируются.
Ошибка ledger, status transition или audit откатывает всю операцию.

### Приватные чеки и Telegram

Используется текущий D1 storage MediaObject/MediaChunk, не новый storage/provider.
`d1/media.ts:D1MediaBucket.putInBatch` переиспользует прежнюю подготовку media SQL;
у LEGACY put остаётся прежний интерфейс и отдельный batch.
Новый submit включает MediaObject, все бинарные chunks, CheckoutPayment и audit
в общий atomic batch. Нет предварительной внешней загрузки/неатомарного cleanup:
сбой не оставляет ни чека без метаданных, ни метаданных без файла.

Проверяются JPEG/PNG/WebP, заявленный MIME против содержимого, существующая
проверка структуры/размеров изображения и максимум 5 MiB. Это не OCR и не
проверка подлинности банковского документа. PDF, SVG и произвольные файлы не разрешены.
Idempotency и один pending-чек предотвращают дубли на повторе запроса.
После REJECTED можно подать новую попытку; история прежней сохраняется.

Proof key случайный, хранится с private=1 и никогда не отдаётся как публичная ссылка.
Чтение требует покупателя-владельца заказа либо актуального owner; обычному
сотруднику доступ закрыт. Прямой /media/payment-proofs/... возвращает 404.
У новых proof media установлен SQL запрет изменения/удаления после привязки.
Отдельный retention/удаление личных документов пока не реализован.

Модель источников предусматривает WEBSITE и TELEGRAM_OPERATOR, а также submitter
и attachedBy. На текущем этапе WEBSITE привязывается только покупателем к своему
заказу. Telegram attachment заблокирован и в службе, и на SQL INSERT: безопасных
персональных прав оператора ещё нет. Чат @askVoyey, bot, callbacks, пересылки,
уведомления и интерфейс не подключались.

### LEGACY-права, оставшиеся без изменения

Новые обязанности owner-only не распространяются автоматически на старый контур:

- PaymentService approve/reject и старые Telegram payment-review callbacks.
- Запрос финальной оплаты и назначение CARGO.
- Старые изменения статусов, разрешающие выдачу/завершение заказа.
- Lifecycle cancellation, stock release и refund completion.
- Изменение закупочной стоимости, расходов и другие финансовые Admin-операции.

Эти действия пока используют прежний Admin permission perimeter и требуют отдельной
ревизии. Общая web-admin cookie не подтверждает личную owner identity.
Новые CheckoutOrder/CheckoutPayment не принимаются старыми handlers; их права
не расширялись. Новая операция не создаёт LEGACY Payment или Refund.

### Проверки и изменённые файлы

Build, typecheck, lint, Prisma generate/validate, full tests, security/config
preflight, Gitleaks, Git integrity и сохранность старых файлов проверены локально.
Итог: **1165 passed, 5 skipped, 0 failed**: API 249, Worker/D1 571, Admin 150,
Mini App 169, Bot 16, config/security 10. Новый Worker набор выполнен заново;
последний Turbo прогон — 7 успешных задач, 6 из cache. Прежние предупреждения
Prisma о package.json#prisma и Vite use-client/sourcemap остались без изменения.
Gitleaks не обнаружил секретов; исключения сканера не расширялись. Git fsck и
diff check без ошибок. По SHA-256 с нормализацией CRLF/LF проверены все 643 файла
исходного HEAD: 637 неизменны, 6 изменены по задаче, отсутствующих нет.
Добавлены 6 файлов; после коммита проект содержит 649 отслеживаемых файлов.
Итоговый SHA — в сообщении о завершении; логи в игнорируемой `.cache/voyey-stage-2-4c1/`.

Добавлены 28 серверных тестов: три режима первой оплаты, claim/received distinction,
private proof, ownership, MIME/лимиты, повторные/конкурентные подачи и approvals,
bank reference uniqueness (также SQL), overpayment/partial denial, новый owner guard,
отзыв прав между чтением и commit, rollback media/ledger/audit/REJECT, независимость
дочерних заказов, неизменность скидки, сохранение 0021, запрет старых handlers,
отсутствие новых routes и настоящая изолированная D1/Miniflare.
Реальные PostgreSQL integration tests остаются пропущенными; legacy наборы сохранены.

Новые файлы:

- `apps/api/src/modules/checkout/linked-payments.ts`.
- `apps/api/src/modules/checkout/payment-state.ts`.
- `apps/worker/migrations/0022_linked_checkout_payments.sql`.
- `apps/worker/tests/linked-payments.test.ts`.
- `packages/database/src/checkout-payment-d1-schema.ts`.
- Этот отчёт.

Изменены:

- `apps/api/src/modules/admin/owner.ts` — совместимый transactional inspect и owner reads.
- `apps/api/src/d1/media.ts` — постановка прежних media statements в общий batch.
- `apps/api/src/modules/checkout/group-store.ts` — актуальный ledger balance и согласованное чтение.
- `apps/worker/tests/helpers/sqlite.ts` — binary bind support и доступ к тестовому adapter для CAS race.
- `packages/database/prisma/schema.prisma` — две scalar-модели, без PostgreSQL runtime.
- `packages/database/src/d1-schema.ts` — новые read metadata.

Миграции 0001–0021 не менялись. SQL 0022 авторитетен для FK/CHECK/UNIQUE/views/triggers;
исторический генератор D1 схем не запускался. Frontend/Admin UI/Mini App/Bot,
Worker src/config, lockfile и зависимости не менялись. Оригинальный STENZO не трогался.

## Б. Актуальная карта Backend

«Работает» здесь означает реализацию и локальные тесты. Production не проверялся.

| Модуль | Реализовано | Только внутренне / недоступно покупателям |
| --- | --- | --- |
| Каталог и SKU | Универсальные атрибуты категорий/Product/SKU, Product price, размеры/цвет, preorderEnabled | SKU prices/marketplace отсутствуют; UI не адаптировался этим этапом |
| Корзина | LEGACY/IN_STOCK/PREORDER, две строки SKU, общий cap99 и stock checks | Выбор новых способов оплаты в UI, публичный split checkout |
| CheckoutGroup | Атомарная группа 1–2 заказов, snapshots, promo once, durable idempotency | Commit выключен по умолчанию; HTTP/Admin маршрутов нет |
| Заказы | LEGACY lifecycle; новый неизменяемый контракт и отдельная текущая финансовая проекция | Новый order lifecycle/выдача/завершение закрыты |
| Склад | Резерв IN_STOCK, PREORDER без резерва, legacy null | Освобождение/TTL новых резервов ещё закрыты |
| Оплата и ledger | LEGACY; внутренний manual-card FIRST 100%/50%, APPROVE/REJECT и уникальный bank digest | Новая оплата default-off, без публичных API и без реальных реквизитов |
| Чеки | Приватный D1, atomic media/metadata, MIME/ownership, owner review | Новый upload/proof/review только внутренний; operator attachment заблокирован |
| CARGO | LEGACY; новый PREORDER сохраняет unknown | Начисление/оплата нового CARGO отсутствуют |
| Возвраты | LEGACY | Новые cancel/refund/release не реализованы |
| Сотрудники/owner | Существующие sessions/JWT/TelegramAdmin; новый owner inspect в финансовой транзакции | Реальный owner не настроен, staff attachment и ревизия legacy permissions впереди |
| Telegram | Прежние RU/UZ и механизмы в коде сохранены; новые источники документов описаны | Нет подключения @askVoyey, нового bot/callbacks/уведомлений/кнопки |
| База данных | Worker + Fastify + D1; 0022, append-only ledger, finance view, ограничения и revision | Реальные миграции не применялись; требуется отдельный rollout VOYEY |

## В. План 2.4C2 — не реализован

1. Ввести подтверждённое поступление PREORDER и неизменяемый final invoice/snapshot
   обязательства. Только после поступления owner назначает CARGO отдельной
   абсолютной суммой, отличая unknown от 0 и не смешивая его с такси.
2. Рассчитывать остаток товара по сохранённому goodsTotal минус подтверждённые
   goods allocations ledger. Для PREORDER 50% это оставшиеся товары + CARGO;
   для PREORDER 100% — только CARGO. Не переоценивать каталог/скидку/первый платёж.
3. Новым миграционным шагом расширить phases, допустимые allocations и invoice
   states. Текущие FIRST entries/проверенные банковские digest оставить неизменными.
   Общий bank registry должен защищать от использования первого перевода ещё раз.
4. Начисление CARGO делать идемпотентно: одна версия начисления/счёта, повтор с тем
   же намерением возвращает прежний результат. Изменение уже оплаченного invoice
   требует отдельного owner-аудита и правил корректировок, не простого прибавления.
5. Финальные proof/review/ledger/financial projection изменять одним owner-authorized
   CAS batch. Проверять сумму, phase, отсутствие overpayment и банковского duplicate,
   а также конкурентные final approvals и связь с первым платёжным ledger.
6. Нулевой final due не создаёт фиктивного платежа. Выдача, статусы завершения,
   возвраты, отмены и взаимодействие Telegram требуют собственных согласованных
   правил и тестов, не включаются автоматически вместе с финальным платежом.

## Г. Что необходимо до открытия новых заказов покупателям

- Завершить final PREORDER/CARGO, а также безопасные отмены/возвраты/release stock,
  pending proofs, expiration и политику частичной отмены CheckoutGroup/промокода.
- Определить delivery/fulfillment lifecycle: PAID товара сам по себе не выдача.
- Настроить отдельные VOYEY owner/JWT/card/origins и реальную независимую D1,
  проверить её migrations/state. Делать это только отдельным разрешённым этапом.
- Согласовать процедуру проверки и канонический bank reference; исключить повторный
  учёт между новым ledger, LEGACY и платежами из переписки. Старый контур не даёт
  общей гарантии банковской дедупликации или исключительности owner.
- Ввести персональные operator permissions перед Telegram attachment; не использовать
  общую Admin cookie как owner/employee identity.
- Отдельно добавить защищённые HTTP routes/DTO, rate limits, multipart bounds,
  CSRF там, где используются cookie, и private/no-store proof responses. Сейчас
  отсутствие этих HTTP operations — намеренная backend-блокировка.
- Подготовить UI для двух заказов/процентов, receipt history, review и понятных
  финансовых состояний; UI/дизайн этим этапом не менялись.
- Согласовать retention/удаление приватных чеков, восстановление и сверку ledger,
  лимиты D1/Workers и работу больших файлов в реальном независимом окружении.
- Перед реальным запуском отдельно проверить ручную оплату в согласованном процессе,
  миграции, безопасность и постепенный feature rollout. COMMERCE_ENABLED остаётся 0.

Простыми словами: Backend уже умеет внутри тестового серверного контура принять
приватный чек, дождаться решения владельца и один раз зачесть первый платёж.
Сайт ещё не открывает эту возможность покупателю. Остаточная оплата предзаказа,
CARGO, выдача, отмены и возвраты остаются следующими отдельными этапами.
