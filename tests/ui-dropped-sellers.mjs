import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { __testing } from "../src/app.mjs";

function seller(sellerName, sellerCountry, items) {
  return {
    sellerName,
    sellerCountry,
    shippingMethod: "Standardbrief",
    trackingStatus: "untracked",
    items: items.map(([cardName, quantity, condition, price]) => ({ cardName, quantity, condition, price }))
  };
}

// --- 4. Sellers not in plan: readable, lists cards, escapes names.
const dropped = seller("<b>Evil & Co</b>", "Germany", [
  ["Sol Ring", 1, "Near Mint", 1.2],
  ["Korvold, Fae-Cursed King", 2, "Excellent", 0.99]
]);
const droppedHtml = __testing.droppedSellersTemplate({ droppedSellers: [{ seller: dropped, sellerIndex: 0 }] });
assert.ok(droppedHtml.includes("Sellers not in plan"));
assert.ok(droppedHtml.includes("&lt;b&gt;Evil &amp; Co&lt;/b&gt;"), "Seller name is escaped.");
assert.ok(!droppedHtml.includes("<b>Evil"), "No raw seller HTML.");
assert.ok(droppedHtml.includes("1× Sol Ring · Near Mint · EUR 1.20"));
assert.ok(droppedHtml.includes("2× Korvold, Fae-Cursed King · Excellent · EUR 0.99"));
assert.ok(droppedHtml.includes("Germany"));
assert.ok(!/text-shadow|#ffd9d9/i.test(droppedHtml));
assert.equal(__testing.droppedSellersTemplate({ droppedSellers: [] }), "");

// The stylesheet defines the chip once, without the old pink/shadow styling.
const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
assert.equal((css.match(/^\.dropped-seller-item\s*\{/gm) || []).length, 1);
assert.equal((css.match(/^\s*\.dropped-sellers-list\s*\{/gm) || []).length, 1);
assert.ok(!/#ffd9d9/i.test(css));

// --- 5. Kept seller: "Remove from this seller:" only when there is something to cut.
const cost = {
  articleValue: 2.2, shippingValue: 1.25, trusteeFeeValue: 0, cardmarketFeeValue: 0, totalCost: 1.25,
  shippingMethod: "Standardbrief", trackingStatus: "untracked", source: "recalculated", estimatedWeight: 20
};
const kept = seller("Keeper", "Germany", [
  ["Sol Ring", 1, "Near Mint", 1.2],
  ["Korvold, Fae-Cursed King", 2, "Near Mint", 0.99],
  ["Grave Pact", 1, "Near Mint", 25.99],
  ["Sylvan Library", 1, "Near Mint", 22]
]);
const offer = (itemIndex, requiredQuantity) => ({
  sellerIndex: 0, itemIndex, requiredQuantity, quantity: kept.items[itemIndex].quantity,
  cardName: kept.items[itemIndex].cardName, condition: "Near Mint", unitPrice: kept.items[itemIndex].price
});

const partialHtml = __testing.sellerPlanTemplate(kept, 0, 1, [offer(0, 1), offer(1, 1)], cost);
const cutLine = partialHtml.match(/<p class="seller-cut-list">([\s\S]*?)<\/p>/)?.[1] || "";
assert.ok(cutLine.includes("Remove from this seller:"));
assert.ok(cutLine.includes("1× Grave Pact"));
assert.ok(cutLine.includes("1× Sylvan Library"));
assert.ok(cutLine.includes("Korvold, Fae-Cursed King: keep 1 of 2"));
assert.ok(!cutLine.includes("Sol Ring"), "Kept rows are not listed.");

const fullHtml = __testing.sellerPlanTemplate(kept, 0, 1, [offer(0, 1), offer(1, 2), offer(2, 1), offer(3, 1)], cost);
assert.ok(!fullHtml.includes("seller-cut-list"), "Fully kept seller shows nothing extra.");
assert.ok(!fullHtml.includes("Remove from this seller"));

// Two printings of one card: only the unused one is listed.
const twins = seller("Twins", "France", [["Sylvan Library", 1, "Near Mint", 22], ["Sylvan Library", 1, "Near Mint", 22]]);
const twinHtml = __testing.sellerPlanTemplate(twins, 0, 1, [{ sellerIndex: 0, itemIndex: 0, requiredQuantity: 1, quantity: 1, cardName: "Sylvan Library", unitPrice: 22 }], cost);
assert.equal((twinHtml.match(/<p class="seller-cut-list">[\s\S]*?<\/p>/)?.[0].match(/Sylvan Library/g) || []).length, 1);

console.log("ui-dropped-sellers: all assertions passed");
