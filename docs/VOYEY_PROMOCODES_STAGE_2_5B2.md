# VOYEY — Backend 2.5B2: резерв промокода и жизненный цикл FIRST

Дата: 24 октября 2026 года. Рабочая копия: `C:\Users\USER\Desktop\Voyey`.
Ветка: `chore/voyey-bootstrap`. Исходный чистый HEAD: `06e2ef026892605354f0fbf364b445d46429e3c4`.
Origin: `https://github.com/xopesa/voyey.git`.

Локальный коммит реализации: **`f8ac64575c9789eac9abb2b8b927660849f0b091`**. Отчёт фиксируется отдельным локальным коммитом.

## Результат и границы

Реализован внутренний lifecycle промокодов v2: RESERVED при checkout, CONSUMED при подтверждении FIRST и RELEASED при безопасной неоплаченной отмене. Квоты учитывают резерв, подтверждённое использование и прежние записи использования без дублирования.

Новые оформления получают серверное окно FIRST на 24 часа и максимум три принятые отправки чека. Своевременный pending удерживает резерв независимо от истечения времени. Первый подходящий поздний REJECT предоставляет одно дополнительное окно на два часа; повторные решения не сдвигают его.

**Публичный запуск не выполнен.** `SaleModeCheckoutCommit`, платежи, owner review, отмены и refund остаются внутренними и выключенными по умолчанию. Новых HTTP routes и environment-переключателей нет. `COMMERCE_ENABLED=0` сохранён. Нет cron, автоматической отмены, восстановления CONSUMED после refund, реальных банков/Telegram, Cloudflare-ресурсов, push, merge или deployment. Выводы о работоспособности подтверждены локальными тестами, а не production.

## А. Архитектура состояний

Миграция `apps/worker/migrations/0028_promo_reservation_lifecycle.sql` добавляет четыре таблицы и read-only SQL view:

| Объект | Назначение и защита |
| --- | --- |
| `CheckoutFirstWindow` | Один immutable срок на CheckoutOrder и CheckoutGroup. `expiresAt=createdAt+86400000`; createdAt совпадает с серверным временем группы. Только выбранный режим и положительный заказ. |
| `CheckoutFirstExtension` | Не более одного продления на заказ. FK на конкретный отклонённый FIRST-чек; `expiresAt=decisionAt+7200000`. |
| `PromoReservation` | Один код на группу и заказ, FK на sealed v2 policy и FIRST window, покупатель, скидка и immutable policy/quote snapshot. |
| `PromoReservationEvent` | Неизменяемые RESERVED/CONSUMED/RELEASED. Терминальное событие только одно; CONSUMED требует FIRST ledger, RELEASED — sealed unpaid cancellation без денег и pending. |
| `PromoReservationState` | Представление состояния из событий. Нет открытого изменяемого столбца status. |

Все четыре таблицы имеют FK, CHECK/UNIQUE, запрет UPDATE/DELETE и revision-триггеры. Каждый переход пишет аудит. Событие RESERVED автоматически создаётся при вставке reservation, CONSUMED — при FIRST ledger, RELEASED — при seal cancellation. Ошибка события или его аудита откатывает породившую операцию.

Истёкший timestamp **не является RELEASED**. Пока нет законной отмены, RESERVED продолжает занимать квоту, а складской резерв IN_STOCK сохраняется. Pending не может потерять промокод из-за часов. CONSUMED в текущей модели никогда не переводится в RELEASED и не восстанавливается после refund.

## Б. Checkout, снимки и квоты

### Новый внутренний путь

`apps/api/src/modules/checkout/sale-mode-commit.ts:SaleModeCheckoutCommit.create` по умолчанию выключен. При явном внутреннем включении новые selected checkouts используют lifecycle B2, включая заказы без промокода. Явный второй аргумент `false` оставляет только прежний контракт B1 для исторической совместимости; он не подключён к HTTP и не допускает v2.

`apps/api/src/modules/checkout/group-commit.ts:LinkedCheckoutCommit.create` выполняет в одной `atomic`/CAS операции:

1. Проверку активного покупателя и idempotency key.
2. Чтение текущей общей корзины и выбор только одного saleMode.
3. Прежние проверки каталога, SKU, количества, мерок, характеристик, текущей цены и stock/preorderEnabled. Общий лимит 99 одного SKU учитывает обе вкладки и LEGACY.
4. Серверный v2 quote по выбранным строкам и текущей политике.
5. Проверку общих/per-user квот с учётом RESERVED и CONSUMED.
6. Создание одной группы, одного заказа, item/financial snapshots, FIRST window и reservation с policy/quote snapshot.
7. Резерв IN_STOCK; PREORDER резервирует ноль.
8. Аудит, удаление только выбранных CartItem и seal группы.

Ошибка любого шага откатывает заказ, промокод, stock, корзину и аудит. В retry нет внешних побочных эффектов. Изменение цены, доступности, категории, кода или квоты приводит к повторной проверке свежих данных.

Режимы имеют самостоятельные группы, ключи, скидки и обязательства. IN_STOCK FIRST=100%, без CARGO. PREORDER FIRST=50% с прежним округлением либо 100%; CARGO назначается отдельно после поступления и не входит в скидку. Вторая вкладка и тот же SKU в другом режиме не удаляются.

### Идемпотентность

Новый fingerprint использует `VOYEY_RESERVED_MODE_V1` и сохраняет выбранный режим, нормализованного получателя, FIRST-процент и код. Replay возвращает сохранённую группу до чтения новой корзины, не создаёт второго reservation и не пересчитывает скидку после отключения/истечения кода.

Повтор ключа с другим режимом или намерением конфликтует. Ключи старого B1/исторического mixed-контракта не выдаются за новый B2 replay. Прежний контракт можно воспроизвести прежним внутренним путём; исторические строки и fingerprints не переписываются.

### Проверка политики и единый счётчик

`marketing/promo-store.ts:readPromoPolicy` читает одну сохранённую конфигурацию для preview и commit. `marketing/promo-reservations.ts:quoteReservedPromo` вызывает прежний `evaluatePromoPolicy` внутри checkout callback. Сохранены:

- PERCENT 1–99% и FIXED не выше floor(99% подходящей суммы).
- Положительный goodsTotal/FIRST; отсутствие фиктивных нулевых скидок/платежей.
- Ограничения категорий, товаров, режимов, исключения, PERSONAL по внутреннему User и BLOGGER campaign association.
- Активность и строгие сроки кода на момент оформления.
- Отсутствие скидки на CARGO.

`promoV2Usage` складывает unreleased `PromoCodeRedemption`, unreleased `CheckoutPromoUse` и `PromoReservation` без RELEASED. В v2 **нет зеркального CheckoutPromoUse**, поэтому reservation/consumption не считаются дважды. CONSUMED продолжает занимать ровно одно использование. SQL BEFORE INSERT дополнительно проверяет глобальную и аккаунтную квоты, а revision/CAS не допускает перерасхода конкурентными checkout.

Ограничения относятся к одному PromoCode. PromoCampaign остаётся существующей ассоциацией BLOGGER; новый общий пул квоты нескольких разных кодов кампании не добавлялся.

`PromoFoundation.preview` теперь видит занятые резервы, но остаётся read-only: quote не резервирует квоту и не гарантирует её доступность позже. Схема до 0028 поддерживается только для исторических тестов чтения: новый commit без миграции не сможет создать окно/резерв и завершится отказом.

Снимок сохраняет конфигурацию и рассчитанные строки/скидку/суммы. После оформления отключение кода, окончание акции или изменение каталога не изменяют reservation и финансовую обязанность. Owner APPROVE использует подтверждённую сумму сохранённого FIRST, а не текущий каталог или активность акции.

## В. FIRST: 24 часа, pending, три попытки и одно продление

`checkout/first-window.ts` содержит серверные константы, чтение окна и `assertFirstSubmission`. Новые параметры времени/попыток от клиента не принимаются. В `LinkedCheckoutPayments.submitPhase` время вычисляется внутри atomic callback; SQL дублирует проверку сохранённого submittedAt. Сроки — абсолютные UTC epoch milliseconds, без календарного прибавления суток и влияния часового пояса.

| Сценарий | Поведение |
| --- | --- |
| `submittedAt < expiresAt` | Обычная отправка разрешена при свободной попытке и отсутствии pending/подтверждения. |
| `submittedAt == expiresAt` или позже | Новая FIRST-подача запрещена, если нет ещё действующего дополнительного окна. |
| Pending принят вовремя | RESERVED сохраняется после deadline; второй SUBMITTED той же фазы запрещён. Owner может решить позже. |
| APPROVE своевременного pending после deadline | FIRST ledger и CONSUMED фиксируются атомарно; время окончания акции повторно не применяется. |
| REJECT до первоначального deadline | Нового окна нет; остаётся неиспользованное основное время. |
| Первый подходящий REJECT в момент первоначального deadline или позже | Создаётся одно окно `[decisionAt, decisionAt+2 часа)`. Требуется чек, принятый до основного deadline. |
| Повтор review / следующий REJECT | Двухчасовое окно не сдвигается и не создаётся снова. |
| Подача точно в конце дополнительного окна | Запрещена. За 1 ms до конца разрешена при оставшихся попытках. |
| Pending принят в дополнительном окне | Удерживается до решения, даже после конца окна. Поздний REJECT не выдаёт ещё два часа. |
| Три принятых FIRST-чека | Четвёртый запрещён даже при ещё действующем окне. Продление не добавляет попытки. |

Попытки считаются по неизменяемым `CheckoutPayment` с phase FIRST, включая SUBMITTED/REJECTED/APPROVED. Принятая первая отправка — попытка 1. Повтор submit key возвращает прежний результат до проверки нового окна и не занимает попытку. Неверный файл, невалидная сумма и отказ транзакции до создания claim не расходуют попытку и не оставляют приватный media-объект.

FIRST и FINAL считаются раздельно. Новые guards касаются только FIRST заказов с CheckoutFirstWindow. FINAL сохраняет прежние сроки, проверки, повторные подачи и собственную уникальность pending. Отсутствие остаточного долга PREORDER FIRST100/CARGO0 по-прежнему даёт FINAL=0 без нового платежа и без повторного расходования промокода.

`LinkedCheckoutPayments.state` дополнен `firstPaymentWindow` только для новых B2-заказов: первоначальный/effective deadline, момент продления, attempts и pendingPaymentId. Это информация для будущего интерфейса, а не самостоятельное разрешение на submit. Исторические orders без окна получают прежнюю форму состояния; срок им задним числом не назначается.

## Г. Owner review, отмена, concurrency и rollback

При review используется существующий `VoyeyOwnerAuthority` внутри того же atomic callback: личный JWT, ACTIVE User, активный TelegramAdmin и соответствие серверному VOYEY_OWNER_TELEGRAM_ID. При CAS retry полномочия проверяются заново. Клиентские роли, owner ID и денежные суммы не заменяют серверную проверку. Подтверждается ровно сохранённое обязательство; банковская дедупликация и приватность proof сохранены.

Вставка FIRST ledger автоматически создаёт CONSUMED-event с FK на ledger, его verifiedBy/verifiedAt и аудитом. Это часть той же D1-транзакции, а не последующее best-effort действие. Повтор approval не создаёт ни новых денег, ни второго использования. REJECT не создаёт денежный ledger; допустимое продление и аудит также входят в эту транзакцию.

Исходник `checkout/cancellations.ts` не изменён. Его действующие проверки запрещают отмену при подтверждённых FIRST/FINAL деньгах, SUBMITTED, конфликтующем invoice/refund и небезопасном stock. После полного выполнения stock release и аудита seal cancellation автоматически записывает RELEASED. Сбой release/event/audit откатывает cancellation и stock. Отдельного writer для освобождения промокода нет; удалить/изменить событие нельзя.

Проверены гонки: два checkout последней общей квоты, один User с двумя вкладками, разные User, одинаковые/разные idempotency keys, параллельный submit, APPROVE против REJECT, cancel против submit/approve, отзыв User/Admin/owner-конфигурации при повторной CAS-проверке. В каждом случае согласованы деньги, claim, quota и stock.

Также проверены шесть классов отказов: reservation/window/event INSERT, приватный payment batch, ledger, аудит reserve/consume/release/extension, небезопасный stock и прерванная миграция. Отказ не оставляет частично созданного заказа, отдельного использования промокода или лишней попытки.

## Д. Совместимость и оставшиеся ограничения

- V1 API/DTO, максимум 90%, существующие счётчики и финансовые permissions остаются прежними. Новые selected B2 заказы даже без v2 получают новый FIRST-window; исторические legacy/B1/mixed-заказы не получают его автоматически.
- Старые SQL-барьеры `PromoCodeRedemption_advanced_blocked` и `CheckoutPromoUse_advanced_blocked` сохраняются: v2 не может попасть в старые quota writers. Существующий путь mixed groups сохранён.
- Предел v2 99%, политика FIXED, положительные суммы и текущий финансовый калькулятор не переписаны.
- FIRST/FINAL, CARGO, owner review, private proof, bank digest, refund ledger и immutable order snapshots совместимы с новыми reservation.
- После REQUESTED/COMPLETED refund использование CONSUMED остаётся занятым. Денежный refund и сверка stock работают по прежним правилам и не превращаются в восстановление акции.
- SQL `CheckoutGroup_seal` пересоздаётся только в новой миграции: прежние проверки сохранены, допустимый источник discount дополнен отдельным PromoReservation. Новые guards не допускают одновременно reservation и CheckoutPromoUse.
- Нет автоматического expiry или cron. Просроченные активные RESERVED удерживают квоту до безопасной отмены. Pending требует ручного решения владельца; произвольный timeout не освобождает его.
- Будущие buyer/Admin HTTP и UI должны использовать окно/остаток попыток и повторную серверную проверку при отправке. Их подключение не выполнялось. Старые readers и платёжные инструкции сами по себе не означают разрешение нового FIRST submit.
- Публичные номера STZ и внутренние `@stenzo/*` не изменены. Дизайн, UI, Bot, media storage, конфигурация инфраструктуры и исходный STENZO не изменялись.

## Е. Файлы, миграция и проверки

### Изменённые и добавленные файлы

| Файл | Изменение |
| --- | --- |
| `apps/api/src/modules/checkout/group-commit.ts` | B2 fingerprint, live v2 quote, атомарные FIRST window и reservation |
| `apps/api/src/modules/checkout/sale-mode-commit.ts` | Default-off entrypoint, новый lifecycle при явном внутреннем включении; сохранён исторический opt-out |
| `apps/api/src/modules/checkout/linked-payments.ts` | Серверная проверка FIRST window/attempts после проверки replay, окно в state reader |
| `apps/api/src/modules/checkout/first-window.ts` | 24h/2h/3 константы, чтение окна и submit guard |
| `apps/api/src/modules/marketing/promo-foundation.ts` | Preview учитывает reservations; общее чтение конфигурации |
| `apps/api/src/modules/marketing/promo-store.ts` | Read-only загрузчик v2 policy/scope/exclusions |
| `apps/api/src/modules/marketing/promo-reservations.ts` | Единый usage и live quote для нового checkout |
| `apps/worker/migrations/0028_promo_reservation_lifecycle.sql` | Четыре append-only таблицы, state view, timing/transition/quota/audit guards |
| `packages/database/prisma/schema.prisma` | Scalar-модели новых таблиц; Prisma остаётся исторической/type metadata, runtime D1 |
| `packages/database/src/promo-lifecycle-d1-schema.ts` | Новая D1 scalar metadata |
| `packages/database/src/d1-schema.ts` | Подключение новой metadata |
| `apps/worker/tests/promo-reservations.test.ts` | 70 новых серверных сценариев |
| `apps/worker/tests/sale-mode-checkout.test.ts` | Два явных указания исторического B1-контракта для прежних migration/compatibility fixtures |
| `docs/VOYEY_PROMOCODES_STAGE_2_5B2.md` | Этот отчёт, контракт B3 и план expiry |

Миграции `0001–0027` не изменены. `0028` добавляет таблицы и триггеры, не выполняет rebuild таблиц и не обновляет исторические финансовые строки. Единственный заменяемый guard — CheckoutGroup_seal; его прежние условия сохранены с дополнительным независимым источником v2 discount. Новые таблицы и аудит участвуют в общей revision/CAS-схеме.

Upgrade заполненных SQLite и Miniflare D1 проверен с legacy order/redemption, исторической mixed group, подтверждёнными платежами, завершённым refund и существующей политикой v2. Сравнены все прежние таблицы приложения до/после upgrade и искусственно прерванной миграции. Служебная `_Revision` закономерно увеличивается; закрытые `_cf_*` не являются таблицами приложения и не читаются. Новые события не задним числом назначаются старым заказам. FK check, SQLite integrity_check и D1 quick_check успешны.

### Итоговый прогон

| Проверка | Результат |
| --- | --- |
| Prisma generate | Успешно |
| Prisma validate | Успешно |
| Config/security preflight | Успешно, VOYEY изолирован, ресурсы/credentials неактивны |
| Build | Успешно; прежний локальный Worker dry-run |
| Typecheck | Успешно |
| Lint | Успешно |
| Полный `pnpm test` | **1456 passed, 5 skipped, 0 failed** |
| Новые тесты B2 | **70 passed** |
| Worker / API | **862 passed** / **249 passed, 5 skipped** |
| Admin / Mini App / Bot / config isolation | **150 / 169 / 16 / 10 passed** |
| Gitleaks | Секретов не обнаружено, прежние исключения не расширялись |
| Git | `git diff --check`, `git fsck --full` успешны |
| Сохранность | Все **671** исходный файл сохранены: 664 неизменны, 7 изменены по задаче; удалений нет |

Проверки выполнены Node 24.21.0 / pnpm 10.17.1. Унаследованные credentials удалялись из окружения runner; PostgreSQL/infrastructure integrations не запускались. Пять пропусков — исторические PostgreSQL tests, не отключение новых сценариев. Vite выдаёт прежние предупреждения о `use client` и sourcemap в UI; build завершается с exit 0. Зависимости и lockfile не изменялись.

Подтверждены строгие границы первоначального и дополнительного окна, replay, 3/4-я попытка, поздние решения, pending во время обоих deadline, три часовых пояса/полночь, единая квота, SQL history guards, CAS при цене/scope/деактивации, concurrent checkout/submit/review/cancel, owner revocation, ошибки аудита/ledger/reservation/media и rollback. FINAL допускает прежние повторные подачи независимо от лимита FIRST; отдельно проверен FINAL=0. Внешних запросов Miniflare outbound handler зафиксировано **0**.

SHA-256 сохранность сверяется относительно исходного HEAD: текст нормализуется CRLF/LF, бинарные файлы сравниваются без нормализации. UI, Mini App, Bot, Worker runtime, старые миграции, scripts, конфигурации и lockfile не изменены. Полные локальные логи и результаты находятся в игнорируемой `.cache/voyey-stage-2-5b2/`, в Git не включаются.

После коммитов кода и отчёта заключительная проверка `git status --porcelain` подтверждает чистое рабочее дерево. В Git сохранено **678 файлов**. Итоговый SHA коммита документации сообщается отдельно, чтобы не записывать самоссылочный хеш. Push/deployment/remote migrations отсутствуют.

## Ж. Актуальная карта Backend

| Модуль | Реализовано и проверено локально | Что остаётся закрытым / отсутствует |
| --- | --- | --- |
| Каталог | Универсальные характеристики, категории, SKU, Product price, stock/preorderEnabled, live validation | Цены SKU и новые UI не добавлялись |
| Корзина | Общая корзина, два режима SKU, лимит 99, выбранные CartItem | Новый интерфейс вкладок отсутствует |
| Checkout | Один saleMode → одна группа/заказ, CAS/replay, immutable snapshots, независимая вторая вкладка | Default-off, без нового buyer/Admin API |
| Промокоды v1 | Прежний контракт до 90%, legacy/linked usage | Rollout на новую модель отдельно |
| Промокоды v2 | 1–99%, FIXED ceiling, scopes/режимы/PERSONAL/BLOGGER, reservation quota и события | Публичное включение отсутствует |
| FIRST | 24 часа, три accepted submit, pending hold, одно продление, owner approval + consumption | Нет публичных endpoints и автоматического банковского подтверждения |
| FINAL/CARGO | Сохранены PREORDER arrival, отдельный CARGO, остаток, FINAL0, private proof/ledger | Новые UI/логистика не подключались |
| Unpaid cancellation | Старые guards, stock release once, атомарный RELEASED | Автоотмена/cron не реализованы |
| Refund | Actual received money, REQUESTED/COMPLETED, immutable outgoing ledger и reconciliation | Нет восстановления CONSUMED до 2.5B3 |
| Cloudflare | Worker + Fastify + D1, локальная схема 0028, изоляция STENZO | Настоящие ресурсы/deployment не создавались; COMMERCE_ENABLED=0 |

## З. Технический контракт 2.5B3 и сопряжение с expiry

### Восстановление использования по вине VOYEY — проект контракта, не writer

Будущий внутренний запрос должен содержать reservationId, owner operationKey, причину `CUSTOMER`/`VOYEY` и обоснование. Решение принимает свежая VoyeyOwnerAuthority в atomic callback. Клиентское указание причины не является разрешением.

Для восстановления необходимы: CONSUMED, принадлежащий конкретной группе; неизменяемое owner-решение `VOYEY`; полная отмена и завершённый refund фактически полученных денег; нулевой net received по ledger; отсутствие pending и ранее предоставленного восстановления. Суммы/этапы берутся из существующих финансовых ledgers, а не из запроса. Причина CUSTOMER или отсутствие решения не дают кредит квоты.

Вместо CONSUMED→RELEASED добавить отдельный append-only restoration/credit ledger с FK на исходный reservation, owner decision и подтверждённый refund. UNIQUE(reservationId) запрещает второй кредит; idempotency fingerprint включает решение и доказательства. RESERVED/CONSUMED/RELEASED и денежные snapshots сохраняют исходную историю. Расчёт квоты должен учитывать подтверждённый compensating credit ровно один раз; атомарный аудит обязателен.

Активность/срок кода при следующем checkout всё равно проверяются заново. Восстановление квоты не оживляет истёкшую или отключённую акцию молча; отдельная компенсационная акция PERSONAL возможна только по отдельному решению владельца. Stock reconciliation не подменяет подтверждённый возврат денег.

Историческая mixed group с одной скидкой и двумя заказами требует отдельной **групповой** политики. До её согласования возвращать блокирующий результат `HISTORICAL_GROUP_POLICY_REQUIRED`, не выдавать кредит за один частично возвращённый дочерний заказ.

Предлагаемые результаты будущей оценки: `ELIGIBLE`, `OWNER_DECISION_REQUIRED`, `CUSTOMER_CAUSE`, `REFUND_INCOMPLETE`, `PENDING_PAYMENT`, `ALREADY_RESTORED`, `HISTORICAL_GROUP_POLICY_REQUIRED`. Ни оценщик, ни writer восстановления в этом этапе не реализованы.

### Будущая автоотмена 2.4C3C

1. Создать отдельную внутреннюю идемпотентную операцию expiry с серверным временем. Выбирать только заказы с новым FIRST window и `now >= effectiveExpiresAt`; не назначать сроки историческим группам задним числом.
2. Своевременный SUBMITTED всегда блокирует expiry независимо от 24/2 часов и числа попыток. Не должно быть отдельной очистки промокодов по timestamp.
3. Проверять отсутствие денег, FIRST ledger, APPROVED, invoice/refund и всех конфликтующих финансовых действий. Оплаченные/CONSUMED не отменять через unpaid lifecycle.
4. Повторно проверять deadline, pending и финансовое состояние внутри той же CAS операции, которая выполняет безопасную cancellation, stock release и promo RELEASED. Гонки с submit/approve/reject/extension должны приводить к одному согласованному результату.
5. Небезопасный stock или финансовый конфликт требуют контролируемого отказа и расследования; не освобождать только промокод. Исчерпание трёх попыток само по себе не добавляет пока несогласованную досрочную автоотмену.
6. Для фонового исполнителя отдельно согласовать узкие системные полномочия и аудит; не хранить и не подставлять JWT владельца как job credential. Текущий cancellation требует личного владельца и не выдаёт такого разрешения cron.
7. Сначала проверить внутренний expiry на временной D1 и гонках. Scheduler/cron, инфраструктура и публичное включение требуют отдельного этапа и разрешения. В 2.5B2 этих компонентов нет.

На этапе 2.5B2 реализация завершена; 2.5B3 и автоотмена не выполняются.
