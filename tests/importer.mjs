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

console.log({
  direct: direct.parsed.itemCount,
  encoded: encoded.parsed.sellerCount
});
