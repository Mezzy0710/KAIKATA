import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseCart } from "../src/parser.mjs";
import { __testing } from "../src/app.mjs";

const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));
__testing.state.shippingData = shippingData;

function seller(sellerName, sellerCountry, items, overrides = {}) {
  return {
    sellerName,
    sellerCountry,
    countrySource: "manual",
    shippingMethod: "Standardbrief",
    trackingStatus: "untracked",
    shippingValue: 99,
    trusteeValue: 0,
    articleValue: items.reduce((sum, item) => sum + item.quantity * item.price, 0),
    total: null,
    items: items.map((item, index) => ({
      id: `${sellerName}-${index}`,
      cardName: item.cardName,
      condition: item.condition || "Near Mint",
      quantity: item.quantity,
      price: item.price,
      rawLine: `${item.quantity}x ${item.cardName} ${item.price}`
    })),
    ...overrides
  };
}

function optimize(sellers, desiredQuantityByCard = {}) {
  const groups = __testing.buildOfferGroups(sellers);
  __testing.state.desiredQuantityByCard = { ...desiredQuantityByCard };
  return __testing.optimizeCart(sellers, groups);
}

function selectedQuantity(result, cardName) {
  return result.selectedOffers
    .filter((offer) => offer.cardName === cardName)
    .reduce((sum, offer) => sum + Number(offer.requiredQuantity || offer.quantity || 1), 0);
}

const quantitySellers = [
  seller("GermanStaples", "Germany", [
    { cardName: "Sol Ring", quantity: 2, price: 1.2 },
    { cardName: "Arcane Signet", quantity: 2, price: 1.0 },
    { cardName: "Command Tower", quantity: 1, price: 0.5 }
  ]),
  seller("ItalianSingles", "Italy", [
    { cardName: "Sol Ring", quantity: 2, price: 1.1 },
    { cardName: "Arcane Signet", quantity: 2, price: 0.95 }
  ])
];

let result = optimize(quantitySellers, { "Sol Ring": 2, "Arcane Signet": 2, "Command Tower": 1 });
assert.equal(selectedQuantity(result, "Sol Ring"), 2, "Sol Ring desired quantity 2 should produce 2 planned copies when available.");
assert.equal(selectedQuantity(result, "Arcane Signet"), 2, "Arcane Signet desired quantity 2 should produce 2 planned copies when available.");
assert.equal(selectedQuantity(result, "Command Tower"), 1);

result = optimize(quantitySellers, { "Sol Ring": 1, "Arcane Signet": 2, "Command Tower": 1 });
assert.equal(selectedQuantity(result, "Sol Ring"), 1, "Changing Sol Ring from 2 to 1 should re-optimize to only 1 copy.");

result = optimize(quantitySellers, { "Sol Ring": 1, "Arcane Signet": 2, "Command Tower": 0 });
assert.equal(selectedQuantity(result, "Command Tower"), 0, "Quantity 0 should exclude a card from optimization.");
assert.ok(!result.selectedOffers.some((offer) => offer.cardName === "Command Tower"));

const consolidationSellers = [
  seller("CheapCardA", "Germany", [{ cardName: "Card A", quantity: 1, price: 1 }]),
  seller("CheapCardB", "Germany", [{ cardName: "Card B", quantity: 1, price: 1 }]),
  seller("ConsolidatedHigherCards", "Germany", [
    { cardName: "Card A", quantity: 1, price: 1.3 },
    { cardName: "Card B", quantity: 1, price: 1.3 }
  ])
];
result = optimize(consolidationSellers, { "Card A": 1, "Card B": 1 });
assert.deepEqual(new Set(result.selectedOffers.map((offer) => offer.sellerName)), new Set(["ConsolidatedHigherCards"]), "Optimizer should accept higher card prices when shipping consolidation lowers total cost.");
assert.equal(result.sellerCosts.length, 1);
assert.notEqual(result.sellerCosts[0].shippingValue, 99, "Final optimized shipping must be dynamically recalculated, not reused from parsed cart shipping.");

const thresholdSellers = [
  seller("ThresholdCheapA", "Germany", [{ cardName: "Threshold A", quantity: 1, price: 24.9 }]),
  seller("ThresholdCheapB", "Germany", [{ cardName: "Threshold B", quantity: 1, price: 0.1 }]),
  seller("BadThresholdConsolidation", "Germany", [
    { cardName: "Threshold A", quantity: 1, price: 24.95 },
    { cardName: "Threshold B", quantity: 1, price: 0.09 }
  ])
];
result = optimize(thresholdSellers, { "Threshold A": 1, "Threshold B": 1 });
assert.ok(!result.selectedOffers.every((offer) => offer.sellerName === "BadThresholdConsolidation"), "Optimizer should avoid consolidation when crossing EUR 25.00 makes tracked shipping more expensive.");

const sellerCostByIndex = new Map(result.sellerCosts.map((cost) => [cost.sellerIndex, cost]));
for (const [sellerIndex, offers] of __testing.groupSelectedOffersBySeller(result.selectedOffers)) {
  const cost = sellerCostByIndex.get(sellerIndex);
  const cardSubtotal = offers.reduce((sum, offer) => sum + Number(offer.requiredQuantity || offer.quantity || 1) * Number(offer.unitPrice), 0);
  const expectedSellerTotal = Math.round((cardSubtotal + cost.shippingValue + cost.trusteeFeeValue) * 100) / 100;
  assert.equal(Math.round((cardSubtotal + cost.totalCost) * 100) / 100, expectedSellerTotal, "Seller total should equal cards + dynamic shipping + modeled fees/trustee.");
}

const fixtureRaw = await readFile(new URL("./fixtures/sample-cart-insufficient-availability.txt", import.meta.url), "utf8");
const parsedInsufficient = parseCart(fixtureRaw, shippingData);
result = optimize(parsedInsufficient.sellers, { "Sol Ring": 3, "Arcane Signet": 1 });
assert.equal(result.statusLabel, "Action required", "Impossible desired quantities should not be presented as a complete best plan.");
assert.equal(result.insufficientGroups.length, 1);
assert.equal(result.insufficientGroups[0].cardName, "Sol Ring");
assert.ok(result.warnings.some((warning) => warning.includes("Sol Ring")));
assert.ok(__testing.buildResultWarnings(result).some((entry) => entry.severity === "critical" && /desired quantities/i.test(entry.title)));

console.log(JSON.stringify({
  quantityPlan: {
    solRing: selectedQuantity(optimize(quantitySellers, { "Sol Ring": 2, "Arcane Signet": 2 }), "Sol Ring"),
    arcaneSignet: selectedQuantity(optimize(quantitySellers, { "Sol Ring": 2, "Arcane Signet": 2 }), "Arcane Signet")
  },
  consolidationSeller: [...new Set(optimize(consolidationSellers, { "Card A": 1, "Card B": 1 }).selectedOffers.map((offer) => offer.sellerName))],
  insufficientStatus: result.statusLabel
}, null, 2));
