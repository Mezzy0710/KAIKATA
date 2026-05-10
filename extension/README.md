# CartForge Extension - Cardmarket Cart Extractor

A browser extension that intelligently extracts your Cardmarket shopping cart for optimization with [CartForge](https://github.com/Mezzy0710/cardmarket-cart-optimizer).

## Features

✨ **One-click cart extraction** - No more manual copy-paste  
✨ **Intelligent DOM parsing** - Captures more data than copy-paste allows  
✨ **Multiple layout support** - Works on desktop, mobile, and German UI  
✨ **Data validation** - Ensures extracted data is complete before delivery  
✨ **Copy to clipboard** - Seamlessly integrates with CartForge  

## Installation

### For Development/Testing

1. **Clone the CartForge repository** (if not already done)
   ```bash
   git clone https://github.com/Mezzy0710/cardmarket-cart-optimizer.git
   cd cardmarket-cart-optimizer
   ```

2. **Load the extension in your browser**

   **Chrome/Edge:**
   - Open `chrome://extensions` (or `edge://extensions`)
   - Enable "Developer mode" (toggle in top-right)
   - Click "Load unpacked"
   - Select the `extension/` folder from this repo
   - The extension should appear in your toolbar

   **Firefox:**
   - Open `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Select `extension/manifest.json`
   - The extension should appear in your toolbar

3. **Navigate to a Cardmarket cart page**
   - Go to https://www.cardmarket.com/en/Magic/Cart
   - The CartForge icon should appear in the extension menu
   - Click it to open the popup

## Usage

### Basic Workflow

1. **Add items to your Cardmarket cart** as normal
2. **Click the CartForge extension icon** in your browser toolbar
3. **View extracted data** in the popup preview
4. **Click "Copy to Clipboard"** to copy the extracted cart as JSON
5. **Open CartForge** (click the button in the popup)
6. **Paste the JSON** into the cart input field
7. **Review and optimize** your shopping plan

### What Gets Extracted

The extension captures:
- ✅ Seller names and countries
- ✅ Shipping methods and costs
- ✅ Trustee fees
- ✅ Card names, conditions, quantities, prices
- ✅ Total values per seller
- ✅ Availability warnings
- ❌ Dynamic pricing (not reliable from static page snapshot)

## Development

### Project Structure

```
extension/
├── manifest.json              # Extension configuration
├── package.json               # Node dependencies
├── src/
│   ├── selectors.json         # DOM selectors (easy to update)
│   ├── extractor.mjs          # Core extraction logic
│   ├── content-script.mjs     # Runs on Cardmarket pages
│   ├── popup.mjs              # Popup UI logic
│   └── background.js          # Service worker
├── public/
│   ├── popup.html             # Popup interface
│   └── icons/                 # Extension icons (16x16, 48x48, 128x128)
└── tests/
    ├── fixtures/
    │   └── dom-utils.mjs       # Mock cart data for testing
    └── extractor.test.mjs      # Unit tests
```

### Running Tests

```bash
# Install dependencies (one-time)
npm install --prefix extension

# Run tests
npm --prefix extension test

# Watch mode (re-run on file changes)
npm --prefix extension run test:watch
```

### Testing Locally

1. **Make changes** to any `.mjs` or `.html` files in the extension
2. **Reload the extension** in your browser:
   - Chrome/Edge: Go to `chrome://extensions`, find CartForge, click the reload icon
   - Firefox: Go to `about:debugging`, find CartForge, click "Reload"
3. **Test on a real Cardmarket cart page** to see changes

### Updating DOM Selectors

If Cardmarket changes their page structure:

1. **Open the cart page** in your browser
2. **Inspect the HTML** (right-click → "Inspect Element")
3. **Find the new selector** for the changed element
4. **Update `src/selectors.json`** with the new selector(s)
5. **Add a test fixture** in `tests/fixtures/dom-utils.mjs`
6. **Run tests** to validate extraction still works

Example: If seller names move from `.seller-name` to `.vendor-name`:
```json
"sellerName": [
  ".vendor-name",              // ← New selector (tried first)
  ".seller-name",              // ← Fallback (old)
  "[itemprop='name']"          // ← Fallback (semantic)
]
```

## Troubleshooting

### "Extraction failed" error

**Cause:** Extension can't find cart data on the page  
**Solutions:**
- Make sure you're on a Cardmarket cart page (URL includes `/Cart`)
- Wait for the page to fully load before clicking the extension icon
- Try reloading the page and extension
- Check if Cardmarket changed their page structure (update selectors)

### "Communication failed" error

**Cause:** Extension can't communicate with the content script  
**Solutions:**
- Reload the extension (`chrome://extensions` → reload CartForge)
- Make sure you clicked the extension icon on a Cardmarket page (not other sites)
- Check the browser console for errors (F12 → Console tab)

### Data looks incomplete

**Cause:** Some fields weren't found on the page  
**Solutions:**
- Make sure all items are fully visible (scroll to load lazy-loaded items)
- Check if Cardmarket changed the page layout
- Some sellers might be missing country/shipping info - verify on Cardmarket

### "Copy to Clipboard" fails silently

**Cause:** Browser clipboard permission not granted  
**Solutions:**
- Check browser permissions for CartForge extension
- Try copying a smaller amount of data first
- Use fallback: manually select and copy the JSON from the popup

## Architecture

### Content Script (`src/content-script.mjs`)
- Runs in the Cardmarket page context
- Extracts cart data using `extractor.mjs`
- Communicates with popup via Chrome message API
- Cached data available for quick popup loading

### Extractor (`src/extractor.mjs`)
- Pure extraction logic (no DOM dependencies for tests)
- Fallback selectors for robustness
- Validates extracted data
- Returns structured cart object

### Popup (`src/popup.mjs` + `public/popup.html`)
- Requests extraction from content script
- Displays preview of extracted data
- Handles copy-to-clipboard
- Shows errors and warnings

### Background Service Worker (`src/background.js`)
- Minimal required by Manifest v3
- Future: session state, statistics, permissions

## Browser Support

| Browser | Status | Notes |
|---------|--------|-------|
| Chrome  | ✅ Supported | Primary target, fully tested |
| Edge    | ✅ Supported | Chromium-based, same as Chrome |
| Firefox | ✅ Supported | Manifest v3 compatible |
| Safari  | ⚠️ Planned | Requires native app wrapper (v2.0) |

## Known Limitations

- **Static snapshot only** - Extension reads the current page, not live prices
- **Mobile optimizations** - Some selectors may need adjustment for mobile
- **Lazy loading** - Extension tries to trigger it, but may not capture all items if page isn't fully scrolled
- **Cardmarket structure** - If Cardmarket significantly redesigns, selectors may need updates

## Contributing

Found a bug? Want to improve the extension?

1. **Report issues** in [GitHub Issues](https://github.com/Mezzy0710/cardmarket-cart-optimizer/issues)
2. **Test on different layouts** (desktop/mobile/language)
3. **Update DOM selectors** if Cardmarket changes
4. **Improve extraction logic** in `src/extractor.mjs`
5. **Add tests** for edge cases

## License

MIT - See LICENSE file in the main CartForge repository

## Roadmap

- **v1.0** (Current) - DOM extraction + clipboard copy
- **v1.1** - localStorage bridge for seamless auto-fill
- **v1.2** - Seller rating extraction
- **v2.0** - One-click cart auto-apply (browser form submission)
- **v2.1** - Safari support (native app wrapper)
