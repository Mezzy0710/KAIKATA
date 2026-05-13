import assert from "node:assert/strict";
import { encodeCartForgePayload, parseExtractedCartPayload } from "../src/importer.mjs";

const payload = {
  source: "cartforge-cardmarket-extension",
  version: 1,
  url: "https://www.cardmarket.com/en/Magic/ShoppingCart",
  extractedAt: "2026-05-11T18:00:00.000Z",
  sellers: [
    {
      sellerId: "13779",
      sellerName: "StructuredSeller",
      sellerProfileUrl: "https://www.cardmarket.com/en/Magic/Users/StructuredSeller",
      shipmentId: "1274779948",
      sellerCountry: "Germany",
      shippingMethod: "Standardbrief",
      tracked: false,
      articleValue: "EUR 4,20",
      shippingValue: "1,10 €",
      items: [
        {
          articleId: "2073188352",
          productId: "772256",
          productUrl: "https://www.cardmarket.com/en/Magic/Products/Singles/Commander-Masters/Sol-Ring",
          cardName: "Sol Ring",
          expansionId: "1718316000",
          setName: "Commander Masters",
          rarity: "uncommon",
          rarityCode: "40",
          condition: "Near Mint",
          conditionCode: "2",
          languageCode: "1",
          quantity: 2,
          price: "2,10 €",
          comment: "a CMM001"
        }
      ]
    }
  ]
};

const direct = parseExtractedCartPayload(`CARTFORGE_CART=${JSON.stringify(payload)}`);
assert.equal(direct.ok, true);
assert.equal(direct.parsed.sellerCount, 1);
assert.equal(direct.parsed.itemCount, 1);
assert.equal(direct.parsed.sourceUrl, "https://www.cardmarket.com/en/Magic/ShoppingCart");
assert.equal(direct.parsed.extractedAt, "2026-05-11T18:00:00.000Z");
assert.equal(direct.parsed.sellers[0].sellerCountry, "Germany");
assert.equal(direct.parsed.sellers[0].sellerId, "13779");
assert.equal(direct.parsed.sellers[0].sellerProfileUrl, "https://www.cardmarket.com/en/Magic/Users/StructuredSeller");
assert.equal(direct.parsed.sellers[0].shipmentId, "1274779948");
assert.equal(direct.parsed.sellers[0].trackingStatus, "untracked");
assert.equal(direct.parsed.sellers[0].items[0].articleId, "2073188352");
assert.equal(direct.parsed.sellers[0].items[0].productId, "772256");
assert.equal(direct.parsed.sellers[0].items[0].productUrl, "https://www.cardmarket.com/en/Magic/Products/Singles/Commander-Masters/Sol-Ring");
assert.equal(direct.parsed.sellers[0].items[0].expansionId, "1718316000");
assert.equal(direct.parsed.sellers[0].items[0].setName, "Commander Masters");
assert.equal(direct.parsed.sellers[0].items[0].rarity, "Uncommon");
assert.equal(direct.parsed.sellers[0].items[0].rarityCode, "40");
assert.equal(direct.parsed.sellers[0].items[0].conditionCode, "2");
assert.equal(direct.parsed.sellers[0].items[0].languageCode, "1");
assert.equal(direct.parsed.sellers[0].items[0].comment, "a CMM001");
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
