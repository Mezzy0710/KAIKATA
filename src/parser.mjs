const MONEY_RE = /(?:EUR\s*)?\d{1,3}(?:[.\s]\d{3})*[,.]\d{2}\s*(?:\u20ac|EUR)?|(?:\u20ac|EUR)\s*\d+(?:[,.]\d{2})?/i;
const MONEY_WITH_CURRENCY_RE = /(?:EUR\s*)?\d{1,3}(?:[.\s]\d{3})*(?:[,.]\d{2})?\s*(?:\u20ac|EUR)|(?:\u20ac|EUR)\s*\d+(?:[,.]\d{2})?/i;

const FIELD_LABELS = {
  shippingMethod: /^(shipping method|shipment method|delivery method|shipping option|shipment option|postage method)\b/i,
  shippingValue: /^(shipping cost|shipment cost|shipping price|shipping value|postage|delivery cost|shipping)\b/i,
  trackingStatus: /^(tracking status|tracking|tracked|trackable|no tracking)\s*:?\s*$/i,
  articleValue: /^(article value|articles value|value of articles|item value|goods value|article total|articles)\b/i,
  trusteeValue: /^(trustee service fee|trustee service|trustee fee|trustee)\b/i,
  total: /^(grand total|order total|shipment total|seller total|total)\b/i,
  sellerCountry: /^(seller country|ships from|shipping from|sent from|country|location)\b/i
};

const BLOCK_START_RE = /^summary$/i;
const CART_OVERVIEW_RE = /^(cart overview|seller overview|overview)$/i;
const STOP_LINE_RE = /^(remove|delete|edit|change|details|show more|add to wants|shopping cart|checkout|continue shopping|subtotal|availability|summary|select shipping method|cart overview)$/i;
const LANGUAGE_RE = /^(english|german|french|italian|spanish|portuguese|japanese|korean|russian|chinese|traditional chinese|simplified chinese)$/i;
const SET_OR_RARITY_RE = /^(common|uncommon|rare|mythic|foil|non-foil|etched|signed|altered|playset)$/i;
const SELLER_MARKER_RE = /^(seller|vendor|seller name|shop)\b\s*:?\s*(.*)$/i;
const GENERIC_METHOD_TOKENS = new Set([
  "brief",
  "international",
  "internacional",
  "internationale",
  "internazionale",
  "letter",
  "mail",
  "online",
  "parcel",
  "post",
  "priority",
  "registered",
  "standard",
  "tracked",
  "tracking",
  "value"
]);

const CONDITION_PATTERNS = [
  ["Near Mint", /\b(near mint|nm|m\/nm)\b/i],
  ["Mint", /\b(mint|mt)\b/i],
  ["Excellent", /\b(excellent|exc|ex)\b/i],
  ["Good", /\b(good|gd)\b/i],
  ["Light Played", /\b(light played|lp)\b/i],
  ["Played", /\b(played|pl)\b/i],
  ["Poor", /\b(poor|po)\b/i]
];

export const COUNTRY_OPTIONS = [
  "Unknown",
  "Austria",
  "Belgium",
  "Bulgaria",
  "Croatia",
  "Cyprus",
  "Czech Republic",
  "Denmark",
  "Estonia",
  "Finland",
  "France",
  "Germany",
  "Greece",
  "Hungary",
  "Ireland",
  "Italy",
  "Latvia",
  "Lithuania",
  "Luxembourg",
  "Malta",
  "Netherlands",
  "Norway",
  "Poland",
  "Portugal",
  "Romania",
  "Slovakia",
  "Slovenia",
  "Spain",
  "Sweden",
  "Switzerland",
  "United Kingdom"
];

const COUNTRY_ALIASES = {
  AT: "Austria",
  AUSTRIA: "Austria",
  BE: "Belgium",
  BELGIUM: "Belgium",
  BG: "Bulgaria",
  BULGARIA: "Bulgaria",
  HR: "Croatia",
  CROATIA: "Croatia",
  CY: "Cyprus",
  CYPRUS: "Cyprus",
  CZ: "Czech Republic",
  CZECHIA: "Czech Republic",
  "CZECH REPUBLIC": "Czech Republic",
  DK: "Denmark",
  DENMARK: "Denmark",
  EE: "Estonia",
  ESTONIA: "Estonia",
  FI: "Finland",
  FINLAND: "Finland",
  FR: "France",
  FRANCE: "France",
  DE: "Germany",
  GERMANY: "Germany",
  DEUTSCHLAND: "Germany",
  GR: "Greece",
  GREECE: "Greece",
  HU: "Hungary",
  HUNGARY: "Hungary",
  IS: "Iceland",
  ICELAND: "Iceland",
  IE: "Ireland",
  IRELAND: "Ireland",
  IT: "Italy",
  ITALY: "Italy",
  LV: "Latvia",
  LATVIA: "Latvia",
  LT: "Lithuania",
  LITHUANIA: "Lithuania",
  LI: "Liechtenstein",
  LIECHTENSTEIN: "Liechtenstein",
  LU: "Luxembourg",
  LUXEMBOURG: "Luxembourg",
  LUXEMBURG: "Luxembourg",
  MT: "Malta",
  MALTA: "Malta",
  NL: "Netherlands",
  NETHERLANDS: "Netherlands",
  "THE NETHERLANDS": "Netherlands",
  NO: "Norway",
  NORWAY: "Norway",
  PL: "Poland",
  POLAND: "Poland",
  PT: "Portugal",
  PORTUGAL: "Portugal",
  RO: "Romania",
  ROMANIA: "Romania",
  SK: "Slovakia",
  SLOVAKIA: "Slovakia",
  SI: "Slovenia",
  SLOVENIA: "Slovenia",
  ES: "Spain",
  SPAIN: "Spain",
  SE: "Sweden",
  SWEDEN: "Sweden",
  CH: "Switzerland",
  SWITZERLAND: "Switzerland",
  UK: "United Kingdom",
  GB: "United Kingdom",
  "UNITED KINGDOM": "United Kingdom",
  ENGLAND: "United Kingdom"
};

export function parseCart(rawInput, shippingData = null) {
  const rawText = String(rawInput || "");
  const lines = normalizeLines(rawText);
  const shippingIndex = buildShippingIndex(shippingData);
  const cartOverview = extractCartOverview(lines);
  const blocks = splitSellerBlocks(lines);
  const sellers = matchSellerNames(
    blocks.map((block, index) => parseSellerBlock(block, index, shippingIndex)),
    cartOverview
  );
  const warnings = [];

  if (!rawText.trim()) {
    warnings.push("No input text provided.");
  }

  if (rawText.trim() && sellers.length === 0) {
    warnings.push("No seller blocks were detected.");
  }

  return {
    rawText,
    lineCount: lines.length,
    sellerCount: sellers.length,
    itemCount: sellers.reduce((sum, seller) => sum + seller.items.length, 0),
    sellers,
    cartOverview,
    warnings,
    shippingIndex: {
      loaded: shippingIndex.length > 0,
      recordCount: shippingIndex.length
    }
  };
}

export function normalizeLines(rawText) {
  return String(rawText || "")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function parseMoney(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value);
  const direct = text.match(MONEY_WITH_CURRENCY_RE) || text.match(MONEY_RE);
  if (!direct) {
    return null;
  }

  const token = direct[0]
    .replace(/EUR/gi, "")
    .replace(/\u20ac/g, "")
    .replace(/\s/g, "")
    .trim();

  const decimalMark = token.includes(",") ? "," : token.includes(".") && /\.\d{2}$/.test(token) ? "." : null;
  let normalized = token;

  if (decimalMark === ",") {
    normalized = token.replace(/\./g, "").replace(",", ".");
  } else if (decimalMark === ".") {
    normalized = token.replace(/,/g, "");
  } else {
    normalized = token.replace(/[,.]/g, "");
  }

  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : null;
}

export function formatMoney(value) {
  const amount = Number(value);
  return `EUR ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

export function buildShippingIndex(shippingData) {
  if (!shippingData) {
    return [];
  }

  const records = [];
  walkShippingData(shippingData, {}, records);

  return records
    .map((record, index) => ({
      id: `ship-${index}`,
      country: normalizeCountry(record.country) || "Unknown",
      destination: normalizeCountry(record.destination || record.destinationCountry || record.toCountry || record.to_country || record.to) || "",
      method: cleanupValue(record.method || record.label || record.name || record.service || ""),
      tracked: normalizeTracked(record.tracked ?? record.tracking ?? record.trackable),
      price: parseMoney(record.price ?? record.shippingPrice ?? record.shipping_price ?? record.cost ?? record.value ?? record.amount),
      raw: record.raw || record
    }))
    .filter((record) => record.method || record.country !== "Unknown");
}

function walkShippingData(value, context, records) {
  if (Array.isArray(value)) {
    value.forEach((entry) => walkShippingData(entry, context, records));
    return;
  }

  if (!value || typeof value !== "object") {
    if (typeof value === "string" && context.country) {
      records.push({ country: context.country, method: value, raw: value });
    }
    return;
  }

  const ownCountry = extractCountry(value) || context.country;
  const ownDestination = extractDestination(value) || context.destination;
  const ownMethod = extractMethod(value);

  if (ownCountry || ownMethod) {
    records.push({
      country: ownCountry,
      destination: ownDestination,
      method: ownMethod,
      tracked: value.tracked ?? value.tracking ?? value.trackable ?? value.isTracked,
      price: value.price ?? value.shippingPrice ?? value.shipping_price ?? value.cost ?? value.value ?? value.amount,
      raw: value
    });
  }

  Object.entries(value).forEach(([key, child]) => {
    if ((ownCountry || ownMethod) && (!child || typeof child !== "object")) {
      return;
    }
    const keyCountry = normalizeCountry(key);
    const keyDestination = /destination|to country|to_country/i.test(key) ? normalizeCountry(child) || normalizeCountry(key) : "";
    const nextContext = keyCountry
      ? { ...context, country: keyCountry, destination: ownDestination || context.destination }
      : { ...context, country: ownCountry || context.country, destination: keyDestination || ownDestination || context.destination };
    walkShippingData(child, nextContext, records);
  });
}

function extractCountry(record) {
  const candidates = [
    record.country,
    record.countryName,
    record.country_code,
    record.countryCode,
    record.originCountry,
    record.sellerCountry,
    record.fromCountry,
    record.from_country,
    record.iso,
    record.iso2
  ];

  for (const candidate of candidates) {
    const normalized = normalizeCountry(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function extractMethod(record) {
  const candidates = [
    record.shippingMethod,
    record.shipping_method,
    record.method,
    record.name,
    record.label,
    record.service,
    record.description,
    record.title
  ];

  return cleanupValue(candidates.find((candidate) => typeof candidate === "string" && candidate.trim()) || "");
}

function extractDestination(record) {
  const candidates = [
    record.destination,
    record.destinationCountry,
    record.destination_country,
    record.toCountry,
    record.to_country,
    record.to,
    record.shipTo,
    record.ship_to
  ];

  for (const candidate of candidates) {
    const normalized = normalizeCountry(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function extractCartOverview(lines) {
  const start = findCartOverviewStart(lines);
  if (start < 0) {
    return [];
  }

  const entries = [];
  let pendingName = "";

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^(number of orders|amount of articles|article value|shipping|trustee service|total|©|copyright)/i.test(line)) {
      break;
    }

    const total = parseMoney(line);
    if (total !== null) {
      if (pendingName) {
        entries.push({
          sellerName: pendingName,
          total,
          sourceLine: index + 1,
          rawLine: `${pendingName} ${line}`
        });
        pendingName = "";
      }
      continue;
    }

    if (isCartOverviewSellerName(line)) {
      pendingName = cleanupValue(line);
    }
  }

  return entries;
}

function matchSellerNames(sellers, cartOverview) {
  if (!cartOverview.length) {
    return sellers;
  }

  const unusedOverview = [...cartOverview];

  sellers.forEach((seller) => {
    if (seller.sellerName && !/^Seller \d+$/i.test(seller.sellerName)) {
      return;
    }

    const exactTotalIndex = unusedOverview.findIndex((entry) => seller.total !== null && Math.abs(entry.total - seller.total) < 0.005);
    const overviewIndex = exactTotalIndex >= 0 ? exactTotalIndex : 0;
    const overviewEntry = unusedOverview.splice(overviewIndex, 1)[0];

    if (overviewEntry?.sellerName) {
      seller.sellerName = overviewEntry.sellerName;
      seller.sellerNameSource = exactTotalIndex >= 0 ? "cart_overview_total" : "cart_overview_order";
    }
  });

  return sellers;
}

function splitSellerBlocks(lines) {
  if (!lines.length) {
    return [];
  }

  const markerIndexes = lines
    .map((line, index) => (isSellerMarker(line) ? index : -1))
    .filter((index) => index >= 0);

  if (markerIndexes.length) {
    return markerIndexes.map((start, position) => {
      const end = markerIndexes[position + 1] ?? lines.length;
      return {
        lines: lines.slice(start, end),
        startLine: start,
        sellerNameHint: extractSellerNameFromMarker(lines, start)
      };
    });
  }

  const summaryStarts = inferSummaryStarts(lines);
  if (summaryStarts.length) {
    const overviewStart = findCartOverviewStart(lines);
    return summaryStarts.map((start, position) => {
      const end = summaryStarts[position + 1] ?? (overviewStart >= 0 ? overviewStart : lines.length);
      return {
        lines: lines.slice(start, end),
        startLine: start,
        sellerNameHint: ""
      };
    });
  }

  const inferredStarts = inferSellerStarts(lines);
  if (inferredStarts.length > 1) {
    return inferredStarts.map((start, position) => {
      const end = inferredStarts[position + 1] ?? lines.length;
      return {
        lines: lines.slice(start, end),
        startLine: start,
        sellerNameHint: cleanupValue(lines[start])
      };
    });
  }

  return [
    {
      lines,
      startLine: 0,
      sellerNameHint: findFirstSellerLikeLine(lines) || "Seller 1"
    }
  ];
}

function inferSummaryStarts(lines) {
  const overviewStart = findCartOverviewStart(lines);
  const limit = overviewStart >= 0 ? overviewStart : lines.length;
  const starts = [];

  lines.slice(0, limit).forEach((line, index) => {
    if (!BLOCK_START_RE.test(line)) {
      return;
    }

    const window = lines.slice(index, Math.min(limit, index + 24)).join(" ");
    if (/contents\b.*article value\b.*shipping\b.*total\b/i.test(window)) {
      starts.push(index);
    }
  });

  return starts.filter((start, index) => index === 0 || start - starts[index - 1] > 4);
}

function findCartOverviewStart(lines) {
  let best = -1;
  let bestScore = 0;

  lines.forEach((line, index) => {
    if (!CART_OVERVIEW_RE.test(line)) {
      return;
    }

    const following = lines.slice(index + 1, index + 80);
    let score = 0;

    if (following[0] && parseMoney(following[0]) !== null) {
      score += 2;
    }

    for (let offset = 0; offset < following.length - 1; offset += 1) {
      if (isCartOverviewSellerName(following[offset]) && parseMoney(following[offset + 1]) !== null) {
        score += 3;
      }
    }

    if (following.some((candidate) => /^number of orders$/i.test(candidate))) {
      score += 4;
    }

    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });

  if (best >= 0) {
    return best;
  }

  return -1;
}

function isCartOverviewSellerName(line) {
  return Boolean(
    line &&
      !parseMoney(line) &&
      !/^(number of orders|amount of articles|article value|shipping|trustee service|total|cart overview)$/i.test(line) &&
      !/^\d+\s+(sellers?|articles?)$/i.test(line) &&
      !/^©|copyright/i.test(line)
  );
}

function inferSellerStarts(lines) {
  const starts = [];

  lines.forEach((line, index) => {
    if (!looksLikeSellerName(line)) {
      return;
    }

    const nextWindow = lines.slice(index + 1, index + 12).join(" ");
    const previousWindow = lines.slice(Math.max(0, index - 8), index).join(" ");
    const hasSellerFieldsAhead = /shipping method|shipment method|article value|trustee|tracking|shipment total|order total/i.test(nextWindow);
    const startsNewBlock = index === 0 || /total|checkout|seller/i.test(previousWindow) || starts.length === 0;

    if (hasSellerFieldsAhead && startsNewBlock) {
      starts.push(index);
    }
  });

  return [...new Set(starts)];
}

function parseSellerBlock(block, sellerIndex, shippingIndex) {
  const usedLineIndexes = new Set();
  const sellerName = block.sellerNameHint || (BLOCK_START_RE.test(block.lines[0] || "") ? "" : findFirstSellerLikeLine(block.lines)) || `Seller ${sellerIndex + 1}`;
  const fields = {
    shippingMethod: captureTextField(block.lines, FIELD_LABELS.shippingMethod, usedLineIndexes),
    shippingValue: captureMoneyField(block.lines, FIELD_LABELS.shippingValue, usedLineIndexes),
    trackingStatus: captureTextField(block.lines, FIELD_LABELS.trackingStatus, usedLineIndexes),
    articleValue: captureMoneyField(block.lines, FIELD_LABELS.articleValue, usedLineIndexes),
    trusteeValue: captureMoneyField(block.lines, FIELD_LABELS.trusteeValue, usedLineIndexes),
    total: captureMoneyField(block.lines, FIELD_LABELS.total, usedLineIndexes),
    sellerCountry: captureTextField(block.lines, FIELD_LABELS.sellerCountry, usedLineIndexes)
  };

  const contentsField = captureContentsField(block.lines);
  if (contentsField.sourceIndex >= 0) {
    usedLineIndexes.add(contentsField.sourceIndex);
  }

  const shippingSelection = parseShippingSelection(block.lines);
  shippingSelection.usedIndexes.forEach((index) => usedLineIndexes.add(index));
  const articleValue = fields.articleValue.amount ?? contentsField.amount;
  const shippingMethod = fields.shippingMethod.value || shippingSelection.method || findShippingMethodCandidate(block.lines) || "";
  const shippingValue = fields.shippingValue.amount ?? shippingSelection.price;
  const trackingStatus = parseTrackingStatus(fields.trackingStatus.value || shippingSelection.trackingText || shippingMethod);
  const explicitCountry = normalizeCountry(fields.sellerCountry.value);
  const countryInference = inferSellerCountry(shippingMethod, shippingValue, trackingStatus, shippingIndex);
  const country = explicitCountry || countryInference.country || "Unknown";
  const items = parseCardmarketSinglesRows(block.lines) || parseItemRows(block.lines, usedLineIndexes);

  return {
    id: `seller-${sellerIndex + 1}`,
    sellerName,
    shippingMethod,
    trackingStatus,
    articleValue,
    shippingValue,
    trusteeValue: fields.trusteeValue.amount,
    total: fields.total.amount,
    sellerCountry: country,
    countrySource: explicitCountry ? "explicit" : countryInference.source,
    countryInference,
    items,
    rawText: block.lines.join("\n"),
    sourceLine: block.startLine + 1
  };
}

function parseShippingSelection(lines) {
  const start = lines.findIndex((line) => /^select shipping method\b/i.test(line));
  const candidates = start >= 0 ? lines.slice(start + 1, start + 8) : lines;
  const selected = candidates.find((line) => isShippingMethodSelectionLine(line));

  if (!selected) {
    return { method: "", price: null, trackingText: "", usedIndexes: [] };
  }

  const price = parseMoney(selected);
  const selectedIndex = lines.indexOf(selected);
  const method = cleanShippingMethod(selected.replace(/\([^)]*(?:\u20ac|EUR)[^)]*\)/i, "").replace(MONEY_WITH_CURRENCY_RE, ""));
  return {
    method,
    price,
    trackingText: selected,
    usedIndexes: [start, selectedIndex].filter((index) => index >= 0)
  };
}

function isShippingMethodSelectionLine(line) {
  if (!/\(.+?(?:\u20ac|EUR).*\)|(?:\u20ac|EUR)/i.test(line)) {
    return false;
  }

  return !/^(estimated arrival date|trustee service|yes|no|use trustee service|information on our trustee service\.?)$/i.test(line);
}

function captureContentsField(lines) {
  const sourceIndex = lines.findIndex((line) => /^contents\s+\d+\s+articles?/i.test(line));
  return {
    amount: sourceIndex >= 0 ? parseMoney(lines[sourceIndex]) : null,
    sourceIndex
  };
}

function captureTextField(lines, labelPattern, usedLineIndexes) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!labelPattern.test(line)) {
      continue;
    }

    const sameLine = cleanupValue(line.replace(labelPattern, "").replace(/^[:\-]+/, ""));
    const nextLine = lines[index + 1] && !isAnyFieldLabel(lines[index + 1]) ? cleanupValue(lines[index + 1]) : "";
    const value = sameLine || (labelPattern === FIELD_LABELS.trackingStatus ? line : nextLine);
    usedLineIndexes.add(index);

    if (!sameLine && nextLine && labelPattern !== FIELD_LABELS.trackingStatus) {
      usedLineIndexes.add(index + 1);
    }

    return { value, sourceLine: index + 1 };
  }

  return { value: "", sourceLine: null };
}

function captureMoneyField(lines, labelPattern, usedLineIndexes) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!labelPattern.test(line)) {
      continue;
    }

    const sameLineAmount = parseMoney(line.replace(labelPattern, ""));
    let amount = sameLineAmount;
    let valueLine = index;

    if (amount === null) {
      for (let offset = 1; offset <= 2; offset += 1) {
        const candidate = lines[index + offset];
        if (!candidate || isAnyFieldLabel(candidate)) {
          break;
        }
        amount = parseMoney(candidate);
        valueLine = index + offset;
        if (amount !== null) {
          break;
        }
      }
    }

    usedLineIndexes.add(index);
    if (amount !== null) {
      usedLineIndexes.add(valueLine);
    }

    return { amount, sourceLine: index + 1 };
  }

  return { amount: null, sourceLine: null };
}

function parseItemRows(lines, usedLineIndexes) {
  const items = [];
  let consumedUntil = -1;

  lines.forEach((line, index) => {
    if (index <= consumedUntil || usedLineIndexes.has(index) || !hasMoney(line)) {
      return;
    }

    if (isAnyFieldLabel(line) || STOP_LINE_RE.test(line) || isShippingSelectorLine(line)) {
      return;
    }

    let start = index;
    while (start > 0) {
      const previousIndex = start - 1;
      const previous = lines[previousIndex];
      if (
        index - previousIndex > 8 ||
        usedLineIndexes.has(previousIndex) ||
        isAnyFieldLabel(previous) ||
        isSellerMarker(previous) ||
        (hasMoney(previous) && previousIndex !== index) ||
        STOP_LINE_RE.test(previous)
      ) {
        break;
      }
      start = previousIndex;
    }

    const group = lines.slice(start, index + 1);
    const item = parseItemGroup(group, start + 1, items.length);
    if (item.cardName || item.price !== null) {
      items.push(item);
      consumedUntil = index;
    }
  });

  return items;
}

function parseCardmarketSinglesRows(lines) {
  const tableStart = lines.findIndex((line) => /^magic the gathering singles\b/i.test(line));
  if (tableStart < 0) {
    return null;
  }

  const items = [];

  for (let index = tableStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const sameLineMatch = line.match(/^(\d+)x\s+(.+)/i);
    const splitLineMatch = !sameLineMatch && line.match(/^(\d+)x$/i) && lines[index + 1] ? cleanupValue(lines[index + 1]) : "";

    if (!sameLineMatch && !splitLineMatch) {
      continue;
    }

    const quantity = Number.parseInt((sameLineMatch?.[1] || line.match(/^(\d+)x$/i)?.[1]), 10);
    const cardName = cleanupValue(sameLineMatch?.[2] || splitLineMatch);
    const group = sameLineMatch ? [line] : [line, lines[index + 1]];
    let condition = "";
    let price = null;
    let endIndex = sameLineMatch ? index : index + 1;
    const scanStart = sameLineMatch ? index + 1 : index + 2;

    for (let offset = scanStart; offset < Math.min(lines.length, scanStart + 10); offset += 1) {
      const candidate = lines[offset];

      if (/^summary$/i.test(candidate) || /^magic the gathering singles\b/i.test(candidate)) {
        break;
      }

      group.push(candidate);

      if (!condition) {
        condition = detectCondition(candidate);
      }

      const candidatePrice = parseMoney(candidate);
      if (candidatePrice !== null) {
        price = candidatePrice;
        endIndex = offset;
        break;
      }
    }

    items.push({
      id: `item-${index + 1}-${items.length + 1}`,
      cardName,
      condition: condition || "Unknown",
      quantity,
      price,
      rawLine: group.join(" | "),
      sourceLine: index + 1,
      warnings: price === null ? ["Price needs review."] : []
    });
    index = endIndex;
  }

  return items.length ? items : null;
}

function isShippingSelectorLine(line) {
  return /\([^)]*(?:\u20ac|EUR)[^)]*\)/i.test(line) && /\b(brief|parcel|package|registered|einschreiben|insured|tracked|tracking|shipping|post|dhl|ups|dpd|gls)\b/i.test(line);
}

function parseItemGroup(group, sourceLine, itemIndex) {
  const rawLine = group.join(" | ");
  const price = parseMoney(rawLine);
  const compact = cleanupValue(rawLine.replace(MONEY_WITH_CURRENCY_RE, " "));
  const condition = detectCondition(compact);
  const quantity = detectQuantity(group) ?? 1;
  const cardName = detectCardName(group, condition);
  const warnings = [];

  if (!cardName) {
    warnings.push("Card name needs review.");
  }

  if (!condition) {
    warnings.push("Condition needs review.");
  }

  if (price === null) {
    warnings.push("Price needs review.");
  }

  return {
    id: `item-${sourceLine}-${itemIndex + 1}`,
    cardName: cardName || "Unknown card",
    condition: condition || "Unknown",
    quantity,
    price,
    rawLine,
    sourceLine,
    warnings
  };
}

function detectQuantity(group) {
  for (const line of group) {
    const trimmed = line.trim();
    if (/^\d{1,3}$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10);
    }

    const match = trimmed.match(/\b(?:qty|quantity)?\s*(\d{1,3})\s*x\b/i) || trimmed.match(/\bx\s*(\d{1,3})\b/i);
    if (match) {
      return Number.parseInt(match[1], 10);
    }

    const withoutMoney = trimmed.replace(MONEY_WITH_CURRENCY_RE, " ");
    const conditionMatch = CONDITION_PATTERNS.find(([, pattern]) => pattern.test(withoutMoney));
    if (conditionMatch) {
      const matchDetails = withoutMoney.match(conditionMatch[1]);
      const afterCondition = matchDetails ? withoutMoney.slice(matchDetails.index + matchDetails[0].length) : "";
      const quantityAfterCondition = afterCondition.match(/\b(\d{1,3})\b/);
      if (quantityAfterCondition) {
        return Number.parseInt(quantityAfterCondition[1], 10);
      }
    }
  }

  return null;
}

function detectCondition(text) {
  const match = CONDITION_PATTERNS.find(([, pattern]) => pattern.test(text));
  return match ? match[0] : "";
}

function detectCardName(group, condition) {
  const inline = group.join(" ").replace(MONEY_WITH_CURRENCY_RE, " ");
  const inlineCondition = condition ? escapeRegExp(condition) : CONDITION_PATTERNS.map(([, pattern]) => pattern.source).join("|");
  const inlineMatch = inline.match(new RegExp(`^(?:\\d{1,3}\\s*x?\\s+)?(.+?)\\s+(?:${inlineCondition})\\b`, "i"));

  if (inlineMatch && cleanupValue(inlineMatch[1]).length > 2) {
    return cleanupCardName(inlineMatch[1]);
  }

  const candidates = group
    .map((line) => line.replace(MONEY_WITH_CURRENCY_RE, " "))
    .map((line) => cleanupCardName(line))
    .filter((line) => line.length > 1)
    .filter((line) => !/^\d{1,3}$/.test(line))
    .filter((line) => !CONDITION_PATTERNS.some(([, pattern]) => pattern.test(line) && line.length < 18))
    .filter((line) => !LANGUAGE_RE.test(line))
    .filter((line) => !SET_OR_RARITY_RE.test(line))
    .filter((line) => !STOP_LINE_RE.test(line));

  return candidates[0] || "";
}

function cleanupCardName(value) {
  return cleanupValue(value)
    .replace(/\b(?:qty|quantity)\b\s*:?\s*\d{1,3}\b/gi, "")
    .replace(/\b\d{1,3}\s*x\b/gi, "")
    .replace(/\bx\s*\d{1,3}\b/gi, "")
    .replace(/\b(?:near mint|mint|excellent|exc|good|light played|played|poor|nm|mt|ex|gd|lp|pl|po)\b/gi, "")
    .trim();
}

function inferSellerCountry(shippingMethod, shippingValue, trackingStatus, shippingIndex) {
  const fallback = { country: "", source: "unknown", confidence: 0, ambiguous: false, matches: [] };
  if (!shippingMethod || !shippingIndex.length) {
    return fallback;
  }

  const germanyRows = shippingIndex.filter((record) => !record.destination || record.destination === "Germany");
  const exactMatches = germanyRows.filter((record) => {
    const methodMatch = methodsMatch(record.method, shippingMethod);
    const priceMatch = shippingValue === null || shippingValue === undefined || record.price === null || Math.abs(record.price - shippingValue) < 0.005;
    const trackingMatch = trackingStatus === "unknown" || record.tracked === "unknown" || record.tracked === trackingStatus;
    return methodMatch && priceMatch && trackingMatch;
  });
  const exactCountries = uniqueCountries(exactMatches);

  if (exactCountries.length === 1) {
    return {
      country: exactCountries[0],
      source: "shipping_data",
      confidence: 1,
      ambiguous: false,
      matches: exactMatches.map(matchSummary)
    };
  }

  if (exactCountries.length > 1) {
    return {
      country: "",
      source: "ambiguous",
      confidence: 1,
      ambiguous: true,
      matches: exactMatches.map(matchSummary)
    };
  }

  const methodOnlyMatches = germanyRows.filter((record) => {
    const methodMatch = methodsMatch(record.method, shippingMethod);
    const trackingMatch = trackingStatus === "unknown" || record.tracked === "unknown" || record.tracked === trackingStatus;
    return methodMatch && trackingMatch;
  });
  const methodOnlyCountries = uniqueCountries(methodOnlyMatches);

  if (methodOnlyCountries.length === 1) {
    return {
      country: methodOnlyCountries[0],
      source: "shipping_data_method",
      confidence: 0.92,
      ambiguous: false,
      matches: methodOnlyMatches.map((record) => ({ ...matchSummary(record), score: 0.92 }))
    };
  }

  if (methodOnlyCountries.length > 1) {
    return {
      country: "",
      source: "ambiguous",
      confidence: 0.8,
      ambiguous: true,
      matches: methodOnlyMatches.slice(0, 8).map((record) => ({ ...matchSummary(record), score: 0.8 }))
    };
  }

  const tokenMatches = inferCountryByMethodTokens(shippingMethod, germanyRows);
  if (tokenMatches.country) {
    return tokenMatches;
  }

  const methodTokens = tokenize(shippingMethod);
  const scored = germanyRows
    .map((record) => {
      const recordTokens = tokenize(record.method);
      const overlap = recordTokens.filter((token) => methodTokens.includes(token)).length;
      const inclusion = normalizeText(record.method).includes(normalizeText(shippingMethod)) || normalizeText(shippingMethod).includes(normalizeText(record.method));
      const trackingBoost = trackingStatus !== "unknown" && record.tracked === trackingStatus ? 0.15 : 0;
      const priceBoost = shippingValue !== null && record.price !== null && Math.abs(record.price - shippingValue) < 0.005 ? 0.2 : 0;
      const rawScore = (inclusion ? 0.65 : 0) + overlap / Math.max(recordTokens.length, methodTokens.length, 1) + trackingBoost + priceBoost;
      const score = Math.min(rawScore, 1);
      return { ...record, score: Number(score.toFixed(3)) };
    })
    .filter((record) => record.score > 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (!scored.length) {
    return fallback;
  }

  const top = scored[0];
  const runnerUp = scored[1];
  const ambiguous = Boolean(runnerUp && runnerUp.score >= top.score - 0.12 && runnerUp.country !== top.country);

  return {
    country: ambiguous ? "" : top.country,
    source: ambiguous ? "ambiguous" : "shipping_data",
    confidence: top.score,
    ambiguous,
    matches: scored.map((record) => ({
      country: record.country,
      method: record.method,
      tracked: record.tracked,
      price: record.price,
      score: record.score
    }))
  };
}

function inferCountryByMethodTokens(shippingMethod, shippingRows) {
  const methodTokens = tokenize(shippingMethod)
    .filter((token) => token.length >= 3)
    .filter((token) => !GENERIC_METHOD_TOKENS.has(token));

  if (!methodTokens.length) {
    return { country: "", source: "unknown", confidence: 0, ambiguous: false, matches: [] };
  }

  const matches = shippingRows.filter((record) => {
    const recordTokens = tokenize(record.method).filter((token) => !GENERIC_METHOD_TOKENS.has(token));
    return recordTokens.some((token) => methodTokens.includes(token));
  });
  const countries = uniqueCountries(matches);

  if (countries.length !== 1) {
    return { country: "", source: countries.length > 1 ? "ambiguous" : "unknown", confidence: 0.78, ambiguous: countries.length > 1, matches: matches.slice(0, 8).map((record) => ({ ...matchSummary(record), score: 0.78 })) };
  }

  return {
    country: countries[0],
    source: "shipping_data_token",
    confidence: 0.86,
    ambiguous: false,
    matches: matches.slice(0, 8).map((record) => ({ ...matchSummary(record), score: 0.86 }))
  };
}

function methodsMatch(left, right) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      (normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  );
}

function uniqueCountries(records) {
  return [...new Set(records.map((record) => record.country).filter((country) => country && country !== "Unknown"))];
}

function matchSummary(record) {
  return {
    country: record.country,
    method: record.method,
    tracked: record.tracked,
    price: record.price,
    score: record.score ?? 1
  };
}

function findShippingMethodCandidate(lines) {
  return (
    lines.find((line) => {
      if (isAnyFieldLabel(line) || hasMoney(line) || STOP_LINE_RE.test(line)) {
        return false;
      }
      return /\b(letter|parcel|package|registered|insured|tracked|shipping|post|dhl|ups|dpd|gls)\b/i.test(line);
    }) || ""
  );
}

function cleanShippingMethod(value) {
  return cleanupValue(value)
    .replace(/\bmax\.?\s*Weight:.*/i, "")
    .replace(/\bEstimated arrival date\b.*/i, "")
    .trim();
}

function findFirstSellerLikeLine(lines) {
  return lines.find((line) => looksLikeSellerName(line)) || "";
}

function looksLikeSellerName(line) {
  return Boolean(
    line &&
      line.length <= 48 &&
      /[a-z]/i.test(line) &&
      !hasMoney(line) &&
      !isAnyFieldLabel(line) &&
      !STOP_LINE_RE.test(line) &&
      !LANGUAGE_RE.test(line) &&
      !SET_OR_RARITY_RE.test(line) &&
      !CONDITION_PATTERNS.some(([, pattern]) => pattern.test(line) && line.length < 18)
  );
}

function isSellerMarker(line) {
  if (/seller country/i.test(line)) {
    return false;
  }
  return SELLER_MARKER_RE.test(line);
}

function extractSellerNameFromMarker(lines, index) {
  const marker = lines[index].match(SELLER_MARKER_RE);
  const inlineName = cleanupValue(marker?.[2] || "");

  if (inlineName && !/^[:\-]+$/.test(inlineName)) {
    return inlineName;
  }

  return cleanupValue(lines[index + 1] || "") || `Seller ${index + 1}`;
}

function isAnyFieldLabel(line) {
  return Object.values(FIELD_LABELS).some((pattern) => pattern.test(line));
}

function hasMoney(line) {
  return MONEY_WITH_CURRENCY_RE.test(line) || /\d+[,.]\d{2}/.test(line);
}

function normalizeTracked(value) {
  if (value === true) {
    return "tracked";
  }
  if (value === false) {
    return "untracked";
  }
  return parseTrackingStatus(String(value || ""));
}

function parseTrackingStatus(value) {
  const text = normalizeText(value);
  if (!text) {
    return "unknown";
  }
  if (/not tracked|untracked|without tracking|no tracking|no track/.test(text)) {
    return "untracked";
  }
  if (/tracked|tracking|registered|insured|with tracking|trackable/.test(text)) {
    return "tracked";
  }
  return "unknown";
}

function normalizeCountry(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value)
    .replace(/[_-]/g, " ")
    .replace(/\b(from|ships|shipping|seller|country|location|sent)\b/gi, "")
    .replace(/[:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return "";
  }

  const direct = COUNTRY_ALIASES[text.toUpperCase()];
  if (direct) {
    return direct;
  }

  const foundAlias = Object.entries(COUNTRY_ALIASES).find(([alias]) => new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(text));
  return foundAlias ? foundAlias[1] : "";
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .filter((token) => !["with", "and", "the", "for", "eur"].includes(token));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupValue(value) {
  return String(value || "")
    .replace(/^[\s:|\-]+/, "")
    .replace(/[\s|]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
