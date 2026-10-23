# VOYEY Backend — этап 2.4C3A

23 октября 2026. Ветка `chore/voyey-bootstrap`.
Исходный HEAD: `700cc02a0447335d8d80a78da1c9da8be81a9df9`.
SHA итогового локального коммита приведён в сообщении о завершении.

Работа локальная. COMMERCE_ENABLED=0 сохранён. Push, merge, deployment,
удалённые миграции, реальные оплаты/Telegram/ресурсы не выполнялись.

## Результат и границы

`apps/api/src/modules/checkout/cancellations.ts:LinkedCheckoutCancellations.cancel`
добавляет внутреннюю отмену одного неоплаченного CheckoutOrder. Конструктор
по умолчанию выключен, HTTP routes и environment switch для включения отсутствуют.
Операция требует личный JWT достоверного владельца через VoyeyOwnerAuthority.
Обычная общая Admin cookie, покупатель или TelegramAdmin-сотрудник не подходят.

Разрешён только заказ завершённой (sealed=1) CheckoutGroup с сохранёнными позициями.
Прямой идентификатор старого Order не принимается новой службой. Отмена независима
для каждого дочернего заказа: наличие денег или pending-чека у соседнего заказа
не изменяет допустимость отмены неоплаченного ребёнка.

### Проверка денег

Внутри одного atomic/CAS callback читаются свежие данные и проверяются:

- Нулевые goodsPaid/cargoPaid, отсутствие любой записи FIRST/FINAL ledger
  и любого CheckoutPayment со статусом APPROVED.
- Отсутствие SUBMITTED в любой фазе. Пока чек ожидает ручной проверки, сначала
  требуется законно завершить его проверку прежним механизмом.
- Отсутствие CheckoutFinalInvoice и связанного Refund. Новый invoice является
  конфликтующим финансовым действием. В нормальных данных он уже требует FIRST,
  поэтому оплаченный заказ отклоняется раньше с объяснением необходимости refund.
- Отсутствие предыдущей несовместимой отмены/ключа другого заказа.

REJECTED без поступивших денег не препятствует отмене. Чек и его приватные байты
сохраняются; покупатель/владелец могут продолжать читать разрешённую историю.
Повтор submit/review, включая повтор прежнего отклонённого чека с тем же ключом,
после отмены получает 409. Новые FIRST/FINAL инструкции также запрещены.

Refund сейчас существует только для LEGACY Order и FK-изолирован от CheckoutOrder.
Проверка Refund — дополнительная защита, а не утверждение о готовом новом refund
процессе. При добавлении refund модели в 2.4C3B необходимы взаимные SQL guards,
состояния и гонки cancellation/refund; нельзя просто подключить старый Refund.

Важное решение: неоплаченный PREORDER можно отменить после arrival и назначения
CARGO, если подтверждённых денег, pending-чеков и invoice нет. Эти сведения
сохраняются в истории обязательств; закупка/себестоимость не аннулируются и
фактическое наличие не создаётся. Учёт понесённых расходов требует отдельного
будущего процесса; этот этап не списывает CARGO и не возвращает деньги.

### Additive модель

Миграция `apps/worker/migrations/0024_linked_checkout_cancellations.sql` добавляет:

| Таблица | Содержимое и защита |
| --- | --- |
| CheckoutCancellation | UNIQUE(orderId), причина 1–500 символов, FK инициатора User, время, operationKey 16–200, SHA-256 fingerprint, financialSnapshot, reservationSnapshot, sealed. UNIQUE(actor,key), composite UNIQUE(id,orderId). |
| CheckoutStockRelease | Одно событие на исходный OrderItem: UNIQUE(itemId), composite FK cancellation/order, FK item/SKU, quantity, stockBefore/After, время. Положительное количество <=99; конечный stock в int32. |

Снимок financialSnapshot — полная текущая CheckoutOrderFinance до отмены, включая
GOODS, FIRST, CARGO, FINAL и ссылки на arrival/cargo/invoice. SQL сравнивает поля
с актуальной проекцией при вставке. Первоначальная политика 50%/100%, цены,
скидки, суммы, характеристики и получатель остаются в прежних неизменяемых
CheckoutOrder/Item/Group и не дублируются лишними изменяемыми копиями.
reservationSnapshot содержит полный набор item ID, product/SKU, quantity и
inventoryReservedQuantity; SQL сверяет полноту, уникальность и исходные значения.

Первоначальные CheckoutOrder.state=PAYMENTS_BLOCKED, goodsPaid=0 и unpaidGoods
по-прежнему являются снимком контракта. SQL UPDATE/DELETE этих строк запрещены.
**Текущее терминальное состояние читается из CheckoutOrderFinance.orderState**:
CANCELLED, cancellationId, cancelledAt, paymentAllowed=0. Group reader уже
накладывает эту проекцию. Поле `state` исходного контракта не переименовывалось.
Исторические долги не обнуляются; признак paymentAllowed=0 закрывает их оплату,
а не изображает получение денег. financiallySettled=0 даже для отменённого заказа
с нулевой ценой, fulfillmentAllowed/finalPaymentEnabled/cargoEnabled=0.
До отмены прежние значения финансовой проекции сохраняются; три новых поля additive.

После запечатывания запись отмены неизменяема и не удаляется. События release
также неизменяемы. Вернуть заказ к оплате через SQL UPDATE/DELETE нельзя.

### Фактический складской резерв

Для IN_STOCK используется только inventoryReservedQuantity сохранённой позиции.
Служба проверяет соответствие quantity, существующий активный SKU, неизменённую
связь SKU с productId, конечный целочисленный stock>=0 и отсутствие переполнения.
Если SKU деактивирован, перепривязан, stock=null или восстановление небезопасно,
вся операция получает 409 и откатывается. Автоматической коррекции и частичного
release нет; нужна отдельная диагностика владельцем.

Вставка CheckoutStockRelease повторно проверяется SQL-триггером против исходной
позиции и текущего SKU, затем AFTER INSERT увеличивает stock ровно на сохранённый
резерв и пишет отдельный AuditLog linked-order.stock-released. Если stock успел
измениться после оформления, прибавляется только резерв к текущему остатку;
историческое значение каталога не восстанавливается целиком.

PREORDER всегда reserved=0; не создаёт положительных release events и не изменяет
stock, независимо от наличия arrival/CARGO. Каталожный preorderEnabled и stock=null
не переопределяют исходную семантику заказа.

### Одна атомарная граница и терминальность

В `packages/database/src/d1.ts:atomic` остаётся существующий глобальный CAS/retry
(до пяти попыток). В callback: свежая проверка личного JWT/owner, заказа, денег,
чеков и SKU; затем один batch с cancellation sealed=0, release events/stock/audit,
общим audit linked-order.cancelled и sealing=1. Защищённая VIEW становится терминальной
как результат того же commit. Ошибка release, audit или sealing откатывает всё,
включая права-аудит успешной попытки. Audit отказа владельца фиксируется отдельно
в той же модели denied outcome, что у действующих платёжных служб.

Sealing требует полного набора фактических release и audit. До sealing нельзя
дописать поддельный или превышающий резерв; после него нельзя добавить release.
Как у ранее введённого CheckoutGroup, промежуточное sealed=0 допустимо только внутри
штатного atomic writer. Внешних маршрутов/прав прямой записи в D1 не добавлено.
Ручной неполный SQL-import не является поддерживаемой операцией: даже наличие
sealed=0 блокирует последующие финансовые INSERT (fail closed).

На новых таблицах есть revision INSERT/UPDATE/DELETE triggers. В SQL закрыты
новые INSERT CheckoutPayment/Ledger/Arrival/CargoCharge/FinalInvoice при наличии
любого cancellation record; CheckoutPayment UPDATE после отмены тоже запрещён.
Проверки в backend writers стоят до idempotent replay; история остаётся доступной.

Два разных ключа отмены: одна отмена, другой 409. Один ключ и одинаковое намерение:
одна отмена, оба получают ту же запись, stock не увеличивается повторно.
Fingerprint включает operation version, orderId, нормализованную reason; смена
причины, ключа или владельца не воспринимается как безопасный replay.
Свежие owner проверки на replay могут добавить owner.authorized audit; это не
повтор экономической операции или освобождения stock.

Гонка cancel/submit: победивший submit оставляет pending и отмена отклоняется;
победившая отмена запрещает submit и откатывает даже подготовленные приватные
MediaObject/Chunk. Cancel/approve не может пройти при уже pending-чеке или
подтверждённом ledger. Отзыв активного owner-admin увеличивает revision; повтор
callback проверяет права заново, запись отмены/stock не коммитятся.

SQL имеет доступ к User/TelegramAdmin и проверяет активного инициатора, но не к
серверному VOYEY_OWNER_TELEGRAM_ID или JWT. Точное личное owner сопоставление —
обязательная часть внутреннего writer в том же atomic callback. Прямой доступ
к D1 не считается пользовательским API и не предоставляет роль владельца.

### Группа, промокод, LEGACY

CheckoutGroup, CheckoutPromoUse, распределённая скидка и снимки соседних заказов
не меняются. Ни отмена одного ребёнка, ни отмена обоих не освобождают promo quota.
Вызовы promoForCheckout продолжают считать новую квоту вместе с LEGACY redemptions.
Повторного применения, перераспределения или refund скидки нет.

`apps/api/src/modules/admin/lifecycle.ts`, `refunds.ts`, старые Order/Payment/Refund
и их Admin-права не изменены. LEGACY отмена по-прежнему может сформировать старый
Refund и освободить старую скидку; это историческое поведение, изолированное от
новых групп. Новый owner-only режим не исправляет прежний общий Admin perimeter.

## Проверки

В новом `apps/worker/tests/linked-cancellations.test.ts` — 41 сценарий, включая
все 24 обязательных пункта задания. Проверяются оба режима, нулевой stock,
многопозиционный release, изменившийся stock, null/inactive/перепривязанный/overflow
SKU, replay/конкуренция, release/audit/seal rollback, FIRST/FINAL/pending/rejected,
приватная история, post-cancel writers и прямой SQL, оба ребёнка/квота промокода,
staff/общая Admin cookie/покупатель/anonymous, отзыв полномочий при batch,
LEGACY cancel/refund, пустые настройки и выключенный конструктор.

Миграция проверена на заполненной 0023 SQLite базе с FIRST/FINAL, pending/rejected,
arrival/cargo/invoice, ledger и приватными байтами: значения всех исторических
таблиц совпадают после upgrade. Искусственная ошибка откатывает DDL и данные.
Отдельная проверка в настоящем локальном D1 Miniflare делает populated upgrade,
полный FIRST/FINAL и отмену с rollback аудит-ошибки. FK check чистый.
Проверены закрытые покупательские/обычные Admin routes даже с commerce=1 в
изолированной фикстуре; outbound service запрещает внешние вызовы, вызовов 0.

Build, typecheck, lint, Prisma generate/validate и security/config preflight прошли.
Полный набор: **1236 passed, 5 skipped, 0 failed**: Worker/D1 642, API 249,
Admin 150, Mini App 169, Bot 16, config/security 10. Пять исторических PostgreSQL
integration tests остаются пропущенными; production не проверялся. Turbo мог
использовать cache для неизменившихся пакетов; Worker набор выполнен заново.
После уточнения негативного SQL-теста новый набор из 41 сценария повторно прошёл.
Gitleaks: no leaks found, существующие allowlist/ignore не расширялись.
Git fsck и diff --check прошли. SHA-256 сверка всех 653 исходных tracked файлов
с HEAD (с учётом CRLF/LF для текста): 645 неизменны, 8 изменены по заданию,
потерянных файлов 0; защищённые UI/Bot/Worker runtime, lockfile, scripts и все
23 прежние миграции неизменны. Добавлено 4 файла, итог — 657 tracked файлов.
Логи: `.cache/voyey-stage-2-4c3a/` (игнорируемые локальные артефакты).
Остались прежние предупреждения Vite о use-client/sourcemap и deprecated
package.json#prisma; сборка при этом успешна. Зависимости не менялись.
Ни одна миграция 0001–0023 не редактируется, удалённые миграции не выполняются.

## Изменённые исходники

Новые:

- apps/api/src/modules/checkout/cancellations.ts
- apps/worker/migrations/0024_linked_checkout_cancellations.sql
- apps/worker/tests/linked-cancellations.test.ts
- docs/VOYEY_CANCELLATIONS_STAGE_2_4C3A.md

Изменены:

- apps/api/src/modules/admin/owner.ts — внутреннее действие ORDER_CANCEL.
- apps/api/src/modules/checkout/payment-state.ts — terminal state/метаданные/guard.
- apps/api/src/modules/checkout/linked-payments.ts — guard до submit/review replay.
- apps/api/src/modules/checkout/preorder-finance.ts — guard arrival/cargo/invoice.
- apps/worker/tests/helpers/sqlite.ts — атомарное применение 0023+ миграций в SQLite.
- apps/worker/tests/helpers/marketing-runtime.ts — то же на локальном настоящем D1.
- packages/database/prisma/schema.prisma — две scalar-модели, без PG runtime.
- packages/database/src/checkout-payment-d1-schema.ts — read facade metadata.

Frontend/Admin UI/Mini App/Bot, брендинг, зависимости, lockfile, Worker runtime и
инфраструктурные конфигурации не изменены. Внутренние @stenzo/* и STZ- остаются
прежними согласованными техническими именами и не создают обращения к STENZO.

## Актуальная карта Backend

«Работает» означает код и локальные тесты; проверка развёрнутого магазина отсутствует.

| Модуль | Работает | Добавлено / внутренне | Пока нет / закрыто |
| --- | --- | --- | --- |
| Каталог | Универсальные категории, Product/SKU attributes, цена Product, stock, preorderEnabled | Политика мерок и исторические snapshots | SKU prices, marketplace |
| Корзина | LEGACY/IN_STOCK/PREORDER, две строки одного SKU, общий лимит 99 | Данные mixed checkout | Выбор режимов в UI, публичный новый checkout |
| CheckoutGroup | 1–2 независимых заказа, одна скидка, atomic/CAS/key/fingerprint | Квота сохраняется и после обеих отмен | Публичные routes и отображение группы |
| Заказы | LEGACY история/lifecycle; неизменяемые новые контракты | Терминальная cancellation projection | Выдача, reopening, полноценный новый lifecycle |
| Склад | Конечный IN_STOCK резерв, legacy null, PREORDER reserve=0 | Exactly-once release сохранённого резерва | TTL, fulfillment, ручная unsafe-release коррекция |
| FIRST/FINAL | Внутренняя ручная оплата, private proof, owner review, bank-reference ledger, exact GOODS/CARGO | Запрет всех дальнейших writers после cancel | Публичная оплата новых заказов, bank API, cross-LEGACY bank dedup |
| CARGO | Full PREORDER arrival, immutable CARGO и final invoice | Закрыт после cancellation; история сохраняется | Частичное поступление, исправления invoice/CARGO, доставка/выдача |
| Отмены | Старые LEGACY и новая внутренняя owner-only unpaid отмена | Отдельные cancellation/release/audit и SQL guards | Оплаченные/частичные/автоматические/покупательские отмены |
| Возвраты | Старый LEGACY Refund | Новая отмена не выдаёт фиктивных возвратов | Linked refund ledger и возврат подтверждённых GOODS/CARGO |
| Сотрудники | Старые TelegramAdmin и Admin perimeter | Личный owner внутри финансового CAS | Новые персональные staff roles/операторские полномочия |
| Telegram | Существующие bot/auth/RU-UZ исходники сохранены | Новые службы не вызывают Telegram | @askVoyey, operator attachment, уведомления новой отмены |
| D1 | Worker + Fastify + D1, 24 миграции, private media, CAS | Additive 0024, FK/UNIQUE/CHECK/revision/view | Реальная отдельная среда VOYEY, backup/rollout/нагрузочные проверки |

## План 2.4C3B — только предложение

1. Согласовать полный/частичный refund, причины, момент финансовой отмены и резервов,
   комиссий, расходов на закупку/CARGO и промокода. До этого не включать refund.
2. Ввести отдельный immutable linked refund ledger: ссылка на исходный payment ledger,
   исходные GOODS/CARGO allocations, UZS, amount, внутренний actor, bank reference,
   timestamp, ключ и fingerprint; не изменять исходные платёжные записи.
3. Разделить намерение возврата (pending/verification) и подтверждённый фактический
   возврат. Не уменьшать received money или объявлять возврат исполненным по клику.
4. В общем atomic/CAS проверять свежие owner-права, доступную к возврату сумму по
   каждой исходной allocation с вычетом прежних refunds; SQL CHECK/FK/UNIQUE и
   взаимные guards refund/cancel/payment должны запрещать повторные и сверхвозвраты.
5. Связать безопасную отмену оплаченного заказа с этой моделью: отдельный lifecycle,
   закрытие новых оплат/CARGO, подтверждённые refund events, release сохранённого
   stock ровно один раз, audit. Нельзя просто снять проверку goodsPaid>0 из 2.4C3A.
6. Проверить replay/incompatible replay, cancel/refund/approve гонки, оба дочерних
   заказа независимо, деньги только в GOODS/CARGO исходного заказа, rollback,
   quota policy и populated migration с FIRST/FINAL и историей текущих отмен.

## Риски перед открытием магазина

- COMMERCE_ENABLED=0 и внутренние default-off конструкторы сохраняются; новые
  checkout/payments/cancellations не доступны обычному UI и HTTP.
- Оплаченные отмены/возвраты, partial arrival/refund, TTL, fulfillment, correction
  immutable CARGO/invoice ещё требуют согласования и реализации.
- Отмена после неоплаченного arrival не уничтожает факт закупки/перевозки: будущий
  управленческий учёт должен учитывать понесённые расходы отдельно.
- Исторический LEGACY Admin имеет прежние широкие финансовые права. Перед реальным
  запуском нужен отдельный аудит; этот шаг не выдаёт всем новым операциям staff roles.
- Нужны независимые VOYEY инфраструктура/owner/card/JWT/origins и разрешённый rollout
  с backup и проверкой фактически применённых миграций, включая атомарную 0024.
- Ручная сверка банка зависит от правильного canonical bank reference. Нет bank API,
  автоматической проверки чека и общей дедупликации реальных LEGACY/new переводов.
- Требуются защищённые публичные API/DTO, UI связанной группы, limits/CSRF/rate
  защита, private no-store proof responses, наблюдаемость, proof retention,
  восстановление и нагрузочные проверки D1/Workers перед включением торговли.

Этап 2.4C3B не начат. Изменения остаются локальными.
