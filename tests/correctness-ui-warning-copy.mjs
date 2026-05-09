import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { __testing } from "../src/app.mjs";

const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const appSource = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");

assert.match(indexHtml, /Review desired quantities/);
assert.match(appSource, /Review desired cards/);
assert.match(appSource, /Different cards/);
assert.match(appSource, /Total copies/);
assert.match(appSource, /Best buying plan/);

for (const forbidden of ["Savings", "Total saved", "Difference to reviewed offer pool", "Card groups"]) {
  assert.ok(!indexHtml.includes(forbidden), `Main HTML should not show "${forbidden}".`);
}
assert.ok(!appSource.includes("Difference to reviewed offer pool"));
assert.ok(!appSource.includes("Total saved"));
assert.ok(!appSource.includes(">Savings<"));
assert.ok(!appSource.includes("Card groups"));

assert.match(appSource, /Buying plan needs update/, "Changing desired quantity should mark the plan stale and require re-run.");
assert.match(appSource, /Re-run optimization/);
assert.match(appSource, /class="result-warning/, "Warnings and cost notes should render in a dedicated visible section.");
assert.match(appSource, /Show details/, "Warning counters/sections should expose accessible details.");
assert.match(appSource, /Cost note/, "Informational assumptions should be labeled as a cost note when no critical warning exists.");
assert.match(appSource, /Fees \/ trustee \(estimated\)/, "Estimated trustee values should be clearly labeled as estimated.");
assert.match(appSource, /Why it matters:/, "Warning details should explain why the issue matters.");
assert.match(appSource, /What to do:/, "Warning details should explain what to do next.");
assert.match(appSource, /Affects:/, "Warning details should show affected seller/card when available.");

const infoOnlyResult = {
  selectedTotal: 10,
  sellerCosts: [{
    sellerIndex: 0,
    totalCost: 1.25,
    trusteeSource: "estimated_rule"
  }],
  countryWarnings: [],
  warnings: [],
  usedSellers: [{ sellerIndex: 0, seller: { sellerName: "GermanStaples" } }],
  insufficientGroups: []
};
const infoEntries = __testing.buildResultWarnings(infoOnlyResult);
assert.equal(infoEntries.length, 1);
assert.equal(infoEntries[0].severity, "info", "Informational trustee assumptions should be notes, not critical warnings.");

const criticalResult = {
  selectedTotal: 10,
  sellerCosts: [{
    sellerIndex: 0,
    totalCost: 1.25,
    trusteeSource: "estimated_rule"
  }],
  countryWarnings: [],
  warnings: ["Only 1 available."],
  usedSellers: [{ sellerIndex: 0, seller: { sellerName: "GermanStaples" } }],
  insufficientGroups: [{ cardName: "Sol Ring", desiredQuantity: 3 }]
};
const criticalEntries = __testing.buildResultWarnings(criticalResult);
const insufficientEntry = criticalEntries.find((entry) => /desired quantities/i.test(entry.title));
assert.ok(insufficientEntry, "Insufficient availability should create an action-required issue.");
assert.equal(insufficientEntry.severity, "critical");
assert.equal(insufficientEntry.affected, "Sol Ring");
for (const key of ["whatHappened", "whyItMatters", "whatToDo", "affected"]) {
  assert.ok(insufficientEntry[key], `Warning detail should include ${key}.`);
}

const warningHtml = __testing.warningBannerTemplate(criticalResult, criticalEntries);
assert.match(warningHtml, /Action required/);
assert.match(warningHtml, /Why it matters:/);
assert.match(warningHtml, /What to do:/);
assert.match(warningHtml, /Affects: Sol Ring/);

console.log(JSON.stringify({
  checkedMainCopy: true,
  infoWarningEntries: infoEntries.length,
  criticalWarningEntries: criticalEntries.length
}, null, 2));
