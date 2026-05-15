(() => {
  const LIVE_CARTFORGE_URL = "https://mezzy0710.github.io/cardmarket-cart-optimizer/";
  const PANEL_ID = "cartforge-cardmarket-extractor";
  const STORAGE_KEY = "cartforgeConfirmedPlanV3";
  // Set to true in the browser console to log per-seller extraction diagnostics.
  const CARTFORGE_DEBUG = false;

  if (document.getElementById(PANEL_ID)) {
    return;
  }

  // Try to load a confirmed plan from extension storage; fall back to the
  // extraction panel if storage is unavailable or empty.
  try {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const plan = result && result[STORAGE_KEY]?.plan;
      if (plan && Array.isArray(plan.sellers) && plan.sellers.length > 0) {
        renderPlanOverlay(plan);
      } else {
        renderExtractionPanel();
      }
    });
  } catch {
    renderExtractionPanel();
  }

  // ── Plan overlay ──────────────────────────────────────────────────────────

  function renderPlanOverlay(plan) {
    renderFloatingPanel(plan);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => findAndBadgeSellerSections(plan));
    } else {
      findAndBadgeSellerSections(plan);
    }
  }

  function renderFloatingPanel(plan) {
    const keepSellers = plan.sellers.filter((s) => s.decision === "keep");

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    css(panel, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "2147483647",
      width: "288px",
      font: "14px/1.45 'IBM Plex Sans','Segoe UI',sans-serif",
      color: "#F2EDE3",
      background: "#1C1A17",
      border: "1px solid #3A332B",
      borderRadius: "12px",
      boxShadow: "0 16px 40px rgba(0,0,0,.55)",
      overflow: "hidden"
    });

    // Header row
    const header = document.createElement("div");
    css(header, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 16px",
      cursor: "pointer",
      userSelect: "none"
    });

    const headerLeft = document.createElement("div");
    css(headerLeft, { display: "flex", alignItems: "center", gap: "8px" });

    const logo = document.createElement("strong");
    logo.textContent = "CartForge";
    css(logo, {
      fontFamily: "'Space Grotesk','Segoe UI',sans-serif",
      fontSize: "15px",
      fontWeight: "700",
      color: "#C8A75D",
      letterSpacing: ".01em"
    });

    const statusBadge = document.createElement("span");
    statusBadge.textContent = "PLAN ACTIVE";
    css(statusBadge, {
      fontSize: "10px",
      fontWeight: "700",
      letterSpacing: ".06em",
      padding: "2px 6px",
      borderRadius: "4px",
      background: "#1A2E1A",
      color: "#6FCF6F"
    });

    headerLeft.append(logo, statusBadge);

    const minimizeBtn = document.createElement("button");
    minimizeBtn.textContent = "—";
    minimizeBtn.setAttribute("aria-label", "Minimize panel");
    css(minimizeBtn, {
      background: "none",
      border: "none",
      color: "#7D7468",
      fontSize: "16px",
      cursor: "pointer",
      padding: "0 4px",
      lineHeight: "1",
      fontFamily: "inherit"
    });

    header.append(headerLeft, minimizeBtn);

    // Body
    const body = document.createElement("div");
    css(body, { padding: "0 16px 16px" });

    const buyLine = document.createElement("p");
    buyLine.textContent = `Buy from ${keepSellers.length} seller${keepSellers.length !== 1 ? "s" : ""}`;
    css(buyLine, { margin: "0 0 10px", color: "#AFA699", fontSize: "13px" });
    body.append(buyLine);

    if (keepSellers.length > 0) {
      const chipsWrap = document.createElement("div");
      css(chipsWrap, { display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "14px" });
      for (const seller of keepSellers) {
        const chip = document.createElement("span");
        chip.textContent = seller.sellerDisplayName;
        css(chip, {
          fontSize: "11px",
          fontWeight: "600",
          padding: "3px 8px",
          borderRadius: "20px",
          background: "#1A2E1A",
          color: "#8FBF6F",
          border: "1px solid #2A4A2A"
        });
        chipsWrap.append(chip);
      }
      body.append(chipsWrap);
    }

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "CLEAR PLAN";
    css(clearBtn, {
      width: "100%",
      border: "1px solid #3A332B",
      borderRadius: "6px",
      background: "transparent",
      color: "#7D7468",
      padding: "9px 14px",
      fontFamily: "'Space Grotesk','Segoe UI',sans-serif",
      fontSize: "12px",
      fontWeight: "700",
      letterSpacing: ".04em",
      textTransform: "uppercase",
      cursor: "pointer"
    });
    body.append(clearBtn);

    panel.append(header, body);
    document.body.append(panel);

    // Minimize / restore toggle
    let minimized = false;
    const toggleMinimize = () => {
      minimized = !minimized;
      body.style.display = minimized ? "none" : "";
      minimizeBtn.textContent = minimized ? "▲" : "—";
      minimizeBtn.setAttribute("aria-label", minimized ? "Restore panel" : "Minimize panel");
    };
    minimizeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMinimize();
    });
    header.addEventListener("click", () => {
      if (minimized) {
        toggleMinimize();
      }
    });

    // Clear plan — remove storage, badges, and panel
    clearBtn.addEventListener("click", () => {
      try {
        chrome.storage.local.remove([STORAGE_KEY], () => {
          document.querySelectorAll("[data-cartforge-badge]").forEach((el) => el.remove());
          document.querySelectorAll("[data-cartforge-accordion]").forEach((el) => el.remove());
          document.querySelectorAll("[data-cartforge-section]").forEach((el) => {
            el.removeAttribute("data-cartforge-section");
          });
          panel.remove();
        });
      } catch {
        panel.remove();
      }
    });
  }

  function findAndBadgeSellerSections(plan) {
    // Build lookup structures from the plan
    const planByName = new Map(
      plan.sellers.map((s) => [normalizeName(s.sellerDisplayName), s])
    );
    const rowsBySeller = new Map(plan.sellers.map((s) => [s.sellerIndex, []]));
    for (const row of plan.rows || []) {
      const bucket = rowsBySeller.get(row.sellerIndex);
      if (bucket) {
        bucket.push(row);
      }
    }

    const sections = findSellerSections(document);
    for (const section of sections) {
      if (section.hasAttribute("data-cartforge-section")) {
        continue;
      }

      const text = visibleText(section);
      const sectionName = extractSellerNameFromSection(section, text);
      const planSeller = matchPlanSeller(sectionName, planByName);
      if (!planSeller) {
        continue;
      }

      section.setAttribute("data-cartforge-section", String(planSeller.sellerIndex));

      const rows = rowsBySeller.get(planSeller.sellerIndex) || [];
      const visibleRows = rows.filter(
        (r) => r.decision === "selected" || r.decision === "manual_review"
      );

      const badgeEl = createSellerBadge(planSeller, visibleRows);
      section.insertBefore(badgeEl, section.firstChild);
    }
  }

  function matchPlanSeller(sectionName, planByName) {
    if (!sectionName) {
      return null;
    }
    const normalized = normalizeName(sectionName);
    if (planByName.has(normalized)) {
      return planByName.get(normalized);
    }
    // Partial match fallback
    for (const [planName, seller] of planByName) {
      if (planName.includes(normalized) || normalized.includes(planName)) {
        return seller;
      }
    }
    return null;
  }

  function createSellerBadge(planSeller, rows) {
    const { decision } = planSeller;
    const isKeep = decision === "keep";
    const isReview = decision === "manual_review";

    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-cartforge-badge", String(planSeller.sellerIndex));
    css(wrapper, {
      margin: "8px 0",
      fontFamily: "'IBM Plex Sans','Segoe UI',sans-serif"
    });

    const badge = document.createElement("div");
    css(badge, {
      display: "inline-flex",
      alignItems: "center",
      gap: "5px",
      padding: "5px 10px",
      borderRadius: "6px",
      fontSize: "12px",
      fontWeight: "700",
      letterSpacing: ".05em",
      userSelect: "none",
      ...(isKeep
        ? { background: "#1A2E1A", color: "#6FCF6F", border: "1px solid #2A4A2A", cursor: "pointer" }
        : isReview
          ? { background: "#2E2A1A", color: "#CFA75D", border: "1px solid #4A3A1A", cursor: "default" }
          : { background: "#2E1A1A", color: "#CF6F6F", border: "1px solid #4A2A2A", cursor: "default" })
    });

    const icon = document.createElement("span");
    icon.textContent = isKeep ? "✓" : isReview ? "⚠" : "✗";

    const label = document.createElement("span");
    label.textContent = isKeep ? "KEEP" : isReview ? "REVIEW" : "SKIP";

    badge.append(icon, label);

    if (isKeep) {
      const chevron = document.createElement("span");
      chevron.textContent = "▾";
      css(chevron, { fontSize: "11px", display: "inline-block", transition: "transform .2s" });
      badge.append(chevron);

      const accordion = createCardAccordion(rows, planSeller.sellerIndex);
      wrapper.append(badge, accordion);

      let open = false;
      badge.addEventListener("click", () => {
        open = !open;
        accordion.style.display = open ? "block" : "none";
        chevron.style.transform = open ? "rotate(180deg)" : "";
      });
    } else {
      wrapper.append(badge);
    }

    return wrapper;
  }

  function createCardAccordion(rows, sellerIndex) {
    const container = document.createElement("div");
    container.setAttribute("data-cartforge-accordion", String(sellerIndex));
    container.style.display = "none";
    css(container, {
      marginTop: "6px",
      borderRadius: "6px",
      border: "1px solid #2A3020",
      background: "#141210",
      overflow: "hidden",
      fontFamily: "'IBM Plex Sans','Segoe UI',sans-serif",
      fontSize: "12px",
      color: "#AFA699"
    });

    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No cards to show.";
      css(empty, { padding: "8px 12px", color: "#7D7468" });
      container.append(empty);
      return container;
    }

    rows.forEach((row, i) => {
      const rowEl = document.createElement("div");
      css(rowEl, {
        padding: "7px 12px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "8px",
        ...(i < rows.length - 1 ? { borderBottom: "1px solid #1E1C18" } : {})
      });

      // Left: card name + meta
      const left = document.createElement("div");
      css(left, { flex: "1", minWidth: "0" });

      const nameEl = document.createElement("div");
      nameEl.textContent = row.cardName || "(unknown)";
      css(nameEl, {
        fontWeight: "600",
        color: "#E8E0D0",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      });

      const metaParts = [`${row.quantity || 1}x`];
      const condLang = [row.condition, row.language].filter(Boolean).join(" · ");
      if (condLang) {
        metaParts.push(condLang);
      }
      const metaEl = document.createElement("div");
      metaEl.textContent = metaParts.join(" · ");
      css(metaEl, { color: "#7D7468", marginTop: "2px" });

      left.append(nameEl, metaEl);

      // Right: price + optional review label
      const right = document.createElement("div");
      css(right, { textAlign: "right", flexShrink: "0" });

      const priceEl = document.createElement("div");
      priceEl.textContent = row.unitPrice != null ? `€${Number(row.unitPrice).toFixed(2)}` : "";
      css(priceEl, { fontWeight: "600", color: "#C8A75D" });
      right.append(priceEl);

      if (row.decision === "manual_review") {
        const reviewLabel = document.createElement("div");
        reviewLabel.textContent = "⚠ Review";
        css(reviewLabel, { color: "#CFA75D", fontSize: "10px", marginTop: "2px" });
        right.append(reviewLabel);
      }

      rowEl.append(left, right);
      container.append(rowEl);
    });

    return container;
  }

  function extractSellerNameFromSection(section, text) {
    return (
      readFirst(section, [
        "[data-seller-name]",
        ".seller-name",
        "a[href*='/Users/']",
        "h2",
        "h3"
      ]) ||
      inferLabel(text, /seller\s*:?\s*([^\n]+)/i) ||
      ""
    );
  }

  function normalizeName(name) {
    return String(name || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  }

  function css(el, styles) {
    Object.assign(el.style, styles);
  }

  // ── Extraction panel (no plan active) ────────────────────────────────────

  function renderExtractionPanel() {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "width:288px",
      "font:14px/1.45 'IBM Plex Sans','Segoe UI',sans-serif",
      "color:#F2EDE3",
      "background:#1C1A17",
      "border:1px solid #3A332B",
      "border-radius:12px",
      "box-shadow:0 16px 40px rgba(0,0,0,.55)",
      "padding:16px"
    ].join(";");

    const titleEl = document.createElement("div");
    css(titleEl, { display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" });
    const logoEl = document.createElement("strong");
    logoEl.textContent = "CartForge";
    css(logoEl, {
      fontFamily: "'Space Grotesk','Segoe UI',sans-serif",
      fontSize: "15px",
      fontWeight: "700",
      color: "#C8A75D",
      letterSpacing: ".01em"
    });
    titleEl.append(logoEl);

    const descEl = document.createElement("p");
    descEl.textContent = "Import your Cardmarket cart into CartForge for seller cost optimisation.";
    css(descEl, { margin: "0 0 14px", color: "#AFA699", fontSize: "13px", lineHeight: "1.5" });

    const openBtn = document.createElement("button");
    openBtn.setAttribute("data-cartforge-action", "open-live");
    openBtn.textContent = "Open CartForge";
    css(openBtn, {
      width: "100%",
      border: "0",
      borderRadius: "6px",
      background: "#C8A75D",
      color: "#12110F",
      padding: "10px 14px",
      fontFamily: "'Space Grotesk','Segoe UI',sans-serif",
      fontSize: "13px",
      fontWeight: "700",
      letterSpacing: ".04em",
      textTransform: "uppercase",
      cursor: "pointer"
    });

    const copyBtn = document.createElement("button");
    copyBtn.setAttribute("data-cartforge-action", "copy");
    copyBtn.textContent = "Copy cart data";
    css(copyBtn, {
      width: "100%",
      border: "1px solid #3A332B",
      borderRadius: "6px",
      background: "transparent",
      color: "#AFA699",
      padding: "9px 14px",
      fontFamily: "'Space Grotesk','Segoe UI',sans-serif",
      fontSize: "13px",
      fontWeight: "600",
      letterSpacing: ".04em",
      textTransform: "uppercase",
      cursor: "pointer",
      marginTop: "8px"
    });

    const statusEl = document.createElement("p");
    statusEl.setAttribute("data-cartforge-status", "");
    css(statusEl, { margin: "10px 0 0", color: "#7D7468", fontSize: "12px", lineHeight: "1.4" });

    panel.append(titleEl, descEl, openBtn, copyBtn, statusEl);
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
        setStatus(statusEl, "No cart items detected on this page yet. Open the Cardmarket cart page and try again.");
        return;
      }

      if (action === "open-live") {
        window.open(buildTargetUrl(LIVE_CARTFORGE_URL, encoded), "_blank", "noopener,noreferrer");
        setStatus(statusEl, `Cart received from Cardmarket: ${payload.sellers.length} seller(s), ${itemCount} item row(s).`);
      }

      if (action === "copy") {
        try {
          await navigator.clipboard.writeText(`CARTFORGE_CART=${JSON.stringify(payload, null, 2)}`);
          setStatus(statusEl, `Copied payload: ${payload.sellers.length} seller(s), ${itemCount} item row(s).`);
        } catch {
          setStatus(statusEl, "Could not copy payload. Check clipboard permissions and try again.");
        }
      }
    });
  }

  function setStatus(statusEl, message) {
    statusEl.textContent = message;
  }

  function buildTargetUrl(baseUrl, encodedPayload) {
    const targetUrl = new URL(baseUrl);
    targetUrl.searchParams.set("source", "cardmarket-extension");
    targetUrl.searchParams.set("t", String(Date.now()));
    targetUrl.hash = `cartforge=${encodedPayload}`;
    return targetUrl.toString();
  }

  // ── Cart extraction helpers ───────────────────────────────────────────────

  function extractCartPayload(root) {
    const sellerSections = findSellerSections(root);
    const sellers = sellerSections
      .map(extractSeller)
      .filter((seller) => seller.items.length || seller.sellerName !== "Unknown seller");
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
    // Prefer the known Cardmarket shipment-block pattern (section[id^="seller"]).
    // This is the most reliable anchor: it is exactly one element per seller and
    // always contains the flag tooltip with the seller's country.
    const shipmentBlocks = [
      ...root.querySelectorAll('section[id^="seller"], section.shipment-block')
    ].filter((el) => /(?:€|EUR|\d+[,.]\d{2})/.test(visibleText(el)));
    if (shipmentBlocks.length) {
      return shipmentBlocks;
    }

    // Generic fallback: use heuristics for sites with different markup.
    const semanticCandidates = [
      ...root.querySelectorAll(
        "[data-seller-id], [data-seller], .seller, .seller-row, .shopping-cart-seller, .cart-seller, article, section"
      )
    ].filter((element) => {
      const text = visibleText(element);
      return (
        /\b(summary|shipping|shipment|seller|articles?|total|trustee)\b/i.test(text) &&
        /(?:€|EUR|\d+[,.]\d{2})/.test(text)
      );
    });

    if (semanticCandidates.length) {
      return compactSections(semanticCandidates);
    }

    const headings = [...root.querySelectorAll("h2,h3,h4")].filter((heading) =>
      /\bseller\b/i.test(visibleText(heading))
    );
    return headings
      .map((heading) => heading.closest("section,article,div") || heading.parentElement)
      .filter(Boolean);
  }

  function compactSections(sections) {
    return sections.filter((section, index) => {
      return !sections.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.contains(section) &&
          visibleText(other).length < visibleText(section).length * 2.5
      );
    });
  }

  function extractSeller(section, sellerIndex) {
    const text = visibleText(section);
    const rows = findItemRows(section)
      .map((row, rowIndex) => extractItem(row, sellerIndex, rowIndex))
      .filter((item) => item.cardName || item.price !== null);
    const sellerName =
      readFirst(section, [
        "[data-seller-name]",
        ".seller-name",
        ".seller a[href*='/Users/']",
        "a[href*='/Users/']",
        "h2",
        "h3"
      ]) ||
      inferLabel(text, /seller\s*:?\s*([^\n]+)/i) ||
      `Seller ${sellerIndex + 1}`;

    const sellerCountry = readCountry(section, text);

    if (CARTFORGE_DEBUG) {
      // eslint-disable-next-line no-console
      console.log("[CartForge] extractSeller", {
        sellerName,
        sectionId: section.id || "(no id)",
        locationElFound: !!(
          section.querySelector('[title^="Item location:"]') ||
          section.querySelector('[data-bs-original-title^="Item location:"]')
        ),
        allTitleAttrs: [
          ...section.querySelectorAll("[title], [data-bs-original-title]"),
        ].map(
          (el) =>
            el.getAttribute("title") || el.getAttribute("data-bs-original-title")
        ).filter(Boolean),
        sellerCountry,
      });
    }

    return {
      sellerName,
      sellerCountry,
      shippingMethod: readShippingMethod(section, text),
      trackingStatus: /\b(untracked|no tracking)\b/i.test(text)
        ? "untracked"
        : /\b(tracked|tracking|registered|insured)\b/i.test(text)
          ? "tracked"
          : "unknown",
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
      return (
        /(?:€|EUR|\d+[,.]\d{2})/.test(text) &&
        !/\b(summary|shipping|shipment|trustee|total)\b/i.test(text)
      );
    });

    if (rowCandidates.length) {
      return rowCandidates;
    }

    return [...section.querySelectorAll("li, div")].filter((row) => {
      const text = visibleText(row);
      return (
        /\b(?:near mint|mint|excellent|good|light played|played|poor|nm|ex|gd|lp|pl)\b/i.test(text) &&
        /(?:€|EUR|\d+[,.]\d{2})/.test(text)
      );
    });
  }

  function extractItem(row, sellerIndex, rowIndex) {
    const text = visibleText(row);
    const cardName =
      readFirst(row, [
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
      setName:
        readFirst(row, ["[data-expansion-name]", "[data-set-name]", ".expansion", ".set", ".edition"]) ||
        inferLabel(text, /(?:set|edition|expansion)\s*:?\s*([^\n|]+)/i),
      rarity:
        readFirst(row, ["[data-rarity]", ".rarity"]) ||
        inferLabel(text, /\b(common|uncommon|rare|mythic(?: rare)?)\b/i),
      condition: readFirst(row, ["[data-condition]", ".condition"]) || inferCondition(text),
      quantity: inferQuantity(text),
      price: readLastMoney(text),
      rawLine: text
    };
  }

  function readFirst(root, selectors) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      const value =
        element?.dataset?.sellerName ||
        element?.dataset?.cardName ||
        element?.dataset?.productName ||
        element?.dataset?.condition ||
        visibleText(element);
      if (value) {
        return value;
      }
    }
    return "";
  }

  function readCountry(section, text) {
    // Bootstrap 5 tooltip init consumes the `title` attribute, storing its value
    // in `data-bs-original-title` and clearing `title` to "". Check both so
    // extraction works regardless of when Bootstrap runs relative to the extension.
    const locationEl =
      section.querySelector('[title^="Item location:"]') ||
      section.querySelector('[data-bs-original-title^="Item location:"]');
    const rawTitle =
      locationEl?.getAttribute("title") ||
      locationEl?.getAttribute("data-bs-original-title");
    const locationTitle = rawTitle?.replace(/^Item location:\s*/i, "")?.trim() || null;
    return (
      locationTitle ||
      inferLabel(text, /(?:country|location|ships from|sent from)\s*:?\s*([A-Z][A-Za-z ]+)/i) ||
      ""
    );
  }

  function readShippingMethod(section, text) {
    return (
      readFirst(section, ["[data-shipping-method]", ".shipping-method", ".shipment-method"]) ||
      inferLabel(text, /(?:shipping method|shipment method|shipping option)\s*:?\s*([^\n]+)/i) ||
      ""
    );
  }

  function inferCardName(text) {
    return (
      text
        .split("\n")
        .map((line) => line.trim())
        .find(
          (line) =>
            line.length > 2 &&
            !/(?:€|EUR|\d+x|near mint|mint|excellent|good|played|common|uncommon|rare|mythic)/i.test(line)
        ) || ""
    );
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
    const line = text
      .split("\n")
      .find((candidate) => labelPattern.test(candidate) && readLastMoney(candidate) !== null);
    return line ? readLastMoney(line) : null;
  }

  function readLastMoney(text) {
    const matches = [
      ...String(text || "").matchAll(
        /(?:EUR\s*)?\d{1,3}(?:[.\s]\d{3})*[,.]\d{2}\s*(?:€|EUR)?|(?:€|EUR)\s*\d+(?:[,.]\d{2})?/gi
      )
    ];
    return matches.length ? matches[matches.length - 1][0] : null;
  }

  function visibleText(element) {
    return String(element?.innerText || element?.textContent || "")
      .replace(/ /g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .trim();
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
