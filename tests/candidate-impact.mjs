import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseExtractedCartPayload } from "../src/importer.mjs";
import { mergeCandidateOffers } from "../src/candidates.mjs";
import { checkedText, describeCandidateImpact, headlineText, optimizeWithCandidates, buildCandidateImpact } from "../src/candidate-impact.mjs";
import { __testing } from "../src/app.mjs";

const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));
const cartText = await readFile(new URL("./fixtures/real-cart-2026-09.txt", import.meta.url), "utf8");
__testing.state.shippingData = shippingData;
__testing.state.variantPreferences = {};

const round = (value) => Math.round(value * 100) / 100;
const sellerNames = (result) => result.usedSellers.map(({ seller }) => seller.sellerName).sort();
const planKey = (result) => result.selectedOffers.map((offer) => `${offer.sellerIndex}:${offer.itemIndex}:${offer.requiredQuantity}`).join(",");
const BASELINE_SELLERS = ["Seller01", "Seller04", "Seller05", "Seller07", "Seller08", "Seller09", "Seller12", "Seller14", "Seller16", "Seller17", "Seller18", "Seller19", "Seller20"];

let articleCounter = 8000000;
function captured(sellerName, sellerCountry, offers) {
  return {
    sellerName,
    sellerCountry,
    wantsListId: "25431729",
    capturedAt: "2026-09-26T10:00:00.000Z",
    stale: false,
    offers: offers.map(([cardName, price]) => ({
      idArticle: String(articleCounter++),
      sellerName,
      sellerCountry,
      cardName,
      expansion: "Commander Masters",
      rarity: "Rare",
      condition: "Near Mint",
      conditionCode: "NM",
      language: "English",
      foil: false,
      price,
      available: 1
    }))
  };
}

// The app's flow: cart-only groups, cart + captures merged, then two runs.
function run(captures, options = {}) {
  const parsed = parseExtractedCartPayload(cartText, shippingData).parsed;
  const offerGroups = __testing.buildOfferGroups(parsed.sellers);
  __testing.state.desiredQuantityByCard = __testing.buildDefaultDesiredQuantities(offerGroups);
  const merged = captures.length
    ? mergeCandidateOffers({
      cartSellers: parsed.sellers,
      offerGroups,
      candidateSellers: captures,
      cardKey: (name) => __testing.normalizeOfferKey(name),
      variantKey: __testing.makeVariantKey,
      variantPreferences: {}
    })
    : null;
  const out = optimizeWithCandidates({
    cart: { sellers: parsed.sellers, offerGroups },
    merged,
    optimize: __testing.optimizeCart,
    captures,
    ...options
  });
  return { ...out, text: describeCandidateImpact(out.impact) };
}

// --- 5. No candidates: the real-cart plan is unchanged (€211.37, 13 sellers).
const none = run([]);
assert.equal(none.impact.state, "none");
assert.equal(none.candidateResult, null, "No second run without wants stock.");
assert.equal(none.result, none.cartResult);
assert.equal(round(none.result.selectedTotal), 211.37);
assert.deepEqual(sellerNames(none.result), BASELINE_SELLERS);
assert.equal(none.text.tip, "Tip: load sellers' wants stock from your cart page to compare offers outside your cart.");
assert.equal(none.text.headline, null);
assert.equal(none.text.detail, "");

// --- 4a. One cheaper candidate at an existing seller → improved.
// The cart-only plan buys Grave Pact from Seller16 (€22.00, its only planned card).
// Seller04 (already in the plan) offers it for €15.00, so Seller16 drops out.
const improved = run([captured("Seller04", "Germany", [["Grave Pact", 15]])]);
assert.equal(improved.impact.state, "improved");
assert.equal(improved.result, improved.candidateResult, "The candidate plan is shown.");
const before = round(improved.cartResult.selectedTotal);
const after = round(improved.candidateResult.selectedTotal);
assert.equal(before, 211.37);
assert.equal(improved.impact.before, before);
assert.equal(improved.impact.after, after);
assert.equal(improved.impact.savings, round(before - after), "D = A − B");
assert.equal(improved.impact.savings, 8.18);
assert.deepEqual(improved.impact.adds, { articles: 1, sellers: 1, newSellers: 0 });
assert.equal(improved.impact.removals, 1, "Seller16's Grave Pact is no longer bought.");
const adds = improved.result.selectedOffers.filter((offer) => offer.source === "candidate");
assert.deepEqual(adds.map((offer) => [offer.sellerName, offer.cardName, offer.unitPrice]), [["Seller04", "Grave Pact", 15]]);
assert.ok(!sellerNames(improved.result).includes("Seller16"));
assert.deepEqual(improved.impact.breakdown, { inCart: 1, otherCards: 0, alreadyInCart: 0 });
assert.equal(
  headlineText(improved.text.headline),
  "Checked 1 offer from 1 seller → saves €8.18 (€211.37 → €203.19). Add 1 article from 1 seller (0 new sellers), remove 1."
);
assert.equal(improved.text.headline.strong, "saves €8.18");
assert.equal(improved.text.detail, "Of 1 offer: 1 for cards in your cart, 0 for other wants-list cards (ignored), 0 already in your cart.");

// A new seller counts as a new seller in the add summary.
const newSeller = run([captured("FreshSeller", "Germany", [
  ["Food Chain", 9.0], ["Goblin Bombardment", 1.4], ["Mahadi, Emporium Master", 0.45], ["Village Rites", 0.06], ["Warren Soultrader", 7.8]
])]);
assert.equal(newSeller.impact.state, "improved");
assert.equal(newSeller.impact.adds.newSellers, 1);
assert.equal(newSeller.impact.adds.articles, 5);
assert.equal(newSeller.impact.removals, 5, "Five cart articles are replaced.");

// --- 4b. Only dearer candidates → nothing better, and the plan is the cart-only plan.
const dearer = run([
  captured("Seller04", "Germany", [["Grave Pact", 30], ["Food Chain", 18], ["Black Lotus", 1]]),
  captured("FreshSeller", "Germany", [["Sylvan Library", 40]])
]);
assert.equal(dearer.impact.state, "nothing-better");
assert.equal(dearer.result, dearer.cartResult);
assert.equal(round(dearer.result.selectedTotal), 211.37);
assert.deepEqual(sellerNames(dearer.result), BASELINE_SELLERS);
assert.equal(planKey(dearer.result), planKey(none.result), "Same offers as the cart-only plan.");
assert.ok(dearer.result.selectedOffers.every((offer) => offer.source === "cart"));
assert.deepEqual(dearer.impact.breakdown, { inCart: 3, otherCards: 1, alreadyInCart: 0 });
assert.equal(headlineText(dearer.text.headline), "Checked 4 offers from 2 sellers — nothing beats your cart. Your plan uses only cart items.");
assert.equal(dearer.text.detail, "Of 4 offers: 3 for cards in your cart, 1 for other wants-list cards (ignored), 0 already in your cart.");

// Captures without a usable offer: no second run, still "nothing better".
const unusable = run([captured("Seller04", "Germany", [["Black Lotus", 1]])]);
assert.equal(unusable.impact.state, "nothing-better");
assert.equal(unusable.candidateResult, unusable.cartResult);
assert.equal(unusable.impact.timings.candidateMs, 0);

// Empty wants pages (0-offer captures) count as "checked, nothing extra".
const withEmpty = run([
  captured("Seller04", "Germany", [["Grave Pact", 30], ["Food Chain", 18], ["Black Lotus", 1]]),
  captured("FreshSeller", "Germany", [["Sylvan Library", 40]]),
  captured("Seller01", "Germany", []),
  captured("Seller05", "Italy", [])
]);
assert.equal(withEmpty.impact.state, "nothing-better");
assert.equal(withEmpty.impact.emptySellers, 2);
assert.equal(round(withEmpty.result.selectedTotal), 211.37, "Empty captures change nothing.");
assert.equal(headlineText(withEmpty.text.headline), "Checked 4 offers from 2 sellers, 2 more checked, nothing extra — nothing beats your cart. Your plan uses only cart items.");
const onlyEmpty = run([captured("Seller01", "Germany", []), captured("Seller05", "Italy", [])]);
assert.equal(onlyEmpty.impact.state, "nothing-better");
assert.equal(headlineText(onlyEmpty.text.headline), "Checked 2 sellers, nothing extra — nothing beats your cart. Your plan uses only cart items.");
assert.equal(onlyEmpty.text.detail, "");
assert.equal(checkedText({ offersChecked: 5, sellersChecked: 1, emptySellers: 0 }), "Checked 5 offers from 1 seller");

// Excluded captures and the no-wantsListIds fallback are described.
const excluded = run([], { excluded: { stale: 2, otherWantsList: 1 } });
assert.equal(excluded.text.excludedLine, "Not used: 2 captures older than 24 h, 1 capture from another wants list.");
const fallback = run([captured("Seller04", "Germany", [["Grave Pact", 30]])], { fallback: true });
assert.match(fallback.text.fallbackLine, /no wants-list info/);

// A slow second run is reported, not hidden.
let tick = 0;
const slowClock = () => (tick += 1200); // every run appears to take 1.2 s
const slow = run([captured("Seller04", "Germany", [["Grave Pact", 15]])], { clock: slowClock });
assert.equal(slow.impact.timings.candidateMs, 1200);
assert.equal(slow.impact.slow, true);
assert.equal(slow.text.slowLine, "Comparing with the wants stock took 1.2 s.");
assert.equal(improved.impact.slow, false);

// Fewer unresolved sellers wins even without a comparable savings figure.
const fakeResult = (unresolvedCount, resolvedTotal) => ({ unresolvedCount, resolvedTotal, selectedTotal: unresolvedCount ? Infinity : resolvedTotal, selectedOffers: [] });
const resolved = buildCandidateImpact({ cartResult: fakeResult(1, 50), candidateResult: fakeResult(0, 60), captures: [{ offers: [{}] }], stats: { received: 1, beforeFilter: 1, notInCart: 0, alreadyInCart: 0 } });
assert.equal(resolved.state, "improved");
assert.equal(resolved.savings, null);
assert.match(headlineText(describeCandidateImpact(resolved).headline), /fewer sellers needing shipping review/);

// --- Timing on a real-size cart with a realistic amount of wants stock.
const cards = [...new Set(none.result.selectedOffers.map((offer) => offer.comparableCardName || offer.cardName))];
const bigStock = Array.from({ length: 8 }, (_, s) => captured(`Stock${s}`, "Germany", [
  ...cards.map((card, c) => [card, round(1 + ((s * 7 + c * 13) % 40))]),
  ...Array.from({ length: 150 }, (_, i) => [`Other card ${i}`, 0.5])
]));
const timed = run(bigStock);
console.log(JSON.stringify({
  candidateImpact: "ok",
  improvedSavings: improved.impact.savings,
  realSizeRun: {
    offers: timed.impact.offersChecked,
    cardOffers: timed.impact.breakdown.inCart,
    state: timed.impact.state,
    cartMs: Math.round(timed.impact.timings.cartMs),
    candidateMs: Math.round(timed.impact.timings.candidateMs),
    over1s: timed.impact.slow
  }
}));
