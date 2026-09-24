import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildShippingIndex } from "../src/parser.mjs";
import { calculateShippingCost } from "../src/shipping.mjs";
import { buildSellerShippingRecords, parseObservedShipping } from "../src/shipping-calibration.mjs";
import { __testing } from "../src/app.mjs";

const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));
const shippingRecords = buildShippingIndex(shippingData);

function dropdown(lines) {
  return ["Select shipping method ", ...lines, "MORE SHIPPING OPTIONS", "Estimated arrival date 03.10.2026"].join("\n");
}

const CZECH_DROPDOWN = dropdown([
  "Regular Letter (2,27 €) max. Weight: 50g",
  "No tracking",
  "Letter (2,27 €)",
  "Tracked Letter (5,20 €)",
  "Tracked Parcel (26,89 €)"
]);

function seller(sellerName, sellerCountry, cardCount, shippingText = null, price = 0.5) {
  return {
    sellerName,
    sellerCountry,
    countrySource: "manual",
    shippingMethod: "",
    trackingStatus: "unknown",
    observedShipping: shippingText ? parseObservedShipping(shippingText, "2026-09-24T12:00:00Z") : null,
    items: Array.from({ length: cardCount }, (_, index) => ({
      id: `${sellerName}-${index}`,
      cardName: `${sellerName} Card ${index + 1}`,
      condition: "Near Mint",
      quantity: 1,
      price,
      rawLine: `1x ${sellerName} Card ${index + 1}\nNM\n${price} €`
    }))
  };
}

function calibrate(sellers) {
  return buildSellerShippingRecords({
    shippingRecords,
    sellers,
    cartCardCountBySeller: new Map(sellers.map((s, index) => [index, s.items.length]))
  });
}

function ship(records, country, cardCount, orderValue) {
  return calculateShippingCost({ shippingRecords: records, country, cardCount, orderValue });
}

// --- Dropdown parsing.
let observed = parseObservedShipping(CZECH_DROPDOWN, "2026-09-24T12:00:00Z");
assert.deepEqual(observed, {
  selected: { method: "Regular Letter", price: 2.27, maxWeightG: 50, tracked: false },
  categories: { letter: 2.27, trackedLetter: 5.2, trackedParcel: 26.89 },
  observedAt: "2026-09-24T12:00:00Z"
});

observed = parseObservedShipping(dropdown([
  "Carta ordinaria (Priority Letter) (2,60 €) max. Weight: 50g",
  "No tracking",
  "Letter (2,60 €)",
  "Tracked Parcel (1.008,55 €)"
]));
assert.equal(observed.categories.trackedLetter, null, "Missing category stays null.");
assert.equal(observed.categories.trackedParcel, 1008.55, "Thousands separator and comma decimals.");
assert.equal(observed.observedAt, null);

observed = parseObservedShipping(dropdown(["Letter (1,25 €)", "Tracked Parcel (7,19 €)"]));
assert.equal(observed.selected, null, "No selected line.");
assert.equal(observed.categories.letter, 1.25);

observed = parseObservedShipping(dropdown(["Kompaktbrief + Einschreiben EINWURF (3,95 €) max. Weight: 50g", "Tracked"]));
assert.equal(observed.selected.tracked, true);

assert.equal(parseObservedShipping("Standardbrief"), null, "Pasted-text carts have no dropdown.");
assert.equal(parseObservedShipping(""), null);

// --- C1: country price update, shared by every seller of that country.
let sellers = [seller("DH", "Czech Republic", 5, CZECH_DROPDOWN), seller("OtherCz", "Czech Republic", 2)];
let calibration = calibrate(sellers);
const priceUpdate = calibration.corrections.find((c) => c.kind === "price_update");
assert.deepEqual(
  { country: priceUpdate.country, sellerName: priceUpdate.sellerName, method: priceUpdate.method, maxWeightG: priceUpdate.maxWeightG, tablePrice: priceUpdate.tablePrice, observedPrice: priceUpdate.observedPrice },
  { country: "Czech Republic", sellerName: null, method: "Regular Letter", maxWeightG: 50, tablePrice: 2.34, observedPrice: 2.27 }
);
assert.equal(ship(calibration.recordsBySellerIndex.get(1), "Czech Republic", 5, 10).cost, 2.27, "Price update applies to all sellers of the country.");
assert.equal(ship(shippingRecords, "Czech Republic", 5, 10).cost, 2.34, "Input table is not mutated.");

// Disagreement: keep the higher price, record both.
sellers = [
  seller("CzA", "Czech Republic", 3, CZECH_DROPDOWN),
  seller("CzB", "Czech Republic", 3, CZECH_DROPDOWN.replace("Regular Letter (2,27 €)", "Regular Letter (2,30 €)").replace("Letter (2,27 €)", "Letter (2,30 €)")),
  seller("CzC", "Czech Republic", 3)
];
calibration = calibrate(sellers);
const updates = calibration.corrections.filter((c) => c.kind === "price_update");
assert.deepEqual(updates.map((c) => [c.observedPrice, c.applied]).sort(), [[2.27, false], [2.3, true]]);
assert.equal(ship(calibration.recordsBySellerIndex.get(2), "Czech Republic", 3, 10).cost, 2.3, "Country row uses the higher observed price.");
// CzA's own dropdown still shows a €2.27 letter, which stays available to CzA only.
assert.equal(ship(calibration.recordsBySellerIndex.get(0), "Czech Republic", 3, 10).cost, 2.27);

// No correction when the observed price equals the table.
calibration = calibrate([seller("De", "Germany", 2, dropdown([
  "Standardbrief (1,25 €) max. Weight: 20g", "No tracking", "Letter (1,25 €)", "Tracked Letter (3,95 €)", "Tracked Parcel (7,19 €)"
]))]);
assert.deepEqual(calibration.corrections, []);

// --- C2: seller-specific rows.
calibration = calibrate([seller("DH", "Czech Republic", 5, CZECH_DROPDOWN)]);
const trackedLetter = calibration.corrections.find((c) => c.kind === "category_cheaper" && c.method === "Tracked Letter");
assert.equal(trackedLetter.sellerName, "DH");
assert.equal(trackedLetter.tablePrice, null, "Czech table has no tracked letter.");
assert.equal(trackedLetter.observedPrice, 5.2);

calibration = calibrate([seller("Es", "Spain", 3, dropdown([
  "Totally Custom Letter (1,90 €) max. Weight: 20g", "No tracking", "Letter (1,90 €)", "Tracked Parcel (16,50 €)"
]))]);
const sellerMethod = calibration.corrections.find((c) => c.kind === "seller_method");
assert.deepEqual([sellerMethod.method, sellerMethod.tablePrice, sellerMethod.observedPrice], ["Totally Custom Letter", null, 1.9]);
assert.ok(!calibration.corrections.some((c) => c.method === "Tracked Parcel"), "A category price above the table adds nothing.");
const customRow = calibration.recordsBySellerIndex.get(0).find((row) => row.method === "Totally Custom Letter");
assert.deepEqual([customRow.max_weight_g, customRow.max_value, customRow.tracked], [20, 25, false]);
assert.ok(calibration.recordsBySellerIndex.get(0).length > 1, "Table rows stay in the seller's list.");

// Threshold offers ("free over 100€") are ignored, never turned into a €0 row.
calibration = calibrate([seller("Free", "Germany", 18, dropdown([
  "Free registered shipping over 100€ B (0,00 €) max. Weight: 3000g", "Tracked", "Tracked Parcel (0,00 €)"
]), 7.5)]);
assert.deepEqual(calibration.corrections, []);
assert.equal(calibration.ignored.length, 2);
assert.ok(!calibration.recordsBySellerIndex.get(0).some((row) => Number(row.price) === 0));

// --- 3a / 3b: Czech seller, tracked threshold.
calibration = calibrate([seller("DH", "Czech Republic", 5, CZECH_DROPDOWN)]);
const dhRecords = calibration.recordsBySellerIndex.get(0);
let result = ship(dhRecords, "Czech Republic", 5, 20);
assert.equal(result.tracked, false);
assert.equal(result.cost, 2.27, "3a: €20 → letter");
result = ship(dhRecords, "Czech Republic", 5, 30);
assert.equal(result.method, "Tracked Letter");
assert.equal(result.cost, 5.2, "3a: €30 → tracked letter €5.20");
result = ship(calibrate([seller("DH", "Czech Republic", 5)]).recordsBySellerIndex.get(0), "Czech Republic", 5, 30);
assert.equal(result.cost, 27.7, "3b: without observations → €27.70 parcel");

// --- 3c: German weight bracket.
assert.equal(ship(shippingRecords, "Germany", 4, 5).cost, 1.25);
assert.equal(ship(shippingRecords, "Germany", 5, 5).method, "Kompaktbrief");
assert.equal(ship(shippingRecords, "Germany", 5, 5).cost, 1.4, "3c: 4 → 5 cards moves to Kompaktbrief");

// --- 3d: Austria's 75 g tracked letter. The weight model uses Cardmarket's published
// steps (≤17 cards = 50 g, 18–40 = 100 g), so the letter covers up to 17 cards; 20 cards
// count as 100 g and fall back to the parcel (documented gap, errs on the expensive side).
result = ship(shippingRecords, "Austria", 17, 30);
assert.equal(result.method, "Brief M Priority Tracked (Einschreiben M)");
assert.equal(result.cost, 6.85, "3d: 17 cards, €30 → tracked letter");
result = ship(shippingRecords, "Austria", 20, 30);
assert.equal(result.tracked, true);
assert.equal(result.cost, 19.39, "3d: 20 cards count as 100 g → tracked parcel");

// --- 3e: removing a card from a calibrated seller drops it to a cheaper bracket.
__testing.state.shippingData = shippingData;
__testing.state.variantPreferences = {};
const bracketSellers = [
  seller("A", "Germany", 5, dropdown([
    "Kompaktbrief (1,40 €) max. Weight: 50g", "No tracking", "Letter (1,40 €)", "Tracked Letter (3,95 €)", "Tracked Parcel (7,19 €)"
  ]), 0.1),
  {
    ...seller("B", "Germany", 0),
    items: [
      { id: "B-0", cardName: "A Card 5", condition: "Near Mint", quantity: 1, price: 0.1, rawLine: "1x A Card 5\nNM\n0,10 €" },
      { id: "B-1", cardName: "Only At B", condition: "Near Mint", quantity: 1, price: 1, rawLine: "1x Only At B\nNM\n1,00 €" }
    ]
  }
];
const offerGroups = __testing.buildOfferGroups(bracketSellers);
__testing.state.desiredQuantityByCard = __testing.buildDefaultDesiredQuantities(offerGroups);
const plan = __testing.optimizeCart(bracketSellers, offerGroups);
const costA = plan.sellerCosts.find((cost) => cost.sellerIndex === 0);
assert.equal(costA.quantity, 4);
assert.equal(costA.shippingValue, 1.25, "3e: seller A ships 4 cards as Standardbrief, not the cart's Kompaktbrief");
assert.equal(plan.selectedOffers.find((offer) => offer.cardName === "A Card 5").sellerName, "B");

console.log("shipping-calibration: all assertions passed");
