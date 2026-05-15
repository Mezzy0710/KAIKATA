import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseCart } from "../src/parser.mjs";
import { __testing } from "../src/app.mjs";

const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));

async function parseFixture(name) {
  const raw = await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
  return parseCart(raw, shippingData);
}

const basic = await parseFixture("sample-cart-basic.txt");
assert.equal(basic.sellerCount, 1);
assert.equal(basic.sellers[0].sellerName, "GermanStaples");
assert.equal(basic.sellers[0].sellerCountry, "Germany");
assert.doesNotMatch(basic.sellers[0].sellerName, /^Seller \d+$/);

const basicSolRing = basic.sellers[0].items.find((item) => item.cardName === "Sol Ring");
assert.ok(basicSolRing, "Expected Sol Ring to be parsed from basic fixture.");
assert.equal(basicSolRing.quantity, 2, "2x Sol Ring must not be reduced to 1x.");
assert.equal(basicSolRing.condition, "Near Mint");
assert.equal(basicSolRing.price, 1.2);

const complex = await parseFixture("sample-cart-complex-quantity-threshold.txt");
assert.equal(complex.sellerCount, 7);
assert.equal(complex.itemCount, 16);
assert.ok(complex.sellers.every((seller) => !/^Seller \d+$/i.test(seller.sellerName)), "Real seller names should be retained.");

const sellerNames = complex.sellers.map((seller) => seller.sellerName);
assert.equal(sellerNames.filter((name) => name === "GermanStaples").length, 2, "Duplicate seller blocks should remain consistently represented as separate parsed blocks.");

const complexCountries = new Map(complex.sellers.map((seller) => [seller.sellerName, seller.sellerCountry]));
assert.equal(complexCountries.get("ItalyBelow"), "Italy");
assert.equal(complexCountries.get("ItalyAtThreshold"), "Italy");
assert.equal(complexCountries.get("DutchStaples"), "Netherlands");

const allItems = complex.sellers.flatMap((seller) => seller.items.map((item) => ({ ...item, sellerName: seller.sellerName })));
const arcaneSignet = allItems.find((item) => item.cardName === "Arcane Signet");
const solRing = allItems.find((item) => item.cardName === "Sol Ring");
assert.equal(arcaneSignet.quantity, 2, "2x Arcane Signet must not be reduced to 1x.");
assert.equal(solRing.quantity, 2, "2x Sol Ring must not be reduced to 1x.");
assert.equal(allItems.find((item) => item.cardName === "Smothering Tithe").price, 25);
assert.equal(allItems.find((item) => item.cardName === "Swiftfoot Boots" && item.sellerName === "GermanStaples").condition, "Good");

const offerGroups = __testing.buildOfferGroups(complex.sellers);
const desiredByCard = Object.fromEntries(offerGroups.map((group) => [group.cardName, group.requiredQuantity]));
assert.equal(desiredByCard["Sol Ring"], 2, "Desired quantities should initialize from parsed 2x rows.");
assert.equal(desiredByCard["Arcane Signet"], 2, "Desired quantities should initialize from parsed 2x rows.");
assert.equal(__testing.getTotalCopies(offerGroups), 17);
assert.ok(offerGroups.length >= 9, "Complex fixture should include at least 9 different cards.");

const wizard = await parseFixture("sample-cart-wizard.txt");
assert.equal(wizard.sellerCount, 5);
const wizardNames = wizard.sellers.map(s => s.sellerName);
assert.ok(wizardNames.includes("MOe-HH"));
assert.ok(wizardNames.includes("Kingcrawler"));
assert.ok(!wizardNames.includes("Mezzy"), "Mezzy must not be parsed as a seller");
const wizardItems = wizard.sellers.flatMap(s => s.items);
assert.ok(wizardItems.some(i => i.cardName === "Crystal Shard"));
assert.ok(wizardItems.some(i => i.cardName === "Majestic Genesis"));

console.log(JSON.stringify({
  fixtures: ["sample-cart-basic.txt", "sample-cart-complex-quantity-threshold.txt", "sample-cart-wizard.txt"],
  parsedSellers: complex.sellerCount,
  parsedItems: complex.itemCount,
  desiredQuantities: {
    "Sol Ring": desiredByCard["Sol Ring"],
    "Arcane Signet": desiredByCard["Arcane Signet"]
  }
}, null, 2));
