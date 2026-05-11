import { COUNTRY_OPTIONS, formatMoney, parseMoney } from "./parser.mjs?v=20260509m";

const CARTFORGE_PAYLOAD_PREFIX = "CARTFORGE_CART=";

export function parseExtractedCartPayload(rawInput) {
  const decoded = decodeCartForgePayload(rawInput);
  if (!decoded.ok) {
    return { ok: false, error: decoded.error || "Input is not a CartForge extracted cart payload." };
  }

  const warnings = Array.isArray(decoded.payload.warnings) ? decoded.payload.warnings.filter(Boolean) : [];
  const sellers = normalizeSellers(decoded.payload.sellers || [], warnings);

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
        loaded: false,
        recordCount: 0
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

function normalizeSellers(sellers, warnings) {
  return sellers.map((seller, sellerIndex) => {
    const sellerName = cleanupValue(seller.sellerName) || `Seller ${sellerIndex + 1}`;
    const sellerCountry = normalizeCountry(seller.sellerCountry || seller.country || seller.location);
    const shippingMethod = cleanupValue(seller.shippingMethod || seller.shippingOption || "");
    const shippingValue = parseMoney(seller.shippingValue ?? seller.shippingCost ?? seller.shippingPrice);
    const articleValue = parseMoney(seller.articleValue ?? seller.itemValue);
    const trusteeValue = parseMoney(seller.trusteeValue ?? seller.trusteeFee);
    const total = parseMoney(seller.total ?? seller.totalValue);
    const items = normalizeItems(seller.items || [], sellerName, sellerIndex, warnings);

    if (seller.items && !items.length) {
      warnings.push(`${sellerName}: no usable item rows were extracted.`);
    }

    return {
      id: seller.id || `seller-${sellerIndex + 1}`,
      sellerName,
      shippingMethod,
      shippingMethodRaw: cleanupValue(seller.shippingMethodRaw || shippingMethod),
      trackingStatus: normalizeTracking(seller.trackingStatus ?? seller.tracked),
      articleValue: articleValue ?? sumItems(items),
      shippingValue,
      trusteeValue,
      total,
      sellerCountry,
      countrySource: sellerCountry === "Unknown" ? "unknown" : "page_extractor",
      countryInference: {
        country: sellerCountry === "Unknown" ? "" : sellerCountry,
        source: sellerCountry === "Unknown" ? "unknown" : "page_extractor",
        confidence: sellerCountry === "Unknown" ? 0 : 1,
        ambiguous: false,
        matches: []
      },
      items,
      rawText: seller.rawText || "",
      sourceLine: null,
      source: "page_extractor"
    };
  });
}

function normalizeItems(items, sellerName, sellerIndex, warnings) {
  return items.map((item, itemIndex) => {
    const cardName = cleanupValue(item.cardName || item.name);
    const quantity = Math.max(1, Number.parseInt(item.quantity ?? item.qty ?? 1, 10) || 1);
    const price = parseMoney(item.price ?? item.unitPrice ?? item.unit_price);

    if (!cardName) {
      warnings.push(`${sellerName}: item ${itemIndex + 1} is missing a card name.`);
    }
    if (price === null) {
      warnings.push(`${sellerName}: ${cardName || `item ${itemIndex + 1}`} is missing a price.`);
    }

    return {
      id: item.id || `item-${sellerIndex + 1}-${itemIndex + 1}`,
      cardName: cardName || "Unknown card",
      setName: cleanupValue(item.setName || item.set || item.expansion || ""),
      rarity: normalizeRarity(item.rarity),
      condition: cleanupValue(item.condition) || "Unknown",
      quantity,
      price,
      rawLine: item.rawLine || buildRawLine(item),
      sourceLine: null,
      warnings: Array.isArray(item.warnings) ? item.warnings : []
    };
  });
}

function normalizeCountry(value) {
  const text = cleanupValue(value);
  if (!text) {
    return "Unknown";
  }

  const exact = COUNTRY_OPTIONS.find((country) => country.toLowerCase() === text.toLowerCase());
  return exact || text;
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

function normalizeRarity(value) {
  const text = cleanupValue(value);
  const match = text.match(/\b(common|uncommon|rare|mythic|mythic rare)\b/i);
  return match ? match[1].replace(/\b\w/g, (char) => char.toUpperCase()) : text;
}

function sumItems(items) {
  const total = items.reduce((sum, item) => sum + Number(item.quantity || 1) * Number(item.price || 0), 0);
  return Number.isFinite(total) ? total : null;
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
