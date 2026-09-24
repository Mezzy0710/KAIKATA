import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Load the extension's parser as Chrome does (classic script → globalThis).
const sandbox = { URL };
vm.runInNewContext(await readFile(new URL("../extension/cartforge-wants-parser.js", import.meta.url), "utf8"), sandbox);
const { parseWantsPage, walkWantsPages, pageUrlFor, MAX_PAGES } = sandbox.CartforgeWantsParser;

const html = await readFile(new URL("./fixtures/wants-page-sample.html", import.meta.url), "utf8");
const PAGE_URL = "https://www.cardmarket.com/en/Magic/Users/SampleSeller/Offers/Singles?sortBy=name_asc&idWantslist=25431729";
const CAPTURED_AT = "2026-09-26T10:00:00.000Z";

// --- 1. Parser.
const page = parseWantsPage(html, PAGE_URL, CAPTURED_AT);
assert.deepEqual({ ...page.meta }, {
  sellerName: "SampleSeller",
  wantsListId: "25431729",
  sellerCountry: "Germany",
  hits: 222,
  page: 1,
  pages: 12
});
assert.equal(page.isChallenge, false);
assert.equal(page.offers.length, 3, "The script's fake row is not parsed.");

const [solRing, gravePact, hierarch] = page.offers;
assert.deepEqual({ ...solRing, extras: [...solRing.extras] }, {
  idArticle: "1111111",
  sellerName: "SampleSeller",
  sellerCountry: "Germany",
  cardName: "Sol Ring (V.1)",
  expansion: "Commander: Bloomburrow: Extras",
  productPath: "/en/Magic/Products/Singles/Commander-Bloomburrow-Extras/Sol-Ring-V-1",
  rarity: "Uncommon",
  condition: "Near Mint",
  conditionCode: "NM",
  language: "English",
  foil: false,
  extras: [],
  price: 10.99,
  available: 3,
  capturedAt: CAPTURED_AT,
  wantsListId: "25431729"
});
// Tooltips in `title`, HTML entity, absolute product URL, foil, thousands separator.
assert.equal(gravePact.expansion, "Dungeons & Dragons: Adventures in the Forgotten Realms");
assert.equal(gravePact.productPath, "/en/Magic/Products/Singles/Adventures-in-the-Forgotten-Realms/Grave-Pact");
assert.equal(gravePact.condition, "Excellent");
assert.equal(gravePact.language, "German");
assert.equal(gravePact.foil, true);
assert.equal(gravePact.price, 1234.56);
// aria-label / data-bs-original-title tooltips; first price and first count only.
assert.equal(hierarch.expansion, "Modern Horizons 2");
assert.equal(hierarch.condition, "Light Played");
assert.equal(hierarch.conditionCode, "LP");
assert.equal(hierarch.price, 0.89);
assert.equal(hierarch.available, 12);

// Country: only names from the parser's country list are accepted.
const noCountry = parseWantsPage(html.replace('data-bs-original-title="Germany"', 'data-bs-original-title="Atlantis"'), PAGE_URL);
assert.equal(noCountry.meta.sellerCountry, "");

// Challenge / empty pages.
assert.equal(parseWantsPage("<html><body><h1>Just a moment...</h1></body></html>", PAGE_URL).isChallenge, true);
assert.equal(parseWantsPage("<html><body><p>0 Hits</p></body></html>", PAGE_URL).isChallenge, false, "An empty result is not a challenge.");

// --- 2. Walker with injected fetch and sleep.
function pageHtml(pageNumber, totalPages) {
  return html
    .replace("Page 1 of 12", `Page ${pageNumber} of ${totalPages}`)
    .replace(/stockRow(\d+)/g, (match, id) => `stockRow${pageNumber}${id}`)
    .replace(/idArticle\[(\d+)\]/g, (match, id) => `idArticle[${pageNumber}${id}]`);
}

function fakeSite({ totalPages, failAt = {} }) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchPage = async (url) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    calls.push(url);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
    const pageNumber = Number(new URL(url).searchParams.get("site"));
    const failure = failAt[pageNumber];
    if (failure === 429) return { status: 429, url, text: async () => "Too many requests" };
    if (failure === 500) return { status: 500, url, text: async () => "Error" };
    if (failure === "login") return { status: 200, url: "https://www.cardmarket.com/en/Magic/Login", text: async () => "<form>Log in</form>" };
    if (failure === "challenge") return { status: 200, url, text: async () => "<html><body>Checking your browser…</body></html>" };
    return { status: 200, url, text: async () => pageHtml(pageNumber, totalPages) };
  };
  return { calls, fetchPage, maxInFlight: () => maxInFlight };
}

function recorder(randomValues = [0, 0.99999, 0.5]) {
  const sleeps = [];
  let index = 0;
  return {
    sleeps,
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => randomValues[index++ % randomValues.length]
  };
}

// Full walk: pages 1…3, sequential, 2 pauses within 2–4 s.
let site = fakeSite({ totalPages: 3 });
let timing = recorder();
let walk = await walkWantsPages({ startUrl: PAGE_URL, fetchPage: site.fetchPage, sleep: timing.sleep, random: timing.random, capturedAt: CAPTURED_AT });
assert.equal(walk.pagesFetched, 3);
assert.equal(walk.offers.length, 9);
assert.equal(walk.stoppedReason, null);
assert.deepEqual(site.calls.map((url) => new URL(url).searchParams.get("site")), ["1", "2", "3"]);
assert.ok(site.calls.every((url) => new URL(url).searchParams.get("idWantslist") === "25431729"), "Keeps the wants-list filter.");
assert.equal(site.maxInFlight(), 1, "Requests never overlap.");
assert.equal(timing.sleeps.length, 2, "A pause between requests, none before the first.");
assert.ok(timing.sleeps.every((ms) => ms >= 2000 && ms <= 4000), `Pauses ${timing.sleeps}`);
assert.deepEqual(timing.sleeps, [2000, 4000]);

// HTTP 429 on page 2: stop, keep page 1.
site = fakeSite({ totalPages: 5, failAt: { 2: 429 } });
walk = await walkWantsPages({ startUrl: PAGE_URL, fetchPage: site.fetchPage, sleep: recorder().sleep });
assert.equal(site.calls.length, 2);
assert.equal(walk.offers.length, 3);
assert.match(walk.stoppedReason, /429/);

// Challenge page on page 3.
site = fakeSite({ totalPages: 5, failAt: { 3: "challenge" } });
walk = await walkWantsPages({ startUrl: PAGE_URL, fetchPage: site.fetchPage, sleep: recorder().sleep });
assert.equal(site.calls.length, 3);
assert.equal(walk.offers.length, 6);
assert.match(walk.stoppedReason, /check or error page/);

// Redirect to login, and a non-200 status.
site = fakeSite({ totalPages: 5, failAt: { 1: "login" } });
walk = await walkWantsPages({ startUrl: PAGE_URL, fetchPage: site.fetchPage, sleep: recorder().sleep });
assert.equal(walk.offers.length, 0);
assert.match(walk.stoppedReason, /login/i);
site = fakeSite({ totalPages: 5, failAt: { 2: 500 } });
walk = await walkWantsPages({ startUrl: PAGE_URL, fetchPage: site.fetchPage, sleep: recorder().sleep });
assert.match(walk.stoppedReason, /HTTP 500/);

// 15-page hard limit, even if a caller asks for more.
site = fakeSite({ totalPages: 40 });
timing = recorder([0.3]);
walk = await walkWantsPages({ startUrl: PAGE_URL, fetchPage: site.fetchPage, sleep: timing.sleep, random: timing.random, maxPages: 100 });
assert.equal(MAX_PAGES, 15);
assert.equal(site.calls.length, 15);
assert.equal(walk.pagesFetched, 15);
assert.match(walk.stoppedReason, /15-page limit/);
assert.equal(site.maxInFlight(), 1);
assert.ok(timing.sleeps.every((ms) => ms >= 2000 && ms <= 4000));

// Stop button: cancellation is checked before each request.
site = fakeSite({ totalPages: 5 });
let cancel = false;
walk = await walkWantsPages({
  startUrl: PAGE_URL,
  fetchPage: site.fetchPage,
  sleep: async () => { cancel = true; },
  isCancelled: () => cancel
});
assert.equal(site.calls.length, 1);
assert.equal(walk.stoppedReason, "Stopped by you.");

assert.equal(new URL(pageUrlFor(PAGE_URL, 4)).searchParams.get("site"), "4");

console.log("wants-parser: all assertions passed");
