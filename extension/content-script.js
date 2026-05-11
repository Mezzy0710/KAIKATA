(() => {
  const LOCAL_CARTFORGE_URL = "http://localhost:8000/";
  const LIVE_CARTFORGE_URL = "https://mezzy0710.github.io/cardmarket-cart-optimizer/";
  const PANEL_ID = "cartforge-cardmarket-extractor";

  if (document.getElementById(PANEL_ID)) {
    return;
  }

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "z-index:2147483647",
    "max-width:320px",
    "font:14px/1.35 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    "color:#122016",
    "background:#f7f1df",
    "border:1px solid #bca971",
    "border-radius:14px",
    "box-shadow:0 18px 48px rgba(0,0,0,.22)",
    "padding:14px"
  ].join(";");

  panel.innerHTML = `
    <strong style="display:block;margin-bottom:6px;">CartForge</strong>
    <p style="margin:0 0 10px;color:#4f583e;">Import your Cardmarket cart into CartForge. We'll handle the seller math.</p>
    <button data-cartforge-action="open-local" style="width:100%;border:0;border-radius:10px;background:#1f4f35;color:white;padding:10px 12px;font-weight:700;cursor:pointer;">Open local CartForge</button>
    <button data-cartforge-action="open-live" style="width:100%;border:1px solid #1f4f35;border-radius:10px;background:#fff9ea;color:#1f4f35;padding:9px 12px;font-weight:700;cursor:pointer;margin-top:8px;">Open live CartForge</button>
    <button data-cartforge-action="copy" style="width:100%;border:1px solid #bca971;border-radius:10px;background:white;color:#1f4f35;padding:9px 12px;font-weight:700;cursor:pointer;margin-top:8px;">Copy payload</button>
    <p data-cartforge-status style="margin:10px 0 0;color:#4f583e;font-size:12px;"></p>
  `;

  document.body.append(panel);

  panel.addEventListener("click", async (event) => {
    const action = event.target?.dataset?.cartforgeAction;
    if (!action) {
      return;
    }

    const payload = extractCartPayload(document);
    const encoded = encodePayload(payload);
    const itemCount = countItems(payload);

    if (!payload.sellers.length || itemCount === 0) {
      setStatus("No cart items detected on this page yet. Open the Cardmarket cart page and try again.");
      return;
    }

    if (action === "open-local") {
      window.open(buildTargetUrl(LOCAL_CARTFORGE_URL, encoded), "_blank", "noopener,noreferrer");
      setStatus(`Cart received from Cardmarket: ${payload.sellers.length} seller(s), ${itemCount} item row(s).`);
    }

    if (action === "open-live") {
      window.open(buildTargetUrl(LIVE_CARTFORGE_URL, encoded), "_blank", "noopener,noreferrer");
      setStatus(`Cart received from Cardmarket: ${payload.sellers.length} seller(s), ${itemCount} item row(s).`);
    }

    if (action === "copy") {
      try {
        await navigator.clipboard.writeText(`CARTFORGE_CART=${JSON.stringify(payload, null, 2)}`);
        setStatus(`Copied payload: ${payload.sellers.length} seller(s), ${itemCount} item row(s).`);
      } catch {
        setStatus("Could not copy payload. Check clipboard permissions and try again.");
      }
    }
  });

  function setStatus(message) {
    const status = panel.querySelector("[data-cartforge-status]");
    if (status) {
      status.textContent = message;
    }
  }

  function buildTargetUrl(baseUrl, encodedPayload) {
    const targetUrl = new URL(baseUrl);
    targetUrl.searchParams.set("source", "cardmarket-extension");
    targetUrl.searchParams.set("t", String(Date.now()));
    targetUrl.hash = `cartforge=${encodedPayload}`;
    return targetUrl.toString();
  }

  function extractCartPayload(root) {
    const sellerSections = findSellerSections(root);
    const sellers = sellerSections.map(extractSeller).filter((seller) => seller.items.length || seller.sellerName !== "Unknown seller");
    const warnings = [];

    if (!sellers.length) {
      warnings.push("No seller sections were recognized. Cardmarket may have changed the cart markup.");
    }

    return {
      source: "cartforge-cardmarket-extension",
      version: 1,
      url: location.href,
      extractedAt: new Date().toISOString(),
      sellers,
      warnings
    };
  }

  function findSellerSections(root) {
    const semanticCandidates = [
      ...root.querySelectorAll("[data-seller-id], [data-seller], .seller, .seller-row, .shopping-cart-seller, .cart-seller, article, section")
    ].filter((element) => {
      const text = visibleText(element);
      return /\b(summary|shipping|shipment|seller|articles?|total|trustee)\b/i.test(text) && /(?:€|EUR|\d+[,.]\d{2})/.test(text);
    });

    if (semanticCandidates.length) {
      return compactSections(semanticCandidates);
    }

    const headings = [...root.querySelectorAll("h2,h3,h4")].filter((heading) => /\bseller\b/i.test(visibleText(heading)));
    return headings.map((heading) => heading.closest("section,article,div") || heading.parentElement).filter(Boolean);
  }

  function compactSections(sections) {
    return sections.filter((section, index) => {
      return !sections.some((other, otherIndex) => otherIndex !== index && other.contains(section) && visibleText(other).length < visibleText(section).length * 2.5);
    });
  }

  function extractSeller(section, sellerIndex) {
    const text = visibleText(section);
    const rows = findItemRows(section).map((row, rowIndex) => extractItem(row, sellerIndex, rowIndex)).filter((item) => item.cardName || item.price !== null);
    const sellerName = readFirst(section, [
      "[data-seller-name]",
      ".seller-name",
      ".seller a[href*='/Users/']",
      "a[href*='/Users/']",
      "h2",
      "h3"
    ]) || inferLabel(text, /seller\s*:?\s*([^\n]+)/i) || `Seller ${sellerIndex + 1}`;

    return {
      sellerName,
      sellerCountry: readCountry(section, text),
      shippingMethod: readShippingMethod(section, text),
      trackingStatus: /\b(untracked|no tracking)\b/i.test(text) ? "untracked" : /\b(tracked|tracking|registered|insured)\b/i.test(text) ? "tracked" : "unknown",
      articleValue: readMoneyNear(text, /article value|articles value|contents/i),
      shippingValue: readMoneyNear(text, /shipping|shipment|postage/i),
      trusteeValue: readMoneyNear(text, /trustee/i),
      total: readMoneyNear(text, /total|grand total|seller total/i),
      items: rows,
      rawText: text
    };
  }

  function findItemRows(section) {
    const rowCandidates = [
      ...section.querySelectorAll("tr, [role='row'], .article-row, .cart-item, .item-row, .product-row")
    ].filter((row) => {
      const text = visibleText(row);
      return /(?:€|EUR|\d+[,.]\d{2})/.test(text) && !/\b(summary|shipping|shipment|trustee|total)\b/i.test(text);
    });

    if (rowCandidates.length) {
      return rowCandidates;
    }

    return [...section.querySelectorAll("li, div")].filter((row) => {
      const text = visibleText(row);
      return /\b(?:near mint|mint|excellent|good|light played|played|poor|nm|ex|gd|lp|pl)\b/i.test(text) && /(?:€|EUR|\d+[,.]\d{2})/.test(text);
    });
  }

  function extractItem(row, sellerIndex, rowIndex) {
    const text = visibleText(row);
    const cardName = readFirst(row, [
      "[data-card-name]",
      "[data-product-name]",
      ".card-name",
      ".product-name",
      "a[href*='/Products/Singles/']",
      "a[href*='/Magic/Products/']"
    ]) || inferCardName(text);

    return {
      id: `cardmarket-${sellerIndex + 1}-${rowIndex + 1}`,
      cardName,
      setName: readFirst(row, ["[data-expansion-name]", "[data-set-name]", ".expansion", ".set", ".edition"]) || inferLabel(text, /(?:set|edition|expansion)\s*:?\s*([^\n|]+)/i),
      rarity: readFirst(row, ["[data-rarity]", ".rarity"]) || inferLabel(text, /\b(common|uncommon|rare|mythic(?: rare)?)\b/i),
      condition: readFirst(row, ["[data-condition]", ".condition"]) || inferCondition(text),
      quantity: inferQuantity(text),
      price: readLastMoney(text),
      rawLine: text
    };
  }

  function readFirst(root, selectors) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      const value = element?.dataset?.sellerName || element?.dataset?.cardName || element?.dataset?.productName || element?.dataset?.condition || visibleText(element);
      if (value) {
        return value;
      }
    }
    return "";
  }

  function readCountry(section, text) {
    const imageAlt = [...section.querySelectorAll("img[alt], [title]")]
      .map((element) => element.getAttribute("alt") || element.getAttribute("title") || "")
      .find((value) => /\b(location|country|ships from|seller from)\b/i.test(value));
    return inferLabel(text, /(?:country|location|ships from|sent from)\s*:?\s*([A-Z][A-Za-z ]+)/i) || imageAlt || "";
  }

  function readShippingMethod(section, text) {
    return readFirst(section, ["[data-shipping-method]", ".shipping-method", ".shipment-method"])
      || inferLabel(text, /(?:shipping method|shipment method|shipping option)\s*:?\s*([^\n]+)/i)
      || "";
  }

  function inferCardName(text) {
    return text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 2 && !/(?:€|EUR|\d+x|near mint|mint|excellent|good|played|common|uncommon|rare|mythic)/i.test(line))
      || "";
  }

  function inferCondition(text) {
    const match = text.match(/\b(near mint|mint|excellent|good|light played|played|poor|nm|ex|gd|lp|pl|po)\b/i);
    return match ? match[1] : "";
  }

  function inferQuantity(text) {
    const match = text.match(/\b(\d{1,3})\s*x\b/i) || text.match(/\bqty\.?\s*:?\s*(\d{1,3})\b/i);
    return Math.max(1, Number.parseInt(match?.[1] || "1", 10) || 1);
  }

  function inferLabel(text, pattern) {
    const match = text.match(pattern);
    return match ? match[1].trim() : "";
  }

  function readMoneyNear(text, labelPattern) {
    const line = text.split("\n").find((candidate) => labelPattern.test(candidate) && readLastMoney(candidate) !== null);
    return line ? readLastMoney(line) : null;
  }

  function readLastMoney(text) {
    const matches = [...String(text || "").matchAll(/(?:EUR\s*)?\d{1,3}(?:[.\s]\d{3})*[,.]\d{2}\s*(?:€|EUR)?|(?:€|EUR)\s*\d+(?:[,.]\d{2})?/gi)];
    return matches.length ? matches[matches.length - 1][0] : null;
  }

  function visibleText(element) {
    return String(element?.innerText || element?.textContent || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
  }

  function countItems(payload) {
    return payload.sellers.reduce((sum, seller) => sum + seller.items.length, 0);
  }

  function encodePayload(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
})();
