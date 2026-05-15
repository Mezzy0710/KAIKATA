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
✅ **Test coverage**: 11/12 test files passing (scryfall-lookup times out due to external API)
✅ **UI/UX**: Mobile-responsive design with intuitive workflow
✅ **Card search**: Search functionality in review table (shipped in v1.0)
✅ **Result summary strip**: Final Total, Savings, Sellers Used, Item Count (shipped in v1.0)
✅ **Browser extension**: Extracts structured cart data from Cardmarket, opens in KAIKATA
✅ **Extension + paste flows**: Both normalize into the same review and optimization model

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
- app.mjs: ~2,012 LOC (~78 KB)
- parser.mjs: ~1,274 LOC (~38 KB)
- styles.css: ~2,373 LOC (~60 KB)
- Total: ~6,400 LOC

**Performance Observations**:
- Parser handles 21 sellers in < 5ms (from performance-large-scale test)
- Shipping index build: < 1ms
- No obvious O(n²) bottlenecks in optimization loop
- Reference price lookups are async (Scryfall) — no blocking

### Technical Debt Identified (Prioritized)

1. **Duplicated escapeHtml definitions** — In both app.mjs and price-verdict.mjs
   - Should export from one shared utility module and import everywhere
   - Impact: ~15 LOC cleanup, improves consistency

2. **scryfall-lookup.mjs integration test** — Times out on external API calls
   - Needs mocking for CI reliability
   - Impact: Currently excluded from CI; no dev blocker

3. **Parser.mjs complexity** — ~1,274 LOC single file
   - Could split: tokenization, inference, item parsing into separate modules
   - Impact: Maintainability, not correctness

4. **app.mjs size** — ~2,000 LOC
   - New logic must go into dedicated modules, not here
   - Impact: Ongoing discipline required

5. **Internal protocol identifiers** — `CARTFORGE_CART=`, `#cartforge=`, storage keys, message types
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
- ✅ Shipping: cost calculation, trustee fee logic
- ✅ Country inference: aliases, mobile parsing
- ✅ UI: warning copy formatting
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
├── shipping_data.json              # Cardmarket shipping rates to Germany
│
├── src/
│   ├── app.mjs                     # Main app logic, UI rendering, templates
│   ├── parser.mjs                  # Cart text parsing, country inference
│   ├── shipping.mjs                # Shipping cost & trustee calculations
│   ├── scryfall.mjs                # Reference price lookups (external API)
│   └── price-verdict.mjs           # Price comparison logic
│
├── extension/                      # Browser extension (extracts from Cardmarket)
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
   - Extract shared `escapeHtml` utility module
   - Mock scryfall integration test for CI

2. **Before v1.1 feature work**:
   - Define and scope chosen feature from wishlist
   - Run full test suite to confirm clean baseline
   - Test on mobile device (iOS/Android)

---

## Known Limitations (By Design)

- **Destination country**: Fixed to Germany (can be changed in settings for v2)
- **Country inference**: Probabilistic, surfaces ambiguity — user must verify
- **Shipping data**: Static JSON (updated manually from Cardmarket)
- **Reference prices**: Best-effort from Scryfall API (may be out of sync with Cardmarket)
- **Trustee fees**: Calculated only if sellers provide the value in cart text

---

## Development Commands

```bash
# Run all tests
node tests/correctness-parser.mjs
node tests/correctness-optimizer.mjs
node tests/shipping-costs.mjs
node tests/parser-mobile-country-aliases.mjs

# Performance testing (large-scale)
node tests/performance-large-scale.mjs

# DO NOT run in CI — external API, will timeout
# node tests/scryfall-lookup.mjs

# Local development
open index.html
# or: python3 -m http.server 8000
```

---

Last Updated: May 15, 2026
Branch: `main`
