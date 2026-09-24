import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildShippingIndex } from "../src/parser.mjs";
import { parseExtractedCartPayload } from "../src/importer.mjs";
import { buildSellerShippingRecords } from "../src/shipping-calibration.mjs";
import { __testing } from "../src/app.mjs";

// Anonymized real cart (23 sellers, 35 cards) extracted by the extension on 2026-09-24.
// Generated with scripts/anonymize-cart.mjs; it still contains the extension's flattened
// duplicate rows as a regression case.
const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));
const cartText = await readFile(new URL("./fixtures/real-cart-2026-09.txt", import.meta.url), "utf8");
const payload = JSON.parse(cartText.slice("CARTFORGE_CART=".length));
assert.ok(payload.sellers.some((seller) => seller.items.some((item) => !item.rawLine.includes("\n"))), "Fixture keeps the flattened rows.");

// --- 1. Import.
const imported = parseExtractedCartPayload(cartText, shippingData);
assert.equal(imported.ok, true);
const sellers = imported.parsed.sellers;
const byName = (name) => sellers.find((seller) => seller.sellerName === name);
const allItems = sellers.flatMap((seller) => seller.items);

assert.equal(sellers.length, 23);
assert.ok(allItems.every((item) => item.rawLine.includes("\n")), "No flattened rows remain.");
assert.ok(allItems.every((item) => item.price <= 50), "No phantom prices (comment glued onto price).");

const seller04 = byName("Seller04");
assert.equal(seller04.items.length, 17);
const korvold = seller04.items.filter((item) => item.cardName === "Korvold, Fae-Cursed King");
assert.equal(korvold.length, 1);
assert.equal(korvold[0].quantity, 2);

const seller18 = byName("Seller18");
assert.equal(seller18.items.length, 2);
assert.ok(seller18.items.every((item) => item.quantity === 2));

const offerGroups = __testing.buildOfferGroups(sellers);
assert.equal(offerGroups.length, 35);

// --- 2. Calibration.
const calibration = buildSellerShippingRecords({
  shippingRecords: buildShippingIndex(shippingData),
  sellers,
  cartCardCountBySeller: new Map(sellers.map((seller, index) => [index, seller.items.reduce((sum, item) => sum + item.quantity, 0)]))
});
const find = (predicate) => calibration.corrections.find(predicate);

const czechLetter = find((c) => c.kind === "price_update" && c.country === "Czech Republic");
assert.deepEqual([czechLetter.method, czechLetter.maxWeightG, czechLetter.tablePrice, czechLetter.observedPrice], ["Regular Letter", 50, 2.34, 2.27]);
assert.equal(find((c) => c.sellerName === "Seller19" && c.method === "Tracked Letter").observedPrice, 5.2);
assert.equal(find((c) => c.sellerName === "Seller03" && c.method === "Tracked Parcel").observedPrice, 8.55);
assert.equal(find((c) => c.sellerName === "Seller02" && c.method === "Tracked Parcel").observedPrice, 5.99);
for (const country of ["Italy", "Austria", "France", "Belgium", "Spain"]) {
  assert.ok(
    !calibration.corrections.some((c) => c.country === country && /letter|brief|lettre|carta/i.test(c.method)),
    `${country} letters already match the table.`
  );
}
// Seller04's "Free registered shipping over 100€" only exists above €100 and is ignored.
assert.ok(calibration.ignored.some((entry) => entry.sellerName === "Seller04"));
assert.ok(!calibration.corrections.some((c) => c.sellerName === "Seller04"));

console.log("Shipping corrections:");
calibration.corrections.forEach((c) => console.log(`  ${c.kind}: ${c.country} · ${c.sellerName || "all sellers"} · ${c.method} ${c.tablePrice ?? "—"} → ${c.observedPrice}`));

// --- 4. Optimization.
__testing.state.shippingData = shippingData;
__testing.state.variantPreferences = {};
__testing.state.desiredQuantityByCard = __testing.buildDefaultDesiredQuantities(offerGroups);
const start = performance.now();
const result = __testing.optimizeCart(sellers, offerGroups);
const elapsed = performance.now() - start;
const usedSellers = result.usedSellers.map(({ seller }) => seller.sellerName).sort();
console.log(`Real cart: ${elapsed.toFixed(1)} ms, total EUR ${result.selectedTotal.toFixed(2)}, ${usedSellers.length} sellers: ${usedSellers.join(", ")}`);
assert.ok(elapsed < 200, `Real cart took ${elapsed.toFixed(1)} ms`);
assert.equal(result.selectedOffers.length, 35);

// Snapshot recorded after implementation (2026-09-25).
assert.equal(Math.round(result.selectedTotal * 100) / 100, 211.37);
assert.deepEqual(usedSellers, [
  "Seller01", "Seller04", "Seller05", "Seller07", "Seller08", "Seller09", "Seller12",
  "Seller14", "Seller16", "Seller17", "Seller18", "Seller19", "Seller20"
]);

console.log("real-cart: all assertions passed");
