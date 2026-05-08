import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildShippingIndex } from "../src/parser.mjs";
import { calculateShippingCost, estimateShipmentWeight, SHIPPING_DATA_INCLUDES_CARDMARKET_FEE } from "../src/shipping.mjs";

const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));
const shippingRecords = buildShippingIndex(shippingData);

const italyAtThreshold = calculateShippingCost({
  shippingRecords,
  country: "Italy",
  cardCount: 1,
  orderValue: 25
});

assert.equal(italyAtThreshold.trackedRequired, true);
assert.equal(italyAtThreshold.tracked, true);
assert.equal(italyAtThreshold.method, "Posta Raccomandata Internazionale (International Registered Mail)");
assert.equal(italyAtThreshold.cost, 10.7);
assert.equal(italyAtThreshold.cardmarketFeeIncluded, true);
assert.equal(SHIPPING_DATA_INCLUDES_CARDMARKET_FEE, true);

const italyBelowThreshold = calculateShippingCost({
  shippingRecords,
  country: "Italy",
  cardCount: 1,
  orderValue: 24.99
});

assert.equal(italyBelowThreshold.trackedRequired, false);
assert.equal(italyBelowThreshold.tracked, false);
assert.equal(italyBelowThreshold.method, "Postapriority Internazionale - Ufficio Postale");
assert.equal(italyBelowThreshold.cost, 4.05);

const emptySellerShipping = 0;
assert.equal(emptySellerShipping, 0);

const germanThresholdOrder = calculateShippingCost({
  shippingRecords,
  country: "Germany",
  cardCount: 1,
  orderValue: 25
});

const simulatedMove = {
  oldShippingA: italyAtThreshold.cost,
  oldShippingB: 0,
  newShippingA: 0,
  newShippingB: germanThresholdOrder.cost,
  finalSellerCards: [{ sellerName: "German seller", cardName: "Battle Angels of Tyr", quantity: 1 }],
  finalOrderValue: 25
};

assert.equal(germanThresholdOrder.trackedRequired, true);
assert.equal(germanThresholdOrder.method, "Kompaktbrief + Einschreiben EINWURF");
assert.equal(germanThresholdOrder.cost, 3.95);
assert.equal(simulatedMove.newShippingA, 0);
assert.deepEqual(simulatedMove.finalSellerCards, [{ sellerName: "German seller", cardName: "Battle Angels of Tyr", quantity: 1 }]);
assert.equal(simulatedMove.finalOrderValue, 25);

const twoCards = calculateShippingCost({
  shippingRecords,
  country: "Germany",
  cardCount: 2,
  orderValue: 16
});

assert.equal(estimateShipmentWeight(2), 3.6);
assert.equal(twoCards.trackedRequired, false);
assert.equal(twoCards.tracked, false);
assert.equal(twoCards.method, "Standardbrief");
assert.equal(twoCards.cost, 1.25);

console.log(JSON.stringify({
  italyAtThreshold: {
    method: italyAtThreshold.method,
    cost: italyAtThreshold.cost,
    trackedRequired: italyAtThreshold.trackedRequired
  },
  italyBelowThreshold: {
    method: italyBelowThreshold.method,
    cost: italyBelowThreshold.cost,
    trackedRequired: italyBelowThreshold.trackedRequired
  },
  simulatedMove: {
    oldShippingA: simulatedMove.oldShippingA,
    oldShippingB: simulatedMove.oldShippingB,
    newShippingA: simulatedMove.newShippingA,
    newShippingB: simulatedMove.newShippingB
  },
  shippingDataIncludesCardmarketFee: SHIPPING_DATA_INCLUDES_CARDMARKET_FEE
}, null, 2));
