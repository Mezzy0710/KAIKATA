/**
 * Scryfall API Integration Module
 *
 * Provides card name lookups with caching, error handling, and EUR/USD price support.
 * All prices are cached in-memory for the duration of the session.
 */

// In-memory cache: Map<normalizedCardName, referencePriceData>
const priceCache = new Map();

// Rate limiting: Scryfall allows 10 req/s, we'll use 100ms delay
const SCRYFALL_RATE_LIMIT_MS = 100;
let lastRequestTime = 0;

/**
 * Initialize Scryfall cache (placeholder for future localStorage integration)
 */
export async function initScryallCache() {
  // Currently a no-op, but reserved for future v2 localStorage support
  priceCache.clear();
  lastRequestTime = 0;
}

/**
 * Get reference price for a single card (with caching)
 *
 * @param {string} cardName - The Magic card name to look up
 * @returns {Promise<{name, price, currency, source, isApproximate, error} | null>}
 */
export async function getReferencePrice(cardName) {
  if (!cardName || typeof cardName !== 'string') {
    return { error: true, reason: 'invalid_input' };
  }

  const normalizedName = normalizeCardName(cardName);

  // Check cache first
  if (priceCache.has(normalizedName)) {
    return priceCache.get(normalizedName);
  }

  // Rate limiting: enforce 100ms minimum between requests
  const timeSinceLastRequest = Date.now() - lastRequestTime;
  if (timeSinceLastRequest < SCRYFALL_RATE_LIMIT_MS) {
    await new Promise(resolve =>
      setTimeout(resolve, SCRYFALL_RATE_LIMIT_MS - timeSinceLastRequest)
    );
  }

  try {
    lastRequestTime = Date.now();

    // Fetch from Scryfall API using fuzzy search
    const response = await fetch(
      `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`,
      { signal: AbortSignal.timeout(5000) } // 5s timeout
    );

    if (response.status === 404) {
      const result = { error: true, reason: 'not_found' };
      priceCache.set(normalizedName, result);
      return result;
    }

    if (!response.ok) {
      const result = {
        error: true,
        reason: response.status === 429 ? 'rate_limited' : 'api_error'
      };
      priceCache.set(normalizedName, result);
      return result;
    }

    const cardData = await response.json();

    // Extract price: prefer EUR, fallback to USD
    const price = cardData.prices?.eur || cardData.prices?.usd;
    const currency = cardData.prices?.eur ? 'EUR' : 'USD';

    if (!price) {
      const result = { error: true, reason: 'no_price_available' };
      priceCache.set(normalizedName, result);
      return result;
    }

    const result = {
      name: cardData.name,
      price: parseFloat(price),
      currency: currency,
      source: 'Scryfall',
      isApproximate: false, // For now; v2 can detect multiple results
      error: false
    };

    priceCache.set(normalizedName, result);
    return result;

  } catch (error) {
    const errorReason = error.name === 'AbortError' ? 'timeout' : 'network_error';
    const result = { error: true, reason: errorReason };
    priceCache.set(normalizedName, result);
    return result;
  }
}

/**
 * Bulk lookup for multiple cards (optimized with caching)
 *
 * @param {string[]} cardNames - Array of card names to look up
 * @returns {Promise<Map<normalizedName, referencePriceData>>}
 */
export async function enrichCardsWithReferencePrices(cardNames) {
  const results = new Map();

  if (!Array.isArray(cardNames) || cardNames.length === 0) {
    return results;
  }

  // Get unique card names
  const uniqueNames = [...new Set(cardNames)];

  // Look up each card (with caching)
  for (const cardName of uniqueNames) {
    const result = await getReferencePrice(cardName);
    const normalizedName = normalizeCardName(cardName);
    results.set(normalizedName, result);
  }

  return results;
}

/**
 * Clear the in-memory cache (useful for testing)
 */
export function clearCache() {
  priceCache.clear();
  lastRequestTime = 0;
}

/**
 * Get cache statistics (useful for debugging)
 *
 * @returns {{size, entries}}
 */
export function getCacheStats() {
  const entries = {};
  priceCache.forEach((value, key) => {
    entries[key] = value.error ? 'error' : `${value.price} ${value.currency}`;
  });
  return {
    size: priceCache.size,
    entries: entries
  };
}

/**
 * Normalize a card name for cache key consistency
 *
 * @param {string} cardName - The card name to normalize
 * @returns {string} Normalized card name (lowercase, trimmed)
 */
function normalizeCardName(cardName) {
  return (cardName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' '); // Collapse multiple spaces
}
