# А. VOYEY Backend — результат этапа 2.1

Дата: 22 октября 2026. Папка: `C:/Users/USER/Desktop/Voyey`.
Ветка: `chore/voyey-bootstrap`. Проверенный исходный HEAD:
`93ddf43459d7790d4f1e2340b411919c09923f8e`; до начала этапа рабочее дерево было чистым.
Коммит этапа: `feat(catalog): add per-SKU preorder availability metadata`.
Точный итоговый SHA приведён в сообщении о завершении; предыдущий коммит сохранён в истории.

## Выбранная модель

Добавлен независимый Boolean `ProductVariant.preorderEnabled`, по умолчанию `false`.
Это разрешение предзаказа в каталоге, **не режим созданного заказа и не включение checkout**.
Флаг относится к SKU, поэтому один товар может иметь разные варианты доступности,
а один и тот же SKU одновременно иметь складской остаток и разрешение предзаказа.
Дублировать Product, SKU, цены, характеристики или изображения не требуется.

| stock | preorderEnabled | Новый складской признак IN_STOCK | PREORDER metadata                   | Старый isAvailable |
| ----- | --------------- | -------------------------------- | ----------------------------------- | ------------------ |
| 5     | false           | quantity=5, available=true       | enabled=false                       | true               |
| 5     | true            | quantity=5, available=true       | enabled=true, checkoutEnabled=false | true               |
| 0     | true            | quantity=0, available=false      | enabled=true, checkoutEnabled=false | false              |
| null  | false           | quantity=null, available=false   | enabled=false                       | true               |
| null  | true            | quantity=null, available=false   | enabled=true, checkoutEnabled=false | true               |

`stock=null` остаётся прежним неучитываемым/неограниченным остатком для старого
checkout. Он не доказывает физическое наличие и никогда автоматически не разрешает
PREORDER. Поэтому новый складской признак консервативно показывает available=false
при quantity=null, а старый isAvailable=true сохранён ради совместимости. Это два
разных контракта, не ошибка преобразования данных.

Положительный stock и preorderEnabled=true позволяют описать оба способа продажи.
При stock=0 предзаказ описан, но оформить его нельзя. При stock=null старые заказы
по-прежнему могут оформляться по прежним правилам — они не становятся PREORDER.

## Изменения API

Существующие запросы продолжают работать:

- `POST /api/admin/catalog/products/:productId/variants`: принимает дополнительный
  optional Boolean `preorderEnabled`; отсутствие поля даёт false.
- `PATCH /api/admin/catalog/variants/:id`: принимает optional Boolean
  `preorderEnabled`; отсутствие поля не меняет сохранённое значение.
- Admin GET товара/списка и ответы create/update возвращают сохранённый флаг
  в вариантах. Прежние SKU, stock, size, color, isActive сохранены.
- `GET /api/catalog/products` и `GET /api/catalog/products/:slug`: у каждого
  варианта добавлен объект `availability`:

```json
{
  "IN_STOCK": { "quantity": 5, "available": true },
  "PREORDER": { "enabled": true, "checkoutEnabled": false }
}
```

Это дополнительные поля ответа. Прежние isAvailable, availableSizes, цены,
изображения, фильтры, пагинация и пути API не изменены. Интерфейсы React не менялись;
существующие frontend-тесты прошли без изменений. Независимые внешние клиенты со
строгими схемами ответов в этом репозитории не проверялись.

Admin create/update сохраняют флаг и AuditLog атомарно. PATCH флага не меняет
остаток, SKU, Product, стоимость или изображения. Генератор SKU создаёт новые
варианты с false через SQL default и не переписывает разрешение существующих SKU.
Отдельных product-level флагов и нового endpoint выбора способа продажи не добавлено.

## Схема и сохранённая логика

- Подготовлена только новая `0017_variant_preorder_enabled.sql`: ADD COLUMN,
  NOT NULL DEFAULT 0, CHECK IN (0,1). Старые строки получают false, stock не меняется.
- Миграции 0001–0016 не изменены. На рабочих/удалённых базах 0017 не применялась.
- Prisma schema описывает новое поле для генерации типов. D1 metadata обновлена
  для корректного преобразования SQL 0/1 в Boolean. Сам Prisma runtime не включён.
- Не запускались исторические schema generators, переписывающие исходные миграции.
- Текущий checkout не получает saleMode; Cart/Order/OrderItem schemas не менялись.
  Явные PREORDER и IN_STOCK в checkout/cart/manual-order payload отклоняются
  существующей строгой валидацией. В тестах это проверено и при commerce=1.
- preorderEnabled=true не обходит stock=0, не создаёт новое резервирование,
  не меняет платёжные суммы или статусы. Старый checkout сохраняет предоплату 50%,
  включая конечный складской остаток. Новая продажа IN_STOCK с оплатой 100% не готова.
- Ручная оплата на карту → приватный чек → решение администратора сохранена.
- `COMMERCE_ENABLED=0`, изоляция VOYEY, инфраструктура и secrets-шаблоны не менялись.
- Категории «Одежда», «Канцтовары», «Средства ухода» не создавались в каких-либо базах.
  Модель Category по-прежнему свободная; наполнить её можно отдельно.

## Проверки

| Проверка                                | Результат                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------- |
| Prisma generate / validate              | Успешно; localhost URL только для синтаксиса, без подключения             |
| VOYEY config/security preflight         | Успешно                                                                   |
| Build Backend, shared/database и Worker | Успешно; Worker только local bundle dry-run                               |
| Build остального workspace              | Успешно; frontend-исходники не менялись                                   |
| Typecheck / lint                        | Успешно                                                                   |
| Полный основной набор тестов            | **985 passed, 5 PostgreSQL tests skipped**                                |
| Новые тесты этапа                       | 3 API DTO cases и 8 D1/Worker/schema/security scenarios                   |
| Миграции и foreign_key_check            | Все 17 применены только в отдельной БД :memory:, 28 таблиц, ошибок FK нет |

Распределение тестов: config/security 10, API 189, Worker/D1 451, Bot 16,
Admin 150, Mini App 169. Проверены совместное наличие и предзаказ, null/zero/positive
stock, отказ от невалидных флагов, защита Admin/CSRF, аудит/rollback, генератор SKU,
старые checkout/stock/payment scenarios и невозможность явного PREORDER checkout.
Внешние обращения новых интеграционных fixtures заканчиваются ошибкой;
outboundCalls=0. Флаг commerce=1 используется только внутри изолированных тестов.

Логи находятся в `.cache/voyey-stage-2-1/` и не включаются в Git.
Сканирование секретов и итоговая проверка неизменности защищённых файлов выполнены
перед созданием локального коммита. Push и deployment не выполнялись.

## Что не готово и требует отдельного решения

1. Выбор способа продажи в корзине и неизменяемый mode snapshot в OrderItem/Order.
2. Раздельные правила резервирования склада и заказа поставщику, включая stock=null.
3. Выбор 50%/100%, оплата 100% для нового IN_STOCK, правила CARGO и final payment.
4. Checkout сейчас требует рост/вес для всех товаров. Для канцелярии и средств ухода
   нужна отдельная согласованная адаптация обязательных полей; на этом этапе её нет.
5. Цены сейчас задаются на Product; разные цены по SKU/способу продажи отсутствуют.
6. Реальная инфраструктура VOYEY, credentials, локальная рабочая БД и применение 0017
   требуют отдельной подготовки. Успешные тесты не подтверждают работу deployment.
7. Предзаказные фильтры каталога, UI-переключатели, сотрудники/RBAC, Google/Phone Auth,
   автоматическая отмена и маркетплейс не реализовывались.

## Файлы этапа

Изменены:

- `apps/api/src/d1/repositories.ts`: persistence и аудит флага в D1 variant CRUD.
- `apps/api/src/modules/admin/catalog/repository.ts`: согласованное описание legacy repository и аудита.
- `apps/api/src/modules/admin/catalog/schemas.ts`: Boolean create/patch validation.
- `apps/api/src/modules/admin/catalog/types.ts`: optional поле входных DTO.
- `apps/api/src/modules/catalog/types.ts`: record/response types.
- `apps/api/src/modules/catalog/service.ts`: additive public availability DTO.
- `apps/api/tests/catalog.test.ts`: совместимость public DTO для null/0/positive stock.
- `packages/database/prisma/schema.prisma`: описание модели без PostgreSQL migration.
- `packages/database/src/d1-schema.ts`: Boolean mapping.
- `packages/shared/src/index.ts`: экспорт новых domain types/helper.

Добавлены:

- `apps/worker/migrations/0017_variant_preorder_enabled.sql`.
- `apps/worker/tests/sale-availability.test.ts`.
- `packages/shared/src/sale-availability.ts`.
- Этот отчёт и `docs/VOYEY_BACKEND_MAP.md` — полная карта Backend после этапа.

Подробная инвентаризация функций, API, таблиц, тестов и ограничений:
[Б. Полная карта текущего Backend VOYEY](C:/Users/USER/Desktop/Voyey/docs/VOYEY_BACKEND_MAP.md).
