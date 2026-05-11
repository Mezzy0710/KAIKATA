import { COUNTRY_OPTIONS, buildShippingIndex, formatMoney, parseMoney } from "./parser.mjs?v=20260509m";

const CARTFORGE_PAYLOAD_PREFIX = "CARTFORGE_CART=";

export function parseExtractedCartPayload(rawInput, shippingData = null) {
  const decoded = decodeCartForgePayload(rawInput);
  if (!decoded.ok) {
    return { ok: false, error: decoded.error || "Input is not a CartForge extracted cart payload." };
  }

  const warnings = Array.isArray(decoded.payload.warnings) ? decoded.payload.warnings.filter(Boolean) : [];
  const shippingIndex = buildShippingIndex(shippingData);
  const sellers = normalizeSellers(decoded.payload.sellers || [], warnings, shippingIndex);

  return {
    ok: true,
    parsed: {
      rawText: JSON.stringify(decoded.payload, null, 2),
      lineCount: 0,
      sellerCount: sellers.length,
      itemCount: sellers.reduce((sum, seller) => sum + seller.items.length, 0),
      sellers,
      cartOverview: [],
      warnings,
      shippingIndex: {
        loaded: shippingIndex.length > 0,
        recordCount: shippingIndex.length
      },
      source: decoded.payload.source || "cartforge-extracted-cart",
      extractedAt: decoded.payload.extractedAt || ""
    }
  };
}

export function decodeCartForgeHash(hashValue) {
  const hash = String(hashValue || "").replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const payload = params.get("cartforge");
  return payload ? decodeCartForgePayload(payload) : { ok: false, error: "No cartforge payload found in URL hash." };
}

export function encodeCartForgePayload(payload) {
  return base64UrlEncode(JSON.stringify(payload));
}

function decodeCartForgePayload(value) {
  const text = String(value || "").trim();
  if (!text) {
    return { ok: false, error: "No payload provided." };
  }

  const jsonText = text.startsWith(CARTFORGE_PAYLOAD_PREFIX)
    ? text.slice(CARTFORGE_PAYLOAD_PREFIX.length).trim()
    : text;

  const candidates = [];
  if (jsonText.startsWith("{")) {
    candidates.push(jsonText);
  }
  candidates.push(base64UrlDecode(jsonText));

  for (const candidate of candidates.filter(Boolean)) {
    try {
      const payload = JSON.parse(candidate);
      if (payload && Array.isArray(payload.sellers)) {
        return { ok: true, payload };
      }
    } catch {
      // Try the next representation.
    }
  }

  return { ok: false, error: "Payload is not valid CartForge cart JSON." };
}

function normalizeSellers(sellers, warnings, shippingIndex) {
  return sellers.map((seller, sellerIndex) => {
    const sellerName = cleanupValue(seller.sellerName) || `Seller ${sellerIndex + 1}`;
    const rawText = seller.rawText || "";
    const shippingMethod = normalizeShippingMethod(seller.shippingMethod || seller.shippingOption || rawText);
    const shippingValue = parseMoney(seller.shippingValue ?? seller.shippingCost ?? seller.shippingPrice) ?? readMoneyNear(rawText, /shipping|shipment|postage/i);
    const articleValue = parseMoney(seller.articleValue ?? seller.itemValue) ?? readMoneyNear(rawText, /article value|articles value|contents/i);
    const trusteeValue = parseMoney(seller.trusteeValue ?? seller.trusteeFee);
    const total = parseMoney(seller.total ?? seller.totalValue) ?? readMoneyNear(rawText, /total|grand total|seller total/i);
    const items = normalizeItems(seller.items || [], sellerName, sellerIndex, warnings);
    const trackingStatus = normalizeTracking(seller.trackingStatus ?? seller.tracked);
    const countryInference = inferSellerCountry({
      explicitCountry: seller.sellerCountry || seller.country || seller.location,
      sellerName,
      shippingMethod,
      shippingValue,
      trackingStatus,
      shippingIndex
    });
    const sellerCountry = countryInference.country || "Unknown";

    if (seller.items && !items.length) {
      warnings.push(`${sellerName}: no usable item rows were extracted.`);
    }

    return {
      id: seller.id || `seller-${sellerIndex + 1}`,
      sellerName,
      sellerType: cleanupValue(seller.sellerType || seller.type || ""),
      shippingMethod,
      shippingMethodRaw: cleanupValue(seller.shippingMethodRaw || shippingMethod),
      trackingStatus,
      articleValue: articleValue ?? sumItems(items),
      shippingValue,
      trusteeValue,
      total,
      sellerCountry,
      countrySource: countryInference.source,
      countryInference,
      items,
      rawText,
      sourceLine: null,
      source: "page_extractor"
    };
  });
}

function normalizeItems(items, sellerName, sellerIndex, warnings) {
  const normalized = items.map((item, itemIndex) => {
    const cardName = cleanupValue(item.cardName || item.name);
    const rawSetName = cleanupValue(item.setName || item.set || item.expansion || "");
    const quantity = Math.max(1, Number.parseInt(item.quantity ?? item.qty ?? 1, 10) || 1);
    const price = parseStructuredMoney(item.price ?? item.unitPrice ?? item.unit_price);

    if (!cardName) {
      warnings.push(`${sellerName}: item ${itemIndex + 1} is missing a card name.`);
    }
    if (price === null) {
      warnings.push(`${sellerName}: ${cardName || `item ${itemIndex + 1}`} is missing a price.`);
    }

    return {
      id: item.id || `item-${sellerIndex + 1}-${itemIndex + 1}`,
      cardName: cardName || "Unknown card",
      setName: /^#\d+[a-z]?$/i.test(rawSetName) ? "" : rawSetName,
      collectorNumber: cleanupValue(item.collectorNumber || (/^#\d+[a-z]?$/i.test(rawSetName) ? rawSetName : "")),
      rarity: normalizeRarity(item.rarity),
      condition: normalizeCondition(item.condition),
      language: cleanupValue(item.language || item.lang || ""),
      quantity,
      price,
      rawLine: item.rawLine || buildRawLine(item),
      sourceLine: null,
      warnings: Array.isArray(item.warnings) ? item.warnings : []
    };
  });

  return dedupeItems(normalized).map((item) => ({
    ...item,
    id: item.id || `item-${sellerIndex + 1}`
  }));
}

function normalizeCountry(value) {
  const text = cleanupValue(value);
  if (!text) {
    return "Unknown";
  }

  const exact = COUNTRY_OPTIONS.find((country) => country.toLowerCase() === text.toLowerCase());
  return exact || text;
}

function parseStructuredMoney(value) {
  const parsed = parseMoney(value);
  if (parsed !== null) {
    return parsed;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function normalizeTracking(value) {
  if (value === true) {
    return "tracked";
  }
  if (value === false) {
    return "untracked";
  }

  const text = String(value || "").toLowerCase();
  if (/untracked|no tracking|without tracking/.test(text)) {
    return "untracked";
  }
  if (/tracked|tracking|registered|insured/.test(text)) {
    return "tracked";
  }
  return "unknown";
}

function normalizeShippingMethod(value) {
  const text = cleanupValue(value);
  if (!text) {
    return "";
  }

  const lines = String(value || "").split(/\n+/).map((line) => cleanupValue(line)).filter(Boolean);
  const start = lines.findIndex((line) => /select shipping method|shipping method|shipment method/i.test(line));
  if (start >= 0) {
    const selected = lines.slice(start + 1, start + 8).find((line) => {
      return parseMoney(line) !== null && !/^(letter|tracked letter|tracked parcel|more shipping options)$/i.test(line);
    });
    if (selected) {
      return selected;
    }
  }

  return text;
}

function normalizeRarity(value) {
  const text = cleanupValue(value);
  const match = text.match(/\b(common|uncommon|rare|mythic|mythic rare)\b/i);
  return match ? match[1].replace(/\b\w/g, (char) => char.toUpperCase()) : text;
}

function normalizeCondition(value) {
  const text = cleanupValue(value);
  const normalized = text.toLowerCase();
  const aliases = {
    m: "Mint",
    mt: "Mint",
    nm: "Near Mint",
    "near mint": "Near Mint",
    ex: "Excellent",
    exc: "Excellent",
    excellent: "Excellent",
    gd: "Good",
    good: "Good",
    lp: "Light Played",
    "light played": "Light Played",
    pl: "Played",
    played: "Played",
    po: "Poor",
    poor: "Poor"
  };
  return aliases[normalized] || text || "Unknown";
}

function sumItems(items) {
  const total = items.reduce((sum, item) => sum + Number(item.quantity || 1) * Number(item.price || 0), 0);
  return Number.isFinite(total) ? total : null;
}

function dedupeItems(items) {
  const byKey = new Map();
  items.forEach((item) => {
    const key = [
      item.cardName,
      item.setName || item.collectorNumber,
      item.quantity
    ].map((part) => String(part || "").toLowerCase().replace(/\s+/g, "")).join("|");
    const existing = byKey.get(key);
    if (!existing || itemScore(item) > itemScore(existing)) {
      byKey.set(key, item);
    }
  });

  return [...byKey.values()];
}

function itemScore(item) {
  return [
    item.condition && item.condition !== "Unknown" ? 4 : 0,
    item.price !== null ? 4 : 0,
    item.rawLine?.includes("\n") ? 3 : 0,
    item.setName ? 2 : 0,
    item.rarity ? 1 : 0
  ].reduce((sum, value) => sum + value, 0);
}

function readMoneyNear(text, labelPattern) {
  const lines = String(text || "").split(/\n+/).map((line) => cleanupValue(line)).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    if (!labelPattern.test(lines[index])) {
      continue;
    }

    const sameLineMoney = parseMoney(lines[index]);
    if (sameLineMoney !== null) {
      return sameLineMoney;
    }

    for (let offset = 1; offset <= 2; offset += 1) {
      const nextLineMoney = parseMoney(lines[index + offset]);
      if (nextLineMoney !== null) {
        return nextLineMoney;
      }
    }
  }
  return null;
}

function inferCountryFromSellerName(sellerName) {
  const suffix = String(sellerName || "").match(/([A-Z]{2})$/)?.[1];
  const aliases = {
    AT: "Austria",
    BE: "Belgium",
    CZ: "Czech Republic",
    DE: "Germany",
    ES: "Spain",
    FR: "France",
    IT: "Italy",
    NL: "Netherlands",
    PL: "Poland",
    PT: "Portugal",
    UK: "United Kingdom"
  };
  return aliases[suffix] || "";
}

function inferSellerCountry({ explicitCountry, sellerName, shippingMethod, shippingValue, trackingStatus, shippingIndex }) {
  const explicit = normalizeCountry(explicitCountry);
  if (explicit !== "Unknown") {
    return {
      country: explicit,
      source: "page_extractor",
      confidence: 1,
      ambiguous: false,
      matches: []
    };
  }

  const sellerNameCountry = inferCountryFromSellerName(sellerName);
  if (sellerNameCountry) {
    return {
      country: sellerNameCountry,
      source: "seller_name_suffix",
      confidence: 0.92,
      ambiguous: false,
      matches: []
    };
  }

  const alias = inferCountryByShippingAlias(shippingMethod);
  if (alias) {
    return {
      country: alias.country,
      source: "shipping_method_alias",
      confidence: alias.confidence,
      ambiguous: false,
      matches: []
    };
  }

  const matches = inferCountryByShippingData(shippingMethod, shippingValue, trackingStatus, shippingIndex);
  if (matches.length === 1) {
    return {
      country: matches[0].country,
      source: "shipping_data",
      confidence: matches[0].score,
      ambiguous: false,
      matches
    };
  }

  return {
    country: "",
    source: "unknown",
    confidence: 0,
    ambiguous: matches.length > 1,
    matches
  };
}

function inferCountryByShippingAlias(shippingMethod) {
  const method = String(shippingMethod || "");
  const aliases = [
    { pattern: /\bstandardbrief\b/i, country: "Germany", confidence: 0.95 },
    { pattern: /\blettre internationale\b/i, country: "France", confidence: 0.95 },
    { pattern: /\bcarta ordinaria\b/i, country: "Spain", confidence: 0.95 },
    { pattern: /\ba'? priority letter\b/i, country: "Greece", confidence: 0.9 }
  ];
  return aliases.find((alias) => alias.pattern.test(method)) || null;
}

function inferCountryByShippingData(shippingMethod, shippingValue, trackingStatus, shippingIndex) {
  if (!shippingMethod || !shippingIndex.length) {
    return [];
  }

  const methodTokens = tokenizeShippingMethod(shippingMethod);
  const matches = shippingIndex
    .map((record) => {
      const recordTokens = tokenizeShippingMethod(record.method);
      const sharedTokens = methodTokens.filter((token) => recordTokens.includes(token));
      const methodScore = sharedTokens.length / Math.max(recordTokens.length, 1);
      const priceMatches = shippingValue === null || record.price === null || Math.abs(record.price - shippingValue) < 0.005;
      const trackingMatches = trackingStatus === "unknown" || record.tracked === "unknown" || record.tracked === trackingStatus;
      const score = methodScore + (priceMatches ? 0.5 : 0) + (trackingMatches ? 0.25 : 0);
      return {
        country: record.country,
        method: record.method,
        score
      };
    })
    .filter((match) => match.score >= 1.4);

  const bestByCountry = new Map();
  matches.forEach((match) => {
    const existing = bestByCountry.get(match.country);
    if (!existing || match.score > existing.score) {
      bestByCountry.set(match.country, match);
    }
  });

  return [...bestByCountry.values()].sort((a, b) => b.score - a.score);
}

function tokenizeShippingMethod(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bmax\.?\s*weight\b.*$/i, " ")
    .replace(/[^a-z\u00c0-\u017f]+/gi, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .filter((token) => !["letter", "priority", "tracked", "tracking", "regular", "small", "parcel"].includes(token));
}

function buildRawLine(item) {
  return [
    item.quantity ? `${item.quantity}x` : "",
    item.cardName || item.name || "",
    item.setName || item.set || "",
    item.rarity || "",
    item.condition || "",
    item.price !== undefined ? formatMoney(parseMoney(item.price) ?? 0) : ""
  ].filter(Boolean).join(" | ");
}

function cleanupValue(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  try {
    const padded = String(value || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value || "").length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}
