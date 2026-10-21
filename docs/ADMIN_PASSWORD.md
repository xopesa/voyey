# Preview Admin password

The preview Admin uses **direct application login and password** with
`ADMIN_AUTH_MODE=password`. Both password secrets are mandatory: missing,
partial, or malformed configuration returns 503 rather than allowing access.
The original Turon application is unaffected.

`ADMIN_AUTH_MODE=access` (the default if absent) retains Cloudflare Access as
an upstream factor; when password secrets are present it requires both factors.
Switching modes or changing credentials invalidates existing sessions. Remove
or bypass the Cloudflare Access edge gate only after the password-mode Worker
is deployed and its unauthenticated API protections are verified.

Set `ADMIN_PANEL_LOGIN` and `ADMIN_PANEL_PASSWORD_HASH` together as Worker secrets.
Neither credentials nor hashes belong in Git or frontend bundles. From the repo:

```powershell
node scripts/set-preview-admin-password.mjs YOUR_ADMIN_LOGIN
```

The script accepts a hidden password, hashes it in memory, and sends the login
and salted verifier to `wrangler secret bulk` via stdin for `stenzo-free-preview`.
It never writes or prints the password or verifier. Deploy the Admin assets and
Worker afterwards; preserve the currently approved commerce flag explicitly.

Password processing uses browser Web Crypto PBKDF2-HMAC-SHA256 (600000 iterations,
32-byte random salt, 32-byte output). The Worker stores only SHA256(derived key).
`auth/method` exposes only the non-secret salt and fixed iteration count on the
separate Admin host. The derived key is a password-equivalent credential and
travels only in the HTTPS login request body, never URLs, logs, or persistent
browser storage. The expensive KDF runs in the browser so login does not depend
on hosted Workers PBKDF2 iteration or Free CPU limits.

Login additionally requires the Admin origin and application request header.
D1 rate limits apply before verification. Sessions keep Secure, HttpOnly,
SameSite=Strict cookies, existing CSRF checks and a mode/credential principal binding.
Access-mode sessions also bind the verified Access identity. Direct mode never
accepts an Access header or Telegram bearer token as an Admin session.
Password or login changes invalidate previous sessions through the principal
binding, including sessions issued before password protection was configured.
Partial or malformed password configuration fails closed. If both settings are
absent, Access-only login remains available only in Access mode.
