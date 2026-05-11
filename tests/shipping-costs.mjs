import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildShippingIndex } from "../src/parser.mjs";
import {
  calculateShippingCost,
  calculateTrusteeFee,
  estimateShipmentWeight,
  recordIsRegistered,
  SHIPPING_DATA_INCLUDES_CARDMARKET_FEE
} from "../src/shipping.mjs";

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

const trusteeAtThreshold = calculateTrusteeFee({
  articleValue: 25,
  shippingMethod: "Standardbrief",
  tracked: false
});

assert.equal(trusteeAtThreshold.applies, true);
assert.equal(trusteeAtThreshold.fee, 0.13);
assert.equal(trusteeAtThreshold.methodCategory, "letter_standard");

const trusteeTrackedAtThreshold = calculateTrusteeFee({
  articleValue: 25,
  shippingMethod: "DHL Kleinpaket",
  tracked: true,
  isRegistered: false
});

assert.equal(trusteeTrackedAtThreshold.applies, true);
assert.equal(trusteeTrackedAtThreshold.fee, 0.13);
assert.equal(trusteeTrackedAtThreshold.rate, 0.005);

const trusteeRegistered = calculateTrusteeFee({
  articleValue: 25.71,
  shippingMethod: "Kompaktbrief + Einschreiben EINWURF",
  tracked: true,
  isRegistered: true
});

assert.equal(trusteeRegistered.applies, true);
assert.equal(trusteeRegistered.fee, 0.26);
assert.equal(trusteeRegistered.rate, 0.01);

const trusteeBelowThreshold = calculateTrusteeFee({
  articleValue: 24.99,
  shippingMethod: "Standardbrief",
  tracked: false
});

assert.equal(trusteeBelowThreshold.applies, false);
assert.equal(trusteeBelowThreshold.fee, 0);

const trusteeLowSales = calculateTrusteeFee({
  articleValue: 10,
  shippingMethod: "Registered Letter",
  tracked: true,
  sellerLifetimeSales: 3
});

assert.equal(trusteeLowSales.applies, true);
assert.equal(trusteeLowSales.fee, 0.05);
assert.equal(trusteeLowSales.methodCategory, "letter_registered");

const verifiedTrusteeExamples = [
  { country: "Germany", method: "DHL Kleinpaket", isRegistered: false, articleValue: 25, fee: 0.13 },
  { country: "Germany", method: "Kompaktbrief + Einschreiben EINWURF", isRegistered: true, articleValue: 25.71, fee: 0.26 },
  { country: "Germany", method: "Kompaktbrief + Einschreiben EINWURF", isRegistered: true, articleValue: 34.5, fee: 0.35 },
  { country: "Germany", method: "DHL Paket", isRegistered: false, articleValue: 196.53, fee: 0.99 },
  { country: "Netherlands", method: "Buspakje / Tracked Letterbox Packet", isRegistered: false, articleValue: 55.72, fee: 0.28 },
  { country: "Romania", method: "Registered Priority Letter", isRegistered: true, articleValue: 69, fee: 0.69 },
  { country: "Greece", method: "EPG Parcel", isRegistered: false, articleValue: 12.8, fee: 0 },
  { country: "Spain", method: "Paq Light Internacional (Registered Parcel)", isRegistered: true, articleValue: 28.51, fee: 0.29 }
];

for (const example of verifiedTrusteeExamples) {
  const fee = calculateTrusteeFee({
    articleValue: example.articleValue,
    shippingMethod: example.method,
    tracked: true,
    isRegistered: example.isRegistered
  });
  assert.equal(fee.fee, example.fee, `${example.country} ${example.method} should match verified Trustee fee.`);
}

assert.equal(recordIsRegistered({ raw: { isRegistered: true } }), true);
assert.equal(recordIsRegistered({ raw: { isRegistered: false } }), false);
assert.equal(recordIsRegistered({ raw: { registered_mail: "true" } }), true);

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
  trustee: {
    threshold: trusteeAtThreshold.fee,
    lowSales: trusteeLowSales.fee
  },
  shippingDataIncludesCardmarketFee: SHIPPING_DATA_INCLUDES_CARDMARKET_FEE
}, null, 2));
