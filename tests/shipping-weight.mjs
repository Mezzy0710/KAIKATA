import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildShippingIndex } from "../src/parser.mjs";
import { calculateShippingCost, estimateShipmentWeight } from "../src/shipping.mjs";

const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));
const shippingRecords = buildShippingIndex(shippingData);

// `_meta` is file metadata, never a country.
assert.equal(shippingData._meta.updatedAt, "2026-09-24");
assert.ok(!shippingRecords.some((record) => /meta/i.test(record.country) || record.country === "Unknown"));
assert.equal(new Set(shippingRecords.map((record) => record.country)).size, 32);

// Cardmarket's published letter limits: 20 g = 4 cards, 50 g = 17 cards, 100 g = 40 cards.
assert.equal(estimateShipmentWeight(0), 0);
assert.equal(estimateShipmentWeight(4), 20);
assert.equal(estimateShipmentWeight(5), 50);
assert.equal(estimateShipmentWeight(17), 50);
assert.equal(estimateShipmentWeight(18), 100);
assert.equal(estimateShipmentWeight(40), 100);
assert.equal(estimateShipmentWeight(41), 102); // 11 + 2.22 × 41, estimate above the published limits

function ship(country, cardCount, orderValue) {
  return calculateShippingCost({ shippingRecords, country, cardCount, orderValue });
}

// Refreshed prices.
assert.equal(ship("Italy", 1, 5).cost, 4.88);
assert.equal(ship("Austria", 1, 5).cost, 1.75);

// Weight tiers.
let result = ship("Germany", 4, 5);
assert.equal(result.method, "Standardbrief");
assert.equal(result.cost, 1.25);

result = ship("Germany", 5, 5);
assert.equal(result.method, "Kompaktbrief");
assert.equal(result.cost, 1.4);

result = ship("France", 5, 5); // no 50 g untracked letter, so the 100 g letter applies
assert.equal(result.cost, 5.35);

result = ship("Germany", 18, 10);
assert.equal(result.method, "Grossbrief");
assert.equal(result.cost, 2.3);

// Value tiers unchanged.
result = ship("Germany", 3, 30);
assert.equal(result.trackedRequired, true);
assert.equal(result.method, "Kompaktbrief + Einschreiben EINWURF");
assert.equal(result.cost, 3.95);

console.log("shipping-weight: all assertions passed");
