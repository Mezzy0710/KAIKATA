/**
 * Price Verdict Module
 *
 * Calculates price deltas and assigns color-coded verdicts.
 * Shows objective data (percentage delta) without subjective labels.
 */

import { escapeHtml } from "./utils.mjs";

/**
 * Calculate absolute and percentage delta between selected and reference price
 *
 * @param {number} selectedPrice - The price the user selected
 * @param {number} referencePrice - The reference price from Scryfall
 * @returns {{absolute: number, percentage: number, direction: string}}
 */
export function calculatePriceDelta(selectedPrice, referencePrice) {
  if (
    referencePrice === null ||
    referencePrice === undefined ||
    referencePrice === 0 ||
    selectedPrice === null ||
    selectedPrice === undefined
  ) {
    return null;
  }

  const absolute = selectedPrice - referencePrice;
  const percentage = (absolute / referencePrice) * 100;

  return {
    absolute: absolute,
    percentage: percentage,
    direction: absolute < -0.005 ? 'cheaper' : absolute > 0.005 ? 'expensive' : 'same'
  };
}

/**
 * Get color for a price delta
 *
 * @param {number} deltaPct - The percentage delta
 * @returns {string} Color code: 'positive' (green), 'neutral' (gray), 'negative' (red)
 */
export function getDeltaColor(deltaPct) {
  if (deltaPct === null || deltaPct === undefined) {
    return 'neutral';
  }

  // Consider ±1% as neutral
  if (deltaPct >= -1 && deltaPct <= 1) {
    return 'neutral';
  }

  // Negative delta = cheaper = positive (green)
  if (deltaPct < 0) {
    return 'positive';
  }

  // Positive delta = more expensive = negative (red)
  return 'negative';
}

/**
 * Format delta for display
 *
 * @param {number} deltaPct - The percentage delta
 * @returns {string} Formatted string like "+20.0%" or "−10.0%"
 */
export function formatDeltaDisplay(deltaPct) {
  if (deltaPct === null || deltaPct === undefined) {
    return '—';
  }

  const sign = deltaPct > 0 ? '+' : deltaPct < 0 ? '−' : '±';
  const absValue = Math.abs(deltaPct).toFixed(1);
  return `${sign}${absValue}%`;
}

/**
 * Enrich a card object with reference price data
 *
 * @param {object} card - Card object {cardName, price, ...}
 * @param {object} refData - Reference data from Scryfall {price, currency, ...}
 * @returns {object} Enriched card with delta and color
 */
export function enrichCardWithReference(card, refData) {
  if (!refData || refData.error) {
    return {
      ...card,
      referencePrice: null,
      referenceCurrency: null,
      delta: null,
      deltaColor: 'neutral',
      deltaDisplay: '—',
      hasReference: false
    };
  }

  const selectedPrice = Number(card.price ?? card.unitPrice);
  const referencePrice = Number(refData.price);
  const delta = calculatePriceDelta(
    Number.isFinite(selectedPrice) ? selectedPrice : null,
    Number.isFinite(referencePrice) ? referencePrice : null
  );
  const color = getDeltaColor(delta?.percentage);
  const display = formatDeltaDisplay(delta?.percentage);

  return {
    ...card,
    referencePrice: refData.price,
    referenceCurrency: refData.currency,
    referenceSource: refData.source,
    referenceIsApproximate: refData.isApproximate || false,
    delta: delta,
    deltaColor: color,
    deltaDisplay: display,
    hasReference: true
  };
}

/**
 * Check if any cards have high prices (20%+ more expensive than reference)
 *
 * @param {array} cards - Array of enriched card objects
 * @param {number} threshold - Percentage threshold (default 0.2 = 20%)
 * @returns {boolean} True if any card has delta >= threshold
 */
export function hasHighPricedCards(cards, threshold = 0.2) {
  if (!Array.isArray(cards)) {
    return false;
  }

  return cards.some(card => {
    if (!card.delta || !card.delta.percentage) {
      return false;
    }
    return card.delta.percentage >= threshold * 100; // Convert to percentage points
  });
}

/**
 * Generate informational note about high-priced cards
 *
 * @param {array} cards - Array of enriched card objects
 * @param {number} threshold - Percentage threshold (default 0.2 = 20%)
 * @returns {string} Informational note HTML string
 */
export function generateHighPriceNote(cards, threshold = 0.2) {
  const highPricedCards = cards.filter(card => {
    if (!card.delta || !card.delta.percentage) {
      return false;
    }
    return card.delta.percentage >= threshold * 100;
  });

  if (highPricedCards.length === 0) {
    return '';
  }

  const cardList = highPricedCards
    .map(card => `<li>${escapeHtml(card.cardName)} (+${card.delta.percentage.toFixed(1)}%)</li>`)
    .join('');

  return `
    <div class="high-price-note">
      <div class="note-title">Some selected cards are above reference price</div>
      <div class="note-body">
        ${highPricedCards.length} card(s) show +20% or higher prices vs. Scryfall reference:
        <ul>
          ${cardList}
        </ul>
        <p>Consider checking for additional offers or alternative printings on Cardmarket.</p>
      </div>
    </div>
  `;
}
