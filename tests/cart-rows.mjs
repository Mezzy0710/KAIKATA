import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// The cart page renders every seller block twice (desktop + hidden mobile layout). The
// content script keeps rendered elements only (getClientRects) and dedupes the rest with
// cartforge-cart-rows.js. Here the fixture is parsed with the wants parser's tree parser and
// "rendered" is simulated from Bootstrap's responsive classes.
const sandbox = { URL };
for (const file of ["cartforge-wants-parser.js", "cartforge-wants-flow.js", "cartforge-cart-rows.js"]) {
  vm.runInNewContext(await readFile(new URL(`../extension/${file}`, import.meta.url), "utf8"), sandbox);
}
const Rows = sandbox.CartforgeCartRows;
const Flow = sandbox.CartforgeWantsFlow;
const { parseHtml } = sandbox.CartforgeWantsParser;
const plain = (value) => JSON.parse(JSON.stringify(value));

const html = await readFile(new URL("./fixtures/cart-duplicated-layouts.html", import.meta.url), "utf8");
const root = parseHtml(html);

const classes = (node) => ` ${node.attrs?.class || ""} `;
const hasClass = (name) => (node) => classes(node).includes(` ${name} `);
function findAll(node, predicate, out = []) {
  for (const child of node.children || []) {
    if (child.tag === "#text") continue;
    if (predicate(child)) out.push(child);
    findAll(child, predicate, out);
  }
  return out;
}
const find = (node, predicate) => findAll(node, predicate)[0] || null;
const textOf = (node) => (node.tag === "#text" ? node.text : (node.children || []).map(textOf).join(" ")).replace(/\s+/g, " ").trim();

// Bootstrap: `d-none d-md-block` shows on desktop only, `d-md-none` on mobile only.
function hiddenBy(viewport) {
  return (node) => (viewport === "desktop"
    ? hasClass("d-md-none")(node)
    : hasClass("d-none")(node) && !hasClass("d-md-none")(node));
}
function renderedIn(viewport) {
  const hidden = hiddenBy(viewport);
  return (node) => {
    for (let current = node; current; current = current.parent) {
      if (hidden(current)) return false;
    }
    return true;
  };
}
// innerText of the rendered part: one line per block element, hidden subtrees skipped.
function renderedText(node, isRendered) {
  const lines = [];
  (function walk(current) {
    if (current.tag === "#text") return;
    if (current !== node && !isRendered(current)) return;
    if (["p", "tr", "div", "a"].includes(current.tag) && !(current.children || []).some((child) => child.tag !== "#text")) {
      lines.push(textOf(current));
      return;
    }
    (current.children || []).forEach(walk);
  })(node);
  return lines.filter(Boolean).join("\n");
}

function readRow(row) {
  const pick = (name) => textOf(find(row, hasClass(name)) || { tag: "#text", text: "" });
  return {
    cardName: textOf(find(row, (node) => node.tag === "a") || { tag: "#text", text: "" }),
    condition: pick("article-condition"),
    price: pick("price"),
    quantity: Number.parseInt(pick("amount"), 10) || 1,
    rawLine: [pick("amount"), pick("collector"), pick("article-condition"), pick("price")].join("\n"),
    articleId: row.attrs["data-article-id"] || ""
  };
}

// Mirrors extractCartPayload / extractSeller in content-script.js.
function extract(isRendered, textVisible = isRendered) {
  const sections = Rows.pickRendered(findAll(root, (node) => node.tag === "section" && /^seller/.test(node.attrs.id || "")), isRendered);
  const sellers = sections.map((section) => {
    const text = renderedText(section, textVisible);
    const rows = Rows.pickRendered(findAll(section, hasClass("article-row")), isRendered).map(readRow);
    const items = Rows.dedupeItems(rows, { contentsCount: Rows.readContentsCount(text) });
    const anchors = findAll(section, (node) => node.tag === "a" && node.attrs.href);
    const ordered = [...anchors.filter(isRendered), ...anchors.filter((a) => !isRendered(a))];
    const links = Rows.dedupeLinks(ordered.map((a) => ({ text: textOf(a), href: a.attrs.href })), "https://www.cardmarket.com/en/Magic/ShoppingCart");
    const sellerLink = find(section, (node) => node.tag === "a" && /\/Users\/[^/]+$/.test(node.attrs.href || ""));
    return {
      sellerName: textOf(sellerLink),
      contents: Rows.readContentsCount(text),
      rowsRead: rows.length,
      items,
      links,
      ...Flow.findWantsLink(links, "https://www.cardmarket.com/en/Magic/ShoppingCart")
    };
  });
  return Rows.dedupeSellers(sellers);
}

const everyRow = findAll(root, hasClass("article-row"));
assert.equal(everyRow.length, 20, "The raw DOM holds every row twice (10 listings × 2 layouts).");

for (const viewport of ["desktop", "mobile"]) {
  const sellers = extract(renderedIn(viewport));
  assert.equal(sellers.length, 4, `${viewport}: one seller per block`);
  assert.deepEqual(plain(sellers.map((seller) => seller.sellerName)), ["AlphaCards", "BravoTCG", "CharlieMTG", "DeltaShop"]);
  sellers.forEach((seller) => {
    assert.equal(seller.rowsRead, seller.items.length, `${viewport}: ${seller.sellerName} reads each rendered row once`);
    assert.equal(Rows.articleCount(seller.items), seller.contents, `${viewport}: ${seller.sellerName} matches "Contents N Articles"`);
    assert.equal(seller.wantsListId, "24618932");
    const wantsLinks = seller.links.filter((link) => /idWantslist=/.test(link.href));
    assert.equal(wantsLinks.length, 1, `${viewport}: ${seller.sellerName}'s wants link is deduped`);
  });
  const articles = sellers.reduce((sum, seller) => sum + Rows.articleCount(seller.items), 0);
  const contents = sellers.reduce((sum, seller) => sum + seller.contents, 0);
  assert.equal(articles, 16, `${viewport}: 16 articles`);
  assert.equal(articles, contents, "The panel's article count equals the sum of Cardmarket's Contents.");
  // Same count through the send summary the panel shows.
  const summary = plain(Flow.summarizeTransfer({ payload: { sellers }, captures: {}, now: Date.now() }));
  assert.equal(summary.cartSellers, 4);
  assert.equal(summary.cartArticles, 16);
}

// Two genuinely identical listings (different article ids) both survive.
const charlie = extract(renderedIn("desktop")).find((seller) => seller.sellerName === "CharlieMTG");
assert.equal(charlie.items.length, 2);

// Safety net without any visibility information (nothing rendered → everything is read):
// article ids and the Contents count still bring every seller back to one read per article.
const unfiltered = extract(() => false, () => true);
assert.equal(unfiltered.length, 4);
assert.equal(unfiltered.reduce((sum, seller) => sum + seller.rowsRead, 0), 20);
assert.deepEqual(plain(unfiltered.map((seller) => Rows.articleCount(seller.items))), [4, 4, 2, 6]);
assert.equal(unfiltered.find((seller) => seller.sellerName === "CharlieMTG").items.length, 2, "Identical listings survive: Contents says both are real.");

// dedupeItems: field-key dedupe only while the rows exceed Contents; no Contents → always.
const row = { cardName: "Ponder", condition: "NM", price: "0,30 €", quantity: 1, rawLine: "1x\n#73\nNM\n0,30 €" };
assert.equal(Rows.dedupeItems([row, { ...row }], { contentsCount: 2 }).length, 2);
assert.equal(Rows.dedupeItems([row, { ...row }], { contentsCount: 1 }).length, 1);
assert.equal(Rows.dedupeItems([row, { ...row }]).length, 1);
assert.equal(Rows.dedupeItems([row, { ...row, rawLine: "1x\n#74\nNM\n0,30 €" }]).length, 2, "Different collector numbers are different listings.");
assert.equal(Rows.dedupeItems([row, { ...row, quantity: 2 }]).length, 2, "Different quantities are different listings.");
assert.equal(Rows.readContentsCount("Summary\nContents\n18 Articles\nArticle Value"), 18);
assert.equal(Rows.readContentsCount("Contents 1 Article"), 1);
assert.equal(Rows.readContentsCount("no summary"), null);
assert.equal(Rows.pickRendered([1, 2, 3], (value) => value === 2).length, 1);
assert.equal(Rows.pickRendered([1, 2], () => { throw new Error("detached"); }).length, 2);

console.log(JSON.stringify({ cartRows: "ok", sellers: 4, articles: 16 }));
