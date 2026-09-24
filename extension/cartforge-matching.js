// KAIKATA row matching for the Cardmarket cart overlay. Pure: no DOM access.
// Loaded as a content script before content-script.js; exposes globalThis.CartforgeMatching.
(() => {
  const CONDITION_CODES = {
    "mint": "mt", "mt": "mt", "m": "mt",
    "near mint": "nm", "nm": "nm",
    "excellent": "ex", "ex": "ex", "exc": "ex",
    "good": "gd", "gd": "gd",
    "light played": "lp", "lp": "lp",
    "played": "pl", "pl": "pl",
    "poor": "po", "po": "po"
  };
  const PRICE_EPSILON = 0.005;

  // Same normalization the confirmed plan uses for `normalizedCardName`
  // (src/confirmed-plan.mjs normalizePlanKey). The plan keeps "(V.2)"-style suffixes,
  // so they are kept here too.
  function normalizeCardName(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeCondition(value) {
    const text = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
    return CONDITION_CODES[text] || text;
  }

  function normalizeCollector(value) {
    return String(value || "").replace(/^#/, "").trim().toLowerCase();
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

  // Page rows carry the collector number either as its own field, as a "#123" set
  // label, or as a "#123" line in the row text.
  function readCollector(domRow) {
    if (domRow.collectorNumber) return normalizeCollector(domRow.collectorNumber);
    if (/^#\w+$/.test(String(domRow.setName || "").trim())) return normalizeCollector(domRow.setName);
    const match = String(domRow.rawLine || "").match(/(?:^|\n)\s*#(\w+)\s*(?:\n|$)/);
    return match ? normalizeCollector(match[1]) : "";
  }

  // Empty on either side means "unknown", not "different".
  function fieldMatches(left, right) {
    return !left || !right || left === right;
  }

  function rowMatches(dom, plan) {
    if (!dom.name || dom.name !== plan.name) return false;
    if (!fieldMatches(dom.collector, plan.collector)) return false;
    if (!fieldMatches(dom.condition, plan.condition)) return false;
    if (dom.price !== null && plan.price !== null && Math.abs(dom.price - plan.price) > PRICE_EPSILON) return false;
    return true;
  }

  // domRows: items read from one seller section (extractItem output), in document order.
  // planRows: confirmed-plan rows for that seller.
  // Returns one { status, keepQty, cartQty, planRow } per DOM row. Each plan row is
  // consumed once; ties go to the first unconsumed plan row in plan order.
  function matchRowsToPlan(domRows, planRows, options = {}) {
    const sellerDropped = options.sellerDecision === "drop";
    const candidates = (planRows || []).map((row) => ({
      row,
      used: false,
      name: row.normalizedCardName || normalizeCardName(row.cardName),
      collector: normalizeCollector(row.collectorNumber),
      condition: normalizeCondition(row.condition),
      price: parsePrice(row.unitPrice)
    }));

    return (domRows || []).map((domRow) => {
      const cartQty = Math.max(1, Number.parseInt(domRow.quantity, 10) || 1);
      if (sellerDropped) {
        // Every article of a dropped seller goes, matched or not.
        return { status: "remove", keepQty: 0, cartQty, planRow: null };
      }
      const dom = {
        name: normalizeCardName(domRow.cardName),
        collector: readCollector(domRow),
        condition: normalizeCondition(domRow.condition),
        price: parsePrice(domRow.price)
      };
      const candidate = candidates.find((entry) => !entry.used && rowMatches(dom, entry));
      if (!candidate) {
        return { status: "unmatched", keepQty: null, cartQty, planRow: null };
      }
      candidate.used = true;
      const planRow = candidate.row;
      if (planRow.decision === "manual_review") {
        return { status: "review", keepQty: null, cartQty, planRow };
      }
      if (planRow.decision === "selected") {
        const keepQty = Number(planRow.selectedQuantity || planRow.quantity || 1);
        // Compared with the live cart quantity, so a row the user already reduced reads as done.
        return { status: cartQty > keepQty ? "reduce" : "keep", keepQty, cartQty, planRow };
      }
      return { status: "remove", keepQty: 0, cartQty, planRow };
    });
  }

  function markLabel(match) {
    if (match.status === "keep") return "KEEP";
    if (match.status === "remove") return "REMOVE";
    if (match.status === "reduce") return `KEEP ${match.keepQty} OF ${match.cartQty}`;
    if (match.status === "review") return "REVIEW";
    return "?";
  }

  // Removes the text of KAIKATA marks from an element's innerText so extraction reads
  // exactly what it would read without marks. Marks sit at the start of a line (they
  // are prepended to a row); each mark removes its first line-start occurrence plus a
  // directly following line break.
  function stripMarkText(text, markTexts) {
    let result = String(text || "");
    for (const markText of markTexts || []) {
      const needle = String(markText || "");
      if (!needle) continue;
      let from = 0;
      while (from <= result.length) {
        const index = result.indexOf(needle, from);
        if (index < 0) break;
        const atLineStart = index === 0 || /\n[ \t]*$/.test(result.slice(Math.max(0, index - 8), index));
        if (atLineStart) {
          const end = index + needle.length;
          const skipBreak = result[end] === "\n" ? 1 : 0;
          result = result.slice(0, index) + result.slice(end + skipBreak);
          break;
        }
        from = index + 1;
      }
    }
    return result;
  }

  // Live counter summary from mark statuses (article counts use cart quantities).
  function summarizeMarks(marks) {
    return (marks || []).reduce((summary, mark) => {
      if (mark.status === "remove") summary.removeArticles += Number(mark.cartQty) || 1;
      if (mark.status === "reduce") summary.reduceRows += 1;
      if (mark.status === "unmatched") summary.unmatchedRows += 1;
      if (mark.status === "review") summary.reviewRows += 1;
      return summary;
    }, { removeArticles: 0, reduceRows: 0, unmatchedRows: 0, reviewRows: 0 });
  }

  globalThis.CartforgeMatching = {
    normalizeCardName,
    normalizeCondition,
    normalizeCollector,
    parsePrice,
    matchRowsToPlan,
    markLabel,
    stripMarkText,
    summarizeMarks
  };
})();
