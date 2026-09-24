import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildShippingIndex, parseCart } from "../src/parser.mjs";
import { __testing } from "../src/app.mjs";

const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));
__testing.state.shippingData = shippingData;
const shippingRecords = buildShippingIndex(shippingData);
const EPSILON = 0.005;

function seller(sellerName, items, sellerCountry = "Germany") {
  return {
    sellerName,
    sellerCountry,
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
assert.ok(hitRate >= 0.98, `Hit rate ${hitRate} below 98%.`);

// --- Excluded groups keep index alignment: nothing dropped or duplicated.
const exclusionSellers = [
  seller("A", [{ cardName: "C1", price: 0.1 }, { cardName: "C2", price: 0.1 }, { cardName: "C3", price: 2 }]),
  seller("B", [{ cardName: "C1", price: 0.3 }, { cardName: "C2", price: 0.3 }, { cardName: "C3", price: 1.0 }, { cardName: "C4", price: 0.5 }]),
  seller("C", [{ cardName: "C4", price: 1.0 }, { cardName: "C2", price: 0.2 }])
];
const excluded = optimize(exclusionSellers, { C2: 0 });
const selectedNames = excluded.selectedOffers.map((offer) => offer.cardName).sort();
assert.deepEqual(selectedNames, ["C1", "C3", "C4"]);

// --- Large fixture: parser smoke check only (one offer per card, so no search happens).
const cartText = await readFile(new URL("./fixtures/sample-cart-large-scale.txt", import.meta.url), "utf8");
const parsed = parseCart(cartText, shippingData);
const largeGroups = __testing.buildOfferGroups(parsed.sellers);
__testing.state.desiredQuantityByCard = __testing.buildDefaultDesiredQuantities(largeGroups);
const largeResult = __testing.optimizeCart(parsed.sellers, largeGroups);
assert.equal(largeResult.selectedOffers.length, largeGroups.length);

// --- Performance on seeded random carts where every card has k competing offers.
const COUNTRIES = ["Germany", "France", "Italy", "Spain", "Netherlands", "Austria", "Belgium"];

function randomCart(seed, sellerCount, cardCount, k) {
  const rand = mulberry32(seed);
  const items = Array.from({ length: sellerCount }, () => []);
  for (let card = 0; card < cardCount; card += 1) {
    const pool = [...Array(sellerCount).keys()];
    for (let n = 0; n < k; n += 1) {
      const [sellerIndex] = pool.splice(Math.floor(rand() * pool.length), 1);
      items[sellerIndex].push({ cardName: `Card ${card + 1}`, price: (5 + Math.floor(rand() * 301)) / 100 });
    }
  }
  return items.map((list, index) => seller(`S${index + 1}`, list, COUNTRIES[index % COUNTRIES.length]));
}

// Selected `sellerIndex:itemIndex` per cart, captured from the uncached implementation
// before per-seller cost memoization. The speedup must not change any plan.
const PERF_SNAPSHOTS = {
  "15/60/4": "4:0,6:0,13:1,10:4,14:4,6:2,6:3,13:3,6:4,8:4,13:4,10:0,4:7,4:8,8:6,13:5,14:5,0:3,7:5,10:8,0:4,1:7,8:0,7:6,4:10,1:8,0:6,8:9,1:10,0:8,14:9,4:12,4:13,8:1,7:9,10:12,13:7,7:10,0:9,1:11,13:8,4:16,1:14,8:13,0:1,1:15,8:14,4:18,10:17,13:11,7:12,7:13,6:17,7:15,7:16,8:2,7:17,14:0,1:1,10:3",
  "25/100/5": "15:0,7:3,8:18,20:2,8:2,4:5,8:3,4:7,7:5,7:6,12:2,19:0,18:0,17:4,20:4,0:3,4:9,12:4,7:8,3:5,14:6,12:6,8:6,14:0,23:4,18:6,11:3,17:6,11:5,3:6,21:6,7:11,3:7,15:6,0:1,3:8,4:13,18:11,18:12,21:9,21:10,12:11,12:12,12:13,4:15,7:1,12:14,15:8,21:14,17:8,18:14,18:15,14:10,21:15,19:3,15:11,23:0,8:9,15:13,17:9,23:9,23:10,7:14,11:13,17:11,17:12,20:8,23:1,23:12,4:20,14:14,8:11,0:12,18:19,21:20,14:15,20:9,3:15,17:2,20:10,17:14,4:22,17:15,18:20,14:16,17:16,17:17,20:12,7:19,8:1,20:13,11:17,8:15,14:17,15:21,19:6,14:18,21:23,20:15,21:24",
  "35/150/6": "21:0,12:1,16:12,27:11,4:20,5:22,30:19,3:12,21:19,5:23,16:16,5:24,31:1,14:15,14:16,33:19,4:23,19:19,8:15,7:25,16:19,17:28,8:16,12:2,26:23,25:17,7:26,26:24,33:21,29:21,14:20,30:22,33:22,29:22,31:2,25:19,5:34,14:21,21:22,20:24,21:23,25:20,17:31,30:23,19:24,12:3,30:24,14:22,25:22,21:26,29:23,14:23,3:21,14:24,4:31,21:27,20:4,8:22,27:1,26:2,20:5,5:5,19:0,16:1,4:4,16:2,19:4,12:4,33:4,26:3,25:3,17:3,16:4,19:1,3:2,31:5,4:6,21:3,4:7,26:7,26:8,29:8,16:7,17:8,7:0,17:9,17:10,29:10,19:10,17:12,25:6,26:10,20:8,20:9,27:4,31:0,20:10,21:9,30:6,33:6,7:7,14:8,14:9,29:13,33:8,5:14,3:0,31:14,25:8,7:10,8:4,20:17,27:5,4:14,8:5,8:6,7:12,14:0,19:12,8:7,5:15,3:9,26:13,7:14,12:9,12:10,21:12,5:16,14:1,8:9,29:15,30:14,30:15,12:13,31:20,17:20,5:18,4:17,26:16,29:3,27:9,12:14,5:19,33:14,5:20,3:11,7:20,7:21,4:19,30:18",
};

const selectionKey = (result) => result.selectedOffers.map((offer) => `${offer.sellerIndex}:${offer.itemIndex}`).join(",");

for (const [sellerCount, cardCount, k, limitMs] of [[15, 60, 4, 300], [25, 100, 5, 1000], [35, 150, 6, 3000]]) {
  const sellers = randomCart(42, sellerCount, cardCount, k);
  const start = performance.now();
  const result = optimize(sellers);
  const elapsed = performance.now() - start;
  const label = `${sellerCount}/${cardCount}/${k}`;
  console.log(`Random cart ${label}: ${result.iterations} iterations, ${elapsed.toFixed(0)} ms, total ${result.selectedTotal.toFixed(2)}`);
  assert.equal(result.selectedOffers.length, cardCount);
  assert.equal(selectionKey(result), PERF_SNAPSHOTS[label], `Random cart ${label}: plan changed.`);
  assert.ok(elapsed < limitMs, `Random cart ${label} took ${elapsed.toFixed(0)} ms (limit ${limitMs} ms)`);
}

// --- Unresolved shipping: an Unknown-country seller must not stall the search.
const unresolvedSellers = [
  seller("U", [{ cardName: "C4", price: 1.0 }], "Unknown"),
  seller("A", [{ cardName: "C1", price: 0.1 }, { cardName: "C2", price: 0.5 }]),
  seller("B", [{ cardName: "C1", price: 0.5 }, { cardName: "C2", price: 0.1 }])
];
const unresolved = optimize(unresolvedSellers);
const sellerOf = (cardName) => unresolved.selectedOffers.find((offer) => offer.cardName === cardName)?.sellerName;
assert.equal(sellerOf("C4"), "U");
assert.equal(sellerOf("C1"), sellerOf("C2"), "C1 and C2 should come from one German seller.");
assert.ok(["A", "B"].includes(sellerOf("C1")));
assert.equal(unresolved.unresolvedSellers.length, 1);
assert.equal(unresolved.unresolvedSellers[0].seller.sellerName, "U");
assert.ok(!Number.isFinite(unresolved.selectedTotal), "A plan with an unresolved seller still displays as unresolved.");

// --- Unresolved fuzz: brute force minimizing (unresolvedCount, resolvedTotal).
function lexBruteForce(sellers, groups) {
  let best = null;
  const selection = new Array(groups.length);
  const walk = (groupIndex) => {
    if (groupIndex === groups.length) {
      const trialScore = score(selection, sellers);
      if (!best
        || trialScore.unresolvedCount < best.unresolvedCount
        || (trialScore.unresolvedCount === best.unresolvedCount && trialScore.resolvedTotal < best.resolvedTotal)) {
        best = trialScore;
      }
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

const unresolvedRandom = mulberry32(777);
const unresolvedInt = (min, max) => min + Math.floor(unresolvedRandom() * (max - min + 1));
let unresolvedGenerated = 0;
let unresolvedHits = 0;
const unresolvedMisses = [];
while (unresolvedGenerated < 100) {
  const sellerCount = unresolvedInt(2, 4);
  const cardCount = unresolvedInt(3, 6);
  const offersBySeller = Array.from({ length: sellerCount }, () => []);
  for (let card = 0; card < cardCount; card += 1) {
    for (let s = 0; s < sellerCount; s += 1) {
      if (unresolvedRandom() < 0.6) {
        offersBySeller[s].push({ cardName: `Card ${card + 1}`, price: unresolvedInt(5, 300) / 100 });
      }
    }
  }
  if (new Set(offersBySeller.flat().map((offer) => offer.cardName)).size < cardCount) {
    continue;
  }
  unresolvedGenerated += 1;
  const unknownIndex = unresolvedInt(0, sellerCount - 1);
  const sellers = offersBySeller.map((items, index) => seller(`S${index + 1}`, items, index === unknownIndex ? "Unknown" : "Germany"));
  const optimum = lexBruteForce(sellers, buildGroups(sellers));
  const result = optimize(sellers);
  const resultScore = score(result.selectedOffers, sellers);
  assert.equal(result.selectedOffers.length, cardCount);
  if (resultScore.unresolvedCount === optimum.unresolvedCount && Math.abs(resultScore.resolvedTotal - optimum.resolvedTotal) < EPSILON) {
    unresolvedHits += 1;
  } else if (unresolvedMisses.length < 3) {
    unresolvedMisses.push({ cart: unresolvedGenerated, optimum: [optimum.unresolvedCount, optimum.resolvedTotal.toFixed(2)], got: [resultScore.unresolvedCount, resultScore.resolvedTotal.toFixed(2)] });
  }
}
console.log(`Unresolved fuzz hit rate: ${unresolvedHits}/${unresolvedGenerated}`);
if (unresolvedMisses.length) {
  console.log("First unresolved misses:", JSON.stringify(unresolvedMisses));
}
assert.ok(unresolvedHits / unresolvedGenerated >= 0.95, `Unresolved hit rate ${unresolvedHits / unresolvedGenerated} below 95%.`);

console.log("optimizer-seller-moves: all assertions passed");
