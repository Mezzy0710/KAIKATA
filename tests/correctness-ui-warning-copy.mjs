import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { __testing } from "../src/app.mjs";

const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const appSource = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");

assert.match(indexHtml, /CartForge/);
assert.match(indexHtml, /Find the cheapest way to buy your cards/);
assert.match(indexHtml, /Review cards & quantities/);
assert.match(indexHtml, /What to buy from each seller/);
assert.match(appSource, /Different cards/);
assert.match(appSource, /Total copies/);
assert.match(appSource, /Best buying plan/);

for (const forbidden of ["Total saved", "Difference to reviewed offer pool", "Card groups", "Advanced details"]) {
  assert.ok(!indexHtml.includes(forbidden), `Main HTML should not show "${forbidden}".`);
}
assert.ok(!appSource.includes("Difference to reviewed offer pool"));
assert.ok(!appSource.includes("Total saved"));
assert.ok(!appSource.includes("Card groups"));
for (const forbiddenPhrase of ["route selected", "seller route", "journey"]) {
  assert.ok(!indexHtml.toLowerCase().includes(forbiddenPhrase), `Main HTML should not use "${forbiddenPhrase}" language.`);
  assert.ok(!appSource.toLowerCase().includes(forbiddenPhrase), `App copy should not use "${forbiddenPhrase}" language.`);
}

assert.match(appSource, /Quantities changed\. Generate the plan again\./, "Changing desired quantity should mark the plan stale and require re-run.");
assert.match(appSource, /Generate best buying plan again|Generate best buying plan/);
assert.match(appSource, /class="result-warning/, "Warnings and cost notes should render in a dedicated visible section.");
assert.match(appSource, /Show all warning details/, "Warning counters/sections should expose accessible details.");
assert.match(appSource, /Quick note/, "Informational assumptions should be labeled as a note when no critical warning exists.");
assert.match(appSource, /Fees \/ trustee/, "Trustee values should be clearly labeled.");
assert.match(appSource, /Estimated /, "Estimated trustee values should be clearly labeled as estimated.");
assert.match(appSource, /Why it matters:/, "Warning details should explain why the issue matters.");
assert.match(appSource, /What to do:/, "Warning details should explain what to do next.");
assert.match(appSource, /Affects:/, "Warning details should show affected seller/card when available.");
assert.match(appSource, /market price/, "The UI should render visible reference price wording.");
assert.match(appSource, /Reference/, "The UI should render visible reference column heading.");

__testing.state.desiredQuantityByCard = { "Arcane Signet": 1 };
__testing.state.scryallLookupInProgress = false;
__testing.state.priceReferences = {
  [__testing.normalizeReferenceKey("Arcane Signet")]: {
    price: 0.8,
    currency: "EUR",
    source: "Scryfall",
    error: false
  }
};

const desiredCardsHtml = __testing.desiredCardsTableTemplate([{
  cardName: "Arcane Signet",
  requiredQuantity: 1,
  sellerCount: 4,
  lowestUnitPrice: 0.85,
  offers: [{ quantity: 1 }]
}]);
assert.match(desiredCardsHtml, /Reference/);
assert.match(desiredCardsHtml, /EUR 0\.80/, "Rendered desired card rows should show the fetched Scryfall price.");
assert.match(desiredCardsHtml, /tooltip-chip/, "Rendered desired card rows should show a visible tooltip trigger.");
assert.match(desiredCardsHtml, /reference-delta-badge/, "Rendered desired card rows should show a visible delta badge.");

__testing.state.desiredQuantityByCard = { "Arcane Signet": 0 };
const excludedDesiredCardsHtml = __testing.desiredCardsTableTemplate([{
  cardName: "Arcane Signet",
  requiredQuantity: 1,
  sellerCount: 4,
  lowestUnitPrice: 0.85,
  offers: [{ quantity: 1 }]
}]);
assert.match(excludedDesiredCardsHtml, /value="0"/, "Quantity 0 should stay visible in the desired cards control.");
assert.match(excludedDesiredCardsHtml, /Excluded/, "Quantity 0 should render as excluded in the desired cards table.");

const sellerPlanHtml = __testing.sellerPlanTemplate(
  { sellerName: "ItalianValue", sellerCountry: "Italy", shippingMethod: "Posta", trackingStatus: "untracked" },
  0,
  1,
  [{ cardName: "Rhystic Study", requiredQuantity: 1, quantity: 1, condition: "Excellent", unitPrice: 24.8 }],
  {
    articleValue: 24.8,
    shippingValue: 4.05,
    trusteeFeeValue: 0,
    cardmarketFeeValue: 0,
    totalCost: 4.05,
    shippingMethod: "Postapriority Internazionale - Ufficio Postale",
    trackingStatus: "untracked",
    source: "recalculated",
    sourceLabel: "Dynamic shipping from table",
    estimatedWeight: 1.8,
    shippingDebug: {
      trackedRequired: false,
      orderValue: 24.8,
      cardCount: 1,
      estimatedWeight: 1.8,
      reason: "Tracking not required below EUR 25.00.",
      basePrice: 4.05,
      cardmarketFeeIncluded: true
    }
  }
);
assert.match(sellerPlanHtml, /EUR 28\.85/, "Seller plan cards should display full totals including cards plus shipping.");
assert.doesNotMatch(sellerPlanHtml, />\s*EUR 4\.05\s*<\/strong>\s*<\/div>\s*<\/header>/, "Seller total header must not show shipping-only totals.");

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
assert.match(warningHtml, /Must fix before buying/);
assert.match(warningHtml, /Why it matters:/);
assert.match(warningHtml, /What to do:/);
assert.match(warningHtml, /Affects: Sol Ring/);

console.log(JSON.stringify({
  checkedMainCopy: true,
  desiredCardsShowsScryfall: true,
  sellerPlanShowsFullTotal: true,
  infoWarningEntries: infoEntries.length,
  criticalWarningEntries: criticalEntries.length
}, null, 2));
