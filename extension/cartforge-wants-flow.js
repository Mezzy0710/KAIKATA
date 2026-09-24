// KAIKATA wants-stock flow helpers. Pure: no DOM, no chrome.* access.
// Loaded before content-script.js (cart page), wants-page.js (wants pages) and via
// importScripts in background.js; exposes globalThis.CartforgeWantsFlow.
//
//   cart page  → cart snapshot + checklist of which sellers' wants stock is loaded
//   wants page → "K of your cart's cards are in this seller's stock, J cheaper"
//   background → which captures go to KAIKATA (fresh + same wants list)
(() => {
  const STALE_MS = 24 * 60 * 60 * 1000;
  const SNAPSHOT_KEY = "cartforgeCartSnapshotV1";
  const CANDIDATES_KEY = "cartforgeCandidatesV1";
  const PRICE_EPSILON = 0.005;
  const BASE_URL = "https://www.cardmarket.com";

  // Same key as KAIKATA's normalizeOfferKey(cardName) in src/app.mjs: drop a trailing
  // "(…)" such as "(V.3)", lowercase, everything else non-alphanumeric → one space.
  function normalizeCardKey(name) {
    return String(name || "")
      .replace(/\s+\([^)]+\)$/i, "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Same key the wants page uses for cartforgeCandidatesV1 entries.
  function normalizeSellerKey(name) {
    return String(name || "").trim().toLowerCase();
  }

  // "0,39 €" → 0.39, "1.234,56 €" → 1234.56, 12.5 → 12.5
  function parsePrice(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const text = String(value || "").replace(/[^\d,.-]/g, "");
    if (!text) return null;
    const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
    const number = Number.parseFloat(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function wantsListIdFromUrl(url) {
    if (!url) return "";
    try {
      const parsed = new URL(url, BASE_URL);
      for (const [key, value] of parsed.searchParams) {
        if (key.toLowerCase() === "idwantslist" && value) return value;
      }
    } catch {
      // Not a URL.
    }
    return "";
  }

  // links: [{ text, href }] from one cart seller block. The wants link is
  // /<lang>/<game>/Users/<seller>/Offers/Singles?…&idWantslist=<id>; its text is
  // "Seller's Articles on My Wants List" in English (the href test is language-independent).
  function findWantsLink(links = [], baseUrl = BASE_URL) {
    const found = [];
    for (const link of links) {
      let url;
      try {
        url = new URL(String(link?.href || ""), baseUrl);
      } catch {
        continue;
      }
      if (!/\/Users\/[^/]+\/Offers\/Singles\/?$/i.test(url.pathname)) continue;
      const wantsListId = wantsListIdFromUrl(url.toString());
      if (!wantsListId) continue;
      found.push({ wantsUrl: url.toString(), wantsListId, byText: /wants\s*list/i.test(String(link?.text || "")) });
    }
    const best = found.find((entry) => entry.byText) || found[0];
    return best ? { wantsUrl: best.wantsUrl, wantsListId: best.wantsListId } : { wantsUrl: "", wantsListId: "" };
  }

  function uniqueIds(values) {
    return [...new Set(values.map((value) => String(value || "")).filter(Boolean))];
  }

  // Light copy of the cart for the wants pages (K/J comparison, "Next seller").
  function buildCartSnapshot(payload, now = Date.now()) {
    const sellers = (payload?.sellers || []).map((seller) => ({
      sellerName: String(seller.sellerName || ""),
      wantsUrl: String(seller.wantsUrl || ""),
      wantsListId: String(seller.wantsListId || wantsListIdFromUrl(seller.wantsUrl)),
      cards: (seller.items || []).map((item) => ({
        name: normalizeCardKey(item.cardName),
        price: parsePrice(item.price),
        condition: String(item.condition || "")
      })).filter((card) => card.name)
    }));
    return {
      capturedAt: new Date(now).toISOString(),
      cartUrl: String(payload?.url || ""),
      wantsListIds: uniqueIds(payload?.wantsListIds || sellers.map((seller) => seller.wantsListId)),
      sellers
    };
  }

  function isFresh(capture, now = Date.now()) {
    const time = Date.parse(capture?.capturedAt || "");
    return Number.isFinite(time) && now - time <= STALE_MS;
  }

  function captureList(captures) {
    if (Array.isArray(captures)) return captures.filter(Boolean);
    return Object.values(captures || {}).filter(Boolean);
  }

  function offerCount(capture) {
    return Array.isArray(capture?.offers) ? capture.offers.length : 0;
  }

  // What goes to KAIKATA: captures < 24 h old whose wants list is one of the cart's.
  // Without wantsListIds (older extension, pasted cart) only the age rule applies.
  function filterCapturesForTransfer(captures, wantsListIds, now = Date.now()) {
    const ids = new Set(uniqueIds(Array.isArray(wantsListIds) ? wantsListIds : []));
    const fallback = ids.size === 0;
    const excluded = { stale: 0, otherWantsList: 0 };
    const sellers = [];
    for (const capture of captureList(captures)) {
      if (!Array.isArray(capture.offers)) continue;
      if (!isFresh(capture, now)) {
        excluded.stale += 1;
        continue;
      }
      if (!fallback && !ids.has(String(capture.wantsListId || ""))) {
        excluded.otherWantsList += 1;
        continue;
      }
      sellers.push(capture);
    }
    return { sellers, excluded, fallback };
  }

  // One line per cart seller: loaded / stale / other-list / not-loaded, plus captured
  // sellers that are not in this cart ("extra sellers").
  function sellerChecklist(snapshot, captures, now = Date.now()) {
    const byName = new Map(captureList(captures).map((capture) => [normalizeSellerKey(capture.sellerName), capture]));
    const cartIds = new Set(uniqueIds(snapshot?.wantsListIds || []));
    const cartNames = new Set();
    const rows = (snapshot?.sellers || []).map((seller) => {
      const key = normalizeSellerKey(seller.sellerName);
      cartNames.add(key);
      const capture = byName.get(key);
      const expectedId = seller.wantsListId || wantsListIdFromUrl(seller.wantsUrl);
      let status = "not-loaded";
      if (capture) {
        const sameList = expectedId
          ? String(capture.wantsListId || "") === expectedId
          : !cartIds.size || cartIds.has(String(capture.wantsListId || ""));
        status = !isFresh(capture, now) ? "stale" : sameList ? "loaded" : "other-list";
      }
      return {
        sellerName: seller.sellerName,
        wantsUrl: seller.wantsUrl || "",
        status,
        offerCount: capture ? offerCount(capture) : 0,
        ageMs: capture ? Math.max(0, now - Date.parse(capture.capturedAt)) : null
      };
    });
    const extras = captureList(captures)
      .filter((capture) => !cartNames.has(normalizeSellerKey(capture.sellerName)) && isFresh(capture, now))
      .map((capture) => ({
        sellerName: capture.sellerName,
        offerCount: offerCount(capture),
        ageMs: Math.max(0, now - Date.parse(capture.capturedAt)),
        sameWantsList: !cartIds.size || cartIds.has(String(capture.wantsListId || ""))
      }));
    return {
      rows,
      total: rows.length,
      loadedCount: rows.filter((row) => row.status === "loaded").length,
      extras
    };
  }

  // First cart seller (in cart order) whose stock is not loaded yet and has a wants link.
  function nextUnloadedSeller(snapshot, captures, now = Date.now(), skipSellerName = "") {
    const skip = normalizeSellerKey(skipSellerName);
    return sellerChecklist(snapshot, captures, now).rows.find((row) => (
      row.status !== "loaded" && row.wantsUrl && normalizeSellerKey(row.sellerName) !== skip
    )) || null;
  }

  // Counts for the send button: the cart plus the captures that will be transferred.
  function summarizeTransfer({ payload, captures, now = Date.now() }) {
    const sellers = payload?.sellers || [];
    const wantsListIds = uniqueIds(payload?.wantsListIds || sellers.map((seller) => seller.wantsListId));
    const transfer = filterCapturesForTransfer(captures, wantsListIds, now);
    return {
      cartSellers: sellers.length,
      cartArticles: sellers.reduce((sum, seller) => sum + (seller.items || []).reduce((s, item) => s + (Number(item.quantity) || 1), 0), 0),
      stockSellers: transfer.sellers.length,
      stockOffers: transfer.sellers.reduce((sum, capture) => sum + offerCount(capture), 0),
      excluded: transfer.excluded,
      fallback: transfer.fallback
    };
  }

  function plural(count, word) {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
  }

  function formatTransferSummary(summary) {
    const cart = `Sends your cart (${plural(summary.cartSellers, "seller")}, ${plural(summary.cartArticles, "article")})`;
    const stock = summary.stockSellers
      ? ` + wants stock from ${plural(summary.stockSellers, "seller")} (${plural(summary.stockOffers, "offer")})`
      : " + no wants stock loaded";
    const parts = [];
    if (summary.excluded?.stale) parts.push(`${summary.excluded.stale} older than 24 h`);
    if (summary.excluded?.otherWantsList) parts.push(`${summary.excluded.otherWantsList} from another wants list`);
    const excluded = parts.length ? `. Not sent: ${parts.join(", ")}.` : ".";
    return `${cart}${stock}${excluded}`;
  }

  // Wants page: how many of the cart's cards this seller's stock has (K), and for how
  // many of those it is cheaper than the lowest price for that card in the cart (J).
  function compareStockToCart(snapshot, offers = []) {
    const cartNames = new Set();
    const cartLowest = new Map();
    (snapshot?.sellers || []).forEach((seller) => (seller.cards || []).forEach((card) => {
      const key = normalizeCardKey(card.name);
      if (!key) return;
      cartNames.add(key);
      const price = parsePrice(card.price);
      if (price !== null && (!cartLowest.has(key) || price < cartLowest.get(key))) cartLowest.set(key, price);
    }));
    const stockLowest = new Map();
    offers.forEach((offer) => {
      const key = normalizeCardKey(offer.cardName);
      if (!cartNames.has(key)) return;
      const price = parsePrice(offer.price);
      if (!stockLowest.has(key)) stockLowest.set(key, null);
      if (price !== null && (stockLowest.get(key) === null || price < stockLowest.get(key))) stockLowest.set(key, price);
    });
    const foundCards = [...stockLowest.keys()];
    const cheaperCards = foundCards.filter((key) => {
      const stock = stockLowest.get(key);
      return stock !== null && cartLowest.has(key) && stock < cartLowest.get(key) - PRICE_EPSILON;
    });
    return { found: foundCards.length, cheaper: cheaperCards.length, foundCards, cheaperCards };
  }

  function formatAge(ms) {
    const minutes = Math.max(0, Math.round((Number(ms) || 0) / 60000));
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
  }

  globalThis.CartforgeWantsFlow = {
    STALE_MS,
    SNAPSHOT_KEY,
    CANDIDATES_KEY,
    normalizeCardKey,
    normalizeSellerKey,
    parsePrice,
    wantsListIdFromUrl,
    findWantsLink,
    buildCartSnapshot,
    isFresh,
    filterCapturesForTransfer,
    sellerChecklist,
    nextUnloadedSeller,
    summarizeTransfer,
    formatTransferSummary,
    compareStockToCart,
    formatAge
  };
})();
