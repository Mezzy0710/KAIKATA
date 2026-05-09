/**
 * Price Verdict Logic Tests
 *
 * Tests delta calculation, color assignment, and verdict generation.
 */

import assert from "node:assert/strict";
import {
  calculatePriceDelta,
  getDeltaColor,
  formatDeltaDisplay,
  enrichCardWithReference,
  hasHighPricedCards,
  generateHighPriceNote
} from "../src/price-verdict.mjs";

console.log("Starting price verdict tests...\n");

// Test 1: Delta calculation - negative (cheaper)
console.log("Test 1: Delta calculation - negative (cheaper)");
const delta1 = calculatePriceDelta(4.50, 5.00);
assert.strictEqual(delta1.percentage, -10, "Expected -10% delta");
assert.strictEqual(delta1.direction, "cheaper", "Expected 'cheaper' direction");
assert.strictEqual(delta1.absolute, -0.50, "Expected -0.50 absolute difference");
console.log("✓ Negative delta calculated correctly\n");

// Test 2: Delta calculation - positive (expensive)
console.log("Test 2: Delta calculation - positive (expensive)");
const delta2 = calculatePriceDelta(6.00, 5.00);
assert.strictEqual(delta2.percentage, 20, "Expected +20% delta");
assert.strictEqual(delta2.direction, "expensive", "Expected 'expensive' direction");
assert.strictEqual(delta2.absolute, 1.00, "Expected +1.00 absolute difference");
console.log("✓ Positive delta calculated correctly\n");

// Test 3: Delta calculation - zero
console.log("Test 3: Delta calculation - zero (same price)");
const delta3 = calculatePriceDelta(5.00, 5.00);
assert.strictEqual(delta3.percentage, 0, "Expected 0% delta");
assert.strictEqual(delta3.direction, "same", "Expected 'same' direction");
console.log("✓ Zero delta calculated correctly\n");

// Test 4: Delta calculation - null/undefined
console.log("Test 4: Delta calculation - null reference");
const delta4 = calculatePriceDelta(5.00, null);
assert.strictEqual(delta4, null, "Expected null for null reference");
console.log("✓ Null handling correct\n");

// Test 5: Color assignment - positive (cheaper = green)
console.log("Test 5: Color assignment - positive (cheaper)");
const color1 = getDeltaColor(-10);
assert.strictEqual(color1, "positive", "Expected 'positive' color for -10%");
const color2 = getDeltaColor(-25);
assert.strictEqual(color2, "positive", "Expected 'positive' color for -25%");
console.log("✓ Negative delta colors correct (green)\n");

// Test 6: Color assignment - negative (expensive = red)
console.log("Test 6: Color assignment - negative (expensive)");
const color3 = getDeltaColor(10);
assert.strictEqual(color3, "negative", "Expected 'negative' color for +10%");
const color4 = getDeltaColor(50);
assert.strictEqual(color4, "negative", "Expected 'negative' color for +50%");
console.log("✓ Positive delta colors correct (red)\n");

// Test 7: Color assignment - neutral
console.log("Test 7: Color assignment - neutral");
const color5 = getDeltaColor(0);
assert.strictEqual(color5, "neutral", "Expected 'neutral' color for 0%");
const color6 = getDeltaColor(0.5);
assert.strictEqual(color6, "neutral", "Expected 'neutral' color for ±0.5%");
const color7 = getDeltaColor(-0.5);
assert.strictEqual(color7, "neutral", "Expected 'neutral' color for ±0.5%");
console.log("✓ Neutral threshold (±1%) correct\n");

// Test 8: Delta formatting
console.log("Test 8: Delta formatting");
const format1 = formatDeltaDisplay(-10);
assert.match(format1, /−10/, "Expected minus symbol for negative");
const format2 = formatDeltaDisplay(20);
assert.match(format2, /\+20/, "Expected plus symbol for positive");
const format3 = formatDeltaDisplay(0);
assert.match(format3, /±0/, "Expected plus-minus symbol for zero");
const format4 = formatDeltaDisplay(null);
assert.strictEqual(format4, "—", "Expected en-dash for null");
console.log("✓ Delta formatting correct\n");

// Test 9: Card enrichment with reference
console.log("Test 9: Card enrichment with reference");
const card1 = {
  cardName: "Lightning Bolt",
  price: 5.00
};
const refData1 = {
  price: 4.50,
  currency: "EUR",
  source: "Scryfall",
  isApproximate: false
};
const enriched1 = enrichCardWithReference(card1, refData1);
assert.strictEqual(enriched1.hasReference, true, "Expected hasReference to be true");
assert.strictEqual(enriched1.referencePrice, 4.50, "Expected referencePrice to match");
assert.strictEqual(enriched1.deltaColor, "negative", "Expected red color for expensive card");
assert.match(enriched1.deltaDisplay, /\+/, "Expected plus sign in display");
console.log("✓ Card enrichment successful\n");

// Test 10: Card enrichment without reference (error)
console.log("Test 10: Card enrichment without reference");
const enriched2 = enrichCardWithReference(card1, { error: true, reason: "not_found" });
assert.strictEqual(enriched2.hasReference, false, "Expected hasReference to be false");
assert.strictEqual(enriched2.referencePrice, null, "Expected null referencePrice");
assert.strictEqual(enriched2.delta, null, "Expected null delta");
console.log("✓ Error handling in enrichment correct\n");

// Test 11: High-priced card detection
console.log("Test 11: High-priced card detection");
const cards1 = [
  { delta: { percentage: 5 } },    // fair
  { delta: { percentage: 15 } },   // slightly high
  { delta: { percentage: 25 } }    // high-priced (>20%)
];
assert.strictEqual(hasHighPricedCards(cards1), true, "Expected to detect high-priced cards");

const cards2 = [
  { delta: { percentage: -10 } },  // great deal
  { delta: { percentage: 5 } },    // fair
  { delta: { percentage: 15 } }    // slightly high (not over 20%)
];
assert.strictEqual(hasHighPricedCards(cards2), false, "Expected no high-priced cards");
console.log("✓ High-priced detection working\n");

// Test 12: High-price note generation
console.log("Test 12: High-price note generation");
const cardsWithHighPrice = [
  { cardName: "Black Lotus", delta: { percentage: 35 } },
  { cardName: "Mox Pearl", delta: { percentage: 25 } }
];
const note = generateHighPriceNote(cardsWithHighPrice);
assert.match(note, /Some selected cards/i, "Expected title in note");
assert.match(note, /Black Lotus/, "Expected card name in note");
assert.match(note, /2 card/, "Expected correct card count");
console.log("✓ High-price note generation successful\n");

// Test 13: Boundary test - exactly 20%
console.log("Test 13: Boundary test - exactly 20% threshold");
const cardsExactly20 = [
  { cardName: "Test Card", delta: { percentage: 20.0 } }
];
assert.strictEqual(hasHighPricedCards(cardsExactly20), true, "Expected 20% to trigger note");
console.log("✓ Boundary test correct\n");

// Test 14: Edge case - empty arrays
console.log("Test 14: Edge case - empty arrays");
assert.strictEqual(hasHighPricedCards([]), false, "Expected false for empty array");
assert.strictEqual(generateHighPriceNote([]), "", "Expected empty string for empty array");
console.log("✓ Empty array handling correct\n");

console.log("✅ All price verdict tests passed!\n");
