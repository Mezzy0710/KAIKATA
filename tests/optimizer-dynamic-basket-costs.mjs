import assert from "node:assert/strict";
import { __testing } from "../src/app.mjs";

function makeSeller(sellerName, sellerCountry, items, overrides = {}) {
  const normalizedItems = items.map((item, index) => ({
    id: `${sellerName}-${index}`,
    cardName: item.cardName,
    condition: item.condition || "Near Mint",
    quantity: item.quantity ?? 1,
    price: item.price,
    rawLine: `${item.quantity ?? 1}x ${item.cardName} ${item.price}`
  }));

  return {
    sellerName,
    sellerCountry,
    countrySource: "manual",
    shippingMethod: overrides.shippingMethod || "",
    trackingStatus: overrides.trackingStatus || "unknown",
    shippingValue: undefined,
    trusteeValue: undefined,
    articleValue: normalizedItems.reduce((sum, item) => sum + item.quantity * item.price, 0),
    total: null,
    items: normalizedItems,
    ...overrides
  };
}

function shippingRow(country, method, price, options = {}) {
  return {
    country,
    destination: "Germany",
    method,
    price,
    tracked: options.tracked || false,
    isRegistered: options.isRegistered || false,
    max_weight_g: options.maxWeightG,
    max_value_eur: options.maxValueEur
  };
}

function setShippingData(rows) {
  __testing.state.shippingData = rows;
  __testing.state.variantPreferences = {};
}

function optimize(sellers, desiredQuantityByCard) {
  const groups = __testing.buildOfferGroups(sellers);
  __testing.state.desiredQuantityByCard = { ...desiredQuantityByCard };
  return __testing.optimizeCart(sellers, groups);
}

function offersByCard(result) {
  return new Map(result.selectedOffers.map((offer) => [offer.cardName, offer.sellerName]));
}

function assertMoney(actual, expected, message) {
  assert.equal(Math.round(Number(actual) * 100) / 100, expected, message);
}

function baseUntrackedCountries(countries, price = 1.5) {
  return countries.map((country) => shippingRow(country, "Untracked Letter", price, { tracked: false }));
}

// Scenario 1: Order value at/above EUR 25.00 triggers registered shipping and Trustee.
setShippingData([
  shippingRow("Germany", "Untracked Letter", 1.5, { tracked: false }),
  shippingRow("Germany", "Registered Letter", 4.5, { tracked: true, isRegistered: true }),
  ...baseUntrackedCountries(["Italy", "France"])
]);
let sellers = [
  makeSeller("Seller A", "Germany", [
    { cardName: "Thoughtseize", quantity: 1, price: 12.5 },
    { cardName: "Fatal Push", quantity: 1, price: 12.6 }
  ]),
  makeSeller("Seller B", "Italy", [{ cardName: "Thoughtseize", quantity: 1, price: 12.8 }]),
  makeSeller("Seller C", "France", [{ cardName: "Fatal Push", quantity: 1, price: 12.9 }])
];
let result = optimize(sellers, { Thoughtseize: 1, "Fatal Push": 1 });
let selected = offersByCard(result);
assert.equal(selected.get("Thoughtseize"), "Seller B");
assert.equal(selected.get("Fatal Push"), "Seller A");
assertMoney(result.selectedTotal, 28.4, "Scenario 1 should prefer the cheapest dynamic partial split.");

// Scenario 2: Bundling remains correct while the seller basket stays below threshold.
setShippingData([
  shippingRow("Germany", "Untracked Letter", 1.5, { tracked: false }),
  shippingRow("Germany", "Registered Letter", 4.5, { tracked: true, isRegistered: true }),
  ...baseUntrackedCountries(["Italy", "France"])
]);
sellers = [
  makeSeller("Seller A", "Germany", [
    { cardName: "Lightning Bolt", quantity: 1, price: 9.9 },
    { cardName: "Counterspell", quantity: 1, price: 9.9 }
  ]),
  makeSeller("Seller B", "Italy", [{ cardName: "Lightning Bolt", quantity: 1, price: 9.7 }]),
  makeSeller("Seller C", "France", [{ cardName: "Counterspell", quantity: 1, price: 9.7 }])
];
result = optimize(sellers, { "Lightning Bolt": 1, Counterspell: 1 });
selected = offersByCard(result);
assert.equal(selected.get("Lightning Bolt"), "Seller A");
assert.equal(selected.get("Counterspell"), "Seller A");
assertMoney(result.selectedTotal, 21.3, "Scenario 2 should prefer Seller A bundle.");

// Scenario 3: Card count pushes Seller A into a higher shipping tier.
setShippingData([
  shippingRow("Germany", "Small Letter", 1.5, { tracked: false, maxWeightG: 31 }),
  shippingRow("Germany", "Large Letter", 5.0, { tracked: false, maxWeightG: 72 }),
  shippingRow("Italy", "Untracked Letter", 1.5, { tracked: false })
]);
sellers = [
  makeSeller("Seller A", "Germany", [
    { cardName: "Bulk Common", quantity: 17, price: 0.1 },
    { cardName: "Counterspell", quantity: 1, price: 1.0 }
  ]),
  makeSeller("Seller B", "Italy", [{ cardName: "Counterspell", quantity: 1, price: 1.2 }])
];
result = optimize(sellers, { "Bulk Common": 17, Counterspell: 1 });
selected = offersByCard(result);
assert.equal(selected.get("Bulk Common"), "Seller A");
assert.equal(selected.get("Counterspell"), "Seller B");
assertMoney(result.selectedTotal, 5.9, "Scenario 3 should avoid the 18-card Seller A tier.");

// Scenario 4: Trustee fee is included in the optimization objective.
// Note: the two-card data in the audit prompt has an unmentioned cheaper partial split
// in a true per-card optimizer, so this one-card fixture isolates Trustee as the decider.
setShippingData([
  shippingRow("Germany", "Untracked Letter", 1.5, { tracked: false }),
  shippingRow("Germany", "Registered Letter", 4.5, { tracked: true, isRegistered: true }),
  shippingRow("Italy", "Untracked Letter", 5.2, { tracked: false })
]);
sellers = [
  makeSeller("Seller A", "Germany", [{ cardName: "Trustee Decider", quantity: 1, price: 25.1 }]),
  makeSeller("Seller B", "Italy", [{ cardName: "Trustee Decider", quantity: 1, price: 24.5 }])
];
result = optimize(sellers, { "Trustee Decider": 1 });
selected = offersByCard(result);
assert.ok(25.1 + 4.5 < 24.5 + 5.2, "Without Trustee, Seller A would win this fixture.");
assert.equal(selected.get("Trustee Decider"), "Seller B");
assertMoney(result.selectedTotal, 29.7, "Scenario 4 should include Trustee in the objective.");

// Scenario 5: The optimum is a partial bundle, not all-from-one-seller or all-split.
setShippingData([
  shippingRow("Germany", "Untracked Letter", 1.5, { tracked: false }),
  shippingRow("Germany", "Registered Letter", 4.5, { tracked: true, isRegistered: true }),
  ...baseUntrackedCountries(["Italy", "France", "Spain"])
]);
sellers = [
  makeSeller("Seller A", "Germany", [
    { cardName: "Card A", quantity: 1, price: 8.0 },
    { cardName: "Card B", quantity: 1, price: 8.0 },
    { cardName: "Card C", quantity: 1, price: 9.1 }
  ]),
  makeSeller("Seller B", "Italy", [{ cardName: "Card A", quantity: 1, price: 8.3 }]),
  makeSeller("Seller C", "France", [{ cardName: "Card B", quantity: 1, price: 8.3 }]),
  makeSeller("Seller D", "Spain", [{ cardName: "Card C", quantity: 1, price: 9.4 }])
];
result = optimize(sellers, { "Card A": 1, "Card B": 1, "Card C": 1 });
selected = offersByCard(result);
assert.equal(result.selectedOffers.filter((offer) => offer.sellerName === "Seller A").length, 2);
assert.equal(new Set(result.selectedOffers.map((offer) => offer.sellerName)).size, 2);
assertMoney(result.selectedTotal, 28.4, "Scenario 5 should find the partial bundle optimum.");

console.log(JSON.stringify({
  scenarios: 5,
  finalScenarioTotal: result.selectedTotal,
  finalScenarioSellers: [...new Set(result.selectedOffers.map((offer) => offer.sellerName))]
}, null, 2));
