# VOYEY Backend — этап 2.3A

Дата: 22 октября 2026. Ветка: `chore/voyey-bootstrap`.
Рабочая копия: `C:/Users/USER/Desktop/Voyey`.
База: `fd921be2bb710659d9bc4259a81c7fee96698357`, дерево перед работой чистое.
В последнем сообщении владелец отдельно разрешил push после проверок. Итоговый
SHA и подтверждение удалённой ветки приведены в сообщении о завершении.

## Изменения checkout и политика мерок

Добавлен `Category.requiresBuyerMeasurements: Boolean`, default **true**.
В существующих категориях новая миграция также ставит true: старое поведение
сохранено. Правило не зависит от названия, slug, size/color или произвольных attributes.

| Категория/политика                              | heightCm / weightKg при оформлении                                  |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Одежда, requiresBuyerMeasurements=true          | Оба обязательны: целые height 100–250 см, weight 30–300 кг          |
| Канцтовары, requiresBuyerMeasurements=false     | Оба необязательны, могут быть null                                  |
| Средства ухода, requiresBuyerMeasurements=false | Оба необязательны, могут быть null                                  |
| Любая другая категория                          | Явно задаётся тем же флагом, без нового enum/ветвления по названиям |
| Старый repository fixture без нового флага      | Совместимый fallback true                                           |

Если для необязательной категории покупатель всё же передаёт мерки, сохраняются
прежние диапазоны и проверка целых чисел. Допустима одна заполненная мерка при
другой null. Одежда по-прежнему требует обе. Неверные значения не игнорируются.
Cart API проверяет диапазоны при add/patch; checkout повторяет проверку на сервере.

Проверены все места требования: общий `prepareOrderItems()` и прежняя обязательная
Zod-схема ручного заказа. Схема manual orders теперь принимает те же nullable поля,
что Cart API, а необходимость определяет общий engine по загруженной категории.
Тело запроса не может подменить политику. Сам checkout не получает мерки в body:
для Mini App он читает их из текущих строк корзины.

Мерки нужны для подбора одежды и сохраняются в OrderItem как параметры покупателя.
Они **не являются весом товара**, не участвуют в вычислении CARGO и не определяют
стоимость доставки. Прежний cargoAmount задаётся администратором отдельно при
запросе финальной оплаты; его код и правила не менялись.

Никакие реальные категории не создавались/не перенастраивались. Для будущего
использования канцтоваров/ухода необходимо явно установить флаг false через
авторизованный Admin API после отдельно разрешённой миграции своей БД.
Автоматической классификации старых категорий по тексту нет.

## Снимок характеристик OrderItem

Добавлено одно nullable JSON-поле `OrderItem.catalogSnapshot`:

```json
{
  "version": 1,
  "category": {
    "id": "synthetic-category",
    "nameRu": "Канцтовары",
    "nameUz": "Kanselyariya",
    "slug": "stationery"
  },
  "requiresBuyerMeasurements": false,
  "attributeDefinitions": [
    {
      "key": "pack_count",
      "nameRu": "Количество в упаковке",
      "nameUz": "Paketdagi soni",
      "type": "INTEGER",
      "scope": "VARIANT",
      "unit": "шт",
      "min": 1
    }
  ],
  "productAttributes": {},
  "variantAttributes": { "pack_count": 12 }
}
```

Пример синтетический. Копируются только определения использованных характеристик,
включая RU/UZ подписи, тип, scope, unit и границы. Product/SKU values — отдельные
объекты, чтобы их смысл не смешивался. Категория и её эффективная политика мерок
сохраняются на момент оформления.

Не дублируются существующие productNameRu/Uz, productSlug, sku, size/color,
imageUrl, originalUnitPrice/unitPrice, quantity/lineTotal, heightCm/weightKg:
они по-прежнему хранятся в собственных столбцах OrderItem.
Себестоимость и закупочные поля остаются приватными прежними полями, не копируются
в публичный JSON. sourceUrl не добавлен в customer snapshot; прежняя Admin-only
ссылка поставщика остаётся отдельным существующим live-полем.

Новые D1 checkout/manual orders создают снимок внутри существующего guarded
order transaction. Чтение customer/Admin DTO использует только сохранённый JSON,
без обогащения из текущего Product/Category. Редактирование имён, attributes,
категории, размеров/SKU или политики мерок не переписывает историю.
Проверено сохранение снимка даже после удаления исходного SKU/товара/категории
в временной БД; productId/variantId могут стать null по старым FK, снимок остаётся.

Для старых заказов `catalogSnapshot=null`, без выдуманной реконструкции прошлого.
Старые основные снимки остаются доступны. Optional category identity в shared
constructor нужна для старых тестовых repository fixtures; активный D1 загружает
полные Category поля и сохраняет её identity. Никакой backfill не выполнен.

## Корзина сейчас: подробное устройство

Источники: `modules/cart/{route,schemas,types,repository,service,domain}.ts`,
`d1/repositories.ts` (D1CartRepository), `packages/shared/src/cart-snapshot.ts`.

1. Одна Cart на User. Доступ требует JWT/активного пользователя; изменение и
   чтение чужой строки запрещены. Уникальность `(cartId,variantId)` означает одну
   строку на SKU. Product/Variant ID проверяются на принадлежность друг другу.
2. `GET /api/cart` возвращает актуальные цены/stock/доступность, не закреплённую
   коммерческую оферту. Корзина сама не резервирует остаток.
3. `POST /api/cart/items` добавляет количество или увеличивает существующую строку.
   Количество целое 1–99; суммарное количество этого SKU также проверяется.
   Мерки в POST имеют default null и при повторном добавлении записываются в строку;
   это прежнее поведение, включая замену прежних мерок на null при их отсутствии.
4. `PATCH /api/cart/items/:id` заменяет переданное количество/мерки; пропущенные
   поля сохраняются. DELETE строки или всей корзины работает по-прежнему.
5. Товар/категория должны быть активны и не архивны, вариант активен. Конечный
   stock ограничивает количество. stock=null сохраняет legacy untracked/unlimited
   смысл, не означает PREORDER. Размер/цвет не являются обязательными проверками.
6. CartItem хранит IDs, количество и nullable мерки. Категория, характеристики,
   имена, изображения и цены читаются из каталога. До оформления снимка attributes
   в CartItem нет. В публичный Cart DTO политика/attributes не добавлялись;
   публичный Category DTO уже возвращает новую политику для будущих UI изменений.
7. Существующая корзина уже допускает несколько SKU. Эта механика сохранена:
   не добавлялись saleMode, группы поставки, отдельные части оплаты или отдельные
   заказы на группы строк. У одного SKU нет двух строк для разных режимов продажи
   или разных наборов мерок. Это существенное ограничение будущей смешанной корзины.

## Checkout сейчас: последовательность и гарантии

Источники: `modules/checkout/{route,service,domain}.ts`, `modules/orders/repository.ts`,
`d1/repositories.ts` (priceD1Order/writeD1Order/D1OrderRepository),
`modules/admin/manual-orders.ts`.

1. `POST /api/checkout` требует авторизацию, корректного получателя и
   Idempotency-Key (16–200 допустимых символов). Клиент не передаёт цены, snapshots,
   политику мерок или saleMode: strict schemas отвергают эти дополнительные поля.
2. D1 `atomic()` сначала ищет Order по `(userId,idempotencyKey)`. Повтор возвращает
   прежний заказ со снимками до проверки сегодняшних цен, мерок или содержимого
   корзины. Повтор не очищает новую корзину и не резервирует повторно. Разные
   источники MINIAPP/ADMIN не могут использовать один ключ для одного пользователя.
3. Для нового заказа загружается вся текущая корзина с актуальными Product,
   Category, Variant и основным изображением. Учитывается текущая политика каждой
   строки; проверяются мерки, активность, принадлежность SKU, stock и количество.
4. Цена берётся с Product с учётом прежней акции и одного server now. Проверяются
   целочисленные UZS суммы/переполнение. Прежние промокоды рассчитываются тем же
   priceD1Order. Прежний requiredPrepayment=ceil(total/2), без выбора 100%.
5. prepareOrderItems формирует основные снимки и новый catalogSnapshot для строк.
   writeD1Order создаёт один Order с прежним AWAITING_PREPAYMENT, OrderItem,
   закупочными defaults, inventoryReservedQuantity, redemption/audit.
6. Конечный stock уменьшается на quantity. stock=null не уменьшается и получает
   inventoryReservedQuantity=0. Снимки, остатки, Order, аудит/промокод и удаление
   строк корзины коммитятся одним D1 batch с существующим CAS/retry.
   Ошибка откатывает всё; подтверждены гонки последней единицы, одного ключа,
   изменения категории и ошибка аудита после записи OrderItem.
7. Уведомление создаётся после коммита; его ошибка не отменяет уже созданный
   заказ. Реальные внешние уведомления на этом этапе не отправлялись.

Manual preview/create загружают выбранные строки с сервера и используют тот же
prepareOrderItems/priceD1Order/writeD1Order. Не используют/не очищают Cart.
Прежние лимит 20 строк, запрет повторяющегося variantId, source=ADMIN, Admin guard,
CSRF и идемпотентность сохранены. Preview не пишет и не резервирует, поэтому его
цены/данные являются предварительными; create повторно валидирует внутри atomic.

Новая политика проверяется построчно поверх прежнего multi-SKU engine; новые
сценарии смешанных режимов продажи/оплаты не реализованы. Нет разделения Order
по категориям или отдельного CARGO/платежа на строку. Политика суммы/статусов общая
для всего заказа. Эти механизмы следует отдельно согласовать перед следующим этапом.

## API, таблицы, миграция

| Изменение                                                    | Контракт                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| POST `/api/admin/catalog/categories`                         | optional Boolean requiresBuyerMeasurements, default true                    |
| PATCH `/api/admin/catalog/categories/:id`                    | optional Boolean; отсутствие не меняет политику                             |
| GET public/Admin catalog                                     | Category DTO/records содержат политику                                      |
| POST `/api/checkout`                                         | Body прежний; мерки проверяются по категории текущих строк                  |
| POST `/api/admin/orders/manual[/preview]`                    | heightCm/weightKg в items optional/nullable; категория решает необходимость |
| Checkout, GET owner/Admin orders/list, manual create/preview | catalogSnapshot у каждой новой строки; старые заказы возвращают null        |
| Category                                                     | Один Boolean столбец requiresBuyerMeasurements                              |
| OrderItem                                                    | Один nullable JSON столбец catalogSnapshot                                  |

Подготовлена только `0019_checkout_measurements_and_catalog_snapshot.sql`.
0001–0018 не менялись. CHECK новой политики ограничивает 0/1; снимок — null либо
JSON object version=1 размером до 64 KiB. Отсутствующий version явно отвергается,
включая особенность SQL CHECK с NULL. Детальная структура/типы проверяются shared
кодом; прямое SQL редактирование снимков не является поддерживаемым API.
Миграция проверена только на временных SQLite/Miniflare; реальные БД не опрашивались.

## Ограничения и подготовка следующего этапа

- COMMERCE_ENABLED=0 и VOYEY_LOCAL_ONLY=1 сохранены. Реальные auth/bot/infra не
  настроены. Успешный тест не является подтверждением работы deployed VOYEY.
- PREORDER.checkoutEnabled=false. Явный PREORDER/IN_STOCK по-прежнему не принимается
  checkout/cart/manual schemas. preorderEnabled не обходит stock=0. Исторический
  stock=null остаётся допустимым legacy путём, без нового типа заказа.
- Все мерки обязательны для старых категорий до явного opt-out. Нет per-product
  override, автоматического определения одежды или нового классификатора.
- Frontend/Admin/Mini App не менялись: формы пока не учитывают policy/attributes
  и могут продолжать требовать мерки. Backend generic сценарии проверены через API.
- Мерки nullable не заменяют товарный вес. CARGO по-прежнему единый amount заказа,
  без вычисления от веса товара или стоимости отдельных отгрузок.
- Новые snapshots не отображаются автоматически в UI/Telegram шаблонах. Старым
  заказам отсутствующую историю восстановить достоверно нельзя.
- Для смешанных режимов нужны отдельные решения о ключе строки корзины, saleMode,
  резервировании/таймаутах, нескольких наборах мерок одного SKU, оплате 50%/100%,
  группах доставки, отменах и распределении скидки/CARGO. Ничего из этого не внедрено.
- Текущий browser cartSnapshotVersion учитывает деньги/количество/stock/мерки,
  но не новые attributes/category policy. Его/UI контракт не менялся; checkout
  использует текущие серверные данные. Перед будущим UX подтверждения заказа
  следует согласовать повторное подтверждение изменившихся характеристик/политики.
- Большие multi-SKU корзины и размер JSON-снимков требуют отдельной нагрузки/
  оценки лимитов Worker/D1. Исторический PostgreSQL runtime не включался.

## Файлы

Все пути относительно `C:/Users/USER/Desktop/Voyey/`.

| Файл                                                                         | Назначение изменения                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/shared/src/catalog-order-snapshot.ts`                              | Versioned snapshot type, создание/безопасное чтение               |
| `packages/shared/src/index.ts`                                               | Экспорт snapshot helpers/types                                    |
| `packages/database/prisma/schema.prisma`                                     | Category policy и OrderItem JSON                                  |
| `packages/database/src/d1-schema.ts`                                         | Boolean/JSON metadata                                             |
| `apps/worker/migrations/0019_checkout_measurements_and_catalog_snapshot.sql` | Additive миграция                                                 |
| `apps/api/src/modules/admin/catalog/schemas.ts`                              | Boolean create/patch validation                                   |
| `apps/api/src/modules/admin/catalog/types.ts`                                | Optional policy в inputs                                          |
| `apps/api/src/d1/repositories.ts`                                            | Только аудит policy; existing generic snapshot write не переписан |
| `apps/api/src/modules/catalog/types.ts`                                      | Policy record/DTO                                                 |
| `apps/api/src/modules/catalog/service.ts`                                    | Policy в public Category DTO                                      |
| `apps/api/src/modules/cart/types.ts`                                         | Внутренние Category/attributes поля для checkout                  |
| `apps/api/src/modules/cart/repository.ts`                                    | Загрузка полной Category для atomic checkout                      |
| `apps/api/src/modules/checkout/domain.ts`                                    | Категорийные мерки и snapshot creation                            |
| `apps/api/src/modules/checkout/errors.ts`                                    | Уточнение сообщения без смены класса ошибки                       |
| `apps/api/src/modules/orders/types.ts`                                       | Совместимые raw record/typed snapshot DTO                         |
| `apps/api/src/modules/orders/repository.ts`                                  | Category include для исторического writer                         |
| `apps/api/src/modules/orders/service.ts`                                     | Возврат только сохранённого snapshot/null                         |
| `apps/api/src/modules/admin/manual-orders.ts`                                | Nullable мерки; общая доменная проверка                           |
| `apps/api/tests/universal-checkout.test.ts`                                  | 21 новая проверка policy/снимков/валидации                        |
| `apps/worker/tests/universal-checkout.test.ts`                               | 15 новых migration/D1/race/runtime проверок                       |
| `apps/worker/tests/checkout-stock.test.ts`                                   | Дополнено точное старое DTO ожидание snapshot                     |
| `docs/VOYEY_CHECKOUT_STAGE_2_3A.md`                                          | Этот отчёт и карта                                                |

## Проверки

| Проверка                    | Итог                                                                        |
| --------------------------- | --------------------------------------------------------------------------- |
| Prisma generate / validate  | Успешно, без подключения к БД                                               |
| Config/security preflight   | Успешно                                                                     |
| Build                       | Успешно, Worker только local dry-run bundle                                 |
| Typecheck / lint            | Успешно                                                                     |
| Полный pnpm test            | **1069 passed, 5 skipped, 0 failed**                                        |
| Распределение               | API 249, Worker/D1 475, Admin 150, Mini App 169, Bot 16, config/security 10 |
| Новые тесты                 | API/shared 21 + Worker/D1 15 = 36                                           |
| Целевые прогоны checkout    | 56 API + 27 Worker тестов прошли отдельно                                   |
| Миграции/целостность        | 0001–0019 проверены на временной БД; foreign_key_check без ошибок           |
| Gitleaks / Git diff --check | Успешно, новых секретов/ошибок не найдено                                   |

Пять skipped — прежние PostgreSQL integration tests, отключённые намеренно.
Полный Turbo прогон использовал cache для 5 из 7 задач; новые тесты также явно
выполнены в целевых прогонах. Это не заявление о 100% покрытии или нагрузочной
готовности. Сохранено прежнее предупреждение Prisma о deprecated package.json#prisma;
смена конфигурации Prisma/зависимостей не входит в этот этап.

Логи — игнорируемая локальная `.cache/voyey-stage-2-3a/`.
Зависимости, lockfile, frontend и инфраструктура
не менялись. SHA-256 сверка 620 файлов базы: 603 неизменны, 17 изменены по таблице,
пропавших нет. Новых исходных/документационных файлов — 5, всего отслеживаемых 625.
Runtime tests используют синтетические данные в памяти, внешние вызовы блокируются.
Ручные реальные оплаты, Telegram, production и исходный STENZO не затронуты.

## Актуальная карта Backend VOYEY

«Работает» означает наличие реализации и локальных тестов, не deployed production.

| Модуль                 | Работает                                                                                       | Добавлено                                                                  | Пока не хватает                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Каталог                | Свободные плоские категории, Product price, SKU, остатки, медиа, RU/UZ, JSON attributes        | Category policy мерок                                                      | UI характеристик/политики, поиск по attributes, подкатегории, цены SKU                          |
| Корзина                | Одна Cart/User; несколько SKU; merge количества; ownership; nullable мерки; текущие цены/stock | Полная category hydration для checkout; public Cart DTO прежний            | Ключ строки по saleMode/меркам; UX generic товаров; согласованное подтверждение catalog changes |
| Checkout               | Проверки текущих строк, целые суммы, прежние акции/промокоды, 50%, D1 atomic/CAS               | Необязательные мерки по категории; snapshot characteristics                | Смешанные способы продажи/оплаты, PREORDER, выбор 100%, разбиение отгрузок                      |
| Заказы                 | Прежние статусы, основные снимки, idempotency, резерв конечного stock, история/архив           | Исторические категория/политика/характеристики/подписи/единицы в OrderItem | UI новых снимков; достоверный backfill старой истории невозможен                                |
| Manual orders          | Admin/CSRF, preview без записи, create без Cart, source=ADMIN, лимит/duplicates/replay         | Общая policy/снимки с checkout, без мерок для generic                      | Новые режимы продажи/финансовые правила                                                         |
| Оплата                 | Ручная карта → private proof → Admin approve/reject; предоплата/финальная оплата               | Финансовая логика сохранена                                                | Выбор 50%/100%, PREORDER payments                                                               |
| CARGO/финансы/возвраты | Прежние суммы CARGO, procurement, расходы/маржа, отмены/stock release/refund                   | Без изменений                                                              | Много отгрузок, товарный вес/тарифы и распределение по группам                                  |
| Auth/Telegram          | JWT, web sessions, Origin/CSRF; Bot/уведомления и ручная проверка                              | Защита новых policy fields; внешние вызовы отключены                       | Реальные credentials, универсальные UI/channel templates, Google/телефон                        |
| Database/media/infra   | D1 Batch/CAS, D1 media, Prisma types, локальные guards                                         | Подготовлена 0019, всего 19 миграций/28 таблиц                             | Отдельное разрешённое применение своей БД/настройка ресурсов; R2/deployment                     |

После этапа работа останавливается; следующий этап требует отдельного разрешения.
