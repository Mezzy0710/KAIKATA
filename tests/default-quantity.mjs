import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { __testing } from "../src/app.mjs";

const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));
__testing.state.shippingData = shippingData;

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
      setName: item.setName || "",
      condition: "Near Mint",
      quantity: 1,
      price: item.price,
      rawLine: `1x ${item.cardName} ${item.price}`
    }))
  };
}

const sellers = [
  seller("A", [{ cardName: "Sol Ring", setName: "Commander Legends", price: 1.2 }, { cardName: "Arcane Signet", price: 0.4 }]),
  seller("B", [{ cardName: "Sol Ring", setName: "Commander Masters", price: 1.1 }]),
  seller("C", [{ cardName: "Sol Ring", setName: "Kaldheim Commander", price: 1.3 }])
];

const offerGroups = __testing.buildOfferGroups(sellers);
const solRing = offerGroups.find((group) => group.cardName === "Sol Ring");
assert.equal(solRing.variantCount, 3);
assert.equal(solRing.requiredQuantity, 3, "requiredQuantity still means copies detected in the cart.");

const defaults = __testing.buildDefaultDesiredQuantities(offerGroups);
assert.deepEqual(defaults, { "Arcane Signet": 1, "Sol Ring": 1 });

__testing.state.desiredQuantityByCard = { ...defaults };
__testing.state.variantPreferences = {};
const result = __testing.optimizeCart(sellers, offerGroups);
const solRingCopies = result.selectedOffers
  .filter((offer) => offer.cardName === "Sol Ring")
  .reduce((sum, offer) => sum + Number(offer.requiredQuantity || offer.quantity || 1), 0);
assert.equal(solRingCopies, 1);
assert.deepEqual(result.warnings, []);
assert.equal(result.insufficientGroups.length, 0);

const html = __testing.desiredCardsTableTemplate(offerGroups);
assert.ok(
  html.includes("1 copy · 3 variants detected · Any version · 3 in cart"),
  "Sol Ring row should show the cart duplicates."
);
assert.ok(html.includes("1 copy · Any version<"), "Arcane Signet row should not show an in-cart suffix.");
assert.ok(!/Needs review/.test(html), "Default quantity of 1 should keep rows Ready.");

// Raising the desired quantity to the cart count removes the suffix.
__testing.state.desiredQuantityByCard["Sol Ring"] = 3;
const raisedHtml = __testing.desiredCardsTableTemplate(offerGroups);
assert.ok(raisedHtml.includes("3 copies · 3 variants detected · Any version<"));

console.log("default-quantity: all assertions passed");
