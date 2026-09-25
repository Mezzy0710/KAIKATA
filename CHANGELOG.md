# Changelog

Versions follow `extension/manifest.json`. `node scripts/package-extension.mjs` refuses to
package a version without an entry here.

## 2.1.0 — 2026-09-25

Fixes from the live UI review (9 sellers / 16 articles, wants list 24618932).

- An empty wants page ("There are no offers for your selected …", or no rows with the wants
  filter present, in any language) is a valid result, not a "check or error page". It saves
  a 0-offer capture that counts as loaded everywhere (checklist, progress header, transfer
  summary, "Next seller"); the result card says "✓ No extra stock for your wants list here".
  Opening an empty wants page records it right away (no request needed); the walker stops
  cleanly after page 1. KAIKATA counts such sellers as "checked, nothing extra".
- The cart is read once: Cardmarket renders every seller block twice (desktop + hidden
  mobile layout). Extraction keeps only rendered sections, rows and links (whichever layout
  the viewport shows), then dedupes by article id, and by card / collector number /
  condition / price / quantity while a seller's rows exceed its "Contents N Articles".
  Wants links are deduped. Overlay marks go on the visible rows only (and follow a resize
  across the breakpoint). The importer's dedupe stays as a safety net.
- "Check all sellers" on the cart page (click only): page 1 of each unloaded seller's wants
  page, one at a time, 2–4 s apart, same stop rules as a full load (429 / non-200 / login /
  check page), Stop available throughout. Empty sellers are saved as "nothing extra";
  sellers with offers show "H offers on P pages" with "Load →" and move to the top of the
  checklist (results kept 24 h in `cartforgeWantsCheckV1`, offers are not saved).
- Cart panel: remembers expanded/collapsed (opens by default on a cart with sellers), max
  320 px wide, anchored bottom-left so it never covers Cardmarket's right-column summary and
  "Proceed to checkout"; scrolls within the window. New intro "Step 1: check your sellers'
  wants stock · Step 2: transfer to KAIKATA"; neutral "Open wants page" links; "Copy to
  Clipboard" and "Open on website instead" moved under "More".
- Wants-page panel: never taller than the window (scrolls inside), with the progress
  header pinned as the first visible element.

## 2.0.2 — 2026-09-25

- The wants-page panel always shows overall progress at the top: "Wants stock: X of Y
  cart sellers loaded · N offers" once a cart is known (same counting rules as the cart
  page's checklist), or a fallback count before a cart has been opened. Updates live,
  including captures made in another tab.
- The loaded-sellers list opens by default once 2+ sellers are loaded, highlights the
  current seller, and shows "N/H offers" for a seller whose captured stock is incomplete.
- The result card after loading adds "That's X of Y. Next: <seller> →", or "All cart
  sellers loaded — back to cart to transfer" when complete.
- Opening KAIKATA from the toolbar icon or "Transfer to KAIKATA" now checks that
  `app/index.html` exists first; the unpackaged `extension/` source folder shows a static
  explainer page instead of a broken tab.
- The Git routine now runs `node scripts/package-extension.mjs` after every commit so
  `dist/` stays in sync with the branch.

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
