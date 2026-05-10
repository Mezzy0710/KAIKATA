/**
 * Cart data extraction from Cardmarket DOM
 * Reusable across content script and tests
 */

import selectors from './selectors.json' assert { type: 'json' };

/**
 * Try multiple selectors in order, return first match
 * @param {Element} container - Parent element to search within
 * @param {string[]} selectorList - List of CSS selectors to try
 * @returns {Element|null} - First matching element or null
 */
function querySelectorFallback(container, selectorList) {
  if (!container || !Array.isArray(selectorList)) return null;

  for (const selector of selectorList) {
    try {
      const el = container.querySelector(selector);
      if (el) return el;
    } catch (e) {
      // Invalid selector, continue to next
      continue;
    }
  }
  return null;
}

/**
 * Safely extract text content, trimmed
 */
function extractText(element) {
  if (!element) return null;
  const text = element.textContent?.trim();
  return text ? text : null;
}

/**
 * Safely extract monetary value (EUR format)
 * Accepts: "€1.50", "1,50", "1.50", etc.
 */
function extractMoney(element) {
  if (!element) return null;
  const text = element.textContent || '';

  // Remove currency symbol and whitespace
  const cleaned = text.replace(/[€$\s]/g, '').replace(',', '.');
  const value = parseFloat(cleaned);

  return Number.isFinite(value) ? value : null;
}

/**
 * Safely extract integer quantity
 */
function extractQuantity(element) {
  if (!element) return null;

  // Try input value first
  if (element.tagName === 'INPUT') {
    const value = parseInt(element.value, 10);
    return Number.isFinite(value) ? value : null;
  }

  // Try parsing from text
  const text = element.textContent?.trim();
  const value = parseInt(text, 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Extract card item from a row element
 */
function extractCard(cardElement) {
  const cardName = extractText(querySelectorFallback(cardElement, selectors.cardName));
  const condition = extractText(querySelectorFallback(cardElement, selectors.cardCondition));
  const quantityEl = querySelectorFallback(cardElement, selectors.cardQuantity);
  const quantity = extractQuantity(quantityEl);
  const price = extractMoney(querySelectorFallback(cardElement, selectors.cardPrice));

  if (!cardName || !quantity || !price) {
    return null; // Skip incomplete items
  }

  return {
    cardName,
    condition: condition || 'Unknown',
    quantity,
    price
  };
}

/**
 * Extract seller data and their items
 */
function extractSeller(sellerElement) {
  const sellerName = extractText(querySelectorFallback(sellerElement, selectors.sellerName));
  const country = extractText(querySelectorFallback(sellerElement, selectors.sellerCountry));
  const shippingMethod = extractText(querySelectorFallback(sellerElement, selectors.sellerShippingMethod));
  const articleValue = extractMoney(querySelectorFallback(sellerElement, selectors.sellerArticleTotal));
  const shippingCost = extractMoney(querySelectorFallback(sellerElement, selectors.sellerShippingCost));
  const trusteeFee = extractMoney(querySelectorFallback(sellerElement, selectors.sellerTrusteeFee));

  // Extract all items for this seller
  const itemElements = sellerElement.querySelectorAll(selectors.cartItemRow[0]);
  const items = [];

  for (const itemEl of itemElements) {
    const card = extractCard(itemEl);
    if (card) items.push(card);
  }

  if (!sellerName || items.length === 0) {
    return null; // Skip sellers with no valid data
  }

  return {
    sellerName,
    sellerCountry: country || 'Unknown',
    shippingMethod: shippingMethod || 'Not specified',
    items,
    articleValue: articleValue ?? 0,
    shippingCost: shippingCost ?? 0,
    trusteeFee: trusteeFee ?? 0
  };
}

/**
 * Extract entire cart from page
 * @returns {Object} Cart data or error
 */
export function extractCart() {
  const sellers = [];
  const errors = [];
  const warnings = [];

  try {
    // Find all seller blocks
    const sellerElements = document.querySelectorAll(selectors.sellerBlock[0]);

    if (sellerElements.length === 0) {
      errors.push('No sellers found on page. Make sure you are on the Cardmarket cart page.');
      return { success: false, sellers: [], errors, warnings, extractedAt: Date.now() };
    }

    // Ensure page is fully loaded (scroll to trigger lazy loading)
    window.scrollTo(0, document.body.scrollHeight);

    // Extract each seller
    for (const sellerEl of sellerElements) {
      const seller = extractSeller(sellerEl);
      if (seller) {
        sellers.push(seller);
      } else {
        warnings.push(`Failed to extract complete data from a seller block`);
      }
    }

    if (sellers.length === 0) {
      errors.push('No valid sellers with items were found');
      return { success: false, sellers: [], errors, warnings, extractedAt: Date.now() };
    }

    return {
      success: true,
      sellers,
      errors,
      warnings,
      extractedAt: Date.now(),
      url: window.location.href,
      pageTitle: document.title
    };
  } catch (error) {
    console.error('[CartForge] Extraction error:', error);
    errors.push(`Extraction failed: ${error.message}`);
    return { success: false, sellers: [], errors, warnings, extractedAt: Date.now() };
  }
}

/**
 * Format extracted cart for display
 */
export function formatCartForDisplay(cartData) {
  if (!cartData.success) {
    return {
      summary: 'Extraction failed',
      details: cartData.errors.join('; ')
    };
  }

  const sellerCount = cartData.sellers.length;
  const itemCount = cartData.sellers.reduce((sum, s) => sum + s.items.length, 0);
  const totalValue = cartData.sellers.reduce((sum, s) => sum + s.articleValue, 0);

  return {
    summary: `${sellerCount} seller${sellerCount !== 1 ? 's' : ''}, ${itemCount} item${itemCount !== 1 ? 's' : ''}, €${totalValue.toFixed(2)}`,
    sellerCount,
    itemCount,
    totalValue,
    sellers: cartData.sellers.map(s => ({
      name: s.sellerName,
      country: s.sellerCountry,
      itemCount: s.items.length
    }))
  };
}

/**
 * Validate extracted cart data
 */
export function validateCart(cartData) {
  const issues = [];

  if (!cartData.success) {
    return { valid: false, issues: cartData.errors };
  }

  // Check each seller
  for (const seller of cartData.sellers) {
    if (!seller.sellerName) issues.push(`Seller missing name`);
    if (!seller.items || seller.items.length === 0) issues.push(`${seller.sellerName}: no items`);

    // Validate items
    for (const item of seller.items || []) {
      if (!item.cardName) issues.push(`${seller.sellerName}: item missing card name`);
      if (!Number.isFinite(item.quantity) || item.quantity < 1) {
        issues.push(`${seller.sellerName}: ${item.cardName || 'unknown'} invalid quantity`);
      }
      if (!Number.isFinite(item.price) || item.price < 0) {
        issues.push(`${seller.sellerName}: ${item.cardName || 'unknown'} invalid price`);
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings: cartData.warnings
  };
}
