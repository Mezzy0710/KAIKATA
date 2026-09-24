// Calibrates Cardmarket's official shipping table with what the cart itself shows.
// Pure: no DOM, no app state. The result is a per-seller list of shipping rows that
// calculateShippingCost searches exactly like the table ("cheapest eligible row"), so
// shipping stays dynamic in weight and order value.
//
// Why cart observations are safe to reuse: every offer the optimizer can pick is already
// in the cart, so in any plan a seller ships at most its current cart card count, and
// therefore at most its current weight. An option seen in the cart is available for
// every subset the optimizer can build, subject to value limits.
// Exception: threshold offers ("Free shipping over 100€"). Those only exist *because*
// the cart value is high and would wrongly make smaller subsets free, so they are ignored.
import { estimateShipmentWeight, normalizeCountryForLookup } from "./shipping.mjs?v=20260925a";

const PRICE_EPSILON = 0.005;
const PRICED_LINE = /^(.*?)\s*\(\s*([\d.,]+)\s*€\s*\)\s*(?:max\.?\s*weight:?\s*([\d.,]+)\s*g)?\s*$/i;
const CATEGORY_KEYS = {
  "letter": "letter",
  "tracked letter": "trackedLetter",
  "tracked parcel": "trackedParcel"
};
// Assumptions for category rows, which carry no limits in the dropdown: value caps per
// category (Letter: untracked mail tops out at the €25 tracking threshold; Tracked Letter
// €100 and Tracked Parcel €500 match the common caps in Cardmarket's table).
const CATEGORY_RULES = {
  letter: { label: "Letter", tracked: false, isLetter: true, maxValue: 25 },
  trackedLetter: { label: "Tracked Letter", tracked: true, isLetter: true, maxValue: 100 },
  trackedParcel: { label: "Tracked Parcel", tracked: true, isLetter: false, maxValue: 500 }
};
const THRESHOLD_OFFER = /\b(free|gratis|kostenlos|frei)\b|\b(over|above|ab|from|über|ueber)\s*\d|>\s*\d/i;

// Parses a seller's shipping dropdown text, e.g.
//   Select shipping method
//   Regular Letter (2,27 €) max. Weight: 50g   <- selected method
//   No tracking                                <- its tracking status
//   Letter (2,27 €)                            <- category entries: assumed to be the
//   Tracked Letter (5,20 €)                       cheapest option of that category for
//   Tracked Parcel (26,89 €)                      the current cart contents
// Returns null when the text has no dropdown at all (e.g. pasted-text carts).
export function parseObservedShipping(text, observedAt = null) {
  const lines = String(text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const start = lines.findIndex((line) => /select shipping method/i.test(line));
  if (start < 0) {
    return null;
  }

  const categories = { letter: null, trackedLetter: null, trackedParcel: null };
  let selected = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(PRICED_LINE);
    if (!match) {
      continue;
    }
    const name = match[1].trim();
    const price = parseEuro(match[2]);
    const categoryKey = CATEGORY_KEYS[name.toLowerCase()];
    if (categoryKey && match[3] === undefined) {
      categories[categoryKey] = price;
      continue;
    }
    if (!selected) {
      selected = {
        method: name,
        price,
        maxWeightG: match[3] !== undefined ? parseEuro(match[3]) : null,
        tracked: readTracked(lines[index + 1], name)
      };
    }
  }

  return { selected, categories, observedAt: observedAt || null };
}

export function buildSellerShippingRecords({ shippingRecords = [], sellers = [], cartCardCountBySeller = new Map() }) {
  const corrections = [];
  const ignored = [];
  const records = shippingRecords.map((record) => ({ ...record }));
  const countryKey = (value) => normalizeCountryForLookup(value);

  // 1. Country price updates: the selected method matches a table row exactly.
  const observationsByRow = new Map();
  const unmatchedSelected = new Map();
  sellers.forEach((seller, sellerIndex) => {
    const selected = seller.observedShipping?.selected;
    if (!selected || !Number.isFinite(selected.price)) {
      return;
    }
    if (isThresholdOffer(selected)) {
      ignored.push({ country: seller.sellerCountry, sellerName: seller.sellerName, method: selected.method, observedPrice: selected.price, reason: "threshold_offer" });
      return;
    }
    const row = records.find((record) => (
      countryKey(record.country) === countryKey(seller.sellerCountry) &&
      normalizeMethod(record.method) === normalizeMethod(selected.method) &&
      rowNumber(record, "max_weight_g") === selected.maxWeightG
    ));
    if (!row) {
      unmatchedSelected.set(sellerIndex, selected);
      return;
    }
    if (!observationsByRow.has(row)) {
      observationsByRow.set(row, []);
    }
    observationsByRow.get(row).push({ price: selected.price, sellerName: seller.sellerName });
  });

  observationsByRow.forEach((observations, row) => {
    const tablePrice = Number(row.price);
    // Sellers of one country can disagree (currency conversion timing); keep the higher.
    const chosen = Math.max(...observations.map((observation) => observation.price));
    const distinct = [...new Set(observations.map((observation) => observation.price))]
      .filter((price) => Math.abs(price - tablePrice) > PRICE_EPSILON);
    distinct.forEach((price) => corrections.push({
      country: row.country,
      sellerName: null,
      method: row.method,
      maxWeightG: rowNumber(row, "max_weight_g"),
      tablePrice,
      observedPrice: price,
      kind: "price_update",
      applied: price === chosen,
      observedBy: observations.filter((observation) => observation.price === price).map((observation) => observation.sellerName)
    }));
    if (Math.abs(chosen - tablePrice) > PRICE_EPSILON) {
      row.price = chosen;
      row.raw = { ...(row.raw || {}), price: chosen };
      row.calibrated = true;
    }
  });

  // 2. Seller-specific rows, then assemble each seller's list (table rows stay in it so
  // lighter subsets still reach cheaper weight brackets).
  const recordsBySellerIndex = new Map();
  sellers.forEach((seller, sellerIndex) => {
    const countryRows = records.filter((record) => countryKey(record.country) === countryKey(seller.sellerCountry));
    const baseRows = countryRows.length ? countryRows : records;
    const sellerRows = [];
    const observed = seller.observedShipping;
    const tableCountry = countryRows[0]?.country || seller.sellerCountry;
    const cartWeight = estimateShipmentWeight(cartCardCountBySeller.get(sellerIndex) ?? seller.items?.length ?? 0);

    const selected = unmatchedSelected.get(sellerIndex);
    if (selected && selected.price > 0) {
      const tracked = Boolean(selected.tracked);
      sellerRows.push(makeRow({
        country: tableCountry,
        sellerIndex,
        method: selected.method,
        price: selected.price,
        tracked,
        isLetter: selected.maxWeightG !== null ? selected.maxWeightG <= 100 : /letter|brief|lettre|carta|lettera/i.test(selected.method),
        maxWeightG: selected.maxWeightG ?? cartWeight,
        maxValue: tracked ? 100 : 25
      }));
      corrections.push({ country: tableCountry, sellerName: seller.sellerName, method: selected.method, maxWeightG: selected.maxWeightG ?? cartWeight, tablePrice: null, observedPrice: selected.price, kind: "seller_method" });
    }

    const skippedPrice = isThresholdOffer(observed?.selected || {}) ? observed.selected.price : null;
    Object.entries(CATEGORY_RULES).forEach(([key, rule]) => {
      const price = observed?.categories?.[key];
      if (!Number.isFinite(price)) {
        return;
      }
      if (price <= 0 || price === skippedPrice) {
        ignored.push({ country: tableCountry, sellerName: seller.sellerName, method: rule.label, observedPrice: price, reason: "threshold_offer" });
        return;
      }
      const tableRow = cheapestCategoryRow(countryRows, rule, cartWeight);
      const tablePrice = tableRow ? Number(tableRow.price) : null;
      if (tablePrice !== null && price >= tablePrice - PRICE_EPSILON) {
        return;
      }
      sellerRows.push(makeRow({
        country: tableCountry,
        sellerIndex,
        method: rule.label,
        price,
        tracked: rule.tracked,
        isLetter: rule.isLetter,
        maxWeightG: cartWeight,
        maxValue: rule.maxValue
      }));
      corrections.push({ country: tableCountry, sellerName: seller.sellerName, method: rule.label, maxWeightG: cartWeight, tablePrice, observedPrice: price, kind: "category_cheaper" });
    });

    recordsBySellerIndex.set(sellerIndex, [...baseRows, ...sellerRows]);
  });

  return { recordsBySellerIndex, corrections, ignored };
}

function cheapestCategoryRow(rows, rule, cartWeight) {
  return rows
    .filter((row) => Boolean(row.tracked === true || row.tracked === "tracked") === rule.tracked)
    .filter((row) => Boolean(row.raw?.is_letter ?? row.is_letter) === rule.isLetter)
    .filter((row) => {
      const maxWeight = rowNumber(row, "max_weight_g");
      return maxWeight === null || maxWeight >= cartWeight;
    })
    .reduce((best, row) => (!best || Number(row.price) < Number(best.price) ? row : best), null);
}

function makeRow({ country, sellerIndex, method, price, tracked, isLetter, maxWeightG, maxValue }) {
  const raw = { method, tracked, max_value: maxValue, max_weight_g: maxWeightG, price, is_letter: isLetter, observedInCart: true };
  return {
    id: `cart-${sellerIndex}-${normalizeMethod(method).replace(/\s+/g, "-")}`,
    country,
    destination: "Germany",
    method,
    tracked,
    price,
    max_value: maxValue,
    max_weight_g: maxWeightG,
    is_letter: isLetter,
    observedInCart: true,
    sellerIndex,
    raw
  };
}

function isThresholdOffer(selected) {
  return Number(selected.price) <= 0 || THRESHOLD_OFFER.test(String(selected.method || ""));
}

function readTracked(line, method) {
  if (/^no tracking$/i.test(String(line || "").trim())) return false;
  if (/^tracked$/i.test(String(line || "").trim())) return true;
  return /tracked|registered|einschreiben|insured|suivi|raccomandata|certificad/i.test(method);
}

function rowNumber(row, key) {
  const value = row.raw?.[key] ?? row[key];
  const number = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(number) ? null : number;
}

function normalizeMethod(method) {
  return String(method || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

// "2,27" → 2.27, "1.234,56" → 1234.56, "2.27" → 2.27
function parseEuro(value) {
  const text = String(value || "").trim();
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const number = Number.parseFloat(normalized);
  return Number.isFinite(number) ? number : null;
}
