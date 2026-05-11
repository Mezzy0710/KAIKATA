import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildShippingIndex } from "../src/parser.mjs";
import { calculateShippingCost } from "../src/shipping.mjs";

const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));
const shippingRecords = buildShippingIndex(shippingData);

const germanyBelow = calculateShippingCost({
  shippingRecords,
  country: "Germany",
  cardCount: 1,
  orderValue: 24.99
});
assert.equal(germanyBelow.ok, true);
assert.equal(germanyBelow.trackedRequired, false);
assert.equal(germanyBelow.tracked, false, "Germany to Germany below EUR 25.00 can use untracked shipping when available.");

const italyBelow = calculateShippingCost({
  shippingRecords,
  country: "Italy",
  cardCount: 1,
  orderValue: 24.99
});
assert.equal(italyBelow.ok, true);
assert.equal(italyBelow.trackedRequired, false);
assert.equal(italyBelow.tracked, false, "Italy to Germany at EUR 24.99 can use untracked shipping when available.");

const italyAtThreshold = calculateShippingCost({
  shippingRecords,
  country: "Italy",
  cardCount: 1,
  orderValue: 25
});
assert.equal(italyAtThreshold.ok, true);
assert.equal(italyAtThreshold.trackedRequired, true, "Tracking threshold must be orderValue >= EUR 25.00.");
assert.equal(italyAtThreshold.tracked, true, "Italy to Germany at exactly EUR 25.00 must use tracked shipping.");

const italyAbove = calculateShippingCost({
  shippingRecords,
  country: "Italy",
  cardCount: 1,
  orderValue: 25.01
});
assert.equal(italyAbove.trackedRequired, true);
assert.equal(italyAbove.tracked, true, "Italy to Germany above EUR 25.00 must require tracked shipping.");

const germanyOneAssignment = calculateShippingCost({
  shippingRecords,
  country: "Germany",
  cardCount: 1,
  orderValue: 12.99
});
const germanyTwoAssignment = calculateShippingCost({
  shippingRecords,
  country: "Germany",
  cardCount: 2,
  orderValue: 25.98
});
assert.equal(germanyOneAssignment.trackedRequired, false);
assert.equal(germanyTwoAssignment.trackedRequired, true, "Shipping must be recalculated when assignment value reaches EUR 25.00.");
assert.notEqual(germanyOneAssignment.cost, germanyTwoAssignment.cost);

const unusedSellerShipping = 0;
assert.equal(unusedSellerShipping, 0, "A seller with zero assigned cards contributes EUR 0.00 shipping.");

console.log(JSON.stringify({
  germanyBelow: { method: germanyBelow.method, cost: germanyBelow.cost, tracked: germanyBelow.tracked },
  italyBelow: { method: italyBelow.method, cost: italyBelow.cost, tracked: italyBelow.tracked },
  italyAtThreshold: { method: italyAtThreshold.method, cost: italyAtThreshold.cost, tracked: italyAtThreshold.tracked },
  italyAbove: { method: italyAbove.method, cost: italyAbove.cost, tracked: italyAbove.tracked }
}, null, 2));
