# Changelog

Versions follow `extension/manifest.json`. `node scripts/package-extension.mjs` refuses to
package a version without an entry here.

## 2.0.1 — 2026-09-24

- Wants-page capture recovers offers lost to Cardmarket's unstable paging: when a
  wants-list walk finishes cleanly but still falls short of the page's own hit count, a
  second pass walks the list sorted Z→A and merges by article id. Never a third pass.
- The result card reports "Loaded N of H offers" with a plain explanation when a gap
  remains, instead of the old (misleading) "N row(s) were not recognized" wording.
- The cart page's "Wants stock" checklist shows "N/H offers" for a seller whose captured
  stock is short of the page's reported hit count.

## 2.0.0 — 2026-09-24

- KAIKATA runs inside the extension: the toolbar icon opens (or focuses) the KAIKATA tab.
- "Transfer to KAIKATA" on the cart page hands the cart over through extension storage
  instead of a URL hash, and reuses an open KAIKATA tab. "Open on website instead" keeps
  the old route during the transition.
- Wants stock loaded in another tab shows up in KAIKATA right away (no tab switch needed).
- Confirmed plans are written straight to extension storage.
- Geist is bundled with the extension (no remote fonts on the extension page).
- Packaged with `scripts/package-extension.mjs` into `dist/kaikata-extension/` and
  `dist/kaikata-extension-<version>.zip`.

## 1.2.0

- Guided wants-stock flow: checklist of loaded sellers on the cart page, K/J result card on
  wants pages, "Next seller →", 24 h / same-wants-list transfer rule.

## 1.1.0

- Captures sellers' "Articles on My Wants List" as extra candidates for KAIKATA.

## 1.0.3

- Marks cart rows KEEP / REMOVE / KEEP n OF m / REVIEW after a plan is confirmed.
