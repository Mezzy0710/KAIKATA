# Cardmarket Cart Optimizer - Development Guide

## Project Overview
A client-side web app that optimizes Cardmarket shopping carts for the lowest total cost by analyzing seller offers, shipping methods, and trustee fees.

**Tech Stack**: Vanilla JavaScript (ES modules), HTML, CSS
**Deployment**: GitHub Pages (static site)
**Latest Release**: v1 (May 9, 2026)

---

## Current Status Assessment (May 10, 2026)

### What's Working Well
✅ **Core functionality**: Parser, optimizer, and shipping logic are solid and well-tested
✅ **Mobile support**: Mobile cart parsing with seller names and country aliases working
✅ **Security**: Proper input escaping (escapeHtml/escapeAttribute) prevents XSS
✅ **Test coverage**: 11/12 test files passing (scryfall-lookup times out due to external API)
✅ **UI/UX**: v1 has mobile-responsive design with intuitive workflow

### Open PRs & Their Status

#### PR #13: "test: cover mobile cart seller names and country aliases"
- **Status**: ✅ Clean, ready to merge
- **Changes**: 
  - Adds country inference aliases (Deutschland-Deal → Germany, Postamail → Italy, Corriere → Italy)
  - Tests mobile cart parsing with real seller names from cart overview
  - 2 new test files, 700 LOC additions
- **Impact**: Improves parsing accuracy for mobile carts

#### PR #14: "Release/v1.1" (release/v1.1 branch)
- **Status**: ⚠️ Unstable merge state (likely CI-related, not conflicts)
- **Changes**:
  - Card search functionality in review table
  - Result summary strip (Final Total, Savings, Sellers Used, Item Count)
  - Large-scale performance tests (21 sellers)
  - Mobile responsive improvements
  - Optimization: Break out of nested loops (outerLoop label)
- **Impact**: Improved UX and performance validation

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
**File Sizes** (dev branch):
- app.mjs: 2,012 LOC (~78 KB)
- parser.mjs: 1,274 LOC (~38 KB)
- styles.css: 2,373 LOC (~60 KB)
- Total: ~6,400 LOC

**Performance Observations**:
- Parser handles 21 sellers in < 5ms (from performance-large-scale test)
- Shipping index build: < 1ms
- No obvious O(n²) bottlenecks in optimization loop
- Reference price lookups are async (Scryfall) - no blocking

**Potential Improvements**:
- Move some utility functions to reduce app.mjs size (~150 KB seems reasonable for v1)
- Consider lazy-loading Scryfall cache (currently loads on boot)
- Memoize seller/item transformations in optimization loop

### Technical Debt Identified

#### Minor Issues (Low Priority)
1. **scryfall-lookup.mjs integration test** - Times out on external API calls
   - Workaround: Run tests locally; consider mocking for CI
   - Impact: None (doesn't block development)

2. **Parser.mjs complexity** - 1,274 LOC single file
   - Could split: tokenization, inference, item parsing into separate modules
   - Impact: Maintainability, not correctness

3. **Duplicated escapeHtml definitions** - In both app.mjs and price-verdict.mjs
   - Should export from one module and import
   - Impact: ~15 LOC cleanup

4. **Manual DOM queries in event handlers** - Lots of dataset/getAttribute chains
   - Could use event delegation more consistently
   - Impact: Minor readability improvement

#### Missing v1 Features (Documented Out-of-Scope)
- ✓ Automatic cart editing on Cardmarket
- ✓ User accounts / data persistence
- ✓ Full customs/tax calculations
- ✓ Perfect country inference (intentionally fallback-based)

---

## Recommended Improvements for v1.1

### Phase 1: Merge & Stabilize (Ready Now)
**Action**: Merge PR #13 (test coverage)
- Improves parsing accuracy
- No new dependencies or breaking changes
- Risk: Very low

**Action**: Fix PR #14 merge state and merge
- Diagnose CI failure (likely a lint or test issue)
- Card search is useful quality-of-life feature
- Result summary strip adds transparency
- Risk: Medium (requires investigation)

### Phase 2: Technical Cleanup (Optional, ~2-4 hours)
**Priority 1 (Recommended)**:
1. Extract escapeHtml to shared utility module
2. Fix scryfall integration test (mock responses)
3. Add performance test to CI (validate large-scale behavior)

**Priority 2 (Nice-to-have)**:
1. Add security headers documentation (CSP)
2. Split parser.mjs into logical submodules
3. Consolidate event delegation patterns

### Phase 3: Feature Wishlist for v1.2
(Document but don't implement yet)
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
- ⚠️ Scryfall: integration test (requires network)

### CI/CD Gaps
- No automated test runner (should add)
- No bundle size checking
- No lighthouse/performance audit

### Recommended for v1.1
```bash
# Add test runner script to package.json equivalent
tests/run-all.sh - run all tests and report summary
```

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
└── tests/
    ├── fixtures/                   # Sample cart data
    ├── correctness-*.mjs           # Functional tests
    ├── parser-mobile-*.mjs         # Mobile parsing tests
    ├── shipping-costs.mjs          # Shipping calculation tests
    └── price-verdict.mjs           # Price logic tests
```

---

## Next Steps

1. **Immediate** (Today):
   - Merge PR #13 ✅
   - Diagnose PR #14 merge state (check CI logs for specific failure)
   - Merge PR #14 or fix issues

2. **Short-term** (This week):
   - Extract shared utilities (escapeHtml)
   - Fix or mock scryfall integration test
   - Document deployment steps

3. **Before v1.1 release**:
   - Run all tests locally
   - Test on mobile device (iOS/Android)
   - Check accessibility (keyboard nav, screen readers)
   - Verify GitHub Pages deployment

---

## Known Limitations (By Design)

- **Destination country**: Fixed to Germany (can be changed in settings for v2)
- **Country inference**: Probabilistic, surfaces ambiguity - user must verify
- **Shipping data**: Static JSON (updated manually from Cardmarket)
- **Reference prices**: Best-effort from Scryfall API (may be out of sync with Cardmarket)
- **Trustee fees**: Calculated only if sellers provide the value in cart text

---

## Development Commands

```bash
# Run all tests
node tests/correctness-parser.mjs
node tests/correctness-optimizer.mjs
node tests/parser-mobile-country-aliases.mjs
# ... etc

# Performance testing (large-scale)
node tests/performance-large-scale.mjs

# Local development (open in browser)
open index.html
# or serve with Python: python3 -m http.server 8000
```

---

Last Updated: May 10, 2026
Branch: `claude/review-and-plan-n5Heq`
