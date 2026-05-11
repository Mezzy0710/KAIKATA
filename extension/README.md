# CartForge Cardmarket Extractor

Experimental browser-extension scaffold for extracting structured shopping-cart data from Cardmarket.

## What It Does

- Injects a small CartForge panel on Cardmarket shopping-cart pages.
- Reads seller and item information from the page DOM.
- Opens CartForge with a structured payload in the URL fragment.
- Can also copy the payload as `CARTFORGE_CART={...}` for manual import.

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

1. Open Chrome or another Chromium browser.
2. Go to `chrome://extensions`.
3. Enable Developer mode.
4. Choose "Load unpacked".
5. Select this `extension/` directory.
6. Open a Cardmarket shopping cart page.
7. Click "Open in CartForge" or "Copy payload".

## Development Notes

This is intentionally selector-tolerant rather than selector-perfect. Cardmarket markup may change, and authenticated cart pages are difficult to fixture without user-provided sanitized HTML.

The next hardening step is to save a sanitized cart DOM sample and add extractor tests against it. Prefer adding selectors to `content-script.js` only after confirming them against real markup.

## Privacy

The extension does not send data to a server. "Open in CartForge" places the payload in the destination URL fragment, which is handled client-side by the static app. Browser history may still retain that fragment, so avoid sharing the resulting URL if it contains private seller/cart data.
