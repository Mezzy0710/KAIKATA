import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseCart } from "../src/parser.mjs";
import { parseExtractedCartPayload } from "../src/importer.mjs";
import { __testing } from "../src/app.mjs";

const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));
const raw = await readFile(new URL("./fixtures/sample-cart-basic.txt", import.meta.url), "utf8");

const manualParsed = parseCart(raw, shippingData);
assert.ok(manualParsed.sellerCount > 0, "Manual parse should detect sellers.");

const payload = {
  source: "cartforge-cardmarket-extension",
  version: 1,
  sellers: manualParsed.sellers.map((seller) => ({
    sellerName: seller.sellerName,
    sellerCountry: seller.sellerCountry,
    shippingMethod: seller.shippingMethod,
    trackingStatus: seller.trackingStatus,
    articleValue: seller.articleValue,
    shippingValue: seller.shippingValue,
    trusteeValue: seller.trusteeValue,
    total: seller.total,
    items: seller.items.map((item) => ({
      cardName: item.cardName,
      quantity: item.quantity,
      condition: item.condition,
      setName: item.setName,
      rarity: item.rarity,
      price: item.price
    }))
  }))
};

const extensionParsedResult = parseExtractedCartPayload(`CARTFORGE_CART=${JSON.stringify(payload)}`, shippingData);
assert.equal(extensionParsedResult.ok, true, "Extension payload should parse.");
const extensionParsed = extensionParsedResult.parsed;

const manualGroups = __testing.buildOfferGroups(manualParsed.sellers);
const extensionGroups = __testing.buildOfferGroups(extensionParsed.sellers);

assert.equal(extensionGroups.length, manualGroups.length, "Both input paths should produce the same number of card groups.");

const manualGroupSignature = manualGroups.map(groupSignature).sort();
const extensionGroupSignature = extensionGroups.map(groupSignature).sort();
assert.deepEqual(extensionGroupSignature, manualGroupSignature, "Both input paths should produce identical normalized grouping.");

__testing.state.shippingData = shippingData;
__testing.state.variantPreferences = {};
__testing.state.desiredQuantityByCard = Object.fromEntries(manualGroups.map((group) => [group.cardName, group.requiredQuantity]));
const manualResult = __testing.optimizeCart(manualParsed.sellers, manualGroups);

__testing.state.shippingData = shippingData;
__testing.state.variantPreferences = {};
__testing.state.desiredQuantityByCard = Object.fromEntries(extensionGroups.map((group) => [group.cardName, group.requiredQuantity]));
const extensionResult = __testing.optimizeCart(extensionParsed.sellers, extensionGroups);

assert.equal(round2(extensionResult.selectedTotal), round2(manualResult.selectedTotal), "Selected total should match across both input paths.");
assert.equal(round2(extensionResult.shippingTotal), round2(manualResult.shippingTotal), "Shipping total should match across both input paths.");
assert.equal(round2(extensionResult.finalTotal), round2(manualResult.finalTotal), "Final total should match across both input paths.");
assert.deepEqual(
  extensionResult.selectedOffers.map(offerSignature).sort(),
  manualResult.selectedOffers.map(offerSignature).sort(),
  "Offer selection should be consistent for both input paths."
);

console.log({
  groups: manualGroups.length,
  selectedOffers: manualResult.selectedOffers.length,
  finalTotal: round2(manualResult.finalTotal)
});

function groupSignature(group) {
  const offers = group.offers
    .map((offer) => `${offer.cardName}|${offer.sellerName}|${offer.quantity}|${round2(offer.unitPrice)}`)
    .sort()
    .join(";");
  return `${group.cardName}|${group.requiredQuantity}|${group.variantCount}|${offers}`;
}

function offerSignature(offer) {
  return `${offer.cardName}|${offer.sellerName}|${offer.requiredQuantity}|${offer.quantity}|${round2(offer.unitPrice)}`;
}

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}
