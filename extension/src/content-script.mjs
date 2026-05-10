/**
 * Content script runs in Cardmarket page context
 * Extracts cart data and communicates with popup via messaging
 */

import { extractCart, formatCartForDisplay, validateCart } from './extractor.mjs';

// Cache extracted data for popup to retrieve
let cachedCartData = null;

/**
 * Perform extraction and cache result
 */
function performExtraction() {
  console.log('[CartForge] Extracting cart data...');
  cachedCartData = extractCart();

  const validation = validateCart(cachedCartData);
  console.log('[CartForge] Extraction complete:', {
    success: cachedCartData.success,
    sellers: cachedCartData.sellers.length,
    items: cachedCartData.sellers.reduce((sum, s) => sum + s.items.length, 0),
    valid: validation.valid,
    issues: validation.issues.length
  });

  return cachedCartData;
}

/**
 * Listen for messages from popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[CartForge] Message received:', request.action);

  switch (request.action) {
    case 'extractCart':
      try {
        const cartData = performExtraction();
        sendResponse({ success: true, data: cartData });
      } catch (error) {
        console.error('[CartForge] Extraction error:', error);
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'getCartData':
      // Return cached data (already extracted)
      if (cachedCartData) {
        sendResponse({ success: true, data: cachedCartData });
      } else {
        const cartData = performExtraction();
        sendResponse({ success: true, data: cartData });
      }
      break;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }

  return true; // Keep message channel open for async response
});

/**
 * Perform initial extraction on page load
 */
function initialize() {
  console.log('[CartForge] Content script loaded');

  // Check if we're on a Cardmarket cart page
  const isCartPage = window.location.pathname.includes('/Cart') ||
                     window.location.pathname.includes('/Sell');

  if (isCartPage) {
    console.log('[CartForge] Cart page detected, initializing...');
    // Wait a moment for page to fully render
    setTimeout(() => {
      performExtraction();
    }, 500);
  } else {
    console.log('[CartForge] Not on cart page, extension disabled');
  }
}

// Initialize on script load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
