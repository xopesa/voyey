# VOYEY: локальная техническая конфигурация

Этап 1.1 отделяет инфраструктуру VOYEY от STENZO. Публичный брендинг STENZO,
логотип, палитра и интерфейс намеренно сохранены. Рабочая архитектура:
React SPA Admin/Mini App → Cloudflare Worker → Fastify → D1.
Изображения товаров и приватные чеки остаются в раздельных пространствах D1.

Текущая конфигурация **не является развёрнутым VOYEY**. Cloudflare account/D1 ID —
нулевые заглушки; маршрутов и R2 bindings нет. Домены `*.voyey.example.invalid`
зарезервированы для шаблонов. `COMMERCE_ENABLED=0`, `VOYEY_LOCAL_ONLY=1`.
Реальные Telegram, Access и платёжные credentials отсутствуют и отключены.

Используются Node 24 и pnpm 10.17.1:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
corepack pnpm --filter @stenzo/database db:validate
corepack pnpm config:check
corepack pnpm build
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
```

`db:generate`/`db:validate` только генерируют типы и проверяют Prisma schema с
синтаксическим localhost URL; к базе они не подключаются. Тесты D1 создают
одноразовые локальные схемы и используют поддельные внешние сервисы.
Исторические PostgreSQL integration tests отключены.

`corepack pnpm dev` запускает только локальный Worker на 127.0.0.1. Для SPA нужен
предварительный build. Базу для ручной работы на этом этапе не инициализировали;
каталог, Admin login и Telegram пока не готовы к полноценному ручному запуску.
Не копируйте `.env`/`.dev.vars` из STENZO: preflight отклоняет runtime env-файлы.
`.env.example` — проверяемый неактивный перечень будущих настроек.

`deploy`, запись Cloudflare secrets, проверка реального бота, регистрация webhook,
legacy Node/Next/Turon start-команды заблокированы. Worker build использует только
`wrangler deploy --dry-run`; это локальная упаковка без публикации. Любые дополнительные
аргументы, remote flags, alternate config и env overrides runner отклоняет.

[Описание изоляции и ограничений](docs/VOYEY_INFRASTRUCTURE_ISOLATION.md).
Файлы `docs/DEPLOYMENT_STATUS.md`, `docs/DEPLOY_WORKERS_FREE.md`, `SOURCE_COPY.md`
и остальные прежние отчёты описывают историю STENZO. Упомянутые в них сайты,
ресурсы и команды deployment не являются инфраструктурой или инструкцией запуска VOYEY.
Исходный snapshot-manifest сохранён как неизменяемый исторический манифест;
он не описывает намеренные изменения рабочего дерева после этапа 1.1.
