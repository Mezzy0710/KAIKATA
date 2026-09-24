import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseExtractedCartPayload } from "../src/importer.mjs";
import { buildConfirmedPlan } from "../src/confirmed-plan.mjs";
import { __testing } from "../src/app.mjs";

// Load the extension's pure matching script the way Chrome does: as a classic script
// that attaches CartforgeMatching to its global object.
const sandbox = {};
vm.runInNewContext(await readFile(new URL("../extension/cartforge-matching.js", import.meta.url), "utf8"), sandbox);
const { matchRowsToPlan, markLabel, stripMarkText, summarizeMarks } = sandbox.CartforgeMatching;

// --- 1. Real cart: rows as the extension reads them vs the plan KAIKATA builds.
const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));
const cartText = await readFile(new URL("./fixtures/real-cart-2026-09.txt", import.meta.url), "utf8");
__testing.state.shippingData = shippingData;
__testing.state.variantPreferences = {};
const parsed = parseExtractedCartPayload(cartText, shippingData).parsed;
const offerGroups = __testing.buildOfferGroups(parsed.sellers);
__testing.state.desiredQuantityByCard = __testing.buildDefaultDesiredQuantities(offerGroups);
const plan = await buildConfirmedPlan(parsed, __testing.optimizeCart(parsed.sellers, offerGroups), { confirmedAt: "2026-09-26T00:00:00Z" });

// The page rows = the payload's clean rows (flattened duplicates are dropped by findItemRows).
const payload = JSON.parse(cartText.slice("CARTFORGE_CART=".length));
const statusesBySeller = new Map();
payload.sellers.forEach((pageSeller, sellerIndex) => {
  const domRows = pageSeller.items.filter((item) => item.rawLine.includes("\n"));
  const planSeller = plan.sellers[sellerIndex];
  const planRows = plan.rows.filter((row) => row.sellerIndex === sellerIndex);
  const matches = matchRowsToPlan(domRows, planRows, { sellerDecision: planSeller.decision });

  assert.equal(matches.length, domRows.length, `${pageSeller.sellerName}: one status per row`);
  matches.forEach((match, index) => {
    assert.notEqual(match.status, "unmatched", `${pageSeller.sellerName} row ${index + 1} is unmatched`);
    const planRow = planRows[index];
    // The payload and the plan keep the cart's row order, so row i must map to plan row i.
    if (match.planRow) {
      assert.equal(match.planRow, planRow, `${pageSeller.sellerName} row ${index + 1} matched the wrong plan row`);
    }
    const expected = planSeller.decision === "drop" || planRow.decision === "rejected"
      ? "remove"
      : planRow.decision === "manual_review"
        ? "review"
        : planRow.selectedQuantity < planRow.quantity ? "reduce" : "keep";
    assert.equal(match.status, expected, `${pageSeller.sellerName} ${planRow.cardName}`);
  });
  statusesBySeller.set(pageSeller.sellerName, matches);
});

const seller04 = statusesBySeller.get("Seller04");
const korvoldIndex = payload.sellers[3].items.filter((item) => item.rawLine.includes("\n")).findIndex((item) => item.cardName === "Korvold, Fae-Cursed King");
assert.deepEqual(
  { status: seller04[korvoldIndex].status, keepQty: seller04[korvoldIndex].keepQty, cartQty: seller04[korvoldIndex].cartQty },
  { status: "reduce", keepQty: 1, cartQty: 2 }
);
assert.equal(markLabel(seller04[korvoldIndex]), "KEEP 1 OF 2");
assert.deepEqual(statusesBySeller.get("Seller19").map((match) => match.status), ["keep", "keep", "keep", "keep", "keep"]);

const summary = summarizeMarks([...statusesBySeller.values()].flat());
console.log(`Real cart marks: remove ${summary.removeArticles} articles, reduce ${summary.reduceRows}, unmatched ${summary.unmatchedRows}`);
assert.equal(summary.unmatchedRows, 0);

// A row the user already reduced to the kept quantity reads as done.
const reduced = matchRowsToPlan(
  [{ cardName: "Korvold, Fae-Cursed King", setName: "#120", condition: "NM", quantity: 1, price: "0,99 €" }],
  plan.rows.filter((row) => row.sellerIndex === 3 && row.cardName === "Korvold, Fae-Cursed King"),
  { sellerDecision: "keep" }
);
assert.equal(reduced[0].status, "keep");

// --- 2. Same card twice at one seller: different price / condition must not swap.
const planRows = [
  { cardName: "Sol Ring", normalizedCardName: "sol ring", collectorNumber: "#1", condition: "Near Mint", unitPrice: 2.5, quantity: 1, selectedQuantity: 0, decision: "rejected" },
  { cardName: "Sol Ring", normalizedCardName: "sol ring", collectorNumber: "#1", condition: "Excellent", unitPrice: 1.5, quantity: 1, selectedQuantity: 1, decision: "selected" },
  { cardName: "Sol Ring", normalizedCardName: "sol ring", collectorNumber: "#1", condition: "Near Mint", unitPrice: 1.9, quantity: 1, selectedQuantity: 1, decision: "selected" }
];
const domRows = [ // page order differs from plan order
  { cardName: "Sol Ring", setName: "#1", condition: "NM", quantity: 1, price: "1,90 €" },
  { cardName: "Sol Ring", setName: "#1", condition: "EX", quantity: 1, price: "1,50 €" },
  { cardName: "Sol Ring", setName: "#1", condition: "NM", quantity: 1, price: "2,50 €" }
];
const twins = matchRowsToPlan(domRows, planRows, { sellerDecision: "keep" });
assert.deepEqual(twins.map((match) => match.status), ["keep", "keep", "remove"]);
assert.equal(twins[0].planRow, planRows[2]);
assert.equal(twins[1].planRow, planRows[1]);
assert.equal(twins[2].planRow, planRows[0]);

// Identical twins: consumed once each, in document order.
const identical = matchRowsToPlan(
  [domRows[0], domRows[0]],
  [planRows[2], { ...planRows[2], decision: "rejected", selectedQuantity: 0 }],
  { sellerDecision: "keep" }
);
assert.deepEqual(identical.map((match) => match.status), ["keep", "remove"]);

// A row not in the plan is never marked for removal (unless the whole seller is dropped).
const unknown = { cardName: "Black Lotus", setName: "#232", condition: "NM", quantity: 1, price: "9.999,00 €" };
assert.equal(matchRowsToPlan([unknown], planRows, { sellerDecision: "keep" })[0].status, "unmatched");
assert.equal(matchRowsToPlan([unknown], planRows, { sellerDecision: "drop" })[0].status, "remove");

// --- 3. Marks never leak into extracted text.
const rawLine = "1x Fecundity \n#145\nEX\n<comment>\n0,39 € \n1";
// Inline pill: innerText glues it onto the first line.
assert.equal(stripMarkText(`KEEP${rawLine}`, ["KEEP"]), rawLine);
// Block/flex pill: innerText puts it on its own line.
assert.equal(stripMarkText(`KEEP 1 OF 3\n${rawLine}`, ["KEEP 1 OF 3"]), rawLine);
// A "?" inside the row text is left alone; only the line-start mark goes.
const withQuestion = "1x Card?\n#1\nNM\nIs this mint?\n1,00 €";
assert.equal(stripMarkText(`?${withQuestion}`, ["?"]), withQuestion);
// Section text with a badge and several row marks.
const sectionText = ["Seller04", "Summary", rawLine, "1x Grave Pact\n#65\nNM\n25,99 €\n1"].join("\n");
const markedSection = ["✓Keep▾", "Seller04", "Summary", `REMOVE${rawLine}`, "KEEP\n1x Grave Pact\n#65\nNM\n25,99 €\n1"].join("\n");
assert.equal(stripMarkText(markedSection, ["✓Keep▾", "REMOVE", "KEEP"]), sectionText);
assert.equal(stripMarkText(rawLine, []), rawLine, "No marks: text unchanged.");

console.log("extension-row-matching: all assertions passed");
