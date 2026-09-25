# KAIKATA – Cardmarket Cart Optimizer: Development Guide

## Project Overview
A client-side web app that optimizes Cardmarket shopping carts for the lowest total cost by analyzing seller offers, shipping methods, and trustee fees.

**Tech Stack**: Vanilla JavaScript (ES modules), HTML, CSS
**Deployment**: GitHub Pages (static site)
**Latest Release**: v1.0 (May 2026)

---

## Current Status Assessment (May 15, 2026)

### What's Working Well
✅ **Core functionality**: Parser, optimizer, and shipping logic are solid and well-tested
✅ **Mobile support**: Mobile cart parsing with seller names and country aliases working
✅ **Security**: Proper input escaping (escapeHtml/escapeAttribute) prevents XSS
✅ **Test coverage**: 17/18 test files passing (scryfall-lookup times out due to external API)
✅ **UI/UX**: Mobile-responsive design with intuitive workflow
✅ **Card search**: Search functionality in review table (shipped in v1.0)
✅ **Result summary strip**: Final Total, Savings, Sellers Used, Item Count (shipped in v1.0)
✅ **Browser extension**: Extracts structured cart data from Cardmarket, opens in KAIKATA
✅ **Cart row marks** (extension 1.0.3): after a plan is confirmed, every article row on the Cardmarket cart gets KEEP / REMOVE / KEEP n OF m / REVIEW / ? (`extension/cartforge-matching.js`, pure, loaded before `content-script.js`). Rows are matched by card name + collector number + condition + price; unmatched rows are never marked REMOVE. The panel shows a live cut counter and an "All / Only removals" filter. `visibleText` strips mark text, so extraction reads the same data with or without marks
✅ **Wants-page candidates** (extension 1.1.0): `extension/wants-page.js` + pure `extension/cartforge-wants-parser.js` (tiny HTML tree parser + sequential page walker: 2–4 s pauses, ≤15 pages, stop on non-200/429/login/challenge) capture sellers' "Articles on My Wants List" into `chrome.storage.local` `cartforgeCandidatesV1`. KAIKATA fetches them via the bridge (`CARTFORGE_V3_GET_CANDIDATES`, not the URL hash) after a cart import. `src/candidates.mjs` merges them into the offer groups: only cards already in the cart, existing sellers keep their index/calibration, new sellers are appended, prefilter ≤3 per (card, seller) after variant preferences. Candidate offers have `source: "candidate"` and `itemIndex: "cand:<idArticle>"`. Confirmed plan schema v2 adds `decision: "add"` rows (cart fingerprint unchanged); the extension accepts v1 and v2. Cart-only plans are unchanged
✅ **Guided wants-stock flow** (extension 1.2.0): pure `extension/cartforge-wants-flow.js` (loaded on the cart page, the wants pages, and via `importScripts` in `background.js`). Cart extraction reads each seller's wants link (href `/Users/<seller>/Offers/Singles?…&idWantslist=<id>`, id taken from the link) into `seller.wantsUrl` / `seller.wantsListId` and `payload.wantsListIds`, and stores `cartforgeCartSnapshotV1` (card names = KAIKATA's `normalizeOfferKey`). Cart panel: **Wants stock** checklist (loaded X of Y, links, "Next seller →", extra sellers) + a send summary. Wants page: prompt → progress bar → result card with K (cart cards in stock) / J (cheaper than the lowest cart price), "Next seller →", "Back to cart"; "Reload" when loaded < 24 h. Transfer rule (`filterCapturesForTransfer`): captures < 24 h old whose `wantsListId` is in the cart's `wantsListIds`; the rest are counted as `excluded: { stale, otherWantsList }`; no ids → 24 h rule only (`fallback`). KAIKATA sends the ids with `CARTFORGE_V3_GET_CANDIDATES`. `src/candidate-impact.mjs` (pure, optimizer injected) runs cart-only and cart + stock, shows the stock plan only when strictly better (optimizer ranking: fewer unresolved sellers, then lower total), else the cart-only plan unchanged; impact card: improved (€D, adds, new sellers, removals vs the cart-only plan) / nothing better / none (tip). `optimizeCart` results now carry `unresolvedCount` / `resolvedTotal`. Second run on the real cart + 8 sellers / 1,480 offers: ~70 ms
✅ **KAIKATA inside the extension** (extension 2.0.0): `scripts/package-extension.mjs` copies the web app (`index.html`, `styles.css`, `src/*.mjs`, `shipping_data.json`, `sample-cart-mobile.txt`) into `dist/kaikata-extension/app/` next to the extension files and zips `dist/kaikata-extension-<version>.zip` (system `zip`; refuses without a `CHANGELOG.md` entry for the manifest version). Only the packaged `index.html` changes: Google Fonts → `../app-assets/fonts.css` (bundled Geist variable woff2, OFL; also resets Chrome's extension-page `body { system-ui; 75% }` default) and `<script src="../cartforge-wants-flow.js">` before `app.mjs`. `src/host.mjs` is the only transport `app.mjs` uses: on `chrome-extension:` it reads/removes `cartforgeIncomingCartV1`, filters `cartforgeCandidatesV1` with `CartforgeWantsFlow.filterCapturesForTransfer`, writes `cartforgeConfirmedPlanV3` (same envelope/validation as `background.js`), and listens to `storage.onChanged` (captures, new carts); on the website it keeps the URL hash + postMessage bridge + visibilitychange. The toolbar icon and "Transfer to KAIKATA" open or focus the app tab (`CARTFORGE_V3_OPEN_APP`, `runtime.getContexts`, no `tabs` permission); "Open on website instead" keeps the hash route. `?v=` imports work on `chrome-extension://`; Scryfall works via CORS (`*`), no host permission. The website is unchanged
✅ **Cut lists in the web app**: "Sellers not in plan" lists each dropped seller's cards; kept sellers show "Remove from this seller:" (`src/plan-cuts.mjs`, matched by itemIndex)
✅ **Extension + paste flows**: Both normalize into the same review and optimization model
✅ **Optimizer search** (`src/optimizer-search.mjs`): local search with single-card moves, seller removal and seller addition (addition is followed by a removal pass). Matches the brute-force optimum on ~99% of a seeded 300-cart fuzz set; 500-iteration safety limit
✅ **Optimizer performance**: per-seller costs are memoized per `optimizeCart` run (`src/optimizer-score-cache.mjs`). Shipping/trustee estimation was >95% of search time. Seeded random carts 15/60/4, 25/100/5, 35/150/6 run in ~0.06 / 0.26 / 0.9 s in Node. The UI yields a frame before optimizing so "Optimizing" and the disabled button paint
✅ **Shipping data** (refreshed 2026-09-24): 32 origin countries → Germany, with `_meta.updatedAt` shown in advanced details. Keys starting with `_` are ignored by `walkShippingData`. Weight model = Cardmarket's published limits (≤4 cards 20 g, ≤17 50 g, ≤40 100 g, above: `11 + 2.22 × cards` estimate). Known gap: Austria's 75 g tracked letter is only used up to 17 cards
✅ **Shipping calibration** (`src/shipping-calibration.mjs`, pure): the importer parses each seller's shipping dropdown into `seller.observedShipping` (selected method + Letter/Tracked Letter/Tracked Parcel category prices). Per `optimizeCart` run the table is calibrated: a selected method matching a table row updates that row's price for the whole country (disagreement → higher price); an unmatched selected method or a category cheaper than the table becomes a seller-only row. Table rows stay in every list, and `calculateShippingCost` still picks the cheapest eligible row by weight and value. Safe because the optimizer never gives a seller more cards than its cart holds. Threshold offers ("free over 100€", €0 prices) are ignored, since they would make smaller subsets free. Corrections are listed in advanced details
✅ **Duplicate extension rows**: the extension keeps the clean row of nested row elements; `dedupeItems` drops flattened copies (`^\d+x\S`, no newline) when a clean row for the same card + collector number exists, and only collapses exact repeats (never two different listings)
✅ **Unresolved sellers**: scores rank lexicographically by `unresolvedCount`, then `resolvedTotal`, then seller count, so an Unknown-country seller (total = Infinity) no longer stalls the search. `score.total` and the UI are unchanged
✅ **Default desired quantity = 1** per card; the collapsed row shows `· N in cart` when the cart holds more copies. The extension overlay shows `Keep X of N` when the plan keeps fewer copies than the cart row

### Open PRs
None. All PRs closed/merged as of May 15, 2026.

---

## Code Quality Assessment

### Security Review ✅
**Finding**: No XSS vulnerabilities detected
- escapeHtml() properly escapes: `&<>"'`
- escapeAttribute() uses escapeHtml()
- All innerHTML content uses escaping for user input (seller names, card names, etc.)
- No eval(), innerHTML injection from untrusted sources, or DOM clobbering

**Recommendation**: Maintain current escaping practices. Consider adding CSP headers in deployment.

### Performance Analysis
**File Sizes** (main branch):
- app.mjs: ~2,889 LOC (~78 KB)
- parser.mjs: ~1,274 LOC (~38 KB)
- styles.css: ~3,631 LOC (~60 KB)
- Total: ~7,794 LOC

**Performance Observations**:
- Parser handles 21 sellers in < 5ms (from performance-large-scale test)
- Shipping index build: < 1ms
- No obvious O(n²) bottlenecks in optimization loop
- Reference price lookups are async (Scryfall) — no blocking

### Technical Debt Identified (Prioritized)

1. **scryfall-lookup.mjs integration test** — Times out on external API calls
   - Needs mocking for CI reliability
   - Impact: Currently excluded from CI; no dev blocker

2. **Parser.mjs complexity** — ~1,274 LOC single file
   - Could split: tokenization, inference, item parsing into separate modules
   - Impact: Maintainability, not correctness

3. **app.mjs size** — ~2,889 LOC
   - New logic must go into dedicated modules, not here
   - Impact: Ongoing discipline required

4. **Internal protocol identifiers** — `CARTFORGE_CART=`, `#cartforge=`, storage keys, message types
   - Still use the pre-rebrand name for backwards compatibility with the extension protocol
   - Impact: Cosmetic; no functional issue

#### Missing v1 Features (Documented Out-of-Scope)
- ✓ Automatic cart editing on Cardmarket
- ✓ User accounts / data persistence
- ✓ Full customs/tax calculations
- ✓ Perfect country inference (intentionally fallback-based)

---

## Feature Wishlist for v1.1
(Document but don't implement until scoped and planned)
- [ ] Quantity adjustment with live optimization (currently requires rerun)
- [ ] Seller reputation/rating integration (requires Cardmarket API)
- [ ] Bulk duplicate detection ("Do I already have this card?")
- [ ] Save/export optimization as PDF
- [ ] Keyboard shortcuts (Cmd/Ctrl+K to search, etc.)

---

## Testing Strategy

### Current Test Coverage
- ✅ Parser: basic, complex quantity, mobile
- ✅ Optimizer: correctness, quantity threshold logic
- ✅ Optimizer search (`optimizer-seller-moves.mjs`): seller-level moves vs brute force + old algorithm, fuzz, perf limits + plan snapshots on seeded random carts, unresolved-seller regression + fuzz. The large fixture has one offer per card, so it is only a parser smoke check, not a perf benchmark
- ✅ Default quantity: default of 1, "in cart" hint (`default-quantity.mjs`)
- ✅ Shipping: cost calculation, trustee fee logic
- ✅ Shipping weight tiers + refreshed prices (`shipping-weight.mjs`)
- ✅ Shipping calibration: dropdown parsing, price updates, seller rows, threshold offers, bracket dynamics (`shipping-calibration.mjs`)
- ✅ Real cart (anonymized, 23 sellers / 35 cards): dedupe, calibration, optimize snapshot €211.37 (`real-cart.mjs`, fixture `tests/fixtures/real-cart-2026-09.txt`)
- ✅ Country inference: aliases, mobile parsing
- ✅ UI: warning copy formatting
- ✅ UI: dropped sellers + seller cut lists (`ui-dropped-sellers.mjs`)
- ✅ Extension row matching vs the real-cart plan, twin rows, mark text stripping (`extension-row-matching.mjs`)
- ✅ Wants-page parser (synthetic fixture `wants-page-sample.html`) + walker limits with fake fetch/sleep (`wants-parser.mjs`)
- ✅ Candidates: add at existing seller, ignored non-cart cards, new seller replacing small sellers, cart-only unchanged, calibration weight fallback, plan v2 add rows, 3×220 offers < 1 s (`candidates.mjs`)
- ✅ Wants flow: wants link from a cart seller block (fixture `cart-seller-block.html`), snapshot normalization = `normalizeOfferKey`, transfer filter + fallback, background `GET_CANDIDATES` via a fake `chrome`, checklist / next seller / send summary, K/J comparison (`wants-flow.mjs`)
- ✅ Host adapter: incoming cart read once, candidates identical to `filterCapturesForTransfer` and `background.js`, confirmed-plan envelope identical to `background.js`, storage-change and visibility listeners (`host.mjs`, fake `chrome.storage`)
- ✅ Packaging: file list, no tests/_private/.claude, no inline scripts or `on*=` in the packaged `index.html`, zip root, changelog gate (`package-extension.mjs`)
- ✅ Candidate impact: real cart + one cheaper stock offer → improved (€8.18, add 1, remove 1), dearer stock → cart-only plan unchanged, no stock → €211.37 / 13 sellers, slow-run flag (`candidate-impact.mjs`)
- ⚠️ Scryfall: integration test (requires network, excluded from CI)

### CI/CD Gaps
- No automated test runner (should add)
- No bundle size checking
- No lighthouse/performance audit

---

## File Structure Reference
```
/
├── index.html                      # Main UI
├── styles.css                      # All styling (mobile-responsive)
├── shipping_data.json              # Cardmarket shipping rates to Germany (`_meta` = capture date/source)
├── scripts/shipping-refresh-snippet.js  # DevTools snippet that regenerates shipping_data.json
├── scripts/anonymize-cart.mjs      # Turns a real CARTFORGE_CART= payload into a committable fixture
├── scripts/package-extension.mjs   # Builds dist/kaikata-extension/ (+ app/) and the versioned ZIP
├── CHANGELOG.md                    # One entry per extension version (packaging requires it)
│
├── src/
│   ├── app.mjs                     # Main app logic, UI rendering, templates
│   ├── host.mjs                    # Extension page vs website transports (cart in, candidates, confirmed plan)
│   ├── optimizer-search.mjs        # Pure local search over seller assignments (cost model injected)
│   ├── optimizer-score-cache.mjs   # Per-run memoization of per-seller cost
│   ├── parser.mjs                  # Cart text parsing, country inference
│   ├── shipping.mjs                # Shipping cost & trustee calculations
│   ├── shipping-calibration.mjs    # Cart-observed shipping → per-seller calibrated rows (pure)
│   ├── plan-cuts.mjs               # Which cart rows to remove/reduce per seller
│   ├── candidates.mjs              # Wants-page offers → extra optimizer candidates (pure)
│   ├── candidate-impact.mjs        # Cart-only vs cart + wants stock: which plan to show, impact card copy (pure)
│   ├── scryfall.mjs                # Reference price lookups (external API)
│   └── price-verdict.mjs           # Price comparison logic
│
├── extension/                      # Browser extension (extracts from Cardmarket, marks cart rows)
│   ├── cartforge-matching.js       # Pure row ↔ plan matching, loaded before content-script.js
│   ├── cartforge-wants-parser.js   # Pure wants-page parser + sequential page walker
│   ├── cartforge-wants-flow.js     # Pure wants-stock helpers: wants links, cart snapshot, transfer filter, K/J
│   ├── wants-page.js               # Wants-page panel: load prompt, progress, result card, ADD ×N marks
│   ├── app-assets/                 # Extension-only assets for the packaged app (Geist + fonts.css)
│
└── tests/
    ├── fixtures/                   # Sample cart data
    ├── correctness-*.mjs           # Functional tests
    ├── parser-mobile-*.mjs         # Mobile parsing tests
    ├── shipping-costs.mjs          # Shipping calculation tests
    └── price-verdict.mjs           # Price logic tests
```

---

## Next Steps

1. **Tech debt** (recommended before new features):
   - Mock scryfall integration test for CI

2. **Before v1.1 feature work**:
   - Define and scope chosen feature from wishlist
   - Run full test suite to confirm clean baseline
   - Test on mobile device (iOS/Android)

---

## Known Limitations (By Design)

- **Destination country**: Fixed to Germany (can be changed in settings for v2)
- **Country inference**: Probabilistic, surfaces ambiguity — user must verify
- **Shipping data**: Static JSON, refreshed manually with `scripts/shipping-refresh-snippet.js` (see README "Refreshing shipping rates"). Refresh every ~3 months or when a cart shows shipping mismatches. `_private/` holds raw captures and is never committed
- **Reference prices**: Best-effort from Scryfall API (may be out of sync with Cardmarket)
- **Trustee fees**: Calculated only if sellers provide the value in cart text

---

## Git routine

1. Work on a new branch from the latest `origin/main` (`git fetch origin && git checkout -b <branch> origin/main`).
2. When all tests pass (`bash tests/run-all.sh` and the `tests/*.mjs` loop without scryfall), commit. Never commit `.claude/` (local settings, worktrees), `_private/` or `dist/` — `.gitignore` covers them.
   A change touching `extension/` bumps `extension/manifest.json` and adds a `CHANGELOG.md` entry for the new version first.
3. After committing, run `node scripts/package-extension.mjs` and report the packaged version (folder + zip size from its output), so `dist/` always matches the branch. It refuses to run without a matching `CHANGELOG.md` entry — that's the signal step 2's version bump is missing.
4. Push the branch (`git push -u origin <branch>`) and open a PR against `main` with `gh pr create`; if `gh` is unavailable, print the compare URL `https://github.com/Mezzy0710/KAIKATA/compare/main...<branch>?expand=1`.
5. Never push to `main`, never merge, never force-push, never delete branches.

---

## Development Commands

```bash
# Run all tests
node tests/correctness-parser.mjs
node tests/correctness-optimizer.mjs
node tests/shipping-costs.mjs
node tests/shipping-weight.mjs
node tests/shipping-calibration.mjs
node tests/real-cart.mjs
node tests/extension-row-matching.mjs
node tests/ui-dropped-sellers.mjs
node tests/wants-parser.mjs
node tests/candidates.mjs
node tests/wants-flow.mjs
node tests/candidate-impact.mjs
node tests/host.mjs
node tests/package-extension.mjs

# Extension build → dist/kaikata-extension/ + dist/kaikata-extension-<version>.zip
node scripts/package-extension.mjs

# New real-cart fixture (keep the raw capture in _private/, never commit it)
# node scripts/anonymize-cart.mjs _private/<cart>.txt tests/fixtures/<name>.txt
node tests/parser-mobile-country-aliases.mjs
node tests/optimizer-seller-moves.mjs
node tests/default-quantity.mjs

# Performance testing (large-scale)
node tests/performance-large-scale.mjs

# DO NOT run in CI — external API, will timeout
# node tests/scryfall-lookup.mjs

# Local development
open index.html
# or: python3 -m http.server 8000
```

---

Last Updated: September 2026 (KAIKATA inside the extension, 2.0.0)
Branch: `main`
