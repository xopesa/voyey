# VOYEY — Frontend ADMIN-01

Дата: 24.10.2026. Рабочая копия: `C:/Users/USER/Desktop/Voyey`.
Ветка: `chore/voyey-bootstrap`. Исходный HEAD: `7c67ee12596d6b2b67e1d844e03a5ca677941cbe`; перед работой дерево было чистым.
Коммит реализации, тестов и машинных результатов: **`620f948c5dde6d7500747b60360a68405f7d15a8`**.

Создан отдельный локальный React/TypeScript прототип VOYEY Admin. Защищённый старый Admin, Backend, Cloudflare, финансовые writers и база данных не изменены. Это дизайн и демонстрационные взаимодействия, не готовая административная система с серверной авторизацией.

**Автоматические проверки завершены успешно. Полноценная браузерная и визуальная QA в этом этапе не выполнялась.** Ранее локальное управление браузером было отключено настройкой Work; владелец разрешил продолжать без него. HTML и семь локальных ресурсов проверены по HTTP; это не подтверждает геометрию, анимации и работу на устройствах.

## Запуск и изоляция входа

С Node 24.x и закреплённым pnpm 10.17.1 из корня:

```powershell
pnpm --filter @stenzo/admin dev --port 5174 --strictPort
```

Новый прототип: <http://127.0.0.1:5174/admin/voyey-admin-demo.html>.
Сначала открывается форма входа; отдельная кнопка «Посмотреть демо-панель» открывает Dashboard.
Прямой демонстрационный маршрут: <http://127.0.0.1:5174/admin/voyey-admin-demo.html?screen=dashboard>.

Префикс `/admin/` обусловлен существующим `base` в `apps/admin/vite.config.ts`. Старый `/admin/` продолжает использовать прежний `index.html` и `src/spa.tsx`; новый вход их не импортирует.

`src/voyey/entry.tsx` разрешает динамический импорт только при `import.meta.env.DEV` и loopback hostname. HTML не добавлен в production inputs. CSP запрещает отправку HTML-форм и внешние ресурсы; соединения со своим origin и локальные WebSocket оставлены для Vite. CSP — дополнительная защита, а основная граница здесь — отсутствие API-клиента/writers и полное исключение Demo из production assets.

Ни новой авторизации, ни новых маршрутов Worker/API не создано. `screen=dashboard` — маршрут синтетического макета, не разрешение на старый Admin. Перезагрузка сбрасывает данные; выход из Demo также сбрасывает локальные товары и решения по чекам. Единственная сохраняемая настройка — RU/UZ в `voyey.admin.demo.locale`; production cookies и browser storage не используются.

## А. Исходная система

### Layout и брендинг

- `apps/admin/index.html`, `src/app/layout.tsx` — прежний заголовок STENZO Admin; Next layout также подключает прежние глобальные стили.
- `src/components/Header.tsx` — STENZO/WEAR/ADMIN, прежние preference controls и административный avatar.
- `src/components/AdminFrame.tsx` — прежний sidebar, восемь основных ссылок, STENZO WEAR wordmark, рабочая область и logout с API. Подключает `src/styles/dashboard-v2.css` и `admin-sections.css`.
- `src/spa.tsx` — фактический Vite routing: session bootstrap, login и защищённые страницы каталога, заказов, клиентов, финансов, маркетинга и Telegram. Next pages сохранены как существующая структура; новый прототип их не заменяет.
- `src/lib/api.ts` — `/api/admin/*`, same-origin credentials, no-store, обработка ошибок и возврат на старый login при 401.

Эти файлы сохранены побайтово с учётом Git-нормализации LF/CRLF. Старый внешний брендинг остаётся намеренно в старом Admin. В новом прототипе используется VOYEY, internal `@stenzo/*` не переименованы.

### Фактически существующая авторизация

Уточнение задания: серверные реализации входа **уже есть в историческом контуре**, но это не готовая индивидуальная система сотрудников для новой панели.

| Слой              | Что обнаружено                                                                                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Старый Frontend   | `src/components/Login.tsx` вызывает `auth/method`, затем `auth/access` либо `auth/login`; при парольном варианте `src/lib/admin-login.ts` вычисляет PBKDF2 proof, очищает пароль и после успеха открывает прежний `/admin/`                                |
| Worker boundary   | `apps/worker/src/index.ts:388` и далее проверяет Admin origin, security configuration и `ADMIN_AUTH_MODE`. Access-ветка проверяет assertion, парольная — конфигурацию и proof. Есть лимит попыток, серверные сессии и внутренний подписанный proxy-контур  |
| Cloudflare Access | `apps/worker/src/access.ts`: team domain, audience, email allowlist, `cf-access-jwt-assertion`, удалённые JWK, RS256, issuer/audience/exp/iat/sub/email/type. В ADMIN-01 реальные JWK endpoints не вызывались                                              |
| Пароль Worker     | `apps/worker/src/admin-password.ts`: валидируемая конфигурация `ADMIN_PANEL_LOGIN`/hash и constant-time сравнение proof. Challenge содержит соль и iterations; это не свежий одноразовый challenge                                                         |
| Fastify login     | `apps/api/src/modules/admin/web-auth.ts`: login/session/logout, origin, request marker, HttpOnly cookie. `web-session.ts` содержит Argon2-проверку для поддерживающей её среды, непрозрачный random token, хеш токена, CSRF, срок сессии и route allowlist |
| Хранилище сессий  | `apps/api/src/d1/session-store.ts`, `modules/admin/session-store.ts`, `prisma-session-store.ts`; D1- и исторический Prisma-контуры существуют отдельно                                                                                                     |
| Общий Admin guard | `modules/admin/authorization.ts`: серверная web session либо JWT + Telegram admin allowlist. Это не полноценная новая RBAC-модель сотрудников                                                                                                              |

Локальный `apps/worker/wrangler.jsonc` уже задаёт `ADMIN_AUTH_MODE=password`, неактивные VOYEY origin/D1, `COMMERCE_ENABLED=0`. `.env.example` — инвентаризация будущих настроек, без password hash и секретов. Значит, неверно описывать Access как безусловно обязательный для всех текущих конфигураций. Сохраняются обе существующие ветки проверки; ни настройки, ни guards не менялись.

Зависимости Access обнаружены в `apps/worker/src/{index,access,admin-password,isolation}.ts`, старом `apps/admin/src/components/Login.tsx`, `.env.example`, `scripts/check-preview.mjs` и `scripts/voyey-isolation.test.mjs`. Исторические Access host/audience в `isolation.ts` являются denylist, не действующими целями. Конфигурации Cloudflare не изменены.

Важно для ADMIN-02: `apps/worker/wrangler.jsonc` подменяет native `argon2` на `src/password-disabled.ts`; простое подключение старого Fastify password endpoint к Worker не является готовым решением. Нужны согласованный серверный протокол, поддерживаемый KDF и проверка стоимости в целевой среде Cloudflare.

### Роли и финансовая authority

`TelegramAdmin` в `packages/database/prisma/schema.prisma` хранит Telegram ID, active flag, label и notification flags. Полной таблицы новых staff permissions там нет. Старый `WEB_ADMIN_ACTOR` — общий web-admin actor, не индивидуальный сотрудник.

`apps/api/src/modules/admin/owner.ts:22`, `VoyeyOwnerAuthority`, проверяет серверную конфигурацию `VOYEY_OWNER_TELEGRAM_ID`, JWT subject, ACTIVE пользователя и активного TelegramAdmin; сравнивает Telegram ID с владельцем и пишет разрешение/отказ в аудит. В новой checkout-модели проверки выполняются рядом с атомарными финансовыми writers, например `checkout/linked-payments.ts:357`, `checkout/refunds.ts:263`; PaymentLedger/RefundLedger и SQL guards сохранены.

Исторические `/admin/payments/*`, finance/refunds и новые checkout owner workflows — разные контуры. Например, `modules/payments/route.ts:233` использует прежний `adminGuard`. Перед будущим подключением новой панели нужна общая матрица permissions для всех маршрутов, включая legacy; нельзя автоматически приравнять web-admin session к owner authority. ADMIN-01 не меняет доступ ни к одному из этих маршрутов.

## Б. Новый VOYEY Admin

| Экран / компонент                                                                         | Реализовано                                                                                                                                             | Граница                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Login                                                                                     | Оригинальный логотип, RU/UZ, поля, show/hide password, Enter, валидация пустых значений, loading, доступные подписи и ошибка                            | Submit очищает пароль, затем явно сообщает, что серверный вход не подключён. Нет успешной ветки, fake JWT или перехода в защищённый Admin |
| Shell / Sidebar                                                                           | Постоянный desktop sidebar, сворачивание 252↔80 px, 13 разделов, общий active indicator, demo viewer, выход                                             | Ни client role, ни серверных полномочий                                                                                                   |
| Header                                                                                    | Breadcrumb/title, RU/UZ, уведомления, avatar/profile dialog; поиск в заказах и товарах                                                                  | Информационные действия локальные                                                                                                         |
| Dashboard                                                                                 | Шесть компактных KPI, последние заказы, ожидающие чеки, низкие остатки, события и состояние магазина; рабочие переходы                                  | Все цифры синтетические, помечены DEMO                                                                                                    |
| Заказы                                                                                    | Таблица, поиск, семь фильтров, drawer со snapshot, скидкой, FIRST 50/100, остатком товаров и отдельным CARGO                                            | Статусы взяты из существующего Backend vocabulary, не создаются реальные заказы                                                           |
| Товары                                                                                    | Фото, RU/UZ названия, категория, Product price, SKU, stock, preorderEnabled, публикация; поиск, сортировка, категории, создание/редактирование в памяти | Один демонстрационный SKU на fixture; полноценный multi-variant/image upload manager остаётся будущим подключением                        |
| Проверка оплат                                                                            | FIRST/FINAL, сумма, submitted time, статус, попытка, синтетический SVG-чек, обязательство, история и ссылка на заказ                                    | Approve/reject требуют отдельного demo confirm; меняют только статус mock claim, не ledger, деньги или order state                        |
| Промокоды                                                                                 | Пять типов, read-only таблица и drawer будущей формы: скидка, минимум, scope/exclusions, PERSONAL user, BLOGGER campaign                                | Нет создания, mutations и настоящих promo writers                                                                                         |
| Категории / Склад / Возвраты / Кампании / Покупатели / Сотрудники / Аналитика / Настройки | Маршруты и честные локализованные экраны разработки                                                                                                     | Рабочие серверные разделы здесь не имитируются                                                                                            |

Общие компоненты в `apps/admin/src/voyey/components.tsx`: `VoyeyAdminSidebar`, `Header`, `Login`, `Button`, `Input`, `Card`, `Table`, `StatusBadge`, `Modal`, `Drawer`, `StatCard`, `EmptyState`, `ConfirmDialog`; `VoyeyAdminShell` — в `App.tsx`. Shared table включает empty/loading/error states, доступный scroll region, sticky headers, hover и форматирование UZS.

`screens.tsx` содержит экраны и общие Orders table/details; `model.ts` — синтетические fixtures, фильтры, сохранение локального товара и demo-review. Новые материалы не содержат реальных покупателей, контактов, заказов, банковских реквизитов или доказательств платежей.

### Денежные примеры и снимки

- `DEMO-1048`: IN_STOCK, товары 89 000, скидка 8 900, FIRST100 = 80 100; первый чек SUBMITTED.
- `DEMO-1047`: PREORDER, товары 72 000, скидка 10 800, FIRST50 = 30 600 подтверждён, остаток товаров 30 600; CARGO неизвестен.
- `DEMO-1046`: IN_STOCK, FIRST100 = 299 000, PAID_FULL.
- `DEMO-1045`: PREORDER FIRST100 = 72 000, CARGO после поступления 17 000; FINAL 17 000 SUBMITTED, поэтому это не полностью оплаченный заказ.
- Ещё два synthetic заказа показывают REJECTED/ожидание оплаты и CANCELLED без оплаты.

Название, SKU, количество и характеристики внутри OrderItem fixture клонированы отдельно от редактируемого каталога. Изменение названия, категории, цены и характеристик локального товара не подменяет историю заказа. Остаток за товары считается от подтверждённой суммы товаров; неизвестный CARGO не превращается в ноль. Demo-review не обновляет финансовую модель и Dashboard turnover: это визуальная имитация решения по изображению, что отражено в пояснениях и тестах.

Процент 1–99 и fixed cap 99% описаны в promo drawer; это визуальные правила будущей формы, не новая реализация расчётов Backend. Цена остаётся только на Product, поле цены SKU не добавлено.

## В. Дизайн и адаптивность

`styles.css` выделяет белый, Burgundy `#B71C3C`, Red `#D31532`, Brown `#4A2C1A`, Soft Pink `#FFF1F1`, Gray `#F7F7F8`, border/shadow/radius/control tokens. Inter — существующий локальный шрифт. Основной фон светлый, красный используется для акцентов, кнопки без градиентов. Glass ограничен sidebar/header, остальная рабочая область — читаемые таблицы и карточки. SVG-иконки используют существующий в проекте подход line icons; новая библиотека иконок не установлена.

Оригинальные PNG `voyey-original.png` и `voyey-symbol-original.png` импортируются из Mini App; файлы не обрезаны и не перекрашены. CSS ограничивает их белые поля. Прежние демонстрационные товарные фотографии также переиспользуются без изменения исходников и без дублирования файлов.

В Admin добавлена только `motion` **14.6.0**, точно закреплённая версия, совпадающая с Mini App. React lockfile — **19.3.0**. Новых транзитивных версий не потребовалось: lockfile изменён только на три строки Admin importer.

Motion: sidebar width, общий navigation indicator через LayoutGroup/layoutId, page fade/небольшой slide, drawer/modal entrance, press feedback и active filter. Основная длительность 220 ms. `MotionConfig reducedMotion="user"` и `useReducedMotion` убирают slide/shared indicator/tap при reduced motion; остаётся короткий переход 80 ms. CSS дополнительно учитывает media preference. Использованы документированные [reduced motion](https://motion.dev/docs/react-accessibility) и [shared layout](https://motion.dev/docs/react-layout-animations).

Sidebar находится вне AnimatePresence страниц, его ширина не зависит от раздела. Страница сохраняет scrollbar gutter; таблицы не получают layout-анимацию размеров. На ширинах до 900 px desktop sidebar скрыт; открывается отдельный левый modal drawer. BottomNav магазина не используется. Overflow таблицы ограничен её собственным доступным region; flex/grid контейнеры имеют min-width:0. На телефоне KPI идут в две колонки, header/search перестраиваются, детали занимают доступную ширину, длинные строки могут переноситься.

Все новые пользовательские подписи, ошибки и состояния основных экранов — RU/UZ в `messages.ts`; названия RU и UZ в каталоге показаны отдельными строками с соответствующим `lang`. Технические enum values, DEMO/VOYEY ADMIN, SKU и валютный код не являются отдельным переводом. Деньги — Intl UZS, время — Asia/Tashkent.

## Г. Безопасность

1. В import graph Demo нет API client, session provider, защищённых компонентов, финансовых writers, Telegram SDK, network client или чтения реальных auth tokens.
2. Login хранит введённое только в текущем React state; пароль очищается при submit. Нет credential logging/storage, cookie, hardcoded password, mock JWT/session или фиктивной успешной авторизации.
3. Только отдельная demo-кнопка/локальные screen query открывают макет. Реальный login и защищённый `/admin/` не открываются из макета.
4. Локальные review callbacks меняют исключительно массив mock claims. Вызов backend approve/reject, изменение stock/ledger и выдача owner permissions отсутствуют.
5. Старые Worker Access/password guards, web sessions, CSRF, proxy signatures, owner binding и SQL guards сохранены. Новый generic login не выдаёт полномочия владельца.
6. Все 28 D1 migrations, Prisma schema/migrations, Worker/API/Bot и прежний Admin сохранены. `COMMERCE_ENABLED=0`, неактивные ресурсы и STENZO denylist не менялись.

Production isolation проверена фактической сборкой: новый HTML, CSS classes, storage key, fixture IDs и promo markers отсутствуют в `apps/admin/dist`, `apps/miniapp/dist`, `apps/worker/public`. SHA-256 всех 13 production HTML/JS/CSS файлов совпали с сохранёнными результатами UI-02. В том числе старые Admin `index-DCatBEP0.js` и `index-CPf77HxM.css` не изменились. Полный список — `docs/admin-01/isolation.json`.

Это проверка исходников и локальных assets, а не тест работающей production-среды. Production-сервисы и реальные сессии не использовались.

## Д. Результаты проверок

Команды выполнялись с очищенными credentials/proxy environment, отключёнными telemetry и PostgreSQL integration flags. Логи доступны локально в `.cache/voyey-admin-01/`; переносимые итоговые результаты — `docs/admin-01/checks.json`.

| Проверка                                           | Результат                                                                                                                                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                   | PASS; lockfile согласован. Установщик сообщил, что build script workerd пропущен; разрешения на дополнительные install scripts не менялись                                                                      |
| `pnpm build`                                       | PASS; существующий pipeline включает локальную Worker dry-run сборку, без deployment                                                                                                                            |
| `pnpm typecheck`                                   | PASS                                                                                                                                                                                                            |
| `pnpm lint`                                        | PASS, включая config lint                                                                                                                                                                                       |
| `pnpm config:check`                                | PASS: неактивные VOYEY Cloudflare/D1, без реальных routes/credentials/env overrides                                                                                                                             |
| `pnpm test:config`                                 | 10 PASS                                                                                                                                                                                                         |
| `pnpm exec turbo run test --force --concurrency=1` | Все 7 tasks успешны, cache не использован                                                                                                                                                                       |
| Admin                                              | 194 PASS, из них 44 новых теста ADMIN-01                                                                                                                                                                        |
| Mini App                                           | 200 PASS                                                                                                                                                                                                        |
| Worker                                             | 862 PASS                                                                                                                                                                                                        |
| API                                                | 249 PASS; 5 PostgreSQL tests SKIP, реальная PostgreSQL не подключалась                                                                                                                                          |
| Bot                                                | 16 PASS                                                                                                                                                                                                         |
| Итого с config                                     | **1531 PASS, 5 SKIP, 0 FAIL**                                                                                                                                                                                   |
| Gitleaks dir + default rules + redact              | 0 находок; скан исходников/документов, generated directories исключены существующей конфигурацией                                                                                                               |
| `git fsck --full --strict`                         | PASS, повреждённых объектов не обнаружено                                                                                                                                                                       |
| `git diff --check` / staged diff                   | PASS; сообщения LF→CRLF являются нормализацией Git                                                                                                                                                              |
| Сохранность исходников                             | 723 исходных blob проверены SHA-256 с LF/CRLF нормализацией текста, бинарные assets — по исходным байтам; 721 без изменений, только manifest и lock изменены намеренно; отсутствующих/неожиданно изменённых нет |
| Production assets                                  | PASS, отсутствие Demo и совпадение SHA-256 с UI-02                                                                                                                                                              |
| Локальный HTTP                                     | HTML и entry/App/components/model/messages/screens/styles: 200, без Vite error overlay                                                                                                                          |

Новые тесты исполняют чистые filters/editor/review, проверяют snapshots/деньги/категории/SKU, отсутствие ложного paid при PREORDER/CARGO, оба языка, route allowlist, реальный React SSR Login и всех 13 страниц, long names, empty/loading/error. Отдельный handler-тест проверяет пустую форму, очистку пароля, loading→честную ошибку, отсутствие credential network/storage и отдельную demo-кнопку. Тест modal lifecycle проверяет showModal/close/focus cleanup с DOM doubles; reduced-motion проверяет отсутствие slide и shared navigation movement. Проверяется import graph без сетевых и защищённых модулей.

**Браузерная QA не пройдена и не объявляется пройденной.** Нет новых screenshots/DOM geometry measurements на 320, 390, 430, 768, 1024, 1280, 1440 px. SSR и HTTP не доказывают отсутствие overflow на всех ширинах, визуальную точность логотипа, стабильность sidebar по кадрам, focus trap/Escape/backdrop в настоящем браузере, работу экранной клавиатуры, системного reduced motion и длинных названий в реальной таблице. Эти сценарии остаются обязательной проверкой при восстановлении управления браузером. Старые измерения UI-02 относятся к Mini App и не подменяют Admin QA.

Сборка сохраняет прежние предупреждения Vite про игнорирование `use client` и связанные sourcemap diagnostics в старых компонентах. Они не остановили build; прежние production hashes подтверждают, что старый интерфейс не изменён. Это не отчёт об устранении старых предупреждений или о полном security-аудите всех зависимостей.

## Е. Изменённые файлы и Git

Изменены существующие:

- `apps/admin/package.json` — одна точная зависимость Motion.
- `pnpm-lock.yaml` — только Admin importer Motion.

Добавлены:

- `apps/admin/voyey-admin-demo.html` — отдельный dev HTML/CSP.
- `apps/admin/src/voyey/entry.tsx` — DEV + loopback gate.
- `apps/admin/src/voyey/App.tsx` — shell, routing и состояние в памяти.
- `apps/admin/src/voyey/components.tsx` — общие компоненты, Login, Sidebar/Header, native dialogs.
- `apps/admin/src/voyey/screens.tsx` — Dashboard, заказы/детали, товары/editor, платежи/детали, промокоды.
- `apps/admin/src/voyey/model.ts` — синтетические fixtures и локальная модель.
- `apps/admin/src/voyey/messages.ts` — RU/UZ и форматирование.
- `apps/admin/src/voyey/styles.css` — самостоятельные Admin tokens/layout/responsive.
- `apps/admin/src/voyey/proof.svg` — схематическое изображение с DEMO, без банковских данных.
- `apps/admin/tests/voyey-admin.test.mjs` — 44 теста.
- `docs/admin-01/checks.json` — результаты команд и границы QA.
- `docs/admin-01/isolation.json` — сохранность исходников и production assets.
- `docs/VOYEY_ADMIN_STAGE_01.md` — этот отчёт и план следующего этапа.

Всего 15 файлов относительно исходного HEAD. Коммит реализации указан в начале отчёта. Сам отчёт фиксируется следующим локальным documentation-коммитом; **точный итоговый HEAD этого коммита и результат заключительного `git status` сообщаются в ответе о завершении**, их также показывает `git rev-parse HEAD` в рабочей копии. SHA собственного содержащего его коммита внутрь файла не записывается.

GitHub push, merge, deployment, реальные миграции, создание ресурсов и работа с реальными банком/Telegram не выполнялись. Исходный STENZO не изменён. Локальные runners/logs находятся в уже игнорируемой `.cache`, не входят в коммиты. Сервер Vite слушает loopback; новая панель — локальный прототип.

## Ж. План ADMIN-02 — только проектирование

Ниже предложения для согласования. В ADMIN-01 они не реализованы; схемы и инфраструктура не создавались.

### 1. Контракт и угроза перехода

Сначала инвентаризировать все Admin/finance/checkout owner endpoints и разделить authentication, обычные staff permissions, owner authority и audit actor. Согласовать модель персональных сотрудников, жизненный цикл учётной записи, bootstrap единственного владельца, восстановление доступа и политику денежных операций. Существующий shared login не превращать автоматически в владельца.

Согласовать единый login/session/logout/step-up контракт Worker + Fastify + D1. Закрыть неоднозначность нынешних password/proof и legacy raw-password paths. Статический client-derived proof нужно рассматривать как повторно используемый credential; перенос KDF только на клиент не заменяет серверную password security. Удалять текущий протокол можно лишь после отдельного решения о совместимости и ревокации старых сессий.

### 2. Password hashes и Cloudflare

Приоритет — серверный password hash с индивидуальной random salt, версией алгоритма/параметров и upgrade-on-login. Argon2id выбирать только при поддерживаемой реализации и измеренном бюджете; существующий native Node-модуль в Worker отключён. Для Workers отдельно оценить стандартный WebCrypto PBKDF2 как совместимый вариант, подобрать параметры по актуальным рекомендациям и замерить p95/CPU/стоимость под лимитами целевого плана. Не вводить быстрый SHA-256 вместо password KDF. Если требуется pepper — хранить отдельно от D1, предусмотреть ротацию. Основание: [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Технический spike сначала на временной локальной среде с синтетическими credentials; выбор KDF/параметров и инфраструктурные ограничения согласовать до изменения production. Проверить конкурентные попытки и защиту от истощения CPU.

### 3. Серверные сессии

Использовать непрозрачный криптографически случайный токен, хранить его digest и server-side account/session metadata. HttpOnly/Secure/SameSite cookie, узкие origin/path, отсутствие токена в JS storage, session rotation после login/step-up, idle и absolute expiry, revoke при logout/password reset/блокировке. CSRF и проверка Origin обязательны на mutations. Привязка к сотруднику и auth version должна проверяться сервером. Существующие D1 session-store и atomic limiter оценить для расширения. Основание: [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

### 4. Вход, смена и восстановление

Ограничить попытки атомарно на сервере по account и источнику, до дорогого KDF; одинаковые внешние ошибки, audit без credentials, защита от user enumeration и блокировок чужого аккаунта. Смена пароля требует повторной проверки; reset — одноразовый случайный токен с коротким сроком, digest, назначением и атомарным consume. Согласовать отдельный доверенный recovery-канал; не предоставлять доступ по переданному клиентом email/Telegram ID. После reset ревокировать сессии. Основание: [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

### 5. Accounts, RBAC и owner

Предусмотреть отдельные будущие StaffAccount, Credential, Session, Role/Permission bindings, MFA/recovery и Audit records; точные таблицы/миграции — отдельный согласуемый этап. Состояния invited/active/blocked, индивидуальные actors, серверные grant/revoke и проверка на каждом запросе. Клиент получает только отображение доступных действий.

Согласовать permissions каталога, заказов, покупателей, маркетинга, чтения финансов и денежных решений. Подтверждение денег/возврата и связанная CARGO authority остаются за владельцем до отдельного решения. Owner MFA/step-up — отдельная серверная проверка с ограниченным сроком; изменения чувствительных прав требуют повторной аутентификации и аудита. Согласовать WebAuthn/passkey или TOTP, безопасную регистрацию/смену фактора, одноразовые recovery codes с хранением digest и защиту от replay. До согласованной безопасной замены сохранять `VoyeyOwnerAuthority`, Telegram owner binding и проверки внутри atomic/CAS, а не только pre-handler. Старые денежные routes включить в эту же матрицу и regression tests до подключения новой панели.

### 6. Audit, тесты и последовательность включения

Записывать успех/отказ login, throttling, logout/revoke, reset/change, MFA/recovery, изменения прав и owner decisions с индивидуальным actor, временем и correlation ID. Пароли, proofs, session tokens, reset/MFA secrets в audit и logs не писать; доступ к журналу ограничить сервером.

Порядок работ после отдельного разрешения:

1. Утвердить threat model, accounts/permissions и Cloudflare-compatible KDF/session контракт.
2. Реализовать и проверить всё на локальной временной D1; отдельно согласовать будущие migrations.
3. Добавить негативные integration tests: missing/forged session, expiry/revoke, CSRF/origin, перебор, reset replay, MFA bypass, смена роли во время запроса, owner revocation при CAS и legacy обходы.
4. Подключить новую панель к согласованным безопасным endpoints; полностью удалить demo fixtures из будущего production entry. Провести браузерную QA, accessibility и owner workflow на изолированном preview с тестовыми данными.
5. Проверить документированный rollback и восстановление владельца. Отдельно получить разрешение на инфраструктуру/preview/deployment; сейчас такого разрешения нет.
6. Только после проверки всего нового server flow, отрицательных тестов и явного разрешения владельца поэтапно убрать зависимость от Cloudflare Access. Не удалять действующую проверку до появления и проверки замены; Access config/guards отключать отдельным обозримым изменением.

ADMIN-02 не начат. ADMIN-01 завершён в границах локального прототипа, с явно открытой задачей визуальной проверки.
