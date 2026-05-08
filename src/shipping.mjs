import { parseMoney } from "./parser.mjs";

export const DESTINATION_COUNTRY = "Germany";
export const ESTIMATED_CARD_WEIGHT_G = 1.8;
export const TRACKED_VALUE_THRESHOLD = 25;
export const SHIPPING_DATA_INCLUDES_CARDMARKET_FEE = true;

export function calculateShippingCost({ shippingRecords, country, cardCount, orderValue, destinationCountry = DESTINATION_COUNTRY }) {
  const trackedRequired = Number(orderValue || 0) >= TRACKED_VALUE_THRESHOLD;
  const estimatedWeight = estimateShipmentWeight(cardCount);
  const normalizedCountry = normalizeCountryForLookup(country);
  const normalizedDestination = normalizeCountryForLookup(destinationCountry);

  if (!normalizedCountry || normalizedCountry === "unknown") {
    return unresolvedShipping({
      country,
      cardCount,
      orderValue,
      estimatedWeight,
      trackedRequired,
      reason: `Country unknown: ${country || "Unknown"}`
    });
  }

  const rows = (shippingRecords || [])
    .filter((record) => {
      const recordCountry = normalizeCountryForLookup(record.country);
      const destination = normalizeCountryForLookup(record.destination || destinationCountry);
      return recordCountry === normalizedCountry && (!destination || destination === normalizedDestination);
    })
    .filter((record) => Number.isFinite(Number(record.price)));

  if (!rows.length) {
    return unresolvedShipping({
      country,
      cardCount,
      orderValue,
      estimatedWeight,
      trackedRequired,
      reason: `No shipping rows found for ${country || "Unknown"}`
    });
  }

  const eligible = rows
    .filter((record) => {
      if (trackedRequired && !recordIsTracked(record)) {
        return false;
      }

      const maxValue = recordNumber(record, ["max_value_eur", "maxValueEur", "max_value", "maxValue", "max_order_value", "maxOrderValue"]);
      if (Number.isFinite(maxValue) && maxValue > 0 && Number(orderValue || 0) > maxValue + 0.005) {
        return false;
      }

      const maxWeight = recordNumber(record, ["max_weight_g", "maxWeightG", "maxWeight", "weight_g", "weight"]);
      if (Number.isFinite(maxWeight) && maxWeight <= 0 && estimatedWeight > 0) {
        return false;
      }
      if (Number.isFinite(maxWeight) && maxWeight > 0 && estimatedWeight > maxWeight + 0.005) {
        return false;
      }

      return true;
    })
    .sort((left, right) => Number(left.price) - Number(right.price) || Number(recordIsTracked(left)) - Number(recordIsTracked(right)));

  const selected = eligible[0];
  if (!selected) {
    return unresolvedShipping({
      country,
      cardCount,
      orderValue,
      estimatedWeight,
      trackedRequired,
      candidateCount: rows.length,
      reason: trackedRequired
        ? "No valid tracked option matched value and weight."
        : "No valid option matched value and weight."
    });
  }

  return {
    ok: true,
    cost: roundMoney(Number(selected.price)),
    basePrice: Number(selected.price),
    cardmarketFeeValue: 0,
    method: selected.method,
    tracked: recordIsTracked(selected),
    country,
    cardCount,
    orderValue: roundMoney(orderValue),
    estimatedWeight,
    trackedRequired,
    eligibleCount: eligible.length,
    candidateCount: rows.length,
    cardmarketFeeIncluded: SHIPPING_DATA_INCLUDES_CARDMARKET_FEE,
    reason: trackedRequired
      ? "Tracked required because order value is at least EUR 25.00."
      : "Tracking not required below EUR 25.00."
  };
}

export function estimateShipmentWeight(cardCount) {
  return Math.round(Math.max(0, Number(cardCount || 0) * ESTIMATED_CARD_WEIGHT_G) * 10) / 10;
}

export function recordIsTracked(record) {
  return record?.tracked === true || record?.tracked === "tracked";
}

function unresolvedShipping(details) {
  return {
    ok: false,
    cost: Number.POSITIVE_INFINITY,
    basePrice: Number.POSITIVE_INFINITY,
    cardmarketFeeValue: 0,
    method: "",
    tracked: details.trackedRequired,
    eligibleCount: 0,
    candidateCount: details.candidateCount || 0,
    cardmarketFeeIncluded: SHIPPING_DATA_INCLUDES_CARDMARKET_FEE,
    ...details
  };
}

function recordNumber(record, keys) {
  const raw = record.raw || {};
  for (const key of keys) {
    const value = raw[key] ?? record[key];
    if (value === null || value === undefined || value === "") {
      continue;
    }
    const direct = Number(value);
    if (Number.isFinite(direct)) {
      return direct;
    }
    const parsed = parseMoney(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return Number.NaN;
}

function normalizeCountryForLookup(value) {
  const text = String(value || "").toLowerCase().trim();
  if (!text) {
    return "";
  }
  if (text === "luxemburg") {
    return "luxembourg";
  }
  if (text === "deutschland") {
    return "germany";
  }
  return text;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
