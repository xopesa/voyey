# Marketing V1 — Cloudflare preview

Scope: `stenzo-free-preview`, `cf.stenzo.uz`, `cf-admin.stenzo.uz`. Turon is outside this change. Secrets and live business data are never fixtures.

## Banners

Admin → Marketing → Banners. Save a draft, upload a validated PNG/JPEG/WebP (max 5 MiB), choose NONE / catalog / category / product / HTTPS link, then activate. Titles RU and UZ and a managed image are required for activation. Targets refer to IDs; public links use the current slug. Inactive or missing targets yield a non-clickable banner. Replacing an image removes the previous managed image only after persistence succeeds.

Public `GET /api/home/banners` exposes presentation fields only. Zero banners or a failed request retains HomeHero. Carousel uses native horizontal scrolling, dots, no autoplay, existing language/theme preferences.

## Product promotions

Edit a product → Promotions. Price is a positive integer in UZS, strictly below the regular price. Optional start/end use **Asia/Tashkent (UTC+5)** in Admin and UTC instants in storage. Start is inclusive; end is exclusive. Clearing removes all three promotion fields. Changes require the existing product Save action.

`effectiveProductPrice()` is shared by catalog, product cards/detail, cart, checkout and new Telegram publications. Cart prices are current. Order items retain `originalUnitPrice` and the effective `unitPrice`/`lineTotal` at checkout. Existing Telegram posts are never edited automatically.

## Promo codes

Admin → Marketing → Promo codes. Uppercase codes are 3–32 characters, A–Z/0–9 with single internal hyphens. Percent 1–90 (floor rounding), optional maximum discount; or fixed positive UZS. Minimum order amount uses the subtotal **after product sales**. Blank global limit/dates are unlimited; per-user limit defaults to one. There is no hard delete; deactivate to retain history.

Authenticated `POST /api/promo-codes/validate` accepts only `{code}` and reads the current user's existing cart. It never creates a cart, reserves usage or writes a redemption. Quotes are advisory. Checkout revalidates inside the existing revision-guarded D1 atomic batch, including stock, global/per-user limits, order/items, redemption, audit and cart clear. New tables have revision triggers; concurrent writes retry against a fresh snapshot. A failed batch consumes nothing. Mini App stores only the existing random cart-scoped attempt key and an optional public promo code for uncertain retries; never recipient data or JWT. A reload cannot silently substitute another promo code on an uncertain attempt. Existing order replay precedes promo/cart validation and returns the immutable original result.

One code per checkout. `subtotal = sum(snapshot item lineTotal)`, `total = subtotal - discountAmount`, prepayment is the existing ceil(50% of total), remaining products = total minus prepayment. Cargo is assigned later and is never discounted. Payment and Telegram payment review continue to use order amounts.

## Additive D1 storage compatibility

Migrations 0001–0007 are unchanged. Apply 0008 (banners), 0009 (sale fields/item original price), 0010 (promo codes/redemptions/order snapshots) only after isolated tests.

0001 contains `Order_amounts_check` requiring the physical `Order.subtotal = Order.total`. SQLite cannot replace that CHECK additively. To preserve it and avoid table rebuilds, foreign-key toggles or historical rewrites, 0010 adds nullable **`Order.itemsSubtotal`**, the immutable pre-code product subtotal. New writes keep the physical legacy `subtotal` equal to the net `total`; a new CHECK enforces `itemsSubtotal - discountAmount = total`. The D1 order repository and public/Admin DTO adapters expose `itemsSubtotal` as canonical **`subtotal`**. Legacy rows keep NULL and read their existing subtotal. Raw SQL/reporting must use `COALESCE(itemsSubtotal, subtotal)` for the canonical product subtotal. Do not treat the legacy compatibility column as the gross amount on discounted orders.

`discountAmount` defaults to zero and `promoCodeSnapshot` to NULL on legacy rows. No business rows are populated or rewritten by these migrations. No marketing seed is run. Deployment preserves commerce=1 and existing secrets.

## Manual acceptance (owner only; not run by Codex)

1. Create one banner, upload your image, fill RU/UZ text, preview and activate. Check both languages/themes, target and carousel; deactivate and verify fallback.
2. Set a sale on your chosen product. Check active/future/expired periods in catalog/detail/cart. Existing orders must retain prior prices. Do not publish a channel post just to test.
3. Create your own limited preview promo code. Apply it at checkout and verify subtotal, discount, net total, rounded prepayment and separately priced cargo. Change the cart and reapply the code.
4. Complete any business/order/payment actions yourself. Check immutable order snapshots and usage count after checkout; replaying the same checkout must not use the code twice. Deactivate the code afterward if desired.

Automated checks use only disposable databases, isolated Worker runtime and local UI fixtures. They never create live banners, sales, codes, products, carts, orders, payments, users or Telegram messages.
