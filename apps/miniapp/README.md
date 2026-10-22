# STENZO Wear Mini App foundation

The app contains Home, the shared mobile shell, RU/UZ localization, Light/Dark/
System appearance and minimal Profile settings. Catalog, Product Detail, Cart,
Checkout, Manual Payment, My Orders and Order Detail use the existing API.

## Design system

- `src/styles/tokens.css`: brand and semantic colors, surfaces, borders, spacing,
  radii, shadows, typography, motion, stacking, touch targets and safe areas.
- `src/styles/foundation.css`: shared styles for the reusable UI primitives.
- `src/components/ui/foundation.tsx`: `Page`, `Section`, `Card`,
  `Button` (primary/secondary), `IconButton`, `Badge` (neutral/accent),
  `Skeleton` and `Divider`. `Badge` also serves as a noninteractive chip.
- `src/components/ui/Icon.tsx`: the five outline navigation icons.
- `src/components/ui/ChoiceGroup.tsx` and `src/styles/settings.css`: reusable
  segmented choices built with native, accessible radio inputs.

Keep new colors in the token file. Use semantic tokens in components. Inter is
self-hosted via `next/font/local`, with Latin and Cyrillic support and no font
network request during the build.

## Shell and navigation

`AppShell` mounts in the root layout, so Telegram bootstrap/auth persists across
client navigation. The existing initData, API calls and JWT storage are retained.
Content scrolls inside the shell, with bottom padding reserved for the floating
navigation. The mobile content width is capped at 480px.

`TelegramViewport` synchronizes stable viewport height, device safe areas and
Telegram content safe areas, and subscribes to their change events. Browser
preview uses `100dvh` and CSS device safe-area fallbacks. Stable viewport height
keeps the navigation steady during Telegram drag animations. Device insets and
Telegram chrome insets are added; browser and Telegram device insets use their
maximum to avoid counting the same notch twice.

`BottomNavigation` uses `next/link` and `usePathname`. Home matches `/` exactly;
the other sections also match their nested routes. The active link expands into
a lime capsule and reveals its label. Links expose accessible names and
`aria-current`; all targets are at least 44px, with keyboard focus and reduced
motion support.

Pass a future frontend cart count through `<AppShell cartCount={count}>` or
directly to `<BottomNavigation cartCount={count} />`. Zero hides the badge,
positive counts show it, and values above 99 display `99+`.

## Routes

`/` renders Home. `/catalog` renders Catalog, `/catalog/[slug]` Product Detail,
and `/cart` Cart. `/checkout` renders Checkout; `/orders` renders My Orders,
`/orders/[publicId]` Order Detail, and `/orders/[publicId]/payment` Manual Payment.
`/profile` renders only `ProfileSettings` with language and appearance controls.

## Home

`src/components/home/` contains the hero, horizontal categories, two-column
product grid, media fallback, loading skeletons and independent error/empty
states. `src/styles/home.css` uses the existing design-system tokens. The shell
adds a compact search link only on Home; BottomNavigation and auth are unchanged.

Catalog data comes through the shared API client:

- `GET /api/catalog/categories` reads `{ categories }`.
- `GET /api/catalog/products?limit=6` reads `{ products, nextCursor }`.

The Next.js rewrite always forwards `/api/:path*` to the existing Fastify API
without the `/api` prefix. `API_URL` overrides the upstream; when omitted, the
local backend is used at `http://127.0.0.1:${API_PORT || 3001}`. The root `.env`
is loaded when present. Set `API_URL` at build time for a separately hosted API;
Next.js preserves search, category and cursor query parameters through the rewrite.
The backend must be running and have its existing environment/database configured.
An unavailable upstream is a proxy error, and an unavailable database is an API
500; neither should be mistaken for a missing frontend route (404).
The endpoints are public and don't require a second authentication flow. Each
section loads independently, validates consumed DTO fields, has retry and a 15s
timeout, and cancels pending requests on unmount. No fallback products, ratings,
discounts or purchase statistics are generated. Product and category labels
switch languages using the same fetched bilingual data.

The backend doesn't sort by creation date, so the section is called Collection,
not New Arrivals. Category links use `/catalog?category=<slug>`. Search and hero
CTA open `/catalog`; Home and Catalog product cards open `/catalog/[slug]`.

The original logo asset and campaign photo have not been supplied. Home keeps
the existing Brand component and an explicit editorial media placeholder. Pass
an original image as `imageSrc` to `HomeHero` to replace it; an image-only bottom
gradient provides text contrast. No reference screenshots are cropped or used
as product photography. Product images use the primary API image, then the first
image, with an accessible fallback when absent or broken. They are unoptimized
Next.js images because backend media hosts aren't fixed, and no remote-host
allowlist or image proxy is introduced here.

Files changed for Home: `src/app/page.tsx`, `src/app/globals.css`,
`src/components/AppShell.tsx`, `src/components/ui/Icon.tsx`,
`src/components/home/*`, `src/lib/api-client.ts`, `src/lib/catalog.ts`,
`src/lib/i18n.ts`, `src/styles/tokens.css`, `src/styles/home.css`,
`tests/catalog.test.mjs`, this README and the Home screenshots in `docs/`.

## Catalog

`src/components/catalog/Catalog.tsx` implements `/catalog` using the same public
API client, proxy, shell, preferences and design-system tokens. Search commits
after 300ms (or immediately on Enter/clear), replaces the URL without a reload,
and preserves the category slug. Category selection preserves the search and
adds a history entry. Initial Home links and browser back/forward restore filters.

Products load 12 at a time with the backend's opaque `nextCursor`. Each filter
selection owns a `CatalogFeed`, aborting obsolete requests and resetting pages.
Pagination preserves filters, ignores concurrent clicks, merges duplicate IDs,
and retains loaded products when a subsequent page fails so it can be retried.
Both categories and products have independent loading/error handling and 15s
timeouts. Empty filtered results offer a reset; no API failure becomes fake data.

The shared `catalog/ProductCard.tsx` renders primary media, bilingual names and
UZS prices with missing/broken-image fallback. Availability follows real variant
stock: `null` is unlimited, positive stock is available, and zero stock/no active
variants are unavailable. Product cards open Product Detail and retain their
Home/Catalog return URL. No new backend or schema is used.

Catalog styles are imported directly by the root layout and use semantic tokens.
Fixtures exist only in tests; production always uses the real backend. Cursor
pagination, cancellation, retries and stock states are covered by tests even
while the real product table is empty.

Catalog files: `src/app/catalog/page.tsx`, `src/app/layout.tsx`,
`src/components/catalog/Catalog.tsx`, `src/components/catalog/ProductCard.tsx`,
`src/components/home/HomeProducts.tsx`, `src/components/ui/Icon.tsx`,
`src/lib/catalog.ts`, `src/lib/catalog-feed.ts`, `src/lib/i18n.ts`,
`src/styles/catalog.css`, `tests/catalog.test.mjs`, `tests/catalog-feed.test.mjs`
and this README. The former `home/ProductCard.tsx` moved to the shared catalog
folder. Real-backend previews are saved as `docs/catalog-ru-light.png` and
`docs/catalog-uz-dark.png`.

## Product Detail

`/catalog/[slug]` uses the existing `GET /api/catalog/products/:slug` proxy and
public DTO. Inactive products/categories return 404; inactive variants are
excluded by the backend. Only supplied bilingual names/descriptions, UZS prices,
category, image URLs and variants are rendered. `sourceUrl` is never rendered.

Gallery photos preserve their proportions, prefer the primary image, support
thumbnails, horizontal swipe and keyboard arrows, and fall back for absent,
unsafe or broken URLs. Size/color options come from variants. A purchasable
combination must be selected; sold-out combinations are disabled. Quantity is
bounded by stock and the cart API's limit of 99 (`stock: null` has no stock cap).

Both purchase actions use the existing session JWT and `POST /api/cart/items`.
They send `productId`, `variantId`, `quantity`, `heightCm`, `weightKg`, and show
success only after the response confirms that saved line and its measurements.
Buy navigates to `/cart` after that confirmation. No checkout/order/payment is
created. Unauthenticated, blocked, stock-conflict, malformed response and network
errors remain errors; an uncertain POST asks the user to inspect the cart before
retrying. Requests abort on unmount and time out after 15 seconds.

Height (integer 100–250 cm) and weight (integer 30–300 kg) can be deferred here
as null. The localized hint states both are required for later checkout. No
automatic size recommendation is provided. Delivery text states China delivery
approximately 10–12 days and a separate CARGO payment after arrival.

The fixed action bar lives in the shell outside scrolling content, above the
unchanged floating navigation. ResizeObserver reserves its measured height,
including long feedback. Existing semantic tokens, preferences and Telegram
viewport/insets are reused. Back works through Telegram BackButton (SDK 6.1+),
browser history, or a safe Home/Catalog fallback; search/category filters, loaded
Catalog pages (immediate return, up to 5 minutes) and list scroll are retained.
Detail and Cart API always revalidate availability independently of that cache.

Files: `src/app/catalog/[slug]/page.tsx`, `src/components/product/*`,
`src/lib/product.ts`, `src/lib/product-navigation.ts`, `src/styles/product-detail.css`;
integration edits in `AppShell`, `ProductCard`, `HomeProducts`, `Catalog`,
`api-client`, `i18n`, `Icon`, Telegram types and root layout. Tests are in
`tests/product.test.mjs` and the updated `tests/catalog.test.mjs`.

An isolated browser fixture can be run with
`node apps/miniapp/tests/fixtures/product-preview/serve.mjs` from the repository
root, then opened at `http://127.0.0.1:3400`. It bundles real components with
test-only media, data, session and cart responses. It is outside Next routes,
does not call production APIs or write PostgreSQL, and requires no new packages.
Screenshots in `docs/product-detail-fixture-*.png` are labeled TEST FIXTURE.
Production always uses the real backend. With zero real products and no signed
Telegram session, a live successful add-to-cart cannot yet be verified.

## Cart

`/cart` reuses the existing JWT and Next.js proxy for `GET /cart`,
`PATCH /cart/items/:id`, `DELETE /cart/items/:id` and `DELETE /cart`.
`TelegramSessionProvider` exposes the existing bootstrap status so cart loading
waits for authentication; it does not add another auth flow.

Each card renders only public bilingual product data, image, selected size/color,
server unit price/line total, confirmed quantity and measurements. Stock and the
existing 99-unit cap bound quantity controls. A line whose quantity exceeds a
reduced stock can be reduced to the available amount. Missing/broken images use
the existing localized fallback. Missing height/weight remain visible and are
identified as required before checkout; entered values follow backend bounds
(integer height 100–250 cm, weight 30–300 kg).

`CartResource` serializes requests because every response contains the entire
cart. Pending or failed mutations preserve the last confirmed snapshot. The
client validates the DTO and mutation acknowledgement; no success is shown
until the server confirms the update, removal or clear. Requests abort on
unmount/session change and time out after 15 seconds. Retry, stock, unavailable,
auth, loading, empty and mutation states are localized. Clearing uses a styled
native modal dialog with focus handling, not browser confirm.

Totals come from the backend. UI displays whole UZS amounts with spaces and a
50% estimate, rounded up for an odd sum consistently with the existing checkout
contract. The copy states final amounts will be recalculated at checkout. The
shared `ShellActionBar` measures its height and reserves space above unchanged
floating navigation and Telegram safe areas. Unsaved measurement edits must be
saved before navigation; missing measurements can be completed at checkout.
The CTA opens Checkout. Cart itself creates no order or payment and calculates
no shipping cost.

Cart files: `src/components/cart/*`, `src/lib/cart.ts`, `src/lib/cart-resource.ts`,
`src/styles/cart.css`, `/cart` and `/checkout` route files; integration edits in
`api-client`, `i18n`, root layout, `AppShell`, `TelegramBootstrap`,
`TelegramSession` and the shared action bar used by Product Detail.

`tests/cart.test.mjs` covers contracts, acknowledgement, cancellation, mutation
ordering, errors, stock, measurements, backend totals and localized rendering.
For isolated browser checks, run
`node apps/miniapp/tests/fixtures/cart-preview/serve.mjs` from the repository root
and open `http://127.0.0.1:3401`. This test-only preview bundles real components
with labeled fixtures, has no production API calls or PostgreSQL writes, and
requires no additional packages. It is outside Next.js routes. Screenshots
`docs/cart-fixture-ru-light.png` and `docs/cart-fixture-uz-dark.png` are explicitly
labeled TEST FIXTURE. Browser checks cover quantity, measurements, removal,
clear/cancel/failure, session/stock errors, checkout navigation, RU/UZ, themes,
320–480px and simulated Telegram insets. Production always uses the real API.
Successful live cart operations require a signed Telegram session and real
products; the local database currently has zero products.

## Checkout

`src/components/checkout/` implements `/checkout` with separate contact,
delivery address, size measurement, order and total blocks. Required recipient
fields follow the existing `recipientSchema` limits and phone format; optional
blank apartment/comment fields become null. Height (100–250 cm) and weight
(30–300 kg) are mandatory integers for every item. They can be corrected and
saved through the existing Cart PATCH endpoint without leaving Checkout.

Before a new POST, Checkout rereads the cart. Changed price, quantity,
availability or measurement data are shown for review before another
confirmation. The UI never sends trusted totals. The existing backend
transaction rereads products/variants, checks availability and stock, calculates
the price, rounds an odd 50% prepayment up and writes immutable Order snapshots.
The only service validation addition rejects missing/out-of-bounds measurements
with HTTP 409; schema and migrations are unchanged.

`CheckoutFlow` locks concurrent submits, passes `Idempotency-Key` through the
shared JWT/proxy client and keeps the same key for retry. A cart-scoped attempt
key is saved in sessionStorage before POST; recipient data and JWT are not stored
there. An uncertain response is replayed with that key even if the server already
cleared the cart. Definitive validation errors refresh the cart. When browser
storage is blocked, retries in the mounted flow still use the in-memory key.
Success requires a validated backend Order response. Errors are localized and
focused into view, including when the user submits from the end of the form.

The confirmed `publicId` opens `/orders/[publicId]/payment`. Checkout and Payment
retain the existing shell without floating navigation inside the purchase flow.
Checkout's BackButton returns to `/cart`; Payment's returns to
`/orders/[publicId]`, preserving the order context without reopening Checkout.

Files: `src/components/checkout/*`, `src/lib/checkout.ts`,
`src/lib/checkout-flow.ts`, `src/styles/checkout.css`, Checkout/payment routes;
integration in `AppShell`, root layout, API client, localization and the shared
Cart photo export. Backend changes are limited to checkout domain/errors/route.

`tests/checkout.test.mjs` covers validation, public DTOs, server-controlled
amounts, preflight, concurrent submission, replay after a lost response/reload,
timeout/cancellation and localized states. Backend tests include field rejection,
measurement bounds, snapshots, price and idempotency. The opt-in
`apps/api/tests/checkout-postgres.test.ts` runs real Fastify/repository SQL inside
a private transaction and forces rollback; no test products/orders are committed
or visible to the shop, and Telegram notifications are not sent.

For isolated browser checks run
`node apps/miniapp/tests/fixtures/checkout-preview/serve.mjs` and open
`http://127.0.0.1:3402`. It uses actual UI with labeled test-only data, session,
Cart/Checkout/Order responses and a simulated BackButton. It has no production
API calls or PostgreSQL writes. Screenshots in `docs/checkout-fixture-*.png`
are labeled TEST FIXTURE. A live Telegram end-to-end checkout still requires an
active signed session and real products; the local catalog is currently empty.

## My Orders / Order Detail

`src/components/orders/`, `src/lib/orders.ts`, `src/lib/orders-feed.ts` and
`src/styles/orders.css` implement the authenticated customer list and tracking
detail. All data comes from `GET /orders?limit=12&cursor=...` and
`GET /orders/:publicId` through the existing JWT client/proxy. Detail shows
immutable OrderItem/recipient snapshots, not current Catalog values. Prices,
prepayment, paid/remaining amounts, CARGO and amount due are rendered directly
from the public DTO; there is no new financial calculation or backend flow.

The user list API accepts only `limit`/`cursor`; All/Active/Completed filters apply
to loaded pages, with an explicit hint and load-more when matches could be on
later pages. Completed includes cancelled orders with a distinct status. Cursor
pagination retains existing cards on errors, deduplicates by publicId, prevents
concurrent loads and rejects repeated/cyclic cursors. No claim is made that the
loaded count equals the user's total order count.

`orderStatusMeta` centralizes all 14 status labels, groups and payment actions.
`orderTimeline` presents completed/current/upcoming stages without fictional event
dates. Cancellation alone does not reveal prior history, so its timeline shows
only cancellation. IN_TRANSIT has the approximate 10–12 day information; there
is no tracking number, map or promised arrival date. Awaiting payment opens the
existing Manual Payment route; submitted phases show review text without a
duplicate payment action. Approved/operational stages show no payment CTA.

`/orders` retains floating navigation. Detail has a focused shell and visual/
Telegram BackButton to the list. Payment links/BackButton now return to the real
detail. Detail revalidates on mount, return/navigation, visible-window focus and
manual refresh; no optimistic status or additional polling. Recipient data is
collapsible, read-only and never written to browser storage.

`tests/orders.test.mjs` covers guards, cursor pagination, filters, cancellation,
all timelines/actions, bilingual snapshots, safe routes, focus refresh and
BackButton cleanup. Existing backend Orders/Payment tests cover ownership,
pagination, immutable snapshots and payment status/accounting. An isolated
preview (`node tests/fixtures/orders-preview/serve.mjs` from `apps/miniapp`) runs
on `http://127.0.0.1:3404`; its labeled controls/data never appear in production
and do not call production APIs or write PostgreSQL. A live owned-order E2E
requires an authenticated Telegram session and a real order.

## Manual Payment

`src/components/payment/`, `src/lib/payment.ts`, `src/lib/payment-resource.ts`
and `src/styles/payment.css` implement the mobile receipt, backend instructions,
private proof preview, upload, retry and status refresh. The existing
`GET /orders/:publicId` and `GET /orders/:publicId/payment-instructions` supply
all financial values. Matching phase, amount and status are required before bank
details are shown; the same responses are checked again before upload. No trusted
financial totals or payment types are selected/calculated by the client.

`POST /orders/:publicId/payments` sends one multipart `file`, the existing Bearer
JWT and `Idempotency-Key` through the Next.js proxy. The browser supplies the
multipart boundary. A session-scoped journal saves only the key and order/phase
identifiers, enabling safe retries after a lost response. MIME and size checks
use the server's `maxProofUploadSize`; the backend still validates file bytes.
Local object URLs are revoked on replacement/unmount. No public proof URL is used.

SUBMITTED shows review status and hides resubmission; REJECTED shows the server's
reason and enables a new attempt; APPROVED shows confirmed prepayment or final
payment without another form. The latest approved PREPAYMENT never hides an
awaiting FINAL payment. Cancellation, auth, missing/foreign orders, changed
amounts, upload and network errors have localized states. Status refreshes on
demand and every 30 seconds while visible; a lost response never claims success.

The existing owner-only instructions response now includes a safe `latestPayment`
DTO and configured upload limit. No schema, migrations, payment flow or admin
changes. My Orders / Order Detail use these existing public order responses.

`tests/payment.test.mjs` and `apps/api/tests/payment-lifecycle.test.ts` cover both
phases, amounts, ownership, private storage, idempotency, rejection, multipart and
confirmed-only UI states. `node tests/fixtures/payment-preview/serve.mjs` from
`apps/miniapp` serves isolated actual UI at `http://127.0.0.1:3403`; test data never
calls production APIs or writes PostgreSQL. Screenshots are explicitly labeled
TEST FIXTURE. A live proof submission requires a signed Telegram session and a
real payable order; no actual transfer, Telegram bot or admin review is run by QA.

## Language and appearance

`PreferencesProvider` exposes `usePreferences()` with `t(key, values)`, `locale`,
`setLocale`, `themeMode`, `setThemeMode`, `resolvedTheme` and `localizedText`.
All UI translations live in `src/lib/i18n.ts`; translation keys and Uzbek
dictionary completeness are checked by TypeScript. RU is the default; Telegram
`initDataUnsafe.user.language_code` values beginning with `uz` select Uzbek Latin.
These unverified Telegram fields are used only for presentation, never auth.
Explicit language choices persist in localStorage under `voyey.locale`.

Appearance supports `light`, `dark` and `system`, persisted under `voyey.theme`.
System prioritizes Telegram's `colorScheme` and listens to `themeChanged`, falling
back to the device's `prefers-color-scheme` with live change updates. The SDK's
ordinary-browser stub (`platform=unknown`, empty initData) is ignored for theme
selection. Explicit selections win, even when persistent storage is blocked.

The shared resolver is also serialized into a synchronous head script so saved
theme colors apply before first paint. The shell becomes visible after initial
preferences have been read, avoiding default-language/theme content flashes.
The HTML language and theme attributes update with settings, and storage changes
sync across tabs. Theme-specific semantic tokens live in `tokens.css`; lime
buttons and active navigation retain charcoal text in either theme.

For future catalog presentation use:

```tsx
const { t, localizedText } = usePreferences();
const name = localizedText({ ru: product.nameRu, uz: product.nameUz });
const description = localizedText({
  ru: product.descriptionRu,
  uz: product.descriptionUz,
});
```

Missing localized content falls back to the other language. Catalog business
logic and API contracts are unchanged. Profile contains only the heading and
minimal settings card, using `ChoiceGroup` with native radio keyboard behavior.

## Checks

Run only the miniapp checks from the repository root:

```sh
pnpm --filter @stenzo/miniapp typecheck
pnpm --filter @stenzo/miniapp lint
pnpm --filter @stenzo/miniapp build
pnpm --filter @stenzo/miniapp test
```

The local ESLint config inherits the repository configuration and excludes
Next.js's generated `next-env.d.ts`.

## Font

Inter by Rasmus Andersson:
https://github.com/rsms/inter/blob/master/docs/font-files/InterVariable.woff2

The bundled font is licensed under the SIL Open Font License 1.1; see
`src/fonts/OFL.txt`. It is stored locally so builds remain reproducible offline.
