// KAIKATA shipping table refresh — paste into the DevTools console on
// https://help.cardmarket.com/en/ShippingCosts and press Enter.
//
// Fetches every origin country → Germany from Cardmarket's /api/shippingCosts
// endpoint (one request at a time), maps the rows to shipping_data.json's schema
// and downloads the result as shipping_data.json. Replace the repo file with it,
// run the tests and commit. See README "Refreshing shipping rates".
//
// Set DRY_RUN = true to skip the download; the result is then left on
// window.kaikataShippingData for inspection.
(async () => {
  const DRY_RUN = false;
  const DESTINATION_ID = 7; // Germany
  const DESTINATION_NAME = "Germany";

  const nuxtEl = document.getElementById("__NUXT_DATA__");
  if (!nuxtEl) {
    throw new Error("__NUXT_DATA__ not found. Open https://help.cardmarket.com/en/ShippingCosts first.");
  }
  // Nuxt payload: a flat array where object values are indexes into the same array.
  const payload = JSON.parse(nuxtEl.textContent);
  const resolve = (index) => payload[index];

  const origins = new Map(); // fromCountryId -> { name, days }
  for (const entry of payload) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (!("fromCountry" in entry && "fromCountryId" in entry && "toCountry" in entry && "toCountryId" in entry)) continue;
    const fromId = resolve(entry.fromCountryId);
    const fromName = resolve(entry.fromCountry);
    if (typeof fromId !== "number" || typeof fromName !== "string") continue;
    if (!origins.has(fromId)) origins.set(fromId, { name: fromName, days: null });
    if (resolve(entry.toCountryId) === DESTINATION_ID && "days" in entry) {
      origins.get(fromId).days = resolve(entry.days);
    }
  }
  if (!origins.size) {
    throw new Error("No countries found in __NUXT_DATA__; the page structure may have changed.");
  }

  const decoder = document.createElement("textarea");
  const decodeHtml = (text) => {
    decoder.innerHTML = String(text ?? "");
    return decoder.value;
  };
  // "1.000,00 €" -> 1000
  const parseEuro = (value) => {
    if (typeof value === "number") return value;
    const cleaned = String(value ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
    const number = Number.parseFloat(cleaned);
    return Number.isFinite(number) ? number : null;
  };

  const result = {
    _meta: {
      updatedAt: new Date().toISOString().slice(0, 10),
      source: "help.cardmarket.com/en/ShippingCosts",
      destination: DESTINATION_NAME
    }
  };

  const sortedOrigins = [...origins.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  for (const [fromId, { name, days }] of sortedOrigins) {
    const url = `/api/shippingCosts?locale=en&fromCountry=${fromId}&toCountry=${DESTINATION_ID}&preview=false`;
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`${name}: HTTP ${response.status}`);
    }
    const rows = await response.json();
    if (!Array.isArray(rows)) {
      throw new Error(`${name}: unexpected response shape`);
    }
    result[name] = rows
      .filter((row) => !row.isVirtual)
      .map((row) => ({
        method: decodeHtml(row.name).trim(),
        tracked: Boolean(row.isTracked),
        max_value: parseEuro(row.maxValue),
        max_weight_g: Number(row.maxWeight),
        price: parseEuro(row.price),
        is_letter: Boolean(row.isLetter),
        delivery_days: days
      }));
    console.log(`${name}: ${result[name].length} rows`);
  }

  const countryCount = Object.keys(result).length - 1;
  const rowCount = Object.entries(result).reduce((sum, [key, rows]) => sum + (key.startsWith("_") ? 0 : rows.length), 0);
  console.log(`Done: ${countryCount} countries, ${rowCount} rows.`);
  window.kaikataShippingData = result;

  if (DRY_RUN) {
    console.log("DRY_RUN: result stored on window.kaikataShippingData, no download.");
    return;
  }
  const blob = new Blob([`${JSON.stringify(result, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "shipping_data.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
})();
