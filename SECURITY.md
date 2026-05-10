# Security Guide - Cardmarket Cart Optimizer

## Overview
This document outlines security considerations and recommended configurations for deploying the Cardmarket Cart Optimizer.

---

## Content Security Policy (CSP)

### Current Security Posture
The application is built with **vanilla JavaScript** (no frameworks) and:
- ✅ Properly escapes all HTML special characters using `escapeHtml()` 
- ✅ Uses `escapeAttribute()` for attribute values
- ✅ Avoids `eval()`, `innerHTML` with untrusted data, and DOM clobbering
- ✅ Implements input validation on numeric/money fields
- ✅ Disables automatic Scryfall cache loading if feature is disabled

### Recommended CSP Header

For **GitHub Pages deployment**, add this header via your web server configuration:

```
Content-Security-Policy: 
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  font-src 'self';
  connect-src 'self' https://api.scryfall.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self'
```

### CSP Header Explanation

| Directive | Value | Purpose |
|-----------|-------|---------|
| `default-src` | `'self'` | Default policy: only same-origin resources |
| `script-src` | `'self'` | JS only from same origin (no inline scripts) |
| `style-src` | `'self' 'unsafe-inline'` | CSS from same origin + inline styles (for dynamic theming) |
| `img-src` | `'self' data:` | Images from same origin + data URIs |
| `connect-src` | `'self' https://api.scryfall.com` | Only same-origin + Scryfall API for price lookups |
| `frame-ancestors` | `'none'` | Block embedding in iframes (clickjacking protection) |
| `base-uri` | `'self'` | Prevent `<base>` tag injection |
| `form-action` | `'self'` | Forms only submit to same origin |

### GitHub Pages Configuration

Unfortunately, GitHub Pages does **not** allow custom headers. To use CSP on GitHub Pages, consider:

**Option 1: Proxy via Cloudflare** (Recommended for security)
```
Set up Cloudflare's free plan in front of your GitHub Pages site.
In Cloudflare dashboard:
- Rules → Transform → Modify Response Headers
- Add the CSP header above
```

**Option 2: Meta Tag Fallback** (Limited protection)
Add this to `<head>` in `index.html` (note: meta tags have limitations):
```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.scryfall.com">
```

---

## Input Validation

### User-Controlled Input Points

**Cart Text Parsing** ✅
- Parser extracts seller names, card names, prices
- All names escaped before DOM insertion via `escapeHtml()`
- Numbers validated with `parseMoney()` and `Number.parseInt()`

**Manual Cart Editing** ✅
- Seller name: text input, escaped on render
- Card name: text input, escaped on render
- Prices: numeric input, parsed and validated
- Quantities: numeric input with `Math.max(1, ...)`

**Country Selection** ✅
- Dropdown with predefined options (COUNTRY_OPTIONS)
- No user text entry

### Escaping Implementation

```javascript
// src/utils.mjs
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
```

---

## External API Integration

### Scryfall API
- **Purpose**: Reference card prices for comparison
- **Encryption**: HTTPS only
- **Rate Limiting**: Scryfall enforces rate limits; caching prevents abuse
- **Data Handling**: Prices are public data, no authentication needed
- **Failure Handling**: Gracefully degrades if API unavailable

```javascript
// Scryfall is optional - feature can be disabled
if (state.referenceCheckEnabled) {
  initScryallCache().catch(error => {
    console.error('Failed to initialize Scryfall cache:', error);
    // App continues without price lookup
  });
}
```

---

## Deployment Checklist

- [ ] **HTTPS Only**: Ensure deployment URL uses HTTPS (GitHub Pages: automatic)
- [ ] **CSP Headers**: Configure via Cloudflare or alternative
- [ ] **SRI (Subresource Integrity)**: If loading any external scripts (currently none)
- [ ] **CORS**: Not needed (client-side only)
- [ ] **Session Security**: No user accounts (out of scope)
- [ ] **Data Privacy**: Local storage only; no server uploads

---

## Testing

### Manual Security Testing

1. **XSS Prevention**
   ```javascript
   // Paste into cart input:
   <script>alert('XSS')</script>
   
   // Expected: Script tags displayed as text, not executed
   ```

2. **HTML Injection**
   ```javascript
   // Add seller name with HTML:
   Seller<img src=x onerror=alert('XSS')>
   
   // Expected: Seller name displayed with escaped HTML
   ```

3. **JavaScript Console**
   - No errors from CSP violations
   - No unhandled exceptions

### Automated Tests
```bash
# Run test suite (includes XSS verification via escaping tests)
./tests/run-all.sh

# Run with performance metrics
./tests/run-all.sh --perf
```

---

## Known Limitations

- **Reference Pricing**: Relies on Scryfall API availability
- **Country Inference**: Based on shipping method keywords (probabilistic)
- **No Authentication**: Future versions may add user accounts (requires additional security)
- **Local Storage Only**: Cart data not backed up; clearing browser storage loses data

---

## Future Security Considerations (v1.2+)

- [ ] Add sub-resource integrity (SRI) if external dependencies added
- [ ] Implement service worker for offline support + additional caching control
- [ ] Add user authentication (if account feature added)
- [ ] Implement rate limiting on client (prevent Scryfall API abuse)
- [ ] Add telemetry opt-out (if usage stats added)
- [ ] Regular security audits

---

## Security Contact

For security issues, please report privately via GitHub Security Advisory.
Do not open public issues for security vulnerabilities.

---

**Last Updated**: May 10, 2026  
**Version**: 1.1  
**Status**: Production Ready
