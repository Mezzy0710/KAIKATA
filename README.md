# KAIKATA – Cardmarket Cart Optimizer

A web app that helps optimize a Cardmarket shopping cart for lowest total cost.

## Purpose

KAIKATA takes your Cardmarket cart data as input, extracts sellers, shipping methods, item rows, and prices, infers seller country where possible, allows manual correction, and calculates the cheapest buying plan including shipping and trustee effects.

## Primary user journey

1. Import cart data from the Cardmarket extension or paste the full shopping cart text.
2. Let the app parse seller blocks and line items.
3. Review ambiguous country/method matches and detected card quantities.
4. Run optimization.
5. Review which sellers to keep, which to drop, and the final total cost.
6. Manually update the cart on Cardmarket and place the orders.

## Cardmarket extractor extension

The `extension/` directory contains a browser extension that can extract structured cart data directly from a Cardmarket shopping-cart page and open it in KAIKATA. This avoids copying the entire cart page manually and unlocks additional metadata that pasted text often loses, including set name and rarity.

Current status:
- The extension injects an "Open in KAIKATA" panel on Cardmarket shopping-cart pages.
- KAIKATA can import extracted payloads from `#cartforge=...` URL fragments or `CARTFORGE_CART={...}` pasted into the input area (internal protocol identifiers, unchanged for compatibility).
- Review rows now preserve `setName` and `rarity` when provided by the extractor.
- Extension-import and manual-paste flows both normalize into the same review and optimization model.

Next hardening step: capture a sanitized Cardmarket cart HTML sample and add fixture tests for the extractor selectors.

### Adding offers from sellers' wants-list pages (extension 1.1.0)

KAIKATA can also consider articles that are **not in your cart yet**, from the "Seller's Articles on My Wants List" page of sellers you pick (`/Users/<seller>/Offers/Singles?idWantslist=<id>`):

1. Open that page for a seller. A small KAIKATA panel appears (only when the URL has `idWantslist`).
2. Click **Capture this seller**. The extension reads the result pages one at a time with a 2–4 s pause between them, at most 15 pages, and stops at the first error, login redirect, check page or HTTP 429, keeping what it has. **Capture this page only** reads just the page you are on (repeat it per page if you prefer to click through yourself).
3. Import your cart into KAIKATA as usual. KAIKATA asks the extension for the captured offers and uses those for cards already in your cart (other cards are ignored). They show as "not in cart" in the review table.
4. The plan lists per seller what to **Add to cart**, with a link to that seller's wants page. After "Send to Cardmarket", that page marks the planned articles **ADD ×N**, and **Select planned articles on this page** ticks them and sets the amounts. You then click Cardmarket's own button; the extension never changes your cart itself.

Captures are stored in the extension (`chrome.storage.local`), per seller; they are marked stale after 24 h, and the panel lists them with **Remove** / **Clear all**. Nothing is crawled in the background.

## Version 1 scope

### Input
- Primary: pasted Cardmarket cart text from desktop or mobile.
- Fallback: manual CSV paste.
- Future: PDF upload and extraction.

### Parser must extract
- Seller name
- Seller-level summary values: article value, shipping, trustee service, total
- Shipping method name
- Tracking status
- Card name
- Set name when available from structured extraction
- Rarity when available from structured extraction
- Condition
- Quantity
- Unit price
- Optional note/comment line under card if present

### Optimization goal
Minimize total cart cost:
- sum of selected card prices
- plus shipping per used seller
- plus trustee fee where applicable

### Important constraints
- Destination country is always Germany unless changed later.
- Seller country may be inferred from shipping method, but must support manual override.
- Parsing must show a review table before optimization.
- Never hide ambiguity. Surface it clearly.

## Shipping data

The repository includes `shipping_data.json`, derived from Cardmarket shipping costs for shipments to Germany.

Use it to:
- map shipping method patterns to likely origin country
- validate shipping-price plausibility
- calculate shipping if cart assignments change

`_meta.updatedAt` records when the table was captured; the app shows it in advanced details as "Shipping rates from <date>". Top-level keys starting with `_` are metadata and are ignored by every country lookup.

Shipment weight follows Cardmarket's published letter limits: up to 4 cards = 20 g, up to 17 = 50 g, up to 40 = 100 g. Above 40 cards KAIKATA estimates `11 + 2.22 × cards` g (a linear fit, not a Cardmarket figure).

### Refreshing shipping rates

Refresh about every 3 months, or sooner when a real cart's shipping doesn't match KAIKATA's estimate.

1. Open https://help.cardmarket.com/en/ShippingCosts in a desktop browser.
2. Open DevTools → Console, paste the contents of `scripts/shipping-refresh-snippet.js` and press Enter. It fetches every origin country → Germany one request at a time and downloads `shipping_data.json`.
3. Replace the repo's `shipping_data.json` with the download.
4. Run `bash tests/run-all.sh`. Price assertions in `tests/shipping-costs.mjs` / `tests/shipping-weight.mjs` and the plan snapshots in `tests/optimizer-seller-moves.mjs` may need updating to the new Cardmarket values; review each change.
5. Bump the `?v=` query on `app.mjs` in `index.html` and commit.

## Suggested UI flow

1. Paste cart text
2. Parse
3. Review extracted seller blocks and inferred countries
4. Correct anything ambiguous
5. Optimize
6. Show results:
   - keep sellers
   - drop sellers
   - per-seller item list
   - article subtotal
   - shipping subtotal
   - trustee subtotal
   - final total

## Tech direction

Keep the app portable and easy to migrate between AI tools.

Recommended options:
- Static HTML/CSS/JS app, or
- Small React app that can still be deployed as a static site

Avoid platform lock-in. The source code is the main asset.

## Deployment

Target deployment: GitHub Pages first.

The app should run fully client-side with no server requirement.

## Not in version 1

- Automatic Cardmarket cart editing
- User accounts
- Persistent database
- Full customs/tax engine
- Perfect country inference without fallback

## Quality bar

The app should optimize correctly before it looks polished. Parsing accuracy and transparent review matter more than visual refinement in version 1.

## Product voice (microcopy guardrails)

KAIKATA should read like a smart TCG friend: concise, practical, hobby-native, and trustworthy.

- Use light wit only in low-risk moments (empty states, successful import/parse, optimization success/loading, optional helper text).
- Keep warnings, malformed import errors, variant constraints, and cost-critical messages neutral and precise.
- Prefer clear-before-clever one-liners over jokes.
