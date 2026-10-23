# VOYEY Backend — этап 2.3B: режимы корзины

Дата: 23 октября 2026. Папка: `C:/Users/USER/Desktop/Voyey`.
Ветка: `chore/voyey-bootstrap`. База: `d4288bd5791d133589cc30bc87d466124211e3b4`.
Работа локальная; push/merge/deployment не выполнялись. SHA локального коммита
приведён в итоговом сообщении. Следующий этап не реализован.

## Модель и совместимость

Добавлено `CartItem.saleMode`: LEGACY / IN_STOCK / PREORDER. LEGACY — технический
совместимый режим для существующих строк и запросов без saleMode, не предзаказ.
SQL default LEGACY сохраняет исходные IDs, количество и мерки. stock=null остаётся
старым untracked/unlimited остатком и никогда не преобразуется автоматически в PREORDER.

Новая уникальность `(cartId,variantId,saleMode)` заменяет `(cartId,variantId)`.
Один SKU может иметь независимые IN_STOCK и PREORDER строки, а также старую LEGACY
строку. Повторный POST объединяет количество только внутри того же режима.
Разделение строк по меркам/получателям не добавлено.

| Режим    | Требование доступности                                    | Работа со stock                                            | Старый checkout         |
| -------- | --------------------------------------------------------- | ---------------------------------------------------------- | ----------------------- |
| LEGACY   | Прежние active/category/archive/variant/quantity проверки | Конечный остаток проверяется; null сохраняет прежний смысл | Разрешён с прежними 50% |
| IN_STOCK | Те же проверки, требуется известный конечный stock        | Сумма LEGACY+IN_STOCK этого SKU не превышает stock         | 409, отключён           |
| PREORDER | Товар/категория/вариант активны, preorderEnabled=true     | stock=0/null допустим; склад не резервируется              | 409, отключён           |

Явный IN_STOCK при stock=null отклоняется: legacy unlimited не подтверждает
физическое наличие. PREORDER не требует наличия и не зависит от устаревшей
складской строки рядом. Если разрешение отозвано или товар скрыт, add/update
отклоняются, DTO показывает isAvailable=false. Удаление строки остаётся доступным.

Общий лимит **99 на SKU во всех режимах одной корзины**, не 99 на каждую строку.
POST и PATCH проверяют новое количество вместе с соседними строками. Дополнительно
складские строки LEGACY и IN_STOCK делят один stock-бюджет. PREORDER в него не
входит. Проверки выполняются внутри прежнего atomic/CAS; конкурентные добавления
не могут обойти общий лимит. Корзина ни в одном режиме сама не резервирует stock.

Цены/акции/валюта берутся с Product по старым правилам. Цены SKU и цены по режимам
не добавлялись. Subtotal корзины остаётся суммой всех строк, предварительной
оценкой, а не разрешением оформить весь её состав.

## API

- `POST /api/cart/items`: optional `saleMode: "IN_STOCK" | "PREORDER"`.
  Отсутствие означает LEGACY. Явные LEGACY/null/произвольные строки запрещены.
- `GET /api/cart` и ответы add/patch/delete содержат saleMode и checkoutEnabled
  у каждой строки. checkoutEnabled=true только у LEGACY и не заменяет isAvailable,
  проверку мерок или глобальный COMMERCE_ENABLED.
- `PATCH /api/cart/items/:id`: прежние quantity/heightCm/weightKg; режим неизменяем.
  Для другого режима создаётся другая строка. Нельзя превратить PREORDER в LEGACY
  через PATCH. DELETE по ID адресует конкретную строку, DELETE /cart очищает все.
- Browser quote fingerprint в shared cartSnapshotVersion дополнен режимом, чтобы
  будущие клиенты могли различать бизнес-состояние строк; frontend не менялся.

Cart ownership/JWT, диапазоны мерок, Category policy и OrderItem snapshots этапа
2.3A сохранены. Старые API payload без режима продолжают работать.

## Защита оформления

prepareOrderItems отвергает любую явную IN_STOCK/PREORDER строку до формирования
снимков и расчётов. Смешанная корзина с хотя бы одной такой строкой также целиком
отклоняется HTTP 409. writeD1Order повторно проверяет строки до записи stock/Order,
включая защиту от обхода подготовительного engine. Нет частичного оформления
LEGACY строк из смешанной корзины и нет молчаливого пропуска новых строк.

Manual create/preview явно отклоняют saleMode в items HTTP 400. Верхнеуровневый
saleMode, цены/итоги/snapshots в checkout payload остаются запрещены strict schemas.
Прежние ручные заказы без режима работают по прежним правилам; они используют
каталог, не преобразуют и не потребляют явные строки Cart.

Идемпотентность сохранена: существующий `(userId,idempotencyKey)` возвращает
исторический заказ без новой записи, резерва или удаления новой корзины, даже если
в новой корзине уже появились явные режимы. Это replay старого заказа, не оформление
новых строк. Разграничение MINIAPP/ADMIN ключей и прежние гарантии атомарности не менялись.

COMMERCE_ENABLED=0 и VOYEY_LOCAL_ONLY=1 сохранены. Commerce=1 используется только
синтетическими runtime тестами в памяти с блокировкой внешних вызовов.

## База и изменённые файлы

Новая `0020_cart_sale_modes.sql`: ADD COLUMN с default/check и замена одного
уникального индекса без пересоздания таблицы. Старые миграции 0001–0019 не менялись.
Order/OrderItem/Payment и финансовые таблицы не изменялись. Prisma schema и D1
metadata синхронизированы с новым ключом. Активные D1 и исторический Prisma Cart
writer используют одинаковые проверки режимов/агрегатов. Реальный PostgreSQL
runtime не включался и не проверялся подключением к БД.

Файлы относительно корня VOYEY:

| Файл                                            | Изменение                                           |
| ----------------------------------------------- | --------------------------------------------------- |
| packages/shared/src/cart-sale-mode.ts           | Тип CartSaleMode                                    |
| packages/shared/src/index.ts                    | Экспорт                                             |
| packages/shared/src/cart-snapshot.ts            | Режим в quote fingerprint                           |
| packages/database/prisma/schema.prisma          | CartItem.saleMode, новый unique                     |
| packages/database/src/d1-schema.ts              | Metadata поля/индекса                               |
| apps/worker/migrations/0020_cart_sale_modes.sql | Новая миграция                                      |
| apps/api/src/modules/cart/types.ts              | Optional input, raw record, DTO режима              |
| apps/api/src/modules/cart/schemas.ts            | Строгий optional mode в POST                        |
| apps/api/src/modules/cart/domain.ts             | Проверки режима/агрегатов и legacy checkout guard   |
| apps/api/src/modules/cart/repository.ts         | Исторический writer: новый ключ/валидация           |
| apps/api/src/d1/repositories.ts                 | D1 cart key/агрегаты; guard перед записью заказа    |
| apps/api/src/modules/cart/service.ts            | DTO и доступность по режимам                        |
| apps/api/src/modules/checkout/domain.ts         | Запрет явных режимов до подготовки заказа           |
| apps/api/src/modules/admin/manual-orders.ts     | Запрет явных режимов manual                         |
| apps/api/tests/universal-checkout.test.ts       | Обновлена проверка нового Cart POST контракта       |
| apps/worker/tests/sale-availability.test.ts     | Cart режимы принимаются, checkout остаётся закрытым |
| apps/worker/tests/cart-sale-modes.test.ts       | 11 новых migration/D1/runtime/race/rollback тестов  |
| docs/VOYEY_CART_STAGE_2_3B.md                   | Этот отчёт                                          |

Frontend/Admin/Mini App/Bot/auth, исходный STENZO, infrastructure templates,
изоляционные guards, зависимости/lockfile и платёжная логика не менялись.

## Проверки

| Проверка                   | Результат                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Build / typecheck / lint   | Успешно                                                                                                |
| Prisma generate / validate | Успешно, без подключения к БД                                                                          |
| Config/security preflight  | Успешно                                                                                                |
| Полный набор               | **1080 passed, 5 skipped, 0 failed**                                                                   |
| Разбивка                   | API 249, Worker/D1 486, Admin 150, Mini App 169, Bot 16, config/security 10                            |
| Новые тесты                | 11; два режима SKU, stock=0, permission, агрегаты, legacy, checkout/manual blocks, гонки, SQL rollback |
| Миграции                   | Только временная SQLite/Miniflare, foreign_key_check без ошибок                                        |

Полный Turbo прогон: 7 успешных задач, 2 из cache. Пять skipped — прежние PostgreSQL
integration tests, намеренно отключённые. Известное предупреждение Prisma о
package.json#prisma не менялось. Зависимости не устанавливались, новых нет.
Логи/проверочные артефакты — игнорируемая `.cache/voyey-stage-2-3b/`.
Gitleaks: новых находок нет; прежние точечные исключения не менялись.
SHA-256 сверка 625 исходных файлов с учётом CRLF/LF: 611 неизменны,
14 ожидаемо изменены по списку, пропавших нет. Добавлены 4 файла (включая отчёт),
всего отслеживаемых 629. Git diff --check прошёл.

## Карта Backend

Подтверждено кодом/локальными тестами, не работающей удалённой средой VOYEY.

| Модуль               | Работает                                                            | Добавлено                                                    | Пока отсутствует                                   |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| Каталог              | Категории/характеристики, Product price, SKU/stock/preorderEnabled  | Без изменений                                                | UI характеристик, SKU price                        |
| Корзина              | Ownership, мерки, текущие цены, атомарные изменения                 | SaleMode, независимые строки SKU, общий 99/stock-бюджет, DTO | UI выбора режима, разные мерки одного SKU/режима   |
| Checkout             | Legacy 50%, policy мерок, snapshots, idempotency, atomic reserve    | Fail-closed guard явных/смешанных режимов                    | Split checkout, IN_STOCK 100%, PREORDER 50%        |
| Заказы               | История/статусы/снимки, отмены/stock release                        | Не изменены                                                  | SaleMode в заказах, группы/parent batch            |
| Оплата/CARGO/финансы | Прежняя ручная карта, private proof, Admin review, финальная оплата | Не изменены                                                  | Разная оплата групп, распределение скидки/доставки |
| Manual orders        | Прежний legacy engine/preview/create                                | Явный запрет saleMode                                        | Безопасное оформление новых режимов                |
| Auth/Bot/media/infra | Прежние JWT/sessions/CSRF, D1 media, изоляция                       | Не изменены                                                  | Реальная отдельная инфраструктура, deployment      |

## Следующий этап — план без реализации

1. Согласовать судьбу LEGACY: не менять исторические корзины/заказы на 100% молча.
   Нужен явный выбор клиента и отдельный versioned checkout контракт, без смены
   семантики прежнего endpoint. Согласовать переход stock=null без предположения наличия.
2. Добавить неизменяемый saleMode в снимки строк/заказы и модель группы оформления
   с одним клиентским idempotency key. Повтор должен возвращать весь прежний набор
   заказов, не создавать только недостающую часть и не резервировать повторно.
3. На сервере одним снимком перечитать весь выбранный Cart; сгруппировать IN_STOCK
   и PREORDER, проверить общий лимит SKU, permission, policy мерок, цены/акции и stock.
   IN_STOCK: 100% согласованной суммы, конечный reserve. PREORDER: 50%, без reserve.
4. Создание обеих групп, снимков, reserve только складской группы, redemption/audit
   и потребление конкретных CartItem IDs должны быть одним guarded D1 commit.
   При конфликте/ошибке — ни одной частично созданной группы. Не очищать новые строки
   корзины, добавленные параллельно после сформированного запроса.
5. До реализации определить точное распределение промокода/округления и CARGO по
   группам, лимиты промокода на одно оформление, статусы/сроки оплаты, отмены,
   освобождение reserve, возвраты и подтверждение ручных чеков для каждого заказа.
   Нельзя применить один промокод дважды без согласованных правил.
6. Проверить гонки stock/permission/catalog edits, CAS retry обеих групп, одинаковые
   ключи, частичный SQL failure, submit/approve/reject платежей, cancellation/refund
   и двойное резервирование. Уведомления отправлять только после общего коммита,
   с собственными idempotency keys на каждую группу.
7. Затем отдельно адаптировать frontend/manual UI/Bot и только по разрешению
   включать commerce/применять миграции своей инфраструктуры. Этот этап ничего
   из перечисленного не активирует.
