# CartForge Cardmarket Extractor

Experimental browser-extension scaffold for extracting structured shopping-cart data from Cardmarket.

## What It Does

- Injects a small CartForge panel on Cardmarket shopping-cart pages.
- Reads seller and item information from the page DOM.
- Opens CartForge with a structured payload in the URL fragment.
- Can also copy the payload as `CARTFORGE_CART={...}` for manual import.
- Supports both local and live CartForge targets.

## Extracted Fields

Seller-level:

- `sellerName`
- `sellerCountry`
- `shippingMethod`
- `trackingStatus`
- `articleValue`
- `shippingValue`
- `trusteeValue`
- `total`

Item-level:

- `cardName`
- `setName`
- `rarity`
- `condition`
- `quantity`
- `price`
- `rawLine`

## Local Testing

1. Run `node scripts/package-extension.mjs` in the repository root. It builds `dist/kaikata-extension/` (this folder plus the KAIKATA app under `app/`) and `dist/kaikata-extension-<version>.zip`.
2. Open Chrome or another Chromium browser and go to `chrome://extensions`.
3. Enable Developer mode.
4. Choose "Load unpacked" and select `dist/kaikata-extension/` (loading `extension/` directly works for the cart and wants pages, but the toolbar icon and "Transfer to KAIKATA" need the packaged `app/`).
5. Open a Cardmarket shopping cart page and click "Transfer to KAIKATA" (or "Open on website instead" / "Copy to Clipboard").

## Live Page

The extension's live target is:

`https://mezzy0710.github.io/cardmarket-cart-optimizer/`

The repository now includes a GitHub Pages workflow in [.github/workflows/deploy-pages.yml](/Users/kevinsula/Documents/AI%20Source%20Files/Projects/cardmarket-optimizer/.github/workflows/deploy-pages.yml).

To make the live target work:

1. Push this repository to GitHub.
2. In GitHub repo settings, enable Pages and choose `GitHub Actions` as the source.
3. Push to `main` or `master`, or run the workflow manually.

## Development Notes

This is intentionally selector-tolerant rather than selector-perfect. Cardmarket markup may change, and authenticated cart pages are difficult to fixture without user-provided sanitized HTML.

The next hardening step is to save a sanitized cart DOM sample and add extractor tests against it. Prefer adding selectors to `content-script.js` only after confirming them against real markup.

## Privacy

The extension does not send data to a server. "Transfer to KAIKATA" hands the cart to the KAIKATA extension page through `chrome.storage.local`. "Open on website instead" places the payload in the destination URL fragment, which is handled client-side by the static app. Browser history may still retain that fragment, so avoid sharing the resulting URL if it contains private seller/cart data.
