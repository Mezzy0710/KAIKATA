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

  // Parses one wants page. `isChallenge` flags pages that are neither offers nor an
  // empty result (Cloudflare / login / error pages): no article rows and no "Hits".
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
    return {
      meta,
      offers,
      isChallenge: rows.length === 0 && !hitsMatch
    };
  }

  function pageUrlFor(startUrl, page) {
    const url = new URL(startUrl, "https://www.cardmarket.com");
    url.searchParams.set("site", String(page));
    return url.toString();
  }

  // Walks pages 1…Y strictly one request at a time, with a random 2–4 s pause between
  // requests, at most 15 pages. Stops at the first sign of trouble and keeps what it has.
  //   fetchPage(url) → Promise<{ status, url, text() }>  (fetch with credentials in the page)
  //   sleep(ms) → Promise
  async function walkWantsPages({ startUrl, fetchPage, sleep, random = Math.random, maxPages = MAX_PAGES, onProgress = () => {}, isCancelled = () => false, capturedAt = new Date().toISOString() }) {
    const limit = Math.min(maxPages, MAX_PAGES);
    const offersById = new Map();
    let meta = null;
    let totalPages = 1;
    let pagesFetched = 0;
    let stoppedReason = null;

    for (let page = 1; page <= Math.min(totalPages, limit); page += 1) {
      if (page > 1) {
        const delay = 2000 + Math.floor(random() * 2001);
        onProgress({ page: page - 1, totalPages: Math.min(totalPages, limit), offers: offersById.size, waitingMs: delay });
        await sleep(delay);
      }
      if (isCancelled()) {
        stoppedReason = "Stopped by you.";
        break;
      }
      const url = pageUrlFor(startUrl, page);
      let response;
      try {
        response = await fetchPage(url);
      } catch (error) {
        stoppedReason = `Network error on page ${page}.`;
        break;
      }
      if (response.status === 429) {
        stoppedReason = `Cardmarket asked to slow down (HTTP 429) on page ${page}.`;
        break;
      }
      if (response.status !== 200) {
        stoppedReason = `Page ${page} returned HTTP ${response.status}.`;
        break;
      }
      if (/\/login/i.test(String(response.url || ""))) {
        stoppedReason = "Redirected to the login page. Log in on Cardmarket and try again.";
        break;
      }
      const parsed = parseWantsPage(await response.text(), url, capturedAt);
      if (parsed.isChallenge) {
        stoppedReason = `Page ${page} was a check or error page instead of offers.`;
        break;
      }
      pagesFetched += 1;
      if (!meta) {
        meta = parsed.meta;
        totalPages = Math.max(1, parsed.meta.pages || 1);
      }
      parsed.offers.forEach((offer) => offersById.set(offer.idArticle, offer));
      onProgress({ page, totalPages: Math.min(totalPages, limit), offers: offersById.size });
    }

    if (!stoppedReason && totalPages > limit) {
      stoppedReason = `Stopped at the ${limit}-page limit (${totalPages} pages).`;
    }
    return { meta, offers: [...offersById.values()], pagesFetched, totalPages, stoppedReason };
  }

  globalThis.CartforgeWantsParser = {
    MAX_PAGES,
    parseHtml,
    parseWantsPage,
    walkWantsPages,
    pageUrlFor,
    parseEuro,
    normalizeCondition
  };
})();
