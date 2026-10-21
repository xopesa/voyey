# STENZO Wear on TuronCloud

This document records the production model checked on 2026-10-15 and its
parameterized templates. It is a reference for a separately approved deployment;
creating these files does not change or restart production.

**Cloudflare is not part of this configuration.**

## Architecture

ISPmanager supervises three separate Node 24 sites. All use one private
pnpm/Turborepo checkout outside the public site directories. PostgreSQL, public
images and private payment proofs keep their existing independent storage.

| Site     | Launcher template    | Application in shared checkout | Loopback port |
| -------- | -------------------- | ------------------------------ | ------------- |
| API      | deploy/turon/api     | apps/api/dist/server.js        | 10009         |
| Mini App | deploy/turon/miniapp | apps/miniapp                   | 10011         |
| Admin    | deploy/turon/admin   | apps/admin                     | 10010         |

Each site directory contains its own `server.js` and `package.json`, copied from
the corresponding template directory. Its supervisor runs `node server.js`
(or `npm run start`) in that site directory. No dependencies are installed in
the site directories: the launchers use the shared checkout and its dependencies.
Keep `deploy/turon/launcher.cjs` in the shared checkout; the site entry points
load that common lifecycle implementation through `STENZO_ROOT`.

Configure these **non-secret launcher settings** in each site's process environment:

- `STENZO_ROOT`: required absolute path to the private shared checkout.
- `PORT`: the site's assigned TCP port; defaults are in the table.
- `ENV_FILE`: optional environment file path, default `.env` inside
  `STENZO_ROOT`. Relative paths are resolved against `STENZO_ROOT`.

Node's `--env-file` loads the file into the child only. Existing process
environment values take precedence. The launchers set `NODE_ENV=production`,
the selected `PORT` and `INSTANCE_HOST=127.0.0.1`; both Next sites also pass
`--hostname 127.0.0.1` explicitly. If a port is changed, the site's Nginx
upstream must match it.

Secret values never belong in Git, templates, logs, command arguments or
`NEXT_PUBLIC_*` variables. Keep the existing environment file private, ignored
by Git and outside public roots, with restricted filesystem permissions.
Use the existing API/Admin proxy signing configuration; do not regenerate it.
The full list of application variable names and storage requirements is in
[turoncloud-deployment.md](turoncloud-deployment.md).

## Build

Use Node 24.x and the project's Corepack-managed pnpm 10.17.1. From the shared
checkout, with the intended application environment already configured privately:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
corepack pnpm build
```

Generation does not migrate the database. Database changes require their own
review and are outside this procedure. Mini App's API rewrite is captured at
build time, so its intended `API_URL` must be present during build. The existing
Next config loads the checkout's root `.env`; `ENV_FILE` is a runtime launcher
setting, so a custom file also needs to be supplied securely to the build
environment. Do not print or put its contents in shell arguments.

The Bot is built by the workspace build. These three web launchers do not start
it; any supervised bot process remains a separate hosting decision.

## Nginx and Admin client IP contract

The files in `deploy/turon/nginx/` are minimal application location snippets,
one per site. They contain no SSL, provider includes or generated server blocks.
An operator must integrate them into the managed site's routing as part of a
separate deployment; do not replace ISPmanager-generated vhosts wholesale.

Nginx forwards `Host` and overwrites `X-Forwarded-Proto` with its scheme.
It must append the real TCP peer to the **end** of `X-Forwarded-For`:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Overwriting `X-Real-IP` with `$remote_addr` is the recommended managed-Nginx
configuration. The Admin login proxy prefers that header. If it is missing or
empty, it uses the **last** XFF element; client-supplied earlier entries are not
selected. On Vercel it continues to use the **first** `x-vercel-forwarded-for`
element. A missing or invalid selected IP, or missing/short signing configuration,
still returns the existing 503 response without forwarding login.

This contract assumes Nginx is the trusted public ingress and Node listens only
on the private loopback ports. Do not pass an untrusted `X-Real-IP` through.
If another proxy is placed in front of Nginx, review the TCP-peer/real-IP contract
before using its headers; a changed proxy chain is not covered by these templates.
API `TRUST_PROXY` must list only confirmed peers/CIDRs, normally loopback.
Admin signs the selected IP and timestamp; the API verifies that signature.
Origin, CSRF, session cookies, HMAC and API authentication remain unchanged.

The snippets send all application paths to Node and disable proxy caching.
Preserve private proof protections and the configured upload limits; never add a
filesystem alias exposing the checkout, environment or private payment storage.

## Lifecycle and later restart

Each launcher inherits stdout/stderr, forwards SIGTERM/SIGINT, and exits with the
child's exit code or terminating signal. It removes its signal handlers before
propagating a child termination signal to itself. Startup failure returns failure
without printing environment values. ISPmanager remains responsible for supervision.

For a later, separately approved deployment, finish the build first and then
restart only the intended Node site through its supervisor, allowing graceful
shutdown. Recheck the API, Mini App and Admin afterward. This documentation change
does not authorize or perform a restart, deploy, DNS or database change.

## Local checks

```sh
corepack pnpm --filter @stenzo/admin test
node --test scripts/turon-launchers.test.mjs
corepack pnpm typecheck
corepack pnpm build
```

Launcher tests use mocked child processes and synthetic configuration. They do
not read real environment files, start applications, connect to production or use
the database.
