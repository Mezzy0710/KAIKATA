// KAIKATA: parser + page walker for Cardmarket's "Seller's Articles on My Wants List"
// pages (/<lang>/<game>/Users/<seller>/Offers/Singles?idWantslist=<id>).
// Pure: works on HTML strings (a small tolerant HTML tree parser, no DOM), so the same
// code runs in the content script and in Node tests. Exposes globalThis.CartforgeWantsParser.
(() => {
  const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);
  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", euro: "€" };
  const CONDITIONS = {
    "mint": "Mint", "mt": "Mint",
    "near mint": "Near Mint", "nm": "Near Mint",
    "excellent": "Excellent", "ex": "Excellent",
    "good": "Good", "gd": "Good",
    "light played": "Light Played", "lp": "Light Played",
    "played": "Played", "pl": "Played",
    "poor": "Poor", "po": "Poor"
  };
  // Same country names the KAIKATA parser accepts (src/parser.mjs COUNTRY_OPTIONS).
  const COUNTRIES = new Set([
    "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic", "Denmark", "Estonia", "Finland",
    "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg", "Malta",
    "Netherlands", "Norway", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Sweden",
    "Switzerland", "United Kingdom"
  ]);
  const LANGUAGES = new Set(["English", "French", "German", "Spanish", "Italian", "Simplified Chinese", "Japanese",
    "Portuguese", "Russian", "Korean", "Traditional Chinese"]);
  const RARITY = /^(common|uncommon|rare|mythic|mythic rare|special|land|token|time shifted|masterpiece|tip card|code card)$/i;
  const SPECIAL = /^(foil|signed|altered|first edition|reverse holo)$/i;
  const MAX_PAGES = 15;

  // ── Tiny HTML tree parser ────────────────────────────────────────────────

  function decodeEntities(text) {
    return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      if (entity[0] === "#") {
        const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    });
  }

  function parseHtml(html) {
    const source = String(html || "");
    const root = { tag: "#root", attrs: {}, children: [], parent: null };
    let current = root;
    let index = 0;
    const attrPattern = /\s*([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;

    const addText = (text) => {
      if (text) current.children.push({ tag: "#text", text: decodeEntities(text), parent: current });
    };

    while (index < source.length) {
      const lt = source.indexOf("<", index);
      if (lt < 0) {
        addText(source.slice(index));
        break;
      }
      addText(source.slice(index, lt));
      if (source.startsWith("<!--", lt)) {
        const end = source.indexOf("-->", lt + 4);
        index = end < 0 ? source.length : end + 3;
        continue;
      }
      if (source[lt + 1] === "!" || source[lt + 1] === "?") {
        const end = source.indexOf(">", lt);
        index = end < 0 ? source.length : end + 1;
        continue;
      }
      if (source[lt + 1] === "/") {
        const end = source.indexOf(">", lt);
        const name = source.slice(lt + 2, end < 0 ? source.length : end).trim().toLowerCase();
        for (let node = current; node && node.tag !== "#root"; node = node.parent) {
          if (node.tag === name) {
            current = node.parent;
            break;
          }
        }
        index = end < 0 ? source.length : end + 1;
        continue;
      }
      const nameMatch = /^<([a-zA-Z][\w:-]*)/.exec(source.slice(lt, lt + 64));
      if (!nameMatch) {
        addText("<");
        index = lt + 1;
        continue;
      }
      const tag = nameMatch[1].toLowerCase();
      const attrs = {};
      let cursor = lt + nameMatch[0].length;
      let selfClosing = false;
      while (cursor < source.length) {
        while (/\s/.test(source[cursor] || "")) cursor += 1;
        if (source[cursor] === ">") {
          cursor += 1;
          break;
        }
        if (source.startsWith("/>", cursor)) {
          selfClosing = true;
          cursor += 2;
          break;
        }
        attrPattern.lastIndex = cursor;
        const attr = attrPattern.exec(source);
        if (!attr || attrPattern.lastIndex === cursor) {
          cursor += 1;
          continue;
        }
        attrs[attr[1].toLowerCase()] = decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? "");
        cursor = attrPattern.lastIndex;
      }
      const node = { tag, attrs, children: [], parent: current };
      current.children.push(node);
      index = cursor;
      if (RAW_TEXT_TAGS.has(tag)) {
        const close = source.toLowerCase().indexOf(`</${tag}`, index);
        const end = close < 0 ? source.length : close;
        if (tag !== "script" && tag !== "style") {
          node.children.push({ tag: "#text", text: decodeEntities(source.slice(index, end)), parent: node });
        }
        const closeEnd = close < 0 ? source.length : source.indexOf(">", close);
        index = closeEnd < 0 ? source.length : closeEnd + 1;
      } else if (!selfClosing && !VOID_TAGS.has(tag)) {
        current = node;
      }
    }
    return root;
  }

  function findAll(node, predicate, results = []) {
    for (const child of node.children || []) {
      if (child.tag === "#text") continue;
      if (predicate(child)) results.push(child);
      findAll(child, predicate, results);
    }
    return results;
  }

  function find(node, predicate) {
    for (const child of node.children || []) {
      if (child.tag === "#text") continue;
      if (predicate(child)) return child;
      const nested = find(child, predicate);
      if (nested) return nested;
    }
    return null;
  }

  const hasClass = (className) => (node) => ` ${node.attrs?.class || ""} `.replace(/\s+/g, " ").includes(` ${className} `);

  function textOf(node) {
    if (!node) return "";
    if (node.tag === "#text") return node.text;
    if (node.tag === "script" || node.tag === "style") return "";
    return (node.children || []).map(textOf).join(" ");
  }

  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function tooltipOf(node) {
    const attrs = node?.attrs || {};
    return clean(attrs["data-bs-original-title"] || attrs["data-original-title"] || attrs.title || attrs["aria-label"] || "");
  }

  // ── Field helpers ───────────────────────────────────────────────────────

  // "10,99 €" → 10.99, "1.234,56 €" → 1234.56
  function parseEuro(value) {
    const text = String(value || "").replace(/[^\d,.-]/g, "");
    if (!text) return null;
    const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
    const number = Number.parseFloat(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeCondition(value) {
    return CONDITIONS[clean(value).toLowerCase()] || clean(value);
  }

  function readPageUrl(pageUrl) {
    try {
      const url = new URL(pageUrl, "https://www.cardmarket.com");
      const sellerMatch = url.pathname.match(/\/Users\/([^/]+)/);
      return {
        sellerName: sellerMatch ? decodeURIComponent(sellerMatch[1]) : "",
        wantsListId: url.searchParams.get("idWantslist") || "",
        page: Number.parseInt(url.searchParams.get("site") || "1", 10) || 1
      };
    } catch {
      return { sellerName: "", wantsListId: "", page: 1 };
    }
  }

  function readCountry(root) {
    const heading = find(root, (node) => node.tag === "h1");
    const scopes = heading ? [heading.parent, heading] : [];
    for (const scope of scopes) {
      if (!scope) continue;
      for (const node of findAll(scope, (candidate) => Boolean(tooltipOf(candidate)))) {
        const value = tooltipOf(node).replace(/^(item location|location|country):\s*/i, "");
        if (COUNTRIES.has(value)) return value;
      }
    }
    return "";
  }

  function parseRow(row, context) {
    const idArticle = String(row.attrs.id || "").replace(/^stockRow/, "");
    const info = find(row, hasClass("col-sellerProductInfo")) || row;
    const link = find(info, (node) => node.tag === "a" && /\/Products\/Singles\//.test(node.attrs.href || ""));
    const tooltips = findAll(info, (node) => node !== link && Boolean(tooltipOf(node))).map(tooltipOf);

    // Classify tooltip values; fall back to their documented order
    // (expansion, rarity, condition, language, extras).
    let expansion = "";
    let rarity = "";
    let conditionLong = "";
    let language = "";
    const extras = [];
    tooltips.forEach((value) => {
      if (!conditionLong && CONDITIONS[value.toLowerCase()] && value.length > 2) conditionLong = value;
      else if (!language && LANGUAGES.has(value)) language = value;
      else if (SPECIAL.test(value)) extras.push(value);
      else if (!rarity && RARITY.test(value)) rarity = value;
      else if (!expansion) expansion = value;
    });

    const conditionCode = clean(textOf(find(find(row, hasClass("article-condition")) || row, hasClass("badge"))));
    const offer = find(row, hasClass("col-offer")) || row;
    const href = String(link?.attrs.href || "").split(/[?#]/)[0];
    return {
      idArticle,
      sellerName: context.sellerName,
      sellerCountry: context.sellerCountry,
      cardName: clean(textOf(link)),
      expansion,
      productPath: href.replace(/^https?:\/\/[^/]+/, ""),
      rarity,
      condition: normalizeCondition(conditionLong || conditionCode),
      conditionCode,
      language,
      foil: extras.some((value) => /foil/i.test(value)),
      extras,
      price: parseEuro(textOf(find(offer, hasClass("color-primary")))),
      available: Number.parseInt(clean(textOf(find(offer, hasClass("item-count")))), 10) || 1,
      capturedAt: context.capturedAt,
      wantsListId: context.wantsListId
    };
  }

  // Cardmarket's empty result: "There are no offers for your selected …". The wording
  // is English-only, so the wants filter (a form field named idWantslist) also counts:
  // Cloudflare, login and error pages never carry it.
  const EMPTY_TEXT = /There are no offers\b/i;

  function hasWantsFilter(root) {
    return Boolean(find(root, (node) => (
      (node.tag === "select" || node.tag === "input") && String(node.attrs.name || "").toLowerCase() === "idwantslist"
    )));
  }

  // Parses one wants page. `isEmpty` flags a valid page without offers (nothing on this
  // wants list in the seller's stock). `isChallenge` flags pages that are neither offers
  // nor an empty result (Cloudflare / login / error pages).
  function parseWantsPage(html, pageUrl, capturedAt = new Date().toISOString()) {
    const root = parseHtml(html);
    const urlInfo = readPageUrl(pageUrl);
    const pageText = clean(textOf(root));
    const hitsMatch = pageText.match(/([\d.,]+)\s+Hits\b/i);
    const pagesMatch = pageText.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    const meta = {
      sellerName: urlInfo.sellerName,
      wantsListId: urlInfo.wantsListId,
      sellerCountry: readCountry(root),
      hits: hitsMatch ? Number.parseInt(hitsMatch[1].replace(/[.,]/g, ""), 10) : null,
      page: pagesMatch ? Number(pagesMatch[1]) : urlInfo.page,
      pages: pagesMatch ? Number(pagesMatch[2]) : 1
    };
    const rows = findAll(root, (node) => hasClass("article-row")(node) && /^stockRow\d+$/.test(node.attrs.id || ""));
    const offers = rows.map((row) => parseRow(row, { ...meta, capturedAt }));
    const isEmpty = rows.length === 0 && (meta.hits === 0 || EMPTY_TEXT.test(pageText) || hasWantsFilter(root));
    if (isEmpty) {
      meta.hits = 0;
      meta.page = 1;
      meta.pages = 1;
    }
    return {
      meta,
      offers,
      isEmpty,
      isChallenge: rows.length === 0 && !isEmpty && !hitsMatch
    };
  }

  // Shared stop rules for every wants-page request: a reason string, or null when the
  // response is a 200 on a Cardmarket page (not the login page).
  function responseStopReason(response, page) {
    if (response.status === 429) return `Cardmarket asked to slow down (HTTP 429) on page ${page}.`;
    if (response.status !== 200) return `Page ${page} returned HTTP ${response.status}.`;
    if (/\/login/i.test(String(response.url || ""))) return "Redirected to the login page. Log in on Cardmarket and try again.";
    return null;
  }

  function pageUrlFor(startUrl, page, sortBy) {
    const url = new URL(startUrl, "https://www.cardmarket.com");
    url.searchParams.set("site", String(page));
    if (sortBy) url.searchParams.set("sortBy", sortBy);
    return url.toString();
  }

  // One sequential pass over pages 1…Y (or fewer, at the first sign of trouble), a random
  // 2–4 s pause between requests, at most `limit` pages. Shared by the first pass (the
  // page's default order) and the second, gap-filling pass (sortBy=name_desc).
  async function walkOnePass({ startUrl, fetchPage, sleep, random, limit, sortBy, pass, onProgress, isCancelled, capturedAt }) {
    const offersById = new Map();
    let rowsSeen = 0;
    let meta = null;
    let totalPages = 1;
    let pagesFetched = 0;
    let stoppedReason = null;
    let empty = false;

    for (let page = 1; page <= Math.min(totalPages, limit); page += 1) {
      if (page > 1) {
        const delay = 2000 + Math.floor(random() * 2001);
        onProgress({ page: page - 1, totalPages: Math.min(totalPages, limit), offers: offersById.size, waitingMs: delay, pass });
        await sleep(delay);
      }
      if (isCancelled()) {
        stoppedReason = "Stopped by you.";
        break;
      }
      const url = pageUrlFor(startUrl, page, sortBy);
      let response;
      try {
        response = await fetchPage(url);
      } catch (error) {
        stoppedReason = `Network error on page ${page}.`;
        break;
      }
      stoppedReason = responseStopReason(response, page);
      if (stoppedReason) break;
      const parsed = parseWantsPage(await response.text(), url, capturedAt);
      if (parsed.isChallenge) {
        stoppedReason = `Page ${page} was a check or error page instead of offers.`;
        break;
      }
      pagesFetched += 1;
      if (parsed.isEmpty) {
        // A valid page without offers: nothing on later pages either.
        if (!meta) meta = parsed.meta;
        empty = page === 1;
        onProgress({ page, totalPages: 1, offers: offersById.size, pass });
        break;
      }
      if (!meta) {
        meta = parsed.meta;
        totalPages = Math.max(1, parsed.meta.pages || 1);
      }
      rowsSeen += parsed.offers.length;
      parsed.offers.forEach((offer) => offersById.set(offer.idArticle, offer));
      onProgress({ page, totalPages: Math.min(totalPages, limit), offers: offersById.size, pass });
    }

    if (!stoppedReason && totalPages > limit) {
      stoppedReason = `Stopped at the ${limit}-page limit (${totalPages} pages).`;
    }
    return { meta, offersById, rowsSeen, pagesFetched, totalPages, stoppedReason, empty };
  }

  // Walks a seller's wants-list pages once in the page's default order, then — only if
  // that pass finished cleanly and still falls short of the page's own "N Hits" count —
  // once more sorted Z→A, merging by idArticle. Cardmarket sorts by name with no stable
  // tie-breaker, so same-name articles at a page boundary repeat in one direction while
  // others are skipped there; walking the other direction recovers most of them. Never
  // runs a third pass.
  //   fetchPage(url) → Promise<{ status, url, text() }>  (fetch with credentials in the page)
  //   sleep(ms) → Promise
  async function walkWantsPages({ startUrl, fetchPage, sleep, random = Math.random, maxPages = MAX_PAGES, onProgress = () => {}, isCancelled = () => false, capturedAt = new Date().toISOString() }) {
    const limit = Math.min(maxPages, MAX_PAGES);
    const pass1 = await walkOnePass({ startUrl, fetchPage, sleep, random, limit, pass: 1, onProgress, isCancelled, capturedAt });

    const offersById = new Map(pass1.offersById);
    let rowsSeen = pass1.rowsSeen;
    let pagesFetched = pass1.pagesFetched;
    let passes = 1;

    const hits = pass1.meta?.hits;
    const shouldFillGap = !pass1.stoppedReason && Number.isFinite(hits) && offersById.size < hits;
    if (shouldFillGap) {
      const pass2 = await walkOnePass({ startUrl, fetchPage, sleep, random, limit, sortBy: "name_desc", pass: 2, onProgress, isCancelled, capturedAt });
      passes = 2;
      rowsSeen += pass2.rowsSeen;
      pagesFetched += pass2.pagesFetched;
      pass2.offersById.forEach((offer, id) => {
        if (!offersById.has(id)) offersById.set(id, offer);
      });
    }

    const offers = [...offersById.values()];
    return {
      meta: pass1.meta,
      offers,
      pagesFetched,
      totalPages: pass1.totalPages,
      stoppedReason: pass1.stoppedReason,
      rowsSeen,
      unique: offers.length,
      duplicateRows: rowsSeen - offers.length,
      passes,
      // Page 1 was Cardmarket's empty result: a valid "no stock for this wants list".
      isEmpty: pass1.empty
    };
  }

  // "Check all sellers" on the cart page: page 1 only of each seller's wants page, one
  // request at a time, a random 2–4 s pause in between, same stop rules as the walker
  // (the whole run stops at the first 429 / non-200 / login / check page).
  //   sellers: [{ sellerName, wantsUrl }]
  // Per seller: { status: "none" } (empty result, parsed page 1 included so the caller
  // can save a 0-offer capture) or { status: "offers", hits, pages }.
  async function checkSellersFirstPage({ sellers, fetchPage, sleep, random = Math.random, onProgress = () => {}, isCancelled = () => false, capturedAt = new Date().toISOString() }) {
    const results = [];
    let stoppedReason = null;
    for (let index = 0; index < sellers.length; index += 1) {
      const seller = sellers[index];
      if (index > 0) {
        const delay = 2000 + Math.floor(random() * 2001);
        onProgress({ done: index, total: sellers.length, sellerName: seller.sellerName, waitingMs: delay, results });
        await sleep(delay);
      }
      if (isCancelled()) {
        stoppedReason = "Stopped by you.";
        break;
      }
      onProgress({ done: index, total: sellers.length, sellerName: seller.sellerName, waitingMs: 0, results });
      const url = pageUrlFor(seller.wantsUrl, 1);
      let response;
      try {
        response = await fetchPage(url);
      } catch {
        stoppedReason = `Network error while checking ${seller.sellerName}.`;
        break;
      }
      const reason = responseStopReason(response, 1);
      if (reason) {
        stoppedReason = `${seller.sellerName}: ${reason}`;
        break;
      }
      const parsed = parseWantsPage(await response.text(), url, capturedAt);
      if (parsed.isChallenge) {
        stoppedReason = `${seller.sellerName}: the wants page was a check or error page instead of offers.`;
        break;
      }
      results.push(parsed.isEmpty
        ? { sellerName: seller.sellerName, wantsUrl: seller.wantsUrl, status: "none", hits: 0, pages: 1, meta: parsed.meta }
        : {
          sellerName: seller.sellerName,
          wantsUrl: seller.wantsUrl,
          status: "offers",
          hits: Number.isFinite(parsed.meta.hits) ? parsed.meta.hits : parsed.offers.length,
          pages: Math.max(1, parsed.meta.pages || 1),
          meta: parsed.meta
        });
    }
    onProgress({ done: results.length, total: sellers.length, sellerName: "", waitingMs: 0, results });
    return { results, stoppedReason };
  }

  // "N of H offers" copy for the wants page's result card. Full (H unknown, or N ≥ H):
  // the plain success line. Partial (N < H, after a clean walk that still fell short):
  // explains the gap without implying anything was actually unrecognized.
  function captureResultText(unique, hits) {
    const count = Number(unique) || 0;
    if (!Number.isFinite(hits) || count >= hits) {
      return { text: `✓ Loaded ${offersLabel(count)}.`, complete: true };
    }
    const gap = hits - count;
    return {
      text: `Loaded ${count} of ${hits} offers. Cardmarket's page order repeats some offers `
        + `across pages, so ${gap} couldn't be reached (usually extra copies of cards that were loaded).`,
      complete: false
    };
  }

  function offersLabel(count) {
    return `${count} offer${count === 1 ? "" : "s"}`;
  }

  globalThis.CartforgeWantsParser = {
    MAX_PAGES,
    parseHtml,
    parseWantsPage,
    walkWantsPages,
    checkSellersFirstPage,
    captureResultText,
    pageUrlFor,
    parseEuro,
    normalizeCondition
  };
})();
