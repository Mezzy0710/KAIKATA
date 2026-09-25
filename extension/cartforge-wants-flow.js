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
  // "Check all sellers" results for sellers with offers (page 1 only, never saved as offers).
  const CHECKS_KEY = "cartforgeWantsCheckV1";
  const EMPTY_RESULT_TEXT = "✓ No extra stock for your wants list here (everything they have is already in your cart or nothing matches).";
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

  // A seller whose wants page is Cardmarket's empty result: checked, nothing extra.
  function isEmptyCapture(capture) {
    return Array.isArray(capture?.offers) && capture.offers.length === 0;
  }

  // The 0-offer capture saved for an empty wants page (same shape as a full load).
  function emptyCapture({ sellerName, sellerCountry = "", wantsListId, now = Date.now() }) {
    return {
      sellerName: String(sellerName || ""),
      sellerCountry: String(sellerCountry || ""),
      wantsListId: String(wantsListId || ""),
      capturedAt: new Date(now).toISOString(),
      hits: 0,
      totalPages: 1,
      pagesFetched: 1,
      stoppedReason: null,
      unique: 0,
      passes: 1,
      empty: true,
      offers: []
    };
  }

  // Check results (CHECKS_KEY) that still apply: < 24 h old and for the seller's wants list.
  function checkFor(checks, seller, expectedId, now) {
    const entry = checks?.[normalizeSellerKey(seller.sellerName)];
    if (!entry || !isFresh({ capturedAt: entry.checkedAt }, now)) return null;
    if (expectedId && String(entry.wantsListId || "") !== expectedId) return null;
    return Number.isFinite(entry.hits) ? { hits: entry.hits, pages: Number(entry.pages) || 1, checkedAt: entry.checkedAt } : null;
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
  // sellers that are not in this cart ("extra sellers"). A 0-offer capture (empty wants
  // page) is loaded, with `empty: true`. With "Check all sellers" results (`checks`),
  // not-loaded sellers known to have offers come first, each with `checked: { hits, pages }`.
  function sellerChecklist(snapshot, captures, now = Date.now(), checks = null) {
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
      const checked = status === "loaded" ? null : checkFor(checks, seller, expectedId, now);
      return {
        sellerName: seller.sellerName,
        wantsUrl: seller.wantsUrl || "",
        status,
        empty: status === "loaded" && isEmptyCapture(capture),
        offerCount: capture ? offerCount(capture) : 0,
        hits: capture && Number.isFinite(capture.hits) ? capture.hits : null,
        ageMs: capture ? Math.max(0, now - Date.parse(capture.capturedAt)) : null,
        checked
      };
    });
    // Stable: sellers with offers found by "Check all sellers" first, then cart order.
    const withOffers = (row) => Boolean(row.checked && row.checked.hits > 0);
    const ordered = [...rows.filter(withOffers), ...rows.filter((row) => !withOffers(row))];
    const extras = captureList(captures)
      .filter((capture) => !cartNames.has(normalizeSellerKey(capture.sellerName)) && isFresh(capture, now))
      .map((capture) => ({
        sellerName: capture.sellerName,
        offerCount: offerCount(capture),
        hits: Number.isFinite(capture.hits) ? capture.hits : null,
        ageMs: Math.max(0, now - Date.parse(capture.capturedAt)),
        sameWantsList: !cartIds.size || cartIds.has(String(capture.wantsListId || ""))
      }));
    return {
      rows: ordered,
      total: rows.length,
      loadedCount: rows.filter((row) => row.status === "loaded").length,
      emptyCount: rows.filter((row) => row.empty).length,
      extras
    };
  }

  // First cart seller (checklist order: known offers first, then cart order) whose stock
  // is not loaded yet and has a wants link. 0-offer captures count as loaded.
  function nextUnloadedSeller(snapshot, captures, now = Date.now(), skipSellerName = "", checks = null) {
    const skip = normalizeSellerKey(skipSellerName);
    return sellerChecklist(snapshot, captures, now, checks).rows.find((row) => (
      row.status !== "loaded" && row.wantsUrl && normalizeSellerKey(row.sellerName) !== skip
    )) || null;
  }

  // Wants-page panel header, always visible: with a cart snapshot, the cart-scoped count
  // (same freshness/wants-list rules as sellerChecklist); without one, every fresh capture
  // there is, with no cart to compare against yet.
  function wantsStockProgress(snapshot, captures, now = Date.now()) {
    if (snapshot && (snapshot.sellers || []).length) {
      const checklist = sellerChecklist(snapshot, captures, now);
      const offers = checklist.rows
        .filter((row) => row.status === "loaded")
        .reduce((sum, row) => sum + row.offerCount, 0);
      return {
        hasCart: true,
        sellersLoaded: checklist.loadedCount,
        sellersTotal: checklist.total,
        offers,
        text: `Wants stock: ${checklist.loadedCount} of ${checklist.total} cart sellers loaded · ${plural(offers, "offer")}`
      };
    }
    const entries = captureList(captures);
    const offers = entries.reduce((sum, entry) => sum + offerCount(entry), 0);
    return {
      hasCart: false,
      sellersLoaded: entries.length,
      sellersTotal: null,
      offers,
      text: `Wants stock: ${plural(entries.length, "seller")} loaded · ${plural(offers, "offer")} `
        + "· open your cart once to see which sellers are still missing"
    };
  }

  // Result-card follow-up line: how many of the cart's sellers are loaded and who's next,
  // or that every cart seller with a wants link is loaded. Null without a cart to count against.
  function nextStepLine(snapshot, captures, now = Date.now(), currentSellerName = "", checks = null) {
    if (!snapshot || !(snapshot.sellers || []).length) return null;
    const checklist = sellerChecklist(snapshot, captures, now, checks);
    if (!checklist.total) return null;
    if (checklist.loadedCount === checklist.total) {
      return { text: "All cart sellers loaded — back to cart to transfer", complete: true, next: null };
    }
    const next = nextUnloadedSeller(snapshot, captures, now, currentSellerName, checks);
    return {
      text: next
        ? `That's ${checklist.loadedCount} of ${checklist.total}. Next: ${next.sellerName} →`
        : `That's ${checklist.loadedCount} of ${checklist.total}.`,
      complete: false,
      next
    };
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
      emptySellers: transfer.sellers.filter(isEmptyCapture).length,
      excluded: transfer.excluded,
      fallback: transfer.fallback
    };
  }

  function plural(count, word) {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
  }

  function formatTransferSummary(summary) {
    const cart = `Sends your cart (${plural(summary.cartSellers, "seller")}, ${plural(summary.cartArticles, "article")})`;
    const empty = summary.emptySellers || 0;
    const withOffers = summary.stockSellers - empty;
    const stock = !summary.stockSellers ? " + no wants stock loaded"
      : !withOffers ? ` + ${plural(empty, "seller")} checked with nothing extra`
        : ` + wants stock from ${plural(withOffers, "seller")} (${plural(summary.stockOffers, "offer")})`
          + (empty ? ` + ${empty} checked with nothing extra` : "");
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
    CHECKS_KEY,
    EMPTY_RESULT_TEXT,
    normalizeCardKey,
    normalizeSellerKey,
    parsePrice,
    wantsListIdFromUrl,
    findWantsLink,
    buildCartSnapshot,
    isFresh,
    isEmptyCapture,
    emptyCapture,
    filterCapturesForTransfer,
    sellerChecklist,
    nextUnloadedSeller,
    wantsStockProgress,
    nextStepLine,
    summarizeTransfer,
    formatTransferSummary,
    compareStockToCart,
    formatAge
  };
})();
