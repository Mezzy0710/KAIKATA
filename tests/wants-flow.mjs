import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { __testing } from "../src/app.mjs";

// Load the extension's pure scripts the way Chrome does (classic scripts → globalThis).
const sandbox = { URL };
vm.runInNewContext(await readFile(new URL("../extension/cartforge-wants-parser.js", import.meta.url), "utf8"), sandbox);
vm.runInNewContext(await readFile(new URL("../extension/cartforge-wants-flow.js", import.meta.url), "utf8"), sandbox);
const Flow = sandbox.CartforgeWantsFlow;
const { parseHtml } = sandbox.CartforgeWantsParser;

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const minutesAgo = (minutes) => new Date(NOW - minutes * 60000).toISOString();
const plain = (value) => JSON.parse(JSON.stringify(value)); // sandbox objects → this realm

// --- 1. Cart extraction: wants link from a seller block + snapshot.
function anchors(node, out = []) {
  if (node.tag === "a") {
    const text = (function textOf(n) { return n.tag === "#text" ? n.text : (n.children || []).map(textOf).join(""); })(node);
    out.push({ text: text.replace(/\s+/g, " ").trim(), href: node.attrs.href || "" });
  }
  (node.children || []).forEach((child) => anchors(child, out));
  return out;
}
const block = await readFile(new URL("./fixtures/cart-seller-block.html", import.meta.url), "utf8");
const links = anchors(parseHtml(block));
assert.equal(links.length, 5, "Seller, more articles, wants list and two card links.");
const wantsLink = plain(Flow.findWantsLink(links, "https://www.cardmarket.com/en/Magic/ShoppingCart"));
assert.deepEqual(wantsLink, {
  wantsUrl: "https://www.cardmarket.com/en/Magic/Users/SampleSeller/Offers/Singles?sortBy=name_asc&idWantslist=25431729",
  wantsListId: "25431729"
}, "The id comes from the link; the link without idWantslist is skipped.");

// The href decides, not the (language-dependent) link text.
assert.equal(Flow.findWantsLink([{ text: "Artikel des Verkäufers auf meiner Wants-Liste", href: "/de/Magic/Users/X/Offers/Singles?idWantslist=77" }]).wantsListId, "77");
assert.equal(Flow.findWantsLink([{ text: "Seller's Articles on My Wants List", href: "/en/Magic/Users/X/Offers/Singles" }]).wantsListId, "");
assert.equal(Flow.findWantsLink([]).wantsUrl, "");

const payload = {
  url: "https://www.cardmarket.com/en/Magic/ShoppingCart",
  sellers: [
    {
      sellerName: "SampleSeller",
      ...wantsLink,
      items: [
        { cardName: "Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel (V.3)", price: "12,50 €", condition: "NM", quantity: 1 },
        { cardName: "Grave Pact", price: "25,99 €", condition: "EX", quantity: 2 }
      ]
    },
    { sellerName: "NoLinkSeller", wantsUrl: "", wantsListId: "", items: [{ cardName: "Sol Ring (V.1)", price: "1.234,56 €", condition: "NM", quantity: 1 }] }
  ]
};
const snapshot = plain(Flow.buildCartSnapshot(payload, NOW));
assert.equal(snapshot.capturedAt, "2026-09-26T12:00:00.000Z");
assert.deepEqual(snapshot.wantsListIds, ["25431729"]);
assert.equal(snapshot.cartUrl, payload.url);
assert.deepEqual(snapshot.sellers[0], {
  sellerName: "SampleSeller",
  wantsUrl: wantsLink.wantsUrl,
  wantsListId: "25431729",
  cards: [
    { name: "sephiroth fabled soldier sephiroth one winged angel", price: 12.5, condition: "NM" },
    { name: "grave pact", price: 25.99, condition: "EX" }
  ]
});
assert.deepEqual(snapshot.sellers[1].cards, [{ name: "sol ring", price: 1234.56, condition: "NM" }]);

// Card names use exactly KAIKATA's grouping key (src/app.mjs normalizeOfferKey).
for (const name of [
  "Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel (V.3)",
  "Sol Ring (V.1)",
  "Squee, the Immortal",
  "Lim-Dûl's Vault",
  "Asmoranomardicadaistinaculdacar",
  "  Jötun Grunt  ",
  "Fire // Ice",
  "Borrowing 100,000 Arrows"
]) {
  assert.equal(Flow.normalizeCardKey(name), __testing.normalizeOfferKey(name), `Same key as KAIKATA for "${name}"`);
}

// --- 2. Transfer filter (background → KAIKATA).
const capture = (sellerName, wantsListId, capturedAt, offers = 3) => ({
  sellerName,
  wantsListId,
  capturedAt,
  offers: Array.from({ length: offers }, (_, i) => ({ idArticle: `${sellerName}-${i}`, cardName: "Grave Pact", price: 20 }))
});
const stored = {
  sampleseller: capture("SampleSeller", "25431729", minutesAgo(12), 4),
  otherlist: capture("OtherList", "999", minutesAgo(30), 2),
  oldone: capture("OldOne", "25431729", minutesAgo(25 * 60), 5),
  extraseller: capture("ExtraSeller", "25431729", minutesAgo(5), 6)
};
const transfer = plain(Flow.filterCapturesForTransfer(stored, ["25431729"], NOW));
assert.deepEqual(transfer.sellers.map((entry) => entry.sellerName), ["SampleSeller", "ExtraSeller"]);
assert.deepEqual(transfer.excluded, { stale: 1, otherWantsList: 1 });
assert.equal(transfer.fallback, false);

// Fallback: a cart without wantsListIds (older extension, pasted cart) → age rule only.
const fallback = plain(Flow.filterCapturesForTransfer(Object.values(stored), [], NOW));
assert.deepEqual(fallback.sellers.map((entry) => entry.sellerName), ["SampleSeller", "OtherList", "ExtraSeller"]);
assert.deepEqual(fallback.excluded, { stale: 1, otherWantsList: 0 });
assert.equal(fallback.fallback, true);
assert.equal(Flow.filterCapturesForTransfer(stored, undefined, NOW).fallback, true);
assert.equal(Flow.filterCapturesForTransfer(stored, ["25431729"], NOW + 24 * 3600000).sellers.length, 0, "Everything is stale a day later.");

// The background answers CARTFORGE_V3_GET_CANDIDATES with exactly this filter.
{
  let listener = null;
  const context = vm.createContext({
    URL,
    Date: class extends Date { static now() { return NOW; } },
    chrome: {
      runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
      storage: { local: { get: async (key) => ({ [key]: stored }), set: async () => {}, remove: async () => {} } }
    }
  });
  const flowSource = await readFile(new URL("../extension/cartforge-wants-flow.js", import.meta.url), "utf8");
  context.importScripts = (file) => {
    assert.equal(file, "cartforge-wants-flow.js");
    vm.runInContext(flowSource, context);
  };
  vm.runInContext(await readFile(new URL("../extension/background.js", import.meta.url), "utf8"), context);
  const ask = (message) => new Promise((resolve) => {
    assert.equal(listener(message, {}, resolve), true, "Async response");
  });
  const filtered = plain(await ask({ type: "CARTFORGE_V3_GET_CANDIDATES", wantsListIds: ["25431729"] }));
  assert.equal(filtered.ok, true);
  assert.deepEqual(filtered.sellers.map((entry) => [entry.sellerName, entry.offers.length, entry.stale]), [["SampleSeller", 4, false], ["ExtraSeller", 6, false]]);
  assert.deepEqual(filtered.excluded, { stale: 1, otherWantsList: 1 });
  assert.equal(filtered.fallback, false);
  // Older KAIKATA builds send no wantsListIds: 24 h rule only.
  const legacy = plain(await ask({ type: "CARTFORGE_V3_GET_CANDIDATES" }));
  assert.equal(legacy.fallback, true);
  assert.deepEqual(legacy.sellers.map((entry) => entry.sellerName), ["SampleSeller", "OtherList", "ExtraSeller"]);
}

// Send summary on the cart page counts only what will be transferred.
const summary = plain(Flow.summarizeTransfer({ payload, captures: stored, now: NOW }));
assert.deepEqual(summary, { cartSellers: 2, cartArticles: 4, stockSellers: 2, stockOffers: 10, excluded: { stale: 1, otherWantsList: 1 }, fallback: false });
assert.equal(
  Flow.formatTransferSummary(summary),
  "Sends your cart (2 sellers, 4 articles) + wants stock from 2 sellers (10 offers). Not sent: 1 older than 24 h, 1 from another wants list."
);
assert.equal(
  Flow.formatTransferSummary(Flow.summarizeTransfer({ payload, captures: {}, now: NOW })),
  "Sends your cart (2 sellers, 4 articles) + no wants stock loaded."
);

// Checklist: one line per cart seller, extra sellers listed separately.
const checklist = plain(Flow.sellerChecklist(snapshot, stored, NOW));
assert.equal(checklist.total, 2);
assert.equal(checklist.loadedCount, 1);
assert.deepEqual(checklist.rows.map((row) => [row.sellerName, row.status, row.offerCount]), [["SampleSeller", "loaded", 4], ["NoLinkSeller", "not-loaded", 0]]);
assert.equal(Flow.formatAge(checklist.rows[0].ageMs), "12 min ago");
assert.deepEqual(checklist.extras.map((extra) => extra.sellerName), ["OtherList", "ExtraSeller"], "Fresh captures of sellers not in the cart.");
assert.equal(checklist.extras[0].sameWantsList, false);
const staleChecklist = plain(Flow.sellerChecklist(snapshot, { sampleseller: capture("SampleSeller", "25431729", minutesAgo(26 * 60)) }, NOW));
assert.equal(staleChecklist.rows[0].status, "stale");
const otherListChecklist = plain(Flow.sellerChecklist(snapshot, { sampleseller: capture("SampleSeller", "1", minutesAgo(1)) }, NOW));
assert.equal(otherListChecklist.rows[0].status, "other-list");

// "Next seller": first unloaded cart seller with a wants link, never the current one.
const twoLinked = { ...snapshot, sellers: [snapshot.sellers[0], { ...snapshot.sellers[0], sellerName: "Second", wantsUrl: "https://www.cardmarket.com/en/Magic/Users/Second/Offers/Singles?idWantslist=25431729" }, snapshot.sellers[1]] };
assert.equal(Flow.nextUnloadedSeller(twoLinked, {}, NOW)?.sellerName, "SampleSeller");
assert.equal(Flow.nextUnloadedSeller(twoLinked, {}, NOW, "SampleSeller")?.sellerName, "Second");
assert.equal(Flow.nextUnloadedSeller(twoLinked, stored, NOW)?.sellerName, "Second");
assert.equal(Flow.nextUnloadedSeller(snapshot, stored, NOW), null, "NoLinkSeller has no wants link to open.");

// --- 3. Wants-page comparison: K cards found, J cheaper than the lowest cart price.
const cartForCompare = Flow.buildCartSnapshot({
  sellers: [
    { sellerName: "A", items: [{ cardName: "Grave Pact", price: "1,00 €" }, { cardName: "Food Chain", price: "5,00 €" }] },
    { sellerName: "B", items: [{ cardName: "Grave Pact", price: "0,80 €" }, { cardName: "Sol Ring (V.1)", price: "2,00 €" }, { cardName: "Unpriced", price: null }] }
  ]
}, NOW);
const comparison = plain(Flow.compareStockToCart(cartForCompare, [
  { cardName: "Sol Ring (V.2)", price: 1.5 },           // cheaper; "(V.x)" ignored
  { cardName: "Grave Pact", price: 0.9 },               // found, but 0.80 in the cart is lower
  { cardName: "Grave Pact", price: 0.8 },               // equal is not cheaper
  { cardName: "Food Chain", price: 5.5 },               // found, dearer
  { cardName: "Black Lotus", price: 0.01 },             // not in the cart
  { cardName: "Unpriced", price: 0.1 }                  // found; no cart price to compare
]));
assert.equal(comparison.found, 4);
assert.equal(comparison.cheaper, 1);
assert.deepEqual(comparison.cheaperCards, ["sol ring"]);
assert.deepEqual(plain(Flow.compareStockToCart(null, [{ cardName: "Grave Pact", price: 1 }])), { found: 0, cheaper: 0, foundCards: [], cheaperCards: [] });

console.log(JSON.stringify({ wantsFlow: "ok", transferred: transfer.sellers.length, excluded: transfer.excluded, comparison: { found: comparison.found, cheaper: comparison.cheaper } }));
