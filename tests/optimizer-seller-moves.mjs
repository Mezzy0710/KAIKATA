import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildShippingIndex, parseCart } from "../src/parser.mjs";
import { __testing } from "../src/app.mjs";

const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));
__testing.state.shippingData = shippingData;
const shippingRecords = buildShippingIndex(shippingData);
const EPSILON = 0.005;

function seller(sellerName, items) {
  return {
    sellerName,
    sellerCountry: "Germany",
    countrySource: "manual",
    shippingMethod: "Standardbrief",
    trackingStatus: "untracked",
    shippingValue: 0,
    trusteeValue: 0,
    articleValue: items.reduce((sum, item) => sum + item.price, 0),
    total: null,
    items: items.map((item, index) => ({
      id: `${sellerName}-${index}`,
      cardName: item.cardName,
      condition: "Near Mint",
      quantity: 1,
      price: item.price,
      rawLine: `1x ${item.cardName} ${item.price}`
    }))
  };
}

// Same candidate construction as optimizeCart with desired qty 1 and no preferences.
function buildGroups(sellers, desiredQuantityByCard = {}) {
  return __testing.buildOfferGroups(sellers).map((group) => {
    const desiredQty = desiredQuantityByCard[group.cardName] ?? 1;
    if (desiredQty === 0) {
      return { ...group, requiredQuantity: 0, desiredQuantity: 0, candidates: [] };
    }
    const valid = group.offers.filter((offer) => offer.quantity >= desiredQty);
    return {
      ...group,
      requiredQuantity: desiredQty,
      desiredQuantity: desiredQty,
      candidates: (valid.length ? valid : group.offers)
        .map((offer) => ({ ...offer, requiredQuantity: desiredQty }))
        .sort((a, b) => a.unitPrice - b.unitPrice)
    };
  });
}

function score(selection, sellers) {
  return __testing.scoreSelection(selection, sellers, shippingRecords);
}

function bruteForce(sellers, groups) {
  assert.ok(sellers.length <= 4 && groups.length <= 6, "bruteForce is only meant for small instances.");
  let best = null;
  const selection = new Array(groups.length);
  const walk = (groupIndex) => {
    if (groupIndex === groups.length) {
      const trialScore = score(selection, sellers);
      if (!best || trialScore.total < best.total) {
        best = { total: trialScore.total, selection: [...selection] };
      }
      return;
    }
    if (!groups[groupIndex].candidates.length) {
      selection[groupIndex] = undefined;
      walk(groupIndex + 1);
      return;
    }
    for (const candidate of groups[groupIndex].candidates) {
      selection[groupIndex] = candidate;
      walk(groupIndex + 1);
    }
  };
  walk(0);
  return best;
}

// The pre-v1.0.1 algorithm: initial assignment + single-card moves only, 50 iterations.
function oldOptimize(sellers, groups) {
  let selection = [...__testing.buildInitialAssignment(groups, sellers, shippingRecords)];
  let current = score(selection, sellers);
  for (let iterations = 0; iterations < 50; iterations += 1) {
    let improved = false;
    outer:
    for (let from = 0; from < sellers.length; from += 1) {
      for (let to = 0; to < sellers.length; to += 1) {
        if (from === to) continue;
        for (let groupIndex = 0; groupIndex < selection.length; groupIndex += 1) {
          if (selection[groupIndex]?.sellerIndex !== from) continue;
          const next = groups[groupIndex].candidates.find((candidate) => candidate.sellerIndex === to);
          if (!next) continue;
          const trial = [...selection];
          trial[groupIndex] = next;
          const trialScore = score(trial, sellers);
          if (trialScore.total - current.total < -EPSILON) {
            selection = trial;
            current = trialScore;
            improved = true;
            break outer;
          }
        }
      }
    }
    if (!improved) break;
  }
  return current.total;
}

function optimize(sellers, desiredQuantityByCard = {}) {
  const offerGroups = __testing.buildOfferGroups(sellers);
  __testing.state.desiredQuantityByCard = Object.fromEntries(
    offerGroups.map((group) => [group.cardName, desiredQuantityByCard[group.cardName] ?? 1])
  );
  return __testing.optimizeCart(sellers, offerGroups);
}

// --- Regression: two cheap cards at A keep A's shipping alive under single-card moves.
const regressionSellers = [
  seller("A", [{ cardName: "C1", price: 0.1 }, { cardName: "C2", price: 0.1 }]),
  seller("B", [{ cardName: "C1", price: 0.3 }, { cardName: "C2", price: 0.3 }, { cardName: "C3", price: 1.0 }]),
  seller("C", [{ cardName: "C4", price: 1.0 }])
];
const regression = optimize(regressionSellers);
const regressionOptimum = bruteForce(regressionSellers, buildGroups(regressionSellers));
assert.deepEqual(new Set(regression.usedSellers.map(({ seller: s }) => s.sellerName)), new Set(["B", "C"]));
assert.ok(Math.abs(regression.selectedTotal - regressionOptimum.total) < EPSILON, `expected ${regressionOptimum.total}, got ${regression.selectedTotal}`);
assert.ok(Math.abs(regression.selectedTotal - 5.10) < EPSILON, `expected €5.10, got ${regression.selectedTotal}`);
assert.ok(oldOptimize(regressionSellers, buildGroups(regressionSellers)) > regression.selectedTotal + EPSILON, "Regression cart should reproduce the old local optimum.");

// --- Fuzz against brute force and the old algorithm.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20260924);
const randomInt = (min, max) => min + Math.floor(random() * (max - min + 1));
let generated = 0;
let hits = 0;
const misses = [];

while (generated < 300) {
  const sellerCount = randomInt(2, 4);
  const cardCount = randomInt(3, 6);
  const offersBySeller = Array.from({ length: sellerCount }, () => []);
  for (let card = 0; card < cardCount; card += 1) {
    for (let s = 0; s < sellerCount; s += 1) {
      if (random() < 0.6) {
        offersBySeller[s].push({ cardName: `Card ${card + 1}`, price: randomInt(5, 300) / 100 });
      }
    }
  }
  const offeredCards = new Set(offersBySeller.flat().map((offer) => offer.cardName));
  if (offeredCards.size < cardCount) {
    continue;
  }
  generated += 1;

  const sellers = offersBySeller.map((items, index) => seller(`S${index + 1}`, items));
  const groups = buildGroups(sellers);
  const optimum = bruteForce(sellers, groups).total;
  const oldTotal = oldOptimize(sellers, groups);
  const result = optimize(sellers);

  assert.ok(result.selectedTotal <= oldTotal + EPSILON, `Cart #${generated}: new ${result.selectedTotal} worse than old ${oldTotal}`);
  assert.equal(result.selectedOffers.length, cardCount, `Cart #${generated}: every card should be bought exactly once.`);
  if (Math.abs(result.selectedTotal - optimum) < EPSILON) {
    hits += 1;
  } else if (misses.length < 3) {
    misses.push({ cart: generated, optimum: optimum.toFixed(2), got: result.selectedTotal.toFixed(2), old: oldTotal.toFixed(2) });
  }
}

const hitRate = hits / generated;
console.log(`Fuzz hit rate vs brute force: ${(hitRate * 100).toFixed(1)}% (${hits}/${generated})`);
if (misses.length) {
  console.log("First misses:", JSON.stringify(misses));
}
assert.ok(hitRate >= 0.95, `Hit rate ${hitRate} below 95%.`);

// --- Excluded groups keep index alignment: nothing dropped or duplicated.
const exclusionSellers = [
  seller("A", [{ cardName: "C1", price: 0.1 }, { cardName: "C2", price: 0.1 }, { cardName: "C3", price: 2 }]),
  seller("B", [{ cardName: "C1", price: 0.3 }, { cardName: "C2", price: 0.3 }, { cardName: "C3", price: 1.0 }, { cardName: "C4", price: 0.5 }]),
  seller("C", [{ cardName: "C4", price: 1.0 }, { cardName: "C2", price: 0.2 }])
];
const excluded = optimize(exclusionSellers, { C2: 0 });
const selectedNames = excluded.selectedOffers.map((offer) => offer.cardName).sort();
assert.deepEqual(selectedNames, ["C1", "C3", "C4"]);

// --- Performance on the large fixture.
const cartText = await readFile(new URL("./fixtures/sample-cart-large-scale.txt", import.meta.url), "utf8");
const start = performance.now();
const parsed = parseCart(cartText, shippingData);
const largeGroups = __testing.buildOfferGroups(parsed.sellers);
__testing.state.desiredQuantityByCard = __testing.buildDefaultDesiredQuantities(largeGroups);
const largeResult = __testing.optimizeCart(parsed.sellers, largeGroups);
const elapsed = performance.now() - start;
console.log(`Large fixture: ${parsed.sellers.length} sellers, ${largeGroups.length} cards, ${largeResult.iterations} iterations, ${elapsed.toFixed(1)} ms`);
assert.equal(largeResult.selectedOffers.length, largeGroups.length);
assert.ok(elapsed < 500, `Large fixture took ${elapsed.toFixed(1)} ms`);

console.log("optimizer-seller-moves: all assertions passed");
