import assert from "node:assert/strict";
import { encodeCartForgePayload, parseExtractedCartPayload } from "../src/importer.mjs";

const payload = {
  source: "cartforge-cardmarket-extension",
  version: 1,
  sellers: [
    {
      sellerName: "StructuredSeller",
      sellerCountry: "Germany",
      shippingMethod: "Standardbrief",
      tracked: false,
      articleValue: "EUR 4,20",
      shippingValue: "1,10 €",
      items: [
        {
          cardName: "Sol Ring",
          setName: "Commander Masters",
          rarity: "uncommon",
          condition: "Near Mint",
          quantity: 2,
          price: "2,10 €"
        }
      ]
    }
  ]
};

const direct = parseExtractedCartPayload(`CARTFORGE_CART=${JSON.stringify(payload)}`);
assert.equal(direct.ok, true);
assert.equal(direct.parsed.sellerCount, 1);
assert.equal(direct.parsed.itemCount, 1);
assert.equal(direct.parsed.sellers[0].sellerCountry, "Germany");
assert.equal(direct.parsed.sellers[0].trackingStatus, "untracked");
assert.equal(direct.parsed.sellers[0].items[0].setName, "Commander Masters");
assert.equal(direct.parsed.sellers[0].items[0].rarity, "Uncommon");
assert.equal(direct.parsed.sellers[0].items[0].price, 2.1);

const encoded = parseExtractedCartPayload(encodeCartForgePayload(payload));
assert.equal(encoded.ok, true);
assert.equal(encoded.parsed.sellers[0].items[0].quantity, 2);

const plainText = parseExtractedCartPayload("Summary\nNot structured JSON");
assert.equal(plainText.ok, false);

const malformed = parseExtractedCartPayload("CARTFORGE_CART={\"source\":\"x\",\"sellers\":[}");
assert.equal(malformed.ok, false);

const partialPayload = {
  source: "cartforge-cardmarket-extension",
  version: 1,
  sellers: [
    {
      sellerName: "PartialSeller",
      items: [{ quantity: 1, price: "1,20 €" }]
    }
  ]
};
const partial = parseExtractedCartPayload(`CARTFORGE_CART=${JSON.stringify(partialPayload)}`);
assert.equal(partial.ok, true);
assert.equal(partial.parsed.sellerCount, 1);
assert.equal(partial.parsed.sellers[0].items[0].cardName, "Unknown card");
assert.ok(partial.parsed.warnings.some((warning) => /missing a card name/i.test(warning)));

const duplicateRowsPayload = {
  source: "cartforge-cardmarket-extension",
  version: 1,
  sellers: [
    {
      sellerName: "DupSeller",
      items: [
        { cardName: "Island", quantity: 1, price: "0,10 €", setName: "Set A" },
        { cardName: "Island", quantity: 1, price: "0,10 €", setName: "Set A" }
      ]
    }
  ]
};
const deduped = parseExtractedCartPayload(`CARTFORGE_CART=${JSON.stringify(duplicateRowsPayload)}`);
assert.equal(deduped.ok, true);
assert.equal(deduped.parsed.sellers[0].items.length, 1);

const structuredNumericPricePayload = {
  source: "cartforge-cardmarket-extension",
  version: 1,
  sellers: [
    {
      sellerName: "WholeEuroSeller",
      items: [
        { cardName: "Aggravated Assault", quantity: 1, price: "12" },
        { cardName: "Herald of Secret Streams", quantity: 1, price: "4" },
        { cardName: "Undergrowth Stadium", quantity: 1, price: "10" }
      ]
    }
  ]
};
const structuredNumericPrices = parseExtractedCartPayload(`CARTFORGE_CART=${JSON.stringify(structuredNumericPricePayload)}`);
assert.equal(structuredNumericPrices.ok, true);
assert.deepEqual(
  structuredNumericPrices.parsed.sellers[0].items.map((item) => item.price),
  [12, 4, 10],
  "Structured extension prices without decimal separators should stay numeric."
);

console.log({
  direct: direct.parsed.itemCount,
  encoded: encoded.parsed.sellerCount,
  partialWarnings: partial.parsed.warnings.length
});
