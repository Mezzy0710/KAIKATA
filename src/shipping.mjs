import { parseMoney } from "./parser.mjs";

export const DESTINATION_COUNTRY = "Germany";
export const ESTIMATED_CARD_WEIGHT_G = 1.8;
export const TRACKED_VALUE_THRESHOLD = 25;
export const SHIPPING_DATA_INCLUDES_CARDMARKET_FEE = true;
export const TRUSTEE_VALUE_THRESHOLD = 25;
export const REGISTERED_TRUSTEE_RATE = 0.01;
export const TRACKED_TRUSTEE_RATE = 0.005;

export function calculateShippingCost({ shippingRecords, country, cardCount, orderValue, destinationCountry = DESTINATION_COUNTRY }) {
  const trackedRequired = moneyToCents(orderValue) >= moneyToCents(TRACKED_VALUE_THRESHOLD);
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
    isRegistered: recordIsRegistered(selected),
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

export function calculateTrusteeFee({ articleValue, shippingMethod, tracked = false, isRegistered = false, sellerLifetimeSales = null }) {
  const normalizedArticleValue = roundMoney(articleValue);
  const hasLowSalesData = sellerLifetimeSales !== null && sellerLifetimeSales !== undefined && sellerLifetimeSales !== "" && Number.isFinite(Number(sellerLifetimeSales));
  const lowSalesTrigger = hasLowSalesData && Number(sellerLifetimeSales) < 5;
  const valueTrigger = moneyToCents(normalizedArticleValue) >= moneyToCents(TRUSTEE_VALUE_THRESHOLD);
  const applies = valueTrigger || lowSalesTrigger;
  const methodCategory = classifyTrusteeMethod(shippingMethod, tracked);
  const registered = isRegistered === true;
  const rate = registered ? REGISTERED_TRUSTEE_RATE : TRACKED_TRUSTEE_RATE;

  if (!applies) {
    return {
      applies: false,
      fee: 0,
      rawFee: 0,
      rate,
      methodCategory,
      isRegistered: registered,
      articleValue: normalizedArticleValue,
      valueTrigger,
      lowSalesTrigger,
      sellerLifetimeSales: hasLowSalesData ? Number(sellerLifetimeSales) : null,
      salesTriggerEvaluated: hasLowSalesData,
      reason: hasLowSalesData
        ? "Trustee not applied: article value below EUR 25.00 and seller has at least 5 completed sales."
        : "Trustee not applied: article value below EUR 25.00 and seller lifetime sales are unknown."
    };
  }

  const rawFee = normalizedArticleValue * rate;
  const fee = Math.ceil(rawFee * 100) / 100;

  return {
    applies: true,
    fee: roundMoney(fee),
    rawFee,
    rate,
    methodCategory,
    isRegistered: registered,
    articleValue: normalizedArticleValue,
    valueTrigger,
    lowSalesTrigger,
    sellerLifetimeSales: hasLowSalesData ? Number(sellerLifetimeSales) : null,
    salesTriggerEvaluated: hasLowSalesData,
    reason: valueTrigger
      ? "Trustee applied because article value is at least EUR 25.00."
      : "Trustee applied because seller has fewer than 5 completed sales."
  };
}

export function recordIsTracked(record) {
  return record?.tracked === true || record?.tracked === "tracked";
}

export function recordIsRegistered(record) {
  const raw = record?.raw || {};
  const value = raw.isRegistered
    ?? raw.is_registered
    ?? raw.registered
    ?? raw.registeredMail
    ?? raw.registered_mail
    ?? raw.isRegisteredMail
    ?? raw.is_registered_mail
    ?? raw.registration
    ?? raw.registration_type
    ?? raw.registrationType
    ?? record?.isRegistered
    ?? record?.is_registered
    ?? record?.registered;

  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  const text = String(value ?? "").toLowerCase().trim();
  if (!text) {
    return false;
  }
  return ["true", "yes", "y", "1", "registered", "registered_mail", "registered-mail"].includes(text);
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

function moneyToCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function classifyTrusteeMethod(method, tracked) {
  const text = normalizeMethodText(method);
  const letterLike = /\b(letter|brief|brievenbus|mail|raccomandata|einschreiben|lettera)\b/.test(text);
  const parcelLike = /\b(parcel|paket|paeckchen|packet|colissimo|minibox|delivery|dpd|dhl|gls|dao|paq|package)\b/.test(text);
  const internationalLike = /\b(international|internacional|internationale|internazionale|int)\b/.test(text);
  const insuredLike = /\b(insured|insurance|versicher|assicur|secure|secur|seguro|ad valorem|wert)\b/.test(text);
  const priorityLike = /\b(priority|express|expres|expr[eè]s|fast)\b/.test(text);
  const signedLike = /\b(signed|signature|signed for)\b/.test(text);
  const registeredLike = /\b(registered|regist|raccomandata|einschreiben|suivie)\b/.test(text);

  if (parcelLike) {
    if (insuredLike) {
      return "parcel_insured";
    }
    if (priorityLike) {
      return "parcel_priority";
    }
    if (internationalLike && tracked) {
      return "parcel_international_tracked";
    }
    if (internationalLike) {
      return "parcel_international";
    }
    if (tracked) {
      return "parcel_tracked";
    }
    return "parcel_standard";
  }

  if (letterLike || !parcelLike) {
    if (signedLike) {
      return "letter_signed";
    }
    if (registeredLike) {
      return "letter_registered";
    }
    if (tracked) {
      return "letter_basic_tracked";
    }
    if (text.includes("standard") || text.includes("basic")) {
      return "letter_standard";
    }
    return "letter_basic";
  }

  return "default";
}

function normalizeMethodText(method) {
  return String(method || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
