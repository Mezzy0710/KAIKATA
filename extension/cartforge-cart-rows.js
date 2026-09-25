// KAIKATA: read each Cardmarket cart row once. Pure: no DOM access (the content script
// passes the rendered check in), so Node tests use the same code.
// Loaded before content-script.js; exposes globalThis.CartforgeCartRows.
//
// Cardmarket renders every seller block twice: a desktop layout and a mobile layout, one
// of them hidden with CSS. Reading both doubled every article (32 rows for 16 articles)
// and, since innerText of a hidden element is its flattened textContent, produced the
// glued "1xFecundityFecundity#145EX…" rows. The content script keeps only rendered
// elements (whichever layout the viewport shows) and this module dedupes what is left.
(() => {
  // Rendered elements only; when none is rendered (a background tab before layout, an
  // unusual page), all of them, so extraction never comes back empty because of this.
  function pickRendered(elements, isRendered) {
    const list = [...(elements || [])];
    const rendered = list.filter((element) => {
      try {
        return Boolean(isRendered(element));
      } catch {
        return false;
      }
    });
    return rendered.length ? rendered : list;
  }

  // "Contents\n16 Articles" in a seller's summary → 16. Null when the line is missing.
  function readContentsCount(text) {
    const match = String(text || "").match(/\bContents\s*\n?\s*(\d+)\s*Articles?\b/i);
    return match ? Number.parseInt(match[1], 10) : null;
  }

  function quantityOf(item) {
    return Math.max(1, Number.parseInt(item?.quantity, 10) || 1);
  }

  function articleCount(items) {
    return (items || []).reduce((sum, item) => sum + quantityOf(item), 0);
  }

  const clean = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();

  function collectorOf(item) {
    const match = String(item?.rawLine || "").match(/(?:^|\n)\s*#(\w+)\s*(?:\n|$)/);
    return match ? match[1].toLowerCase() : "";
  }

  function priceOf(item) {
    return String(item?.price || "").replace(/[^\d,.]/g, "");
  }

  // (card, collector number, condition, price, quantity): one listing within a seller.
  function itemKey(item) {
    return [clean(item?.cardName), collectorOf(item), clean(item?.condition), priceOf(item), quantityOf(item)].join("|");
  }

  // Within one seller. By article id where the row carries one (exact). Then by itemKey,
  // but only while the rows add up to more articles than Cardmarket's own "Contents N
  // Articles" (or when that count is unknown), so two genuinely identical listings survive
  // whenever the count shows they are both real.
  function dedupeItems(items, { contentsCount = null } = {}) {
    const seenIds = new Set();
    const byId = [];
    (items || []).forEach((item) => {
      const id = String(item?.articleId || "");
      if (id && seenIds.has(id)) return;
      if (id) seenIds.add(id);
      byId.push(item);
    });
    const known = Number.isFinite(contentsCount);
    if (known && articleCount(byId) <= contentsCount) return byId;
    const seenKeys = new Set();
    const result = [];
    let total = articleCount(byId);
    byId.forEach((item) => {
      const key = itemKey(item);
      const excess = !known || total > contentsCount;
      if (seenKeys.has(key) && excess) {
        total -= quantityOf(item);
        return;
      }
      seenKeys.add(key);
      result.push(item);
    });
    return result;
  }

  // Links as [{ text, href }]: one per resolved href, first occurrence wins (callers pass
  // rendered links first).
  function dedupeLinks(links, baseUrl = "https://www.cardmarket.com") {
    const seen = new Set();
    return (links || []).filter((link) => {
      let key;
      try {
        key = new URL(String(link?.href || ""), baseUrl).toString();
      } catch {
        key = String(link?.href || "");
      }
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // One seller per name (the cart has one shipment per seller); the first one wins.
  function dedupeSellers(sellers) {
    const seen = new Set();
    return (sellers || []).filter((seller) => {
      const key = clean(seller?.sellerName);
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  globalThis.CartforgeCartRows = {
    pickRendered,
    readContentsCount,
    articleCount,
    itemKey,
    dedupeItems,
    dedupeLinks,
    dedupeSellers
  };
})();
