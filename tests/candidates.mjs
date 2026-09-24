import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { buildShippingIndex } from "../src/parser.mjs";
import { calculateShippingCost, estimateShipmentWeight } from "../src/shipping.mjs";
import { parseExtractedCartPayload } from "../src/importer.mjs";
import { buildSellerShippingRecords } from "../src/shipping-calibration.mjs";
import { buildCanonicalCartSnapshot, buildConfirmedPlan } from "../src/confirmed-plan.mjs";
import { mergeCandidateOffers } from "../src/candidates.mjs";
import { sellerCartCuts } from "../src/plan-cuts.mjs";
import { __testing } from "../src/app.mjs";

const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));
const cartText = await readFile(new URL("./fixtures/real-cart-2026-09.txt", import.meta.url), "utf8");
__testing.state.shippingData = shippingData;
__testing.state.variantPreferences = {};

function freshCart() {
  return parseExtractedCartPayload(cartText, shippingData).parsed;
}

let articleCounter = 9000000;
function captured(sellerName, sellerCountry, offers) {
  return {
    sellerName,
    sellerCountry,
    wantsListId: "25431729",
    capturedAt: "2026-09-26T10:00:00.000Z",
    stale: false,
    offers: offers.map(([cardName, price, extra = {}]) => ({
      idArticle: String(articleCounter++),
      sellerName,
      sellerCountry,
      cardName,
      expansion: extra.expansion || "Commander Masters",
      productPath: `/en/Magic/Products/Singles/Commander-Masters/${cardName.replace(/\W+/g, "-")}`,
      rarity: "Rare",
      condition: extra.condition || "Near Mint",
      conditionCode: "NM",
      language: extra.language || "English",
      foil: false,
      price,
      available: extra.available || 1,
      capturedAt: "2026-09-26T10:00:00.000Z",
      wantsListId: "25431729"
    }))
  };
}

function optimizeWith(candidateSellers) {
  const parsed = freshCart();
  const cartGroups = __testing.buildOfferGroups(parsed.sellers);
  const context = mergeCandidateOffers({
    cartSellers: parsed.sellers,
    offerGroups: cartGroups,
    candidateSellers,
    cardKey: (name) => __testing.normalizeOfferKey(name),
    variantKey: __testing.makeVariantKey,
    variantPreferences: __testing.state.variantPreferences
  });
  __testing.state.desiredQuantityByCard = __testing.buildDefaultDesiredQuantities(cartGroups);
  const start = performance.now();
  const result = __testing.optimizeCart(context.sellers, context.offerGroups);
  return { parsed, context, result, elapsed: performance.now() - start };
}

const sellerNames = (result) => result.usedSellers.map(({ seller }) => seller.sellerName).sort();
const round = (value) => Math.round(value * 100) / 100;
const BASELINE_SELLERS = ["Seller01", "Seller04", "Seller05", "Seller07", "Seller08", "Seller09", "Seller12", "Seller14", "Seller16", "Seller17", "Seller18", "Seller19", "Seller20"];

// --- (d) No candidates: identical to the cart-only plan.
const baseline = optimizeWith([]);
assert.equal(round(baseline.result.selectedTotal), 211.37);
assert.deepEqual(sellerNames(baseline.result), BASELINE_SELLERS);
assert.equal(baseline.context.sellers.length, 23);
assert.ok(baseline.result.selectedOffers.every((offer) => offer.source === "cart"));

// --- (a) Cheaper candidates at an existing seller are chosen as "add".
const seller04Before = baseline.result.sellerCosts.find((cost) => baseline.parsed.sellers[cost.sellerIndex].sellerName === "Seller04");
const scenarioA = optimizeWith([captured("Seller04", "Germany", [["Fecundity", 0.05], ["Squee, the Immortal", 0.05]])]);
const addsA = scenarioA.result.selectedOffers.filter((offer) => offer.source === "candidate");
assert.deepEqual(addsA.map((offer) => offer.cardName).sort(), ["Fecundity", "Squee, the Immortal"]);
assert.ok(addsA.every((offer) => offer.sellerName === "Seller04" && offer.sellerIndex === 3), "Same seller, same sellerIndex.");
assert.equal(scenarioA.context.stats.newSellers, 0);
assert.ok(!sellerNames(scenarioA.result).includes("Seller01"), "Seller01's two cards moved to Seller04.");
const seller04After = scenarioA.result.sellerCosts.find((cost) => cost.sellerIndex === 3);
assert.equal(seller04After.quantity, seller04Before.quantity + 2, "Seller04 ships two more cards.");
assert.equal(seller04After.estimatedWeight, estimateShipmentWeight(seller04After.quantity), "Shipping is priced for the new card count.");
assert.ok(scenarioA.result.selectedTotal < baseline.result.selectedTotal);
// Cart cuts ignore candidate offers (they are not cart rows).
const cutsA = sellerCartCuts(scenarioA.parsed.sellers[3], scenarioA.result.selectedOffers.filter((offer) => offer.sellerIndex === 3));
assert.deepEqual(cutsA.removeRows.map((row) => row.cardName).sort(), ["Food Chain", "Grave Pact", "Morbid Opportunist", "Pest Rescuer", "Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel (V.3)"]);

// --- (b) A candidate for a card that is not in the cart is ignored (count only).
const scenarioB = optimizeWith([captured("Seller04", "Germany", [["Black Lotus", 0.01], ["Fecundity", 0.05]])]);
assert.equal(scenarioB.context.stats.notInCart, 1);
assert.ok(!scenarioB.context.offerGroups.some((group) => group.offers.some((offer) => offer.cardName === "Black Lotus")));

// Articles the wants page lists although they are already in the cart are not duplicated.
const scenarioDup = optimizeWith([captured("Seller04", "Germany", [["Grave Pact", 25.99]])]);
assert.equal(scenarioDup.context.stats.alreadyInCart, 1);

// --- (c) A new seller with 5 cheap cards replaces several small sellers.
const scenarioC = optimizeWith([captured("FreshSeller", "Germany", [
  ["Food Chain", 9.0], ["Goblin Bombardment", 1.4], ["Mahadi, Emporium Master", 0.45], ["Village Rites", 0.06], ["Warren Soultrader", 7.8]
])]);
assert.equal(scenarioC.context.stats.newSellers, 1);
const usedC = sellerNames(scenarioC.result);
assert.ok(usedC.includes("FreshSeller"));
for (const replaced of ["Seller05", "Seller07", "Seller12"]) {
  assert.ok(!usedC.includes(replaced), `${replaced} should be replaced`);
}
const freshCost = scenarioC.result.sellerCosts.find((cost) => scenarioC.result.usedSellers.find((entry) => entry.sellerIndex === cost.sellerIndex)?.seller.sellerName === "FreshSeller");
assert.equal(freshCost.quantity, 5);
assert.equal(freshCost.source, "recalculated", "New sellers are priced from the table.");
console.log(`New seller: EUR ${round(baseline.result.selectedTotal)} → EUR ${round(scenarioC.result.selectedTotal)}, sellers ${baseline.result.usedSellers.length} → ${scenarioC.result.usedSellers.length}`);

// A new seller without a captured country stays unresolved.
const scenarioUnknown = optimizeWith([captured("NoFlagSeller", "", [["Food Chain", 1]])]);
assert.equal(scenarioUnknown.context.sellers.at(-1).sellerCountry, "Unknown");

// --- Shipping: calibrated cart rows only cover the cart's weight.
// Seller19 (Czech) shows a €5.20 tracked letter for its 5-card cart. With more cards
// the plan must fall back to the official table's heavier bracket.
{
  const parsed = freshCart();
  const calibration = buildSellerShippingRecords({
    shippingRecords: buildShippingIndex(shippingData),
    sellers: parsed.sellers,
    cartCardCountBySeller: new Map(parsed.sellers.map((seller, index) => [index, seller.items.reduce((sum, item) => sum + item.quantity, 0)]))
  });
  const rows = calibration.recordsBySellerIndex.get(18);
  const ship = (cards, value) => calculateShippingCost({ shippingRecords: rows, country: "Czech Republic", cardCount: cards, orderValue: value });
  assert.equal(ship(5, 30).cost, 5.2, "Cart-sized parcel: the observed tracked letter");
  assert.equal(ship(18, 30).cost, 27.7, "More cards than the cart: table parcel");
  assert.equal(ship(18, 20).method, "Regular Letter", "Untracked still uses the table's heavier letter");
  assert.equal(ship(18, 20).cost, 3.35);
}

// --- 5. Confirmed plan: schema v2 with "add" rows; v1 fields unchanged.
const planA = await buildConfirmedPlan(scenarioA.parsed, scenarioA.result, { confirmedAt: "2026-09-26T10:00:00Z" });
const basePlan = await buildConfirmedPlan(baseline.parsed, baseline.result, { confirmedAt: "2026-09-26T10:00:00Z" });
assert.equal(planA.schemaVersion, 2);
assert.equal(buildCanonicalCartSnapshot(scenarioA.parsed).schemaVersion, 1, "Cart snapshot (fingerprint) format unchanged.");
assert.equal(planA.cartFingerprint, basePlan.cartFingerprint);
const addRows = planA.rows.filter((row) => row.decision === "add");
assert.equal(addRows.length, 2);
for (const row of addRows) {
  assert.match(row.articleId, /^\d+$/);
  assert.equal(row.sellerIndex, 3);
  assert.equal(row.sellerDisplayName, "Seller04");
  assert.equal(row.addQuantity, 1);
  assert.equal(row.quantity, 0, "Not in the cart yet.");
  assert.equal(row.expansion, "Commander Masters");
  assert.equal(row.condition, "Near Mint");
  assert.equal(row.language, "English");
}
// Old consumers: cart rows keep every v1 field and value.
const cartRowsA = planA.rows.filter((row) => row.decision !== "add");
assert.equal(cartRowsA.length, basePlan.rows.length);
assert.deepEqual(Object.keys(cartRowsA[0]).sort(), Object.keys(basePlan.rows[0]).sort());
assert.equal(planA.sellers.length, 23);

const planC = await buildConfirmedPlan(scenarioC.parsed, scenarioC.result, { confirmedAt: "2026-09-26T10:00:00Z" });
const freshPlanSeller = planC.sellers.find((seller) => seller.sellerDisplayName === "FreshSeller");
assert.equal(freshPlanSeller.decision, "keep");
assert.equal(freshPlanSeller.source, "candidate");
assert.equal(planC.rows.filter((row) => row.decision === "add" && row.sellerIndex === freshPlanSeller.sellerIndex).length, 5);

// The cart overlay treats an added article as KEEP once it is in the cart.
const matchingSandbox = {};
vm.runInNewContext(await readFile(new URL("../extension/cartforge-matching.js", import.meta.url), "utf8"), matchingSandbox);
const inCart = matchingSandbox.CartforgeMatching.matchRowsToPlan(
  [{ cardName: "Fecundity", condition: "NM", quantity: 1, price: "0,05 €", rawLine: "1x Fecundity\nNM\n0,05 €" }],
  planA.rows.filter((row) => row.sellerIndex === 3 && row.cardName === "Fecundity"),
  { sellerDecision: "keep" }
);
assert.equal(inCart[0].status, "keep");
assert.equal(inCart[0].planRow.decision, "add");

// --- Result templates.
const summaryHtml = __testing.resultSummaryTemplate(scenarioC.result);
assert.ok(summaryHtml.includes("5 articles to add from 1 seller"));
assert.ok(!__testing.resultSummaryTemplate(baseline.result).includes("to add from"));
const freshEntry = scenarioC.result.usedSellers.find(({ seller }) => seller.sellerName === "FreshSeller");
const freshOffers = scenarioC.result.selectedOffers.filter((offer) => offer.sellerIndex === freshEntry.sellerIndex);
const cardHtml = __testing.sellerPlanTemplate(freshEntry.seller, freshEntry.sellerIndex, 1, freshOffers, freshCost);
assert.ok(cardHtml.includes("Add to cart"));
assert.ok(cardHtml.includes("https://www.cardmarket.com/en/Magic/Users/FreshSeller/Offers/Singles?idWantslist=25431729"));
assert.ok(cardHtml.includes("1× Food Chain · Commander Masters · Near Mint · EUR 9.00"));
assert.ok(!cardHtml.includes("Remove from this seller"), "A seller not in the cart has nothing to cut.");

// --- 4. Performance: real cart + 3 synthetic sellers × 220 captured offers.
const cartCardNames = [...new Set(freshCart().sellers.flatMap((seller) => seller.items.map((item) => item.cardName)))];
function syntheticSeller(name, country, seed) {
  const offers = [];
  for (let index = 0; index < 220; index += 1) {
    const inCartCard = index % 5 !== 4; // ~20% of rows are cards the cart does not want
    const cardName = inCartCard ? cartCardNames[(index * 7 + seed) % cartCardNames.length] : `Unwanted Card ${index}`;
    offers.push([cardName, 0.1 + ((index * 37 + seed * 11) % 400) / 100, {
      condition: ["Near Mint", "Excellent", "Good"][index % 3],
      language: ["English", "German"][index % 2],
      expansion: `Set ${index % 6}`,
      available: 1 + (index % 3)
    }]);
  }
  return captured(name, country, offers);
}
const perf = optimizeWith([
  syntheticSeller("BulkDE", "Germany", 1),
  syntheticSeller("BulkFR", "France", 2),
  syntheticSeller("Seller04", "Germany", 3)
]);
const { stats } = perf.context;
console.log(`Candidates: ${stats.received} received, ${stats.notInCart} not in cart, ${stats.alreadyInCart} already in cart, ${stats.beforeFilter} → ${stats.afterFilter} after prefilter`);
console.log(`Real cart + 3 × 220 candidates: ${perf.elapsed.toFixed(0)} ms, EUR ${round(perf.result.selectedTotal)}, ${perf.result.usedSellers.length} sellers`);
assert.equal(stats.received, 660);
assert.ok(stats.afterFilter <= stats.beforeFilter);
for (const group of perf.context.offerGroups) {
  const perSeller = new Map();
  group.offers.filter((offer) => offer.source === "candidate").forEach((offer) => perSeller.set(offer.sellerIndex, (perSeller.get(offer.sellerIndex) || 0) + 1));
  assert.ok([...perSeller.values()].every((count) => count <= 3), `${group.cardName}: at most 3 candidates per seller`);
}
assert.ok(perf.elapsed < 1000, `Optimization took ${perf.elapsed.toFixed(0)} ms`);

// Variant preferences apply before the prefilter.
__testing.state.variantPreferences = {};
const excludedKey = __testing.makeVariantKey({ setName: "Commander Masters", collectorNumber: "", language: "English", condition: "Near Mint" });
const prefContext = mergeCandidateOffers({
  cartSellers: freshCart().sellers,
  offerGroups: __testing.buildOfferGroups(freshCart().sellers),
  candidateSellers: [captured("Seller04", "Germany", [["Fecundity", 0.05]])],
  cardKey: (name) => __testing.normalizeOfferKey(name),
  variantKey: __testing.makeVariantKey,
  variantPreferences: { Fecundity: { [excludedKey]: "exclude" } }
});
assert.equal(prefContext.stats.excludedByPreference, 1);
assert.equal(prefContext.stats.afterFilter, 0);

console.log("candidates: all assertions passed");
