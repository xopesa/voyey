# VOYEY — промокоды, этап 2.5A

Ветка: chore/voyey-bootstrap. Исходный чистый HEAD:
`4566258f2fdf1782556e33b0a1948929c4f15d43`.
Последняя обнаруженная миграция до работы — 0025; этап 2.4C3C не выполнялся.
Новая миграция: 0026_promo_policy_foundation.sql. Незавершённой чужой работы не было.

**Источник требований:** VOYEY_Promokody_Pravila.pdf в рабочем проекте не найден.
Использованы перечисленные в задании бизнес-требования. Отсутствующий PDF
не заменялся предположениями о дополнительных правилах.

SHA коммита реализации: 7772a255af1c4edde14da216607f8850ffd1f026.
Итоговый HEAD с этим отчётом приведён в сообщении о завершении.

Работа локальная. COMMERCE_ENABLED=0 сохранён. Не выполнялись push/merge/deployment,
remote migrations, реальные банковские/Telegram операции или создание ресурсов.
Исходный STENZO, Frontend, Admin UI, Mini App, дизайн и брендинг не менялись.

## А. Аудит существующей системы

| Механизм | Фактическая реализация до 2.5A |
| --- | --- |
| PromoCode | Общая уникальная идентичность/код, PERCENT/FIXED, value, minOrderAmount/maxDiscount, даты, active, global/per-user limits. Миграция 0010. |
| PromoCodeRedemption | FK на старые PromoCode/User/Order, UNIQUE(orderId), discountAmount. 0013 добавила releasedAt/releaseReason. |
| CheckoutPromoUse | FK PromoCode и (CheckoutGroup,userId), UNIQUE(group), одна скидка на группу. 0021 запрещает UPDATE/DELETE и release. |
| PromoCodeService | parsePromo, list/save/setActive/validateCart; normalize upper/trim, строгий формат, dates/minimum/limits. |
| promoForCheckout / promoUsage | Проверка заново при checkout; использование legacy redemptions + linked uses с releasedAt IS NULL. |
| CheckoutGroup | Один код на всю группу, одна quota row при commit, immutable распределённые скидки/финансовые снимки. |
| Отмены | LEGACY cancel освобождает свою redemption; новые unpaid cancel и paid refund 0024/0025 сохраняют quota. |
| Платежи | FIRST/FINAL ledger не фиксирует отдельный lifecycle промокода. SUBMITTED/REJECTED не управляет сроком quota. |

Пути: `apps/api/src/modules/marketing/promo-codes.ts`,
`packages/shared/src/promo-codes.ts`, `apps/api/src/d1/repositories.ts`,
`apps/api/src/modules/checkout/group-commit.ts`, `checkout/finance.ts`,
`checkout/split-plan.ts`, `admin/lifecycle.ts`, `checkout/cancellations.ts`,
`checkout/refunds.ts`, миграции 0010/0013/0021–0025.

Действующие HTTP API в `marketing/promo-routes.ts`:

- POST /promo-codes/validate — аутентифицированный покупатель, тело только code;
  server cart, read-only quote, без резерва.
- GET/POST /admin/marketing/promo-codes — прежний Admin guard, список/создание.
- PATCH /admin/marketing/promo-codes/:id — прежнее редактирование.
- POST /admin/marketing/promo-codes/:id/activate и /deactivate.
- DELETE не существует, история сохраняется. LEGACY Admin perimeter не стал owner-only.

Наследованные особенности STENZO:

- Все прежние коды фактически универсальны по режимам/ассортименту: нет PERSONAL,
  BLOGGER, category/product filters или mode exclusions.
- Процент ограничен 1–90 как в Zod, так и SQL CHECK 0010. Этот предел сохранён.
  Расширение до 100% требует отдельного решения и изменения старого SQL-контракта.
- Старый promoDiscount отклоняет FIXED >= subtotal и округлённую нулевую скидку.
  Его поведение не изменялось.
- Основой является актуальная цена Product с прежней логикой sale price. Min purchase
  проверяется после прежней товарной скидки, до промокода.
- Quota расходуется немедленно при оформлении, не после FIRST. Нет 24-часового
  резерва, двухчасового продления, ограничения трёх FIRST-попыток или RESTORED.
- Одна глобальная скидка распределяется 2.4A по subtotal всех режимов. Этот интерфейс
  нельзя использовать напрямую для скидки, применимой только к части ассортимента.

## Б. Реализованная основа

### Совместимое расширение существующей идентичности

PromoCode остаётся единственным источником ID, кода, суммы/процента, дат, статуса
и лимитов. Новый engineVersion DEFAULT 1 сохраняет все прежние коды как version 1.
Новые policy-настройки используют ту же PromoCode строку с engineVersion=2.
Второго namespace кодов, нового счётчика использования или параллельного redemption
lifecycle не создано. Существующие quota rows не менялись.

Миграция 0026 добавляет:

| Таблица/поле | Назначение |
| --- | --- |
| PromoCode.engineVersion | 1 — прежний engine; 2 — новая внутренняя policy. Версия существующей строки неизменяема. |
| PromoCodePolicy | PK/FK promoCodeId; saleModes, audience, purpose, assigned User/campaign, scope, actor/time/sealed. |
| PromoCampaign | Уникальные campaign ID/key, название, внутренний actor/time. Без внешней интеграции. |
| PromoPolicyCategory | Выбранные серверные Category ID, composite PK/FK. |
| PromoPolicyProduct | Выбранные серверные Product ID, composite PK/FK. |
| PromoPolicyExclusion | Product ID + IN_STOCK/PREORDER/BOTH, composite PK/FK. |

Пять представлений Admin выводятся из независимых измерений:

| Представление | saleModes | audience |
| --- | --- | --- |
| IN_STOCK | IN_STOCK | PUBLIC |
| PREORDER | PREORDER | PUBLIC |
| UNIVERSAL | BOTH | PUBLIC |
| PERSONAL | Любой из трёх | PERSONAL + personalUserId |
| BLOGGER | Любой из трёх | BLOGGER + campaignId |

PERSONAL хранит внутренний User ID. Перед созданием проверяется существующий
активный аккаунт; числовой Telegram ID из запроса не преобразуется в назначение.
Preview получает userId только из проверенного личного JWT и свежей User строки.
BLOGGER требует существующую PromoCampaign; связь не заставляет выбирать BOTH/ALL.
Компенсация — purpose=COMPENSATION, только PERSONAL; вручную создаётся владельцем
для будущего применения. Она не корректирует старый заказ и не применяется сама.

### Внутренние методы

`marketing/promo-foundation.ts:PromoFoundation` (default enabled=false):

- createCampaign — owner-only регистрация синтетической/будущей campaign identity.
- create — owner-only создание PromoCode v2, policy и фильтров одним atomic/CAS batch.
- setActive — owner-only переключение статуса v2 с повторной проверкой при CAS retry.
- preview — внутренняя read-only проверка по личному JWT, живому D1 cart/catalog
  и текущим usage counts; ничего не резервирует/не применяет.

Конфигурации и фильтры после sealing неизменяемы; кроме статуса редактирование v2
пока не реализовано. Это ограничение этапа, а не новое коммерческое правило.
До будущей реализации versioned edits можно отключить код, но нельзя незаметно
переписать его policy. Кампании также не редактируются и не удаляются этим API.

Preview использует существующий buildSplitCheckoutPlan. Поэтому необходимы явные
IN_STOCK/PREORDER и валидная для старого планировщика корзина, включая stock/мерки.
LEGACY preview остаётся в старом API. Публичного предварительного UI пока нет.

### Deterministic eligibility engine

`marketing/promo-policy.ts`:

- parsePromoPolicy — повторно использует promoSchema, не создаёт противоречивый
  набор старых money/date/code/limit правил; добавляет совместимые policy-проверки.
- evaluatePromoPolicy — только явные now, userId, usage и server lines; нет clock,
  DB, запросов, уведомлений или записи usage внутри вычислителя.
- promoKind — выводит пять будущих вариантов из двух независимых измерений.

Режим проверяется независимо от scope. Scope ALL/CATEGORIES/PRODUCTS; категории
сопоставляются по точному ID, без неутверждённого наследования подкатегорий.
Исключение Product/режим имеет приоритет. Правило одинаково для всех SKU Product;
цвет, размер, SKU и клиентские названия не участвуют.

Eligible subtotal — сумма подходящих goods lines до промокода. Только по ней
проверяется minimum. PERCENT = floor(eligibleSubtotal * value / 100) с BigInt и
необязательным maxDiscount. FIXED = min(value, eligibleSubtotal). Все входные суммы,
строки и общий итог проверяются на integer/int32/overflow; отрицательных итогов нет.
Нулевая округлённая скидка не считается действующим применением.

CARGO и локальная доставка отсутствуют в строгом контракте goods lines. Попытка
передать эти поля в engine отклоняется; service берёт цены только из server cart.
FIXED, равная eligible subtotal, может дать нулевую стоимость подходящих товаров
ТОЛЬКО в вычислительном предложении. В заказ это не записывается.

Существующий proposeDiscountAllocation даёт воспроизводимое largest-remainder
предложение по eligible subtotal каждого режима. Сумма долей совпадает со скидкой,
неподходящий режим получает 0. Результат version=2/executable=false; функция
calculateSplitFinance и commit новых скидок не изменены.

## В. Безопасность и совместимость

- SQL и service используют один нормализованный namespace: upper/trim, допустимые
  буквы/цифры/одиночные дефисы, 3–32 символа. Нельзя создать конфликт старого и нового
  кода или две version-строки одного кода. Нестандартные прежние SQL-строки не
  переписывались; проверка normalized duplicate применяется к новым INSERT/rename.
- Создание policy, выбранных IDs, audit и sealing — один существующий D1 atomic/CAS.
  FK, PK, CHECK, seal guards и revision triggers действуют на всех пяти таблицах.
  Ошибка audit/FK/seal откатывает конфигурацию; повтор не оставляет неполных фильтров.
- owner-конфигурация проверяется через VoyeyOwnerAuthority в каждой попытке. Обычная
  Admin cookie, staff и покупатель не создают PERSONAL/компенсационные коды.
  SQL видит активного User/Admin; точный owner ID/JWT проверяет server writer.
- Старый PromoCodeService скрывает v2 из обычного Admin списка и не редактирует/
  не активирует его по ID. Старый promoForCheckout/validateCart возвращает INVALID
  для v2, не пытаясь применить ограниченный код как глобальную скидку.
- Дополнительные SQL guards запрещают v2 INSERT в PromoCodeRedemption и
  CheckoutPromoUse. Даже прямой обход через старый checkout не создаст новую quota.
- Входящий payment ledger, outgoing refund ledger, private proofs, cancellation,
  order snapshots и механизмы stock не изменены. Отключение/expiry кода не вызывает
  пересчёта прежних заказов. Проверена сохранность после старого paid refund/cancel.
- promoUsage — то же прежнее суммирование двух существующих источников квоты.
  Его экспортированная функция используется для preview; актуальные counts не
  переписываются. У v2 пока нет фактических reservations/consumptions.
- Новых HTTP-маршрутов, config switch для включения, scheduler или Telegram нет.
  COMMERCE_ENABLED=0 сохранён, ресурсов/секретов STENZO не добавлено.

### Почему commit v2 остаётся закрытым

1. Ещё нет полного RESERVED/CONSUMED lifecycle. Существующий immediate quota нельзя
   объявлять 24-часовым резервом простым переименованием.
2. Старый calculateSplitFinance принимает один общий discountAmount и распределяет
   его по ВСЕМ subtotal. Передача новой суммы туда дала бы скидку неподходящим
   режимам/товарам. Нужен отдельно проверенный интерфейс eligible allocations.
3. Нулевая goodsTotal после полной FIXED скидки несовместима с текущим требованием
   положительного FIRST/ledger и зависимым от FIRST final invoice для CARGO.
   Способ consumption/оформления бесплатных goods требует отдельного решения.

Ни один из этих переходов не разблокирован в 2.5A.

## Г. Проверки и файлы

Новые файлы:

- apps/api/src/modules/marketing/promo-policy.ts
- apps/api/src/modules/marketing/promo-foundation.ts
- apps/worker/migrations/0026_promo_policy_foundation.sql
- apps/worker/tests/promo-foundation.test.ts
- packages/database/src/promo-policy-d1-schema.ts
- docs/VOYEY_PROMOCODES_STAGE_2_5A.md

Изменены:

- apps/api/src/modules/admin/owner.ts — PROMO_CONFIGURE.
- apps/api/src/modules/marketing/promo-codes.ts — v2 quarantine, экспорт прежнего usage.
- packages/database/prisma/schema.prisma — engineVersion и пять scalar-моделей.
- packages/database/src/d1-schema.ts — точечное подключение read metadata.

Старые миграции, тесты и финансовые writers не редактировались. Prisma generate/
validate — type contract, без подключения PostgreSQL. prepare-d1 массово не запускался.

Новый набор содержит 38 сценариев. Он проверяет пять типов/три режима, audience,
campaign/compensation, PERCENT/FIXED/cap/minimum/limits/dates, точные ID и exclusions,
несколько SKU, mixed goods, Cargo rejection, integer/boundaries/rounding, namespace,
owner/revocation/concurrent config, rollback, SQL quarantine, отсутствие маршрутов,
legacy compatibility и сохранность оплаченной истории/возвратов.

Миграция выполнена только в пустых и заполненных временных SQLite/Miniflare базах.
Populated upgrade/rollback содержит старые promo uses, FIRST/FINAL/CARGO, private
proofs, cancellations и refunds; старые значения сохранены. Единственное добавление
в прежние PromoCode rows — engineVersion=1. PRAGMA foreign_key_check чистый.
Настоящий локальный D1 проверяет batch rollback, server preview и закрытые
покупательские/Admin пути; outbound вызовов 0.

Build, typecheck, lint, Prisma generate/validate и security/config preflight прошли.
Полный набор: **1324 passed, 5 skipped, 0 failed** — Worker/D1 730, API 249,
Admin 150, Mini App 169, Bot 16, config/security 10. Пять исторических PostgreSQL
integration tests остаются пропущенными; production не проверялся. Turbo использовал
cache для четырёх неизменившихся test-задач, Worker набор выполнен заново.
Сохранены прежние предупреждения Vite use-client/sourcemap и package.json#prisma
deprecated; успешную сборку они не блокируют.

Gitleaks: no leaks found; существующие ignore/allowlist не расширялись.
Git fsck и diff --check прошли. SHA-256 сравнение 661 исходного tracked файла
с HEAD (CRLF/LF нормализованы для текста): 657 неизменны, 4 изменены по заданию,
потерянных файлов 0. Все 25 прежних миграций, финансовые writers, старые тесты,
UI/Bot/Worker runtime/config, scripts, зависимости и lockfile неизменны.
Добавлены 6 файлов; после сохранения отчёта итог — 667 tracked файлов.
Логи находятся в игнорируемой локальной .cache/voyey-stage-2-5a/.

## Д. Что подготовлено, но НЕ реализовано

Готовы конфигурация, FK-модель, валидация, owner-only внутреннее создание/отключение
и read-only deterministic quote. Это не реализация нового production promo lifecycle.

Нет 24h reservation, consumption после FIRST, pending hold, grace extension,
ограничения 3 FIRST receipts, quota release/restoration и синхронизации по вине
сторон. Нет UI «Мои промокоды», нового Admin UI, уведомлений, autoapply, публичного
v2 checkout, approved FIXED commit allocation или переноса прежних кодов в v2.
Тесты вычислений НЕ подтверждают эти отсутствующие lifecycle-переходы.

## Е. Предлагаемый небольшой этап 2.5B

Не создавать второй usage engine. Расширить существующую CheckoutPromoUse для
новых v2 записей и связать append-only события с одной записью на CheckoutGroup.
Версию старых v1 использований сохранить как LEGACY_CONSUMED по прежним правилам,
без заднего пересчёта/автоматического release.

Предлагаемый контракт, пока НЕ исполняемый:

| Состояние | Источник перехода | Квота |
| --- | --- | --- |
| RESERVED | Атомарный commit группы, срок 24h и неизменяемый eligibility/discount snapshot | Занята глобально и аккаунтом |
| CONSUMED | Подтверждённый FIRST любого ребёнка по согласованному правилу, одна ссылка на ledger/event | Занята один раз на группу |
| RELEASED | Безопасная неоплаченная отмена всей соответствующей группы/резерва | Освобождена по согласованной group policy |
| RESTORED | Подтверждённая owner-причина VOYEY и выполненные условия полной отмены/возврата группы | Восстановлена один раз |

Первый небольшой increment: зафиксировать approved распределение eligible скидки,
структуру v2 usage/event snapshot и атомарный резерв с проверкой global/per-account
лимитов. До проверки FIRST/pending/extension/cancel связей не открывать production.

Далее в том же lifecycle:

1. В checkout заново читать catalog/policy/user/counts внутри CAS; reservation,
   обе ветки заказа, stock, audit и одно использование сохранять единым batch.
2. FIRST approval и CONSUMED event писать атомарно с исходным ledger; group uniqueness
   не допускает второго consumption. Изменение active/expiry проверять только при
   НОВОМ применении, не переписывать ранее зафиксированную скидку.
3. SUBMITTED FIRST удерживает RESERVED до решения. Законный rejection после 24h
   может дать один grace event на группу; UNIQUE запрещает повторное продление.
   Максимум 3 FIRST попытки проверять в writers и SQL, не доверять UI.
4. Неоплаченный release связывать с cancellation; пока хоть одно необходимое pending
   решение не принято, не освобождать quota. Смешанные группы проверять целиком.
5. Оплаченная отмена покупателем не восстанавливает usage. Для VOYEY-fault restoration
   нужны структурированная owner-причина и подтверждённые refund ledgers всех
   оплаченных частей плюс безопасные terminal states остальных детей.
6. Idempotency event keys + source ledger/cancellation/refund FK, CAS/revision,
   единственная owner decision и UNIQUE(use,event,source) защищают гонки/retry.
7. Тестировать concurrent checkout у последней quota, два FIRST approvals,
   submit/reject/deadline, одно продление, attempts limit, mixed cancellation,
   refund/reconciliation и повторное восстановление. Не подменять их pure tests.

Что придётся расширить в следующих миграциях: quarantine guards 0026 на v2 usage,
immutable insert/update/delete guards CheckoutPromoUse из 0021, projection promoUsage
и атомарные callbacks group commit / linked-payment submit/review / cancellations /
refunds. Исторические миграции и существующие snapshots не переписывать; снимать
quarantine можно только одновременно с готовыми SQL/CAS lifecycle-инвариантами.

### Вопросы владельцу перед подключением

- Сохраняем ли лимит PERCENT 90% или требуется 100%? PDF необходимо сверить перед
  расширением. Сейчас действует исторический безопасный предел.
- Как оформить/потребить промокод при goodsTotal=0, особенно PREORDER с будущим CARGO,
  когда положительного FIRST нет? Автоматического фиктивного платежа не будет.
- Подтверждается ли предложенное proportional eligible-subtotal распределение FIXED
  с largest remainder и существующим tie-break, включая смешанную корзину?
- Категория включает только точный ID или все подкатегории? Сейчас только точный ID.
- Три FIRST попытки считаются для каждого дочернего заказа или общими на группу?
- От какого точного timestamp считать дополнительные 2 часа и как трактовать
  одновременные rejection двух детей? Продление в любом случае одно, как согласовано.
- Как трактовать освобождение резерва при отмене только одного неоплаченного ребёнка,
  когда другой сохраняется, особенно если код применим только к одному режиму?
- Какие именно group conditions нужны для VOYEY RESTORED: только финансовое завершение
  или также RELEASED stock reconciliation? Текущий refund может быть COMPLETED
  при REQUIRES_RECONCILIATION, это нельзя игнорировать молча.
- Нужны ли versioned edits и согласованный перенос старых активных кодов в новый
  lifecycle? Сейчас v1 остаются v1, v2 policy terms immutable кроме active.

Этап 2.5B не начат. Изменения остаются локальными.
