# VOYEY — этап 1.1: изоляция инфраструктуры

Дата: 22 октября 2026. Рабочая папка: `C:/Users/USER/Desktop/Voyey`.
Ветка: `chore/voyey-bootstrap`. Базовый коммит: `19000ea925fa2c3b7977c51439cded3cb7f2b4f2`.
Origin: `https://github.com/xopesa/voyey.git`.

## Результат и границы этапа

Подготовлена локальная техническая конфигурация VOYEY без активных ресурсов STENZO.
Это ещё не развёрнутый магазин. Worker, D1, R2, Telegram Bot, webhook и домены не
создавались; remote deployment, миграции реальных баз и push не выполнялись.
Исходный STENZO и резервная ветка не изменялись. Клиентские данные и credentials
из них не переносились.

Архитектура сохранена: React SPA Admin/Mini App → Worker → Fastify → D1.
В Worker используется существующий D1 adapter, включая атомарные операции и
хранение Admin sessions. Медиа остаются в прежних раздельных D1 namespaces
для изображений и приватных чеков. Опциональные R2 bindings отсутствуют.
Каталог, остатки, заказы, предоплата 50%, ручная оплата на карту с загрузкой чека
и подтверждением администратором, CARGO, возвраты, финансы и RU/UZ не менялись.

## Текущие настройки

| Область           | Состояние                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Worker            | `voyey-local`; `workers_dev=false`, `preview_urls=false`, `routes=[]`                     |
| Account           | Неактивная нулевая заглушка; не используется аккаунт из окружения                         |
| D1                | `DB` / `voyey-local`, нулевой UUID, local binding без remote override                     |
| PUBLIC_ORIGIN     | `https://store.voyey.example.invalid`                                                     |
| ADMIN_ORIGIN      | `https://admin.voyey.example.invalid`                                                     |
| Флаги             | `PREVIEW_ONLY=1`, `VOYEY_LOCAL_ONLY=1`, **`COMMERCE_ENABLED=0`**                          |
| Access            | Прежние team/audience удалены из конфигурации; новый Access не настроен                   |
| JWT               | issuer `voyey-api`, audience `voyey-miniapp`; секрет не задан                             |
| Admin             | cookie `voyey_admin_session`; отдельный namespace хеша сессий `voyey:admin:`              |
| Admin credentials | Заготовка login `voyey_admin`, password hash и proxy secret отсутствуют                   |
| Browser storage   | `voyey.access-token`, `voyey.locale`, `voyey.theme`, checkout/payment/product/manual keys |
| Telegram          | Токен, webhook secret, channel, sales username и admin IDs не заданы                      |
| R2                | Не включён. В будущем нужны два новых независимых bucket binding без старых credentials   |

`.env.example` содержит только будущий перечень настроек с пустыми секретами.
На этом этапе его **не нужно копировать** в `.env` или `.dev.vars`: guard намеренно
отклоняет такие runtime-файлы. Настройка настоящих ресурсов потребует отдельного
согласованного изменения шаблонов и проверок, а не только установки env-переменной.

## Защитные проверки

- `scripts/check-preview.mjs`: проверяет Worker, D1, домены, флаги, assets, alias,
  отсутствие неожиданных конфигурационных ключей, env overrides, remote bindings,
  дополнительных Wrangler-конфигов и runtime env-файлов. Проверяет также неактивный
  исторический Containers-шаблон и reserved-domain route examples.
- `scripts/worker-local.mjs`: только фиксированный local dev либо bundle dry-run;
  дополнительные аргументы, `--remote`, `--env`, alternate `--config` и любые другие
  команды отклоняются до запуска Wrangler. Dev слушает 127.0.0.1, remote/tunnel и
  интерактивные команды Wrangler выключены. Persist directory отдельный.
- Runner передаёт разрешённый минимум системных переменных. Он не наследует
  Cloudflare/Telegram credentials, JWT, proxy settings, `NODE_OPTIONS` и произвольные
  переменные сервисов. Wrangler HOME/XDG/логи направлены в локальный `.cache`, чтобы
  не читать пользовательскую OAuth-конфигурацию. Env-файл выбран явно, включение
  process env в Worker и автоматическая загрузка dev vars из dotenv отключены.
- `apps/worker/src/isolation.ts` и вход Worker: блокируют все `stenzo.uz` subdomains,
  прежние STENZO workers.dev hosts и Access identity до D1, assets, redirects или
  внешних запросов. Старый Access audience проверяется также в списках, с пробелами
  и изменённым регистром. `accessConfiguration` защищена и при прямом вызове.
- При `VOYEY_LOCAL_ONLY=1` runtime отклоняет реальные origins, Telegram credentials,
  Access и включение commerce. Бот, уведомления и публикации не могут обратиться к
  реальным Telegram-ресурсам через текущую локальную конфигурацию.
- Deploy, запись remote secrets, реальный Telegram getMe/webhook CLI, legacy
  Node/Next/Turon npm start и Vercel build заблокированы. Webhook helper сохранён
  для тестов; встроенного сетевого транспорта у него больше нет.
- `.gitleaks.toml` исключает только генерируемые каталоги; `.gitleaksignore` содержит
  семь точечных проверенных fingerprints: пять тестовых idempotency/order keys,
  тестовый JWT literal и публичный Access audience, используемый в denylist.

Эти проверки защищают поддерживаемые команды и конфигурацию репозитория. Это не
системный firewall: самостоятельный вызов произвольного CLI или намеренное удаление
проверок кодом не контролируются. Происхождение произвольного секрета определить
без доступа к исходному credential нельзя, поэтому реальные runtime-секреты на
текущем этапе вообще не принимаются и не наследуются.

## Что сохранено намеренно

- Публичный брендинг **STENZO**, тексты, логотип, дизайн, палитра и названия health
  services: текущий этап не является публичным переименованием.
- Внутренние пакеты `@stenzo/*`, имя корневого package и существующие протокольные
  заголовки `x-stenzo-*`: это внутренние контракты, а не ссылки на чужие ресурсы.
- Префикс заказов `STZ-`, схемы, все 16 D1-миграций, Prisma history, зависимости,
  lockfile и patches. Существующие названия тестовых PostgreSQL schemas и переменных
  `STENZO_*` остаются только в исторических/изолированных тестовых механизмах.
- Исторические deployment/audit документы и snapshot-manifest не переписаны.
  Их STENZO URLs и статусы не описывают развёрнутый VOYEY. README теперь указывает
  на актуальный локальный режим. Legacy PostgreSQL Compose получил отдельные
  VOYEY defaults/project/volume и выключенный профиль; он не запускался.

## Проверки

Все проверки выполнялись локально, без настоящих credentials. Установка — с
закреплённым pnpm 10.17.1 и `--frozen-lockfile`, Node 24.21.0. Версии зависимостей
и lockfile не обновлялись.

| Проверка                                 | Результат                                                             |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Install frozen                           | Успешно                                                               |
| Prisma generate / validate               | Успешно; генерация/валидация без подключения к БД                     |
| Config/security preflight                | Успешно                                                               |
| Build всех активных приложений и пакетов | Успешно; Worker только `--dry-run`                                    |
| Typecheck                                | Успешно                                                               |
| Lint, включая новые scripts              | Успешно                                                               |
| Tests основного workspace                | **974 passed, 5 skipped**                                             |
| Gitleaks                                 | Нет неразобранных находок после семи точечных исключений              |
| Local smoke                              | `/health` 200, Mini App `/` 200; commerce выключен; сервер остановлен |

Распределение: config/security 10, Admin 150, API 186, Bot 16, Mini App 169,
Worker/D1 443. Пять PostgreSQL integration tests намеренно не запускались.
D1-тесты применяли исходные схемы только внутри одноразовых локальных fixtures;
миграции рабочей/удалённой базы не выполнялись.

В первом параллельном прогоне один прежний Argon2-тест превысил 5 секунд при
одновременном запуске тяжёлых наборов. Root test теперь запускает пакеты
последовательно (`--concurrency=1`); таймауты и assertions не ослаблялись.
Итоговый прогон завершён успешно. Сохранились прежние предупреждения Vite о
`use client`/sourcemap и pnpm об ignored workerd lifecycle script. Worker build,
Miniflare integration tests и реальный локальный запуск при этом успешны.

Исторический Containers-пакет вне workspace отдельно не устанавливался и не
запускался; его неактивность проверяется новыми config tests. Никакая работа в
развёрнутой среде VOYEY этим этапом не подтверждается.

Дополнительно: 16 тестов исторических Turon launch helpers прошли в VM с поддельным
spawn; реальные legacy-серверы не запускались.

Локальные подробные логи: `.cache/voyey-bootstrap/` (не включаются в Git).

## Перед полноценным запуском

1. Согласовать следующий этап и выбрать собственные VOYEY account, Worker/D1 и домены.
2. Отдельно подготовить новую пустую D1, проверить и применить исходные миграции
   только с отдельным разрешением. Сейчас ручная рабочая БД не инициализирована.
3. Создать свежие JWT/proxy/session credentials и password hash для собственного Admin;
   при необходимости настроить новый Access team/audience и allowlist.
4. Отдельно создать и проверить VOYEY bot/channel, подтвердить владельца и адрес
   webhook; не использовать токен, канал или webhook STENZO.
5. Сохранить D1 media storage; R2 подключать только как отдельное согласованное решение.
6. Проверить вход, роли, cookie/CSRF, каталог, медиа, RU/UZ и уведомления на своей
   инфраструктуре. Платёжные реквизиты и включение commerce согласовать отдельно.

Техническая основа для следующего этапа подготовлена. Создание инфраструктуры, push,
deployment и новые функции требуют отдельного подтверждения владельца.

## Полный список изменённых файлов

Изменены 57 существующих файлов, добавлено 8 новых. Все исходные 601
отслеживаемых файла присутствуют, удалений нет. SHA-256 с нормализацией CRLF/LF
подтвердил неизменность 68 файлов общих пакетов, Database, D1-миграций, Bot source,
lockfile и patches относительно базового HEAD.

- `.env.example`
- `.gitleaks.toml` — новый
- `.gitleaksignore` — новый
- `README.md`
- `apps/admin/README.md`
- `apps/admin/package.json`
- `apps/admin/src/app/api/admin/[...path]/route.ts`
- `apps/admin/src/components/Preferences.tsx`
- `apps/admin/src/lib/manual-orders.ts`
- `apps/admin/src/lib/session.ts`
- `apps/admin/src/spa.tsx`
- `apps/admin/tests/customers.test.mjs`
- `apps/admin/tests/proxy.test.mjs`
- `apps/admin/vercel.json`
- `apps/api/package.json`
- `apps/api/src/modules/admin/web-session.ts`
- `apps/api/src/modules/auth/token.ts`
- `apps/api/tests/admin-catalog.test.ts`
- `apps/api/tests/auth.test.ts`
- `apps/api/tests/orders-manager-postgres.test.ts`
- `apps/api/tests/product-manager-postgres.test.ts`
- `apps/api/tests/web-admin-auth.test.ts`
- `apps/api/vercel.json`
- `apps/bot/package.json`
- `apps/bot/tests/register-preview.test.ts`
- `apps/miniapp/README.md`
- `apps/miniapp/package.json`
- `apps/miniapp/src/app/layout.tsx`
- `apps/miniapp/src/lib/auth-storage.ts`
- `apps/miniapp/src/lib/checkout.ts`
- `apps/miniapp/src/lib/payment-resource.ts`
- `apps/miniapp/src/lib/preferences.ts`
- `apps/miniapp/src/lib/product-navigation.ts`
- `apps/miniapp/tests/locale-sync.test.mjs`
- `apps/miniapp/tests/preferences.test.mjs`
- `apps/miniapp/tests/telegram-session.test.mjs`
- `apps/miniapp/vercel.json`
- `apps/worker/package.json`
- `apps/worker/src/access.ts`
- `apps/worker/src/index.ts`
- `apps/worker/src/isolation.ts` — новый
- `apps/worker/tests/admin-direct-password.test.ts`
- `apps/worker/tests/admin-password.test.ts`
- `apps/worker/tests/cart-preview.test.ts`
- `apps/worker/tests/checkout-stock.test.ts`
- `apps/worker/tests/isolation.test.ts` — новый
- `apps/worker/wrangler.jsonc`
- `deploy/cloudflare/routes.example.json`
- `deploy/cloudflare/scripts/check-config.mjs`
- `deploy/cloudflare/wrangler.jsonc`
- `deploy/turon/admin/package.json`
- `deploy/turon/api/package.json`
- `deploy/turon/miniapp/package.json`
- `docker-compose.yml`
- `docs/VOYEY_INFRASTRUCTURE_ISOLATION.md` — новый
- `eslint.config.mjs`
- `package.json`
- `scripts/blocked-remote.mjs` — новый
- `scripts/check-preview.mjs`
- `scripts/register-preview-webhook.mjs`
- `scripts/set-preview-admin-password.mjs`
- `scripts/turon-launchers.test.mjs`
- `scripts/validate-telegram.mjs`
- `scripts/voyey-isolation.test.mjs` — новый
- `scripts/worker-local.mjs` — новый
