(() => {
  const LIVE_CARTFORGE_URL = "https://mezzy0710.github.io/KAIKATA/";
  const PANEL_ID = "cartforge-cardmarket-extractor";
  const STORAGE_KEY = "cartforgeConfirmedPlanV3";
  // Cart handed to the KAIKATA extension page (read once, then removed, by src/host.mjs).
  const INCOMING_CART_KEY = "cartforgeIncomingCartV1";
  const FILTER_STORAGE_KEY = "cartforgeOverlayFilterV1";
  // true / false once the user expands or collapses the panel; unset = expanded on a cart.
  const EXPANDED_STORAGE_KEY = "cartforgePanelExpandedV1";
  const MARK_SELECTOR = "[data-cartforge-mark]";
  const Matching = globalThis.CartforgeMatching;
  // Pure wants-stock helpers (cartforge-wants-flow.js); the panel works without them.
  const Flow = globalThis.CartforgeWantsFlow;
  // Pure one-read-per-row helpers (cartforge-cart-rows.js); extraction still works without them.
  const Rows = globalThis.CartforgeCartRows;
  // Wants-page parser (cartforge-wants-parser.js), for "Check all sellers".
  const Parser = globalThis.CartforgeWantsParser;
  // Panel elements updated after every marking pass (set by renderFloatingPanel).
  const overlayUi = { counterEl: null, doneEl: null, addedEl: null, filter: "all", setFilterButtons: null };
  // "Wants stock" checklist + send summary (set by the panel builders).
  const wantsUi = { section: null, summaryEl: null, signature: "", snapshotSignature: "", started: false };
  // "Check all sellers" run state (page 1 of each unloaded seller's wants page).
  const checkRun = { running: false, cancel: false, text: "", error: "" };
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

  // ── Shared UI helpers ─────────────────────────────────────────────────────

  function kLogo(size = 20) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 120 120");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "#D84A2B");
    svg.setAttribute("stroke-width", "2.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const lines = [
      [30, 20, 30, 100],
      [30, 60, 90, 20],
      [30, 60, 90, 100]
    ];
    for (const [x1, y1, x2, y2] of lines) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      svg.append(line);
    }
    return svg;
  }

  function css(el, styles) {
    Object.assign(el.style, styles);
  }

  // Bottom-left: Cardmarket's cart summary and "Proceed to checkout" sit in the right
  // column (and its sticky bottom bar on phones is full-width, so a narrow left panel
  // leaves its button free); the left column only has article rows, which scroll past.
  const PANEL_BASE = {
    position: "fixed",
    left: "16px",
    bottom: "16px",
    zIndex: "2147483647",
    font: "14px/1.5 'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    color: "#1C1A17",
    background: "#FFF9EF",
    border: "1.5px solid #DED3C2",
    boxShadow: "0 4px 16px rgba(28,26,23,0.12)",
    overflow: "hidden"
  };
  const PANEL_WIDTH = "min(320px, calc(100vw - 32px))";

  const COLLAPSED = {
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  };

  const EXPANDED = {
    width: PANEL_WIDTH,
    height: "auto",
    maxHeight: "calc(100vh - 32px)",
    overflowY: "auto",
    borderRadius: "12px",
    cursor: "default",
    display: "block",
    alignItems: "",
    justifyContent: ""
  };

  // Collapsed bubble ↔ expanded panel, remembered in storage for both panels. Without a
  // stored choice the panel opens when the page has a cart with sellers.
  function setupExpandToggle({ panel, logoBubble, header, body, collapseBtn, onExpand = () => {} }) {
    const apply = (expanded) => {
      logoBubble.style.display = expanded ? "none" : "flex";
      header.style.display = expanded ? "flex" : "none";
      body.style.display = expanded ? "block" : "none";
      css(panel, expanded ? EXPANDED : { ...COLLAPSED, maxHeight: "", overflowY: "" });
      if (expanded) onExpand();
    };
    const remember = (expanded) => {
      try {
        chrome.storage.local.set({ [EXPANDED_STORAGE_KEY]: expanded });
      } catch {
        // Storage unavailable: the choice lasts for this page only.
      }
    };
    logoBubble.addEventListener("click", () => {
      apply(true);
      remember(true);
    });
    collapseBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      apply(false);
      remember(false);
    });
    storageGet(EXPANDED_STORAGE_KEY).then((stored) => {
      if (typeof stored === "boolean") {
        apply(stored);
        return;
      }
      apply(extractCartPayload(document).sellers.length > 0);
    });
  }

  // ── Plan overlay ──────────────────────────────────────────────────────────

  function renderPlanOverlay(plan) {
    renderFloatingPanel(plan);
    const start = () => {
      try {
        chrome.storage.local.get([FILTER_STORAGE_KEY], (result) => {
          overlayUi.filter = result?.[FILTER_STORAGE_KEY] === "removals" ? "removals" : "all";
          overlayUi.setFilterButtons?.();
          refreshOverlay(plan);
        });
      } catch {
        refreshOverlay(plan);
      }
      observeCartMutations(plan);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  }

  function observeCartMutations(plan) {
    let debounceTimer = null;
    const schedule = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => refreshOverlay(plan), 150);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    // Crossing Cardmarket's breakpoint swaps the desktop and mobile layouts.
    window.addEventListener("resize", schedule);
  }

  // One marking pass. Idempotent: it only touches the DOM when a mark changes, so the
  // MutationObserver settles after Cardmarket re-renders. Rows hidden by the
  // "Only removals" filter are shown first (all synchronous, no repaint in between),
  // because innerText of a hidden element falls back to flattened textContent.
  function refreshOverlay(plan) {
    if (!document.getElementById(PANEL_ID)) {
      return;
    }
    showFilteredElements();
    findAndBadgeSellerSections(plan);
    if (!Matching) {
      return; // cartforge-matching.js failed to load: keep the seller badges only.
    }
    const planSellers = new Map(plan.sellers.map((seller) => [seller.sellerIndex, seller]));
    const addedRows = new Set();
    document.querySelectorAll("[data-cartforge-section]").forEach((section) => {
      const planSeller = planSellers.get(Number(section.getAttribute("data-cartforge-section")));
      if (planSeller) {
        const matches = markSectionRows(section, planSeller, (plan.rows || []).filter((row) => row.sellerIndex === planSeller.sellerIndex));
        matches.forEach((match) => {
          if (match.planRow?.decision === "add") addedRows.add(match.planRow);
        });
      }
    });
    applyFilter();
    updateCounter();
    updateAddedCounter(addedRows.size, (plan.rows || []).filter((row) => row.decision === "add").length);
  }

  function renderFloatingPanel(plan) {
    const keepSellers = plan.sellers.filter((s) => s.decision === "keep");

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    css(panel, { ...PANEL_BASE, ...COLLAPSED });

    // ── Collapsed: logo bubble ──
    const logoBubble = document.createElement("div");
    css(logoBubble, { display: "flex", alignItems: "center", justifyContent: "center" });
    logoBubble.append(kLogo(22));

    // ── Expanded: header ──
    const header = document.createElement("div");
    header.style.display = "none";
    css(header, { alignItems: "center", gap: "8px", padding: "12px 16px 0", marginBottom: "12px" });

    const planBadge = document.createElement("span");
    planBadge.textContent = "Plan active";
    css(planBadge, {
      fontSize: "10px",
      fontWeight: "600",
      padding: "2px 7px",
      borderRadius: "999px",
      background: "rgba(79,122,90,0.12)",
      color: "#4F7A5A",
      border: "1px solid rgba(79,122,90,0.25)",
      letterSpacing: "0.04em"
    });

    const collapseBtn = document.createElement("button");
    collapseBtn.textContent = "×";
    collapseBtn.setAttribute("aria-label", "Collapse panel");
    css(collapseBtn, {
      background: "none",
      border: "none",
      color: "#A89D8F",
      fontSize: "20px",
      lineHeight: "1",
      cursor: "pointer",
      padding: "0",
      fontFamily: "inherit",
      marginLeft: "auto"
    });

    header.append(kLogo(20));
    const wordmark = document.createElement("span");
    wordmark.textContent = "KAIKATA";
    css(wordmark, {
      flex: "1",
      fontWeight: "700",
      fontSize: "13px",
      letterSpacing: "0.08em",
      color: "#1C1A17",
      marginLeft: "6px"
    });
    header.append(wordmark, planBadge, collapseBtn);

    // ── Expanded: body ──
    const body = document.createElement("div");
    body.style.display = "none";
    css(body, { padding: "0 16px 16px" });

    const buyLine = document.createElement("p");
    buyLine.textContent = `Buy from ${keepSellers.length} seller${keepSellers.length !== 1 ? "s" : ""}`;
    css(buyLine, { margin: "0 0 10px", color: "#6E6257", fontSize: "13px" });
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
          padding: "3px 9px",
          borderRadius: "999px",
          background: "rgba(79,122,90,0.10)",
          color: "#4F7A5A",
          border: "1px solid rgba(79,122,90,0.25)"
        });
        chipsWrap.append(chip);
      }
      body.append(chipsWrap);
    }

    // Live cut list counter, computed from the marks present in the page.
    const counter = document.createElement("p");
    counter.setAttribute("data-cartforge-counter", "");
    css(counter, { margin: "0 0 6px", color: "#1C1A17", fontSize: "12.5px", fontWeight: "600" });
    const done = document.createElement("p");
    done.textContent = "Cart matches your plan ✓";
    css(done, { margin: "0 0 10px", color: "#4F7A5A", fontSize: "12.5px", fontWeight: "700", display: "none" });
    const added = document.createElement("p");
    css(added, { margin: "0 0 6px", color: "#1C1A17", fontSize: "12.5px", fontWeight: "600", display: "none" });
    body.append(counter, added, done);
    overlayUi.counterEl = counter;
    overlayUi.addedEl = added;
    overlayUi.doneEl = done;

    const filterWrap = document.createElement("div");
    filterWrap.setAttribute("role", "group");
    filterWrap.setAttribute("aria-label", "Rows to show");
    css(filterWrap, { display: "flex", gap: "0", marginBottom: "12px", border: "1.5px solid #DED3C2", borderRadius: "999px", overflow: "hidden" });
    const filterButtons = [["all", "All"], ["removals", "Only removals"]].map(([value, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("data-cartforge-filter", value);
      css(button, { flex: "1", border: "none", padding: "6px 8px", fontFamily: "inherit", fontSize: "12px", fontWeight: "600", cursor: "pointer" });
      button.addEventListener("click", () => {
        overlayUi.filter = value;
        overlayUi.setFilterButtons();
        try {
          chrome.storage.local.set({ [FILTER_STORAGE_KEY]: value });
        } catch {
          // Storage unavailable: the choice lasts for this page only.
        }
        showFilteredElements();
        applyFilter();
      });
      filterWrap.append(button);
      return button;
    });
    overlayUi.setFilterButtons = () => {
      filterButtons.forEach((button) => {
        const active = button.getAttribute("data-cartforge-filter") === overlayUi.filter;
        button.setAttribute("aria-pressed", String(active));
        css(button, active ? { background: "#1C1A17", color: "#FFFFFF" } : { background: "transparent", color: "#6E6257" });
      });
    };
    overlayUi.setFilterButtons();
    body.append(filterWrap);

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear plan";
    css(clearBtn, {
      width: "100%",
      border: "1.5px solid #DED3C2",
      borderRadius: "999px",
      background: "transparent",
      color: "#6E6257",
      padding: "9px 14px",
      fontFamily: "inherit",
      fontSize: "13px",
      fontWeight: "600",
      cursor: "pointer"
    });
    body.append(buildWantsStockSection(), clearBtn);

    panel.append(logoBubble, header, body);
    document.body.append(panel);
    startWantsStock();

    setupExpandToggle({ panel, logoBubble, header, body, collapseBtn });

    // Clear plan — remove storage, badges, and panel
    clearBtn.addEventListener("click", () => {
      try {
        chrome.storage.local.remove([STORAGE_KEY], () => {
          showFilteredElements();
          removeAllRowMarks();
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
      // Cardmarket may re-render a section's contents in place: re-badge when the badge is gone.
      if (section.hasAttribute("data-cartforge-section") && section.querySelector("[data-cartforge-badge]")) {
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
        (r) => r.decision === "selected" || r.decision === "add" || r.decision === "manual_review"
      );

      const badgeEl = createSellerBadge(planSeller, visibleRows);
      section.insertBefore(badgeEl, section.firstChild);
    }
  }

  // ── Row marks ─────────────────────────────────────────────────────────────

  const MARK_STYLES = {
    keep: { background: "#4F7A5A", color: "#FFFFFF", border: "1px solid #4F7A5A" },
    remove: { background: "#9F2D24", color: "#FFFFFF", border: "1px solid #9F2D24" },
    reduce: { background: "#C8872E", color: "#1C1A17", border: "1px solid #C8872E" },
    review: { background: "#FFFFFF", color: "#8A5A14", border: "1.5px solid #C8872E" },
    unmatched: { background: "#E4DDD2", color: "#4A4038", border: "1px solid #CFC5B6" }
  };
  const CARD_NAME_SELECTOR = "a[href*='/Products/Singles/'], a[href*='/Magic/Products/'], [data-card-name], .card-name, .product-name";

  function markSectionRows(section, planSeller, planRows) {
    // Only the layout on screen: the hidden twin row would otherwise take a plan row's
    // quantity and push the visible row to REMOVE.
    const rowEls = renderedOnly(findItemRows(section));
    const items = rowEls.map((row, rowIndex) => extractItem(row, planSeller.sellerIndex, rowIndex));
    const matches = Matching.matchRowsToPlan(items, planRows, { sellerDecision: planSeller.decision });
    const current = new Set();
    rowEls.forEach((row, index) => {
      current.add(applyRowMark(row, matches[index]));
    });
    // A mark whose row is no longer a chosen item row (re-render, nested row switch)
    // is removed, so a row never carries two marks.
    section.querySelectorAll('[data-cartforge-mark="row"]').forEach((mark) => {
      if (!current.has(mark)) {
        restoreRowStyle(mark.closest("[data-cartforge-row]"));
        mark.remove();
      }
    });
    return matches;
  }

  function markHost(row) {
    return row.matches("tr") ? row.querySelector("td, th") || row : row;
  }

  function applyRowMark(row, match) {
    const host = markHost(row);
    let mark = [...host.children].find((child) => child.getAttribute("data-cartforge-mark") === "row");
    const label = Matching.markLabel(match);
    const qty = String(match.cartQty || 1);
    if (!mark) {
      mark = document.createElement("span");
      mark.setAttribute("data-cartforge-mark", "row");
      mark.className = "cartforge-row-mark";
      css(mark, {
        display: "inline-block",
        marginRight: "6px",
        padding: "1px 7px",
        borderRadius: "999px",
        fontFamily: "'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        fontSize: "10.5px",
        fontWeight: "700",
        letterSpacing: ".04em",
        lineHeight: "1.6",
        verticalAlign: "middle",
        whiteSpace: "nowrap"
      });
      host.prepend(mark);
    }
    if (mark.getAttribute("data-cartforge-status") !== match.status || mark.textContent !== label || mark.getAttribute("data-cartforge-qty") !== qty) {
      mark.textContent = label;
      mark.setAttribute("data-cartforge-status", match.status);
      mark.setAttribute("data-cartforge-qty", qty);
      mark.title = match.status === "unmatched" ? "Not found in your KAIKATA plan. Leave it as is and check manually." : "";
      css(mark, MARK_STYLES[match.status] || MARK_STYLES.unmatched);
    }
    row.setAttribute("data-cartforge-row", match.status);
    if (match.status === "remove") {
      dimRow(row, mark);
    } else {
      restoreRowStyle(row);
      row.setAttribute("data-cartforge-row", match.status);
    }
    return mark;
  }

  // Dims the row's content but not the REMOVE pill itself (opacity on the row would
  // fade the pill too): every element beside the pill's ancestor chain is dimmed.
  function dimRow(row, mark) {
    const dim = (element) => {
      if (!element.hasAttribute("data-cartforge-orig-opacity")) {
        element.setAttribute("data-cartforge-orig-opacity", element.style.opacity || "");
        element.style.opacity = "0.55";
      }
    };
    const walk = (container) => {
      [...container.children].forEach((child) => {
        if (child === mark) return;
        if (child.contains(mark)) walk(child);
        else dim(child);
      });
    };
    walk(row);
    const nameEl = row.querySelector(CARD_NAME_SELECTOR);
    if (nameEl && !nameEl.hasAttribute("data-cartforge-orig-decoration")) {
      nameEl.setAttribute("data-cartforge-orig-decoration", nameEl.style.textDecoration || "");
      nameEl.style.textDecoration = "line-through";
    }
  }

  function restoreRowStyle(row) {
    if (!row) return;
    row.querySelectorAll("[data-cartforge-orig-opacity]").forEach((el) => {
      el.style.opacity = el.getAttribute("data-cartforge-orig-opacity");
      el.removeAttribute("data-cartforge-orig-opacity");
    });
    row.querySelectorAll("[data-cartforge-orig-decoration]").forEach((el) => {
      el.style.textDecoration = el.getAttribute("data-cartforge-orig-decoration");
      el.removeAttribute("data-cartforge-orig-decoration");
    });
    row.removeAttribute("data-cartforge-row");
  }

  function removeAllRowMarks() {
    document.querySelectorAll("[data-cartforge-row]").forEach(restoreRowStyle);
    document.querySelectorAll('[data-cartforge-mark="row"]').forEach((mark) => mark.remove());
  }

  // "Only removals": hide KEEP rows, and whole Keep-seller sections with nothing to cut.
  function applyFilter() {
    if (overlayUi.filter !== "removals") return;
    document.querySelectorAll('[data-cartforge-row="keep"]').forEach(hideElement);
    document.querySelectorAll("[data-cartforge-section]").forEach((section) => {
      const statuses = [...section.querySelectorAll('[data-cartforge-mark="row"]')].map((mark) => mark.getAttribute("data-cartforge-status"));
      if (statuses.length && statuses.every((status) => status === "keep")) {
        hideElement(section);
      }
    });
  }

  function hideElement(element) {
    if (element.hasAttribute("data-cartforge-hidden")) return;
    element.setAttribute("data-cartforge-hidden", element.style.display || "");
    element.style.display = "none";
  }

  function showFilteredElements() {
    document.querySelectorAll("[data-cartforge-hidden]").forEach((element) => {
      element.style.display = element.getAttribute("data-cartforge-hidden");
      element.removeAttribute("data-cartforge-hidden");
    });
  }

  // Wants-page articles the plan adds: how many are in the cart now.
  function updateAddedCounter(added, total) {
    if (!overlayUi.addedEl) return;
    overlayUi.addedEl.textContent = total ? `Added: ${added} / ${total}` : "";
    overlayUi.addedEl.style.display = total ? "block" : "none";
  }

  function updateCounter() {
    if (!overlayUi.counterEl) return;
    const marks = [...document.querySelectorAll('[data-cartforge-mark="row"]')].map((mark) => ({
      status: mark.getAttribute("data-cartforge-status"),
      cartQty: Number(mark.getAttribute("data-cartforge-qty")) || 1
    }));
    const summary = Matching.summarizeMarks(marks);
    const parts = [
      `To remove: ${summary.removeArticles} article${summary.removeArticles === 1 ? "" : "s"}`,
      `Reduce: ${summary.reduceRows}`,
      `Unmatched: ${summary.unmatchedRows}`
    ];
    if (summary.reviewRows) parts.push(`Review: ${summary.reviewRows}`);
    overlayUi.counterEl.textContent = parts.join(" · ");
    overlayUi.doneEl.style.display = marks.length && summary.removeArticles === 0 && summary.reduceRows === 0 ? "block" : "none";
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
      fontFamily: "'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
    });

    const badge = document.createElement("div");
    badge.setAttribute("data-cartforge-mark", "badge");
    css(badge, {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      padding: "6px 14px",
      borderRadius: "999px",
      fontSize: "13px",
      fontWeight: "700",
      letterSpacing: ".02em",
      userSelect: "none",
      ...(isKeep
        ? { background: "#4F7A5A", color: "#FFFFFF", border: "none", cursor: "pointer", boxShadow: "0 2px 6px rgba(79,122,90,0.35)" }
        : isReview
          ? { background: "rgba(200,135,46,0.12)", color: "#C8872E", border: "1.5px solid rgba(200,135,46,0.35)", cursor: "default" }
          : { background: "rgba(159,45,36,0.10)", color: "#9F2D24", border: "1.5px solid rgba(159,45,36,0.25)", cursor: "default" })
    });

    const icon = document.createElement("span");
    icon.textContent = isKeep ? "✓" : isReview ? "⚠" : "✗";

    const label = document.createElement("span");
    label.textContent = isKeep ? "Keep" : isReview ? "Review" : "Skip";

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
      borderRadius: "8px",
      border: "1px solid #DED3C2",
      background: "#F7F1E6",
      overflow: "hidden",
      fontFamily: "'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      fontSize: "12px",
      color: "#6E6257"
    });

    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No cards to show.";
      css(empty, { padding: "8px 12px", color: "#A89D8F" });
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
        ...(i < rows.length - 1 ? { borderBottom: "1px solid #DED3C2" } : {})
      });

      // Left: card name + meta
      const left = document.createElement("div");
      css(left, { flex: "1", minWidth: "0" });

      const nameEl = document.createElement("div");
      nameEl.textContent = row.cardName || "(unknown)";
      css(nameEl, {
        fontWeight: "600",
        color: "#1C1A17",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      });

      const cartQty = Number(row.quantity || 1);
      const keptQty = row.decision === "selected" ? Number(row.selectedQuantity || cartQty) : cartQty;
      const keepFewer = row.decision === "selected" && keptQty < cartQty;
      const condLang = [row.condition, row.language].filter(Boolean).join(" · ");
      const metaEl = document.createElement("div");
      css(metaEl, { color: "#A89D8F", marginTop: "2px" });
      if (keepFewer) {
        const keepEl = document.createElement("span");
        keepEl.textContent = `Keep ${keptQty} of ${cartQty}`;
        css(keepEl, { fontWeight: "700", color: "#C8872E" });
        metaEl.append(keepEl);
        if (condLang) {
          metaEl.append(document.createTextNode(` · ${condLang}`));
        }
      } else {
        metaEl.textContent = [`${keptQty}x`, condLang].filter(Boolean).join(" · ");
      }

      left.append(nameEl, metaEl);

      // Right: price + optional review label
      const right = document.createElement("div");
      css(right, { textAlign: "right", flexShrink: "0" });

      const priceEl = document.createElement("div");
      priceEl.textContent = row.unitPrice != null ? `€${Number(row.unitPrice).toFixed(2)}` : "";
      css(priceEl, { fontWeight: "600", color: "#D84A2B" });
      right.append(priceEl);

      if (row.decision === "manual_review") {
        const reviewLabel = document.createElement("div");
        reviewLabel.textContent = "⚠ Review";
        css(reviewLabel, { color: "#C8872E", fontSize: "10px", marginTop: "2px" });
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

  // ── Extraction panel (no plan active) ────────────────────────────────────

  function renderExtractionPanel() {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    css(panel, { ...PANEL_BASE, ...COLLAPSED });

    // ── Collapsed: logo bubble ──
    const logoBubble = document.createElement("div");
    css(logoBubble, { display: "flex", alignItems: "center", justifyContent: "center" });
    logoBubble.append(kLogo(22));

    // ── Expanded: header ──
    const header = document.createElement("div");
    header.style.display = "none";
    css(header, { alignItems: "center", gap: "8px", padding: "12px 16px 0", marginBottom: "12px" });

    const wordmark = document.createElement("span");
    wordmark.textContent = "KAIKATA";
    css(wordmark, {
      flex: "1",
      fontWeight: "700",
      fontSize: "13px",
      letterSpacing: "0.08em",
      color: "#1C1A17",
      marginLeft: "6px"
    });

    const collapseBtn = document.createElement("button");
    collapseBtn.textContent = "×";
    collapseBtn.setAttribute("aria-label", "Collapse panel");
    css(collapseBtn, {
      background: "none",
      border: "none",
      color: "#A89D8F",
      fontSize: "20px",
      lineHeight: "1",
      cursor: "pointer",
      padding: "0",
      fontFamily: "inherit"
    });

    header.append(kLogo(20), wordmark, collapseBtn);

    // ── Expanded: body ──
    const body = document.createElement("div");
    body.style.display = "none";
    css(body, { padding: "0 16px 16px" });

    const descEl = document.createElement("p");
    descEl.textContent = "Step 1: check your sellers' wants stock · Step 2: transfer to KAIKATA";
    css(descEl, { margin: "0 0 12px", color: "#6E6257", fontSize: "12.5px", lineHeight: "1.45" });

    const transferBtn = document.createElement("button");
    transferBtn.setAttribute("data-cartforge-action", "open-app");
    transferBtn.textContent = "Transfer to KAIKATA";
    css(transferBtn, {
      width: "100%",
      border: "0",
      borderRadius: "999px",
      background: "#D84A2B",
      color: "#FFF9EF",
      padding: "10px 14px",
      fontFamily: "inherit",
      fontSize: "13px",
      fontWeight: "600",
      cursor: "pointer",
      marginBottom: "8px"
    });

    const copyBtn = document.createElement("button");
    copyBtn.setAttribute("data-cartforge-action", "copy");
    copyBtn.textContent = "Copy to Clipboard";
    css(copyBtn, {
      width: "100%",
      marginTop: "6px",
      border: "1.5px solid #DED3C2",
      borderRadius: "999px",
      background: "transparent",
      color: "#6E6257",
      padding: "7px 12px",
      fontFamily: "inherit",
      fontSize: "12.5px",
      fontWeight: "600",
      cursor: "pointer"
    });

    const statusEl = document.createElement("p");
    statusEl.setAttribute("data-cartforge-status", "");
    css(statusEl, { margin: "10px 0 0", color: "#A89D8F", fontSize: "12px", lineHeight: "1.4" });

    // What "Transfer" sends: the cart plus the wants stock that passes the 24 h / wants-list rule.
    const summaryEl = document.createElement("p");
    summaryEl.setAttribute("data-cartforge-send-summary", "");
    css(summaryEl, { margin: "-2px 0 10px", color: "#6E6257", fontSize: "12px", lineHeight: "1.4" });
    wantsUi.summaryEl = summaryEl;

    // Transition: the website still works, one small link away.
    const websiteLink = document.createElement("button");
    websiteLink.setAttribute("data-cartforge-action", "open-live");
    websiteLink.textContent = "Open on website instead";
    css(websiteLink, {
      display: "block",
      margin: "8px auto 0",
      border: "0",
      background: "transparent",
      color: "#A89D8F",
      padding: "2px 4px",
      fontFamily: "inherit",
      fontSize: "12px",
      textDecoration: "underline",
      cursor: "pointer"
    });

    // Rarely needed: copy the payload, or the website route during the transition.
    const more = document.createElement("details");
    css(more, { marginTop: "4px" });
    const moreSummary = document.createElement("summary");
    moreSummary.textContent = "More";
    css(moreSummary, { cursor: "pointer", color: "#6E6257", fontSize: "12px", fontWeight: "600" });
    more.append(moreSummary, copyBtn, websiteLink);

    body.append(descEl, buildWantsStockSection(), transferBtn, summaryEl, more, statusEl);
    panel.append(logoBubble, header, body);
    document.body.append(panel);
    startWantsStock();

    setupExpandToggle({ panel, logoBubble, header, body, collapseBtn, onExpand: refreshWantsStock });

    panel.addEventListener("click", async (event) => {
      const action = event.target?.dataset?.cartforgeAction;
      if (!action) {
        return;
      }

      const payload = extractCartPayload(document);
      const itemCount = countItems(payload);

      if (!payload.sellers.length || itemCount === 0) {
        setStatus(statusEl, "No cart items detected on this page yet. Open the Cardmarket cart page and try again.");
        return;
      }

      saveCartSnapshot(payload);

      if (action === "open-app") {
        const opened = await openInApp(payload);
        setStatus(statusEl, opened.ok
          ? `Transferred: ${payload.sellers.length} seller(s), ${itemCount} item row(s).`
          : `Could not open KAIKATA (${opened.error}). Try "Open on website instead".`);
      }

      if (action === "open-live") {
        window.open(buildTargetUrl(LIVE_CARTFORGE_URL, encodePayload(payload)), "_blank", "noopener,noreferrer");
        setStatus(statusEl, `Transferred: ${payload.sellers.length} seller(s), ${itemCount} item row(s).`);
      }

      if (action === "copy") {
        try {
          await navigator.clipboard.writeText(`CARTFORGE_CART=${JSON.stringify(payload, null, 2)}`);
          setStatus(statusEl, `Copied: ${payload.sellers.length} seller(s), ${itemCount} item row(s).`);
        } catch {
          setStatus(statusEl, "Could not copy payload. Check clipboard permissions and try again.");
        }
      }
    });
  }

  function setStatus(statusEl, message) {
    statusEl.textContent = message;
  }

  // KAIKATA runs as an extension page: the cart goes through storage, not a URL hash.
  async function openInApp(payload) {
    try {
      await chrome.storage.local.set({ [INCOMING_CART_KEY]: { payload, storedAt: new Date().toISOString() } });
      const response = await chrome.runtime.sendMessage({ type: "CARTFORGE_V3_OPEN_APP" });
      return response?.ok ? response : { ok: false, error: response?.error || "no answer from the extension" };
    } catch (error) {
      return { ok: false, error: error?.message || "extension unavailable" };
    }
  }

  function buildTargetUrl(baseUrl, encodedPayload) {
    const targetUrl = new URL(baseUrl);
    targetUrl.searchParams.set("source", "cardmarket-extension");
    targetUrl.searchParams.set("t", String(Date.now()));
    targetUrl.hash = `cartforge=${encodedPayload}`;
    return targetUrl.toString();
  }

  // ── Wants stock checklist (both panels) ──────────────────────────────────
  // Which cart sellers' "Articles on My Wants List" stock is loaded, with links to load
  // the rest. Navigation only ever happens on a user click ("Open wants page", "Next seller").

  function storageGet(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([key], (result) => resolve(result?.[key]));
      } catch {
        resolve(undefined);
      }
    });
  }

  function offersText(count, hits) {
    if (Number.isFinite(hits) && count < hits) return `${count}/${hits} offers`;
    return `${count} offer${count === 1 ? "" : "s"}`;
  }

  function isCardmarketUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && /(^|\.)cardmarket\.com$/i.test(parsed.hostname);
    } catch {
      return false;
    }
  }

  function buildWantsStockSection() {
    const section = document.createElement("div");
    section.setAttribute("data-cartforge-wants-stock", "");
    css(section, { margin: "0 0 12px", padding: "10px 12px", border: "1.5px solid #DED3C2", borderRadius: "10px", background: "#FFFFFF" });
    section.style.display = Flow ? "block" : "none";
    wantsUi.section = section;
    return section;
  }

  function startWantsStock() {
    if (!Flow || wantsUi.started) return;
    wantsUi.started = true;
    refreshWantsStock();
    // Cart edits on this page (ignore the panel's own DOM changes).
    let timer = null;
    new MutationObserver((records) => {
      const panel = document.getElementById(PANEL_ID);
      if (panel && records.every((record) => panel.contains(record.target))) return;
      clearTimeout(timer);
      timer = setTimeout(refreshWantsStock, 800);
    }).observe(document.body, { childList: true, subtree: true });
    // Captures made on wants pages (other tabs) or removed there.
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && (changes[Flow.CANDIDATES_KEY] || changes[Flow.CHECKS_KEY])) refreshWantsStock();
      });
    } catch {
      // Storage events unavailable: the list refreshes on cart changes and on expand.
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshWantsStock();
    });
  }

  async function refreshWantsStock() {
    if (!Flow || !wantsUi.section) return;
    const payload = extractCartPayload(document);
    const hasCart = payload.sellers.length > 0 && countItems(payload) > 0;
    if (hasCart) saveCartSnapshot(payload);
    const captures = (await storageGet(Flow.CANDIDATES_KEY)) || {};
    const checks = (await storageGet(Flow.CHECKS_KEY)) || {};
    const now = Date.now();
    const snapshot = hasCart ? Flow.buildCartSnapshot(payload, now) : null;
    const checklist = snapshot ? Flow.sellerChecklist(snapshot, captures, now, checks) : null;
    const next = snapshot ? Flow.nextUnloadedSeller(snapshot, captures, now, "", checks) : null;
    const summary = hasCart ? Flow.formatTransferSummary(Flow.summarizeTransfer({ payload, captures, now })) : "";

    // Ages are shown in minutes, so re-render at most when something visible changes.
    const run = [checkRun.running, checkRun.text, checkRun.error];
    const signature = JSON.stringify([checklist, next?.sellerName, summary, run].map((part) => part ?? null), (key, value) => (
      (key === "ageMs" || key === "checkedAt") && Number.isFinite(value) ? Math.round(value / 60000) : value
    ));
    if (signature === wantsUi.signature) return;
    wantsUi.signature = signature;
    if (wantsUi.summaryEl) wantsUi.summaryEl.textContent = summary;
    renderWantsStock(checklist, next);
  }

  // Light cart copy for the wants pages; written only when the cart content changes.
  function saveCartSnapshot(payload) {
    if (!Flow) return;
    const snapshot = Flow.buildCartSnapshot(payload);
    const signature = JSON.stringify({ ...snapshot, capturedAt: "" });
    if (signature === wantsUi.snapshotSignature) return;
    wantsUi.snapshotSignature = signature;
    try {
      chrome.storage.local.set({ [Flow.SNAPSHOT_KEY]: snapshot });
    } catch {
      // Storage unavailable: wants pages ask the user to open the cart again.
    }
  }

  function storageSet(key, value) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [key]: value }, () => resolve(true));
      } catch {
        resolve(false);
      }
    });
  }

  // Cart sellers "Check all sellers" would fetch: not loaded yet, with a wants link, and
  // not already known (from an earlier check) to have offers.
  function sellersToCheck(checklist) {
    return (checklist?.rows || []).filter((row) => (
      row.status !== "loaded" && !row.checked && row.wantsUrl && isCardmarketUrl(row.wantsUrl)
    ));
  }

  // "Check all sellers" (explicit click only): page 1 of each unloaded seller's wants page,
  // one request at a time, 2–4 s apart, stopping at the first 429 / error / login / check
  // page (CartforgeWantsParser.checkSellersFirstPage). An empty page is saved as a 0-offer
  // capture (loaded, nothing extra); for sellers with offers only "H offers on P pages" is
  // kept: the user loads those on the seller's own page.
  async function runCheckAll() {
    if (!Flow || !Parser || checkRun.running) return;
    const payload = extractCartPayload(document);
    const now = Date.now();
    const snapshot = Flow.buildCartSnapshot(payload, now);
    const captures = (await storageGet(Flow.CANDIDATES_KEY)) || {};
    const sellers = sellersToCheck(Flow.sellerChecklist(snapshot, captures, now));
    if (!sellers.length) return;
    checkRun.running = true;
    checkRun.cancel = false;
    checkRun.error = "";
    checkRun.text = `Checking ${sellers[0].sellerName} (1 of ${sellers.length})…`;
    refreshWantsStock();

    // Results are saved as they come (a Stop keeps them), one storage write at a time.
    let saved = 0;
    let writes = Promise.resolve();
    const persistNew = (results) => {
      writes = writes.then(async () => {
        while (saved < results.length) {
          await persistCheck(results[saved], snapshot);
          saved += 1;
        }
      });
      return writes;
    };
    const outcome = await Parser.checkSellersFirstPage({
      sellers: sellers.map((row) => ({ sellerName: row.sellerName, wantsUrl: row.wantsUrl })),
      fetchPage: (url) => fetch(url, { credentials: "include", redirect: "follow" }),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      isCancelled: () => checkRun.cancel,
      onProgress: ({ done, total, sellerName, waitingMs, results }) => {
        persistNew(results);
        if (!sellerName) return;
        checkRun.text = waitingMs
          ? `Checked ${done} of ${total} · pausing ${Math.round(waitingMs / 100) / 10} s`
          : `Checking ${sellerName} (${done + 1} of ${total})…`;
        refreshWantsStock();
      }
    });
    await persistNew(outcome.results);
    const withOffers = outcome.results.filter((result) => result.status === "offers").length;
    const none = outcome.results.length - withOffers;
    checkRun.running = false;
    checkRun.text = `Checked ${outcome.results.length} of ${sellers.length}: ${withOffers} with offers, ${none} with nothing extra.`;
    checkRun.error = outcome.stoppedReason ? `Stopped: ${outcome.stoppedReason}` : "";
    wantsUi.signature = "";
    refreshWantsStock();
  }

  async function persistCheck(result, snapshot) {
    const key = Flow.normalizeSellerKey(result.sellerName);
    const cartSeller = (snapshot.sellers || []).find((seller) => Flow.normalizeSellerKey(seller.sellerName) === key);
    const wantsListId = result.meta?.wantsListId || cartSeller?.wantsListId || "";
    const checks = (await storageGet(Flow.CHECKS_KEY)) || {};
    if (result.status === "none") {
      const captures = (await storageGet(Flow.CANDIDATES_KEY)) || {};
      captures[key] = Flow.emptyCapture({ sellerName: result.sellerName, sellerCountry: result.meta?.sellerCountry, wantsListId });
      await storageSet(Flow.CANDIDATES_KEY, captures);
      if (checks[key]) {
        delete checks[key];
        await storageSet(Flow.CHECKS_KEY, checks);
      }
      return;
    }
    checks[key] = { sellerName: result.sellerName, wantsListId, checkedAt: new Date().toISOString(), hits: result.hits, pages: result.pages };
    await storageSet(Flow.CHECKS_KEY, checks);
  }

  const NEUTRAL_LINK = { color: "#1C1A17", whiteSpace: "nowrap", textDecoration: "underline", textUnderlineOffset: "2px", fontWeight: "500" };

  function smallButton(label, primary) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    css(button, {
      width: "100%", marginTop: "8px", borderRadius: "999px", padding: "7px 12px", fontFamily: "inherit",
      fontSize: "12.5px", fontWeight: "600", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      ...(primary
        ? { border: "1.5px solid #1C1A17", background: "#1C1A17", color: "#FFF9EF" }
        : { border: "1.5px solid #DED3C2", background: "transparent", color: "#1C1A17" })
    });
    return button;
  }

  function rowStatusText(row) {
    if (row.status === "loaded") {
      return row.empty
        ? `✓ checked · no extra stock · ${Flow.formatAge(row.ageMs)}`
        : `✓ loaded · ${offersText(row.offerCount, row.hits)} · ${Flow.formatAge(row.ageMs)}`;
    }
    if (row.checked && row.checked.hits > 0) {
      return `${row.checked.hits} offer${row.checked.hits === 1 ? "" : "s"} on ${row.checked.pages} page${row.checked.pages === 1 ? "" : "s"} · load them on the seller's page`;
    }
    if (row.status === "stale") return "loaded over 24 h ago · reload to use it";
    if (row.status === "other-list") return "loaded for another wants list · reload to use it";
    return row.wantsUrl ? "not loaded" : "not loaded · no wants link in the cart";
  }

  function renderWantsStock(checklist, next) {
    const section = wantsUi.section;
    section.replaceChildren();

    const title = document.createElement("p");
    title.textContent = "Wants stock";
    css(title, { margin: "0", fontWeight: "700", fontSize: "12.5px", color: "#1C1A17" });
    section.append(title);

    if (!checklist || !checklist.total) {
      const empty = document.createElement("p");
      empty.textContent = "No cart sellers found on this page yet.";
      css(empty, { margin: "4px 0 0", color: "#6E6257", fontSize: "12px" });
      section.append(empty);
      return;
    }

    const count = document.createElement("p");
    count.textContent = `Loaded for ${checklist.loadedCount} of ${checklist.total} seller${checklist.total === 1 ? "" : "s"}`
      + (checklist.emptyCount ? ` · ${checklist.emptyCount} with nothing extra` : "");
    css(count, { margin: "2px 0 6px", color: "#6E6257", fontSize: "12px" });
    section.append(count);

    // "Check all sellers": explicit click, Stop available for the whole run.
    const toCheck = sellersToCheck(checklist);
    if (Parser && (checkRun.running || toCheck.length)) {
      if (checkRun.running) {
        const stopBtn = smallButton("Stop checking", false);
        stopBtn.style.marginTop = "0";
        stopBtn.addEventListener("click", () => {
          checkRun.cancel = true;
          checkRun.text = "Stopping after the current seller…";
          wantsUi.signature = "";
          refreshWantsStock();
        });
        section.append(stopBtn);
      } else {
        const checkBtn = smallButton(`Check all sellers (${toCheck.length}, about ${toCheck.length * 3} s)`, false);
        checkBtn.style.marginTop = "0";
        checkBtn.title = "Opens page 1 of each seller's wants page in the background, one at a time";
        checkBtn.addEventListener("click", runCheckAll);
        section.append(checkBtn);
      }
    }
    [[checkRun.text, "#6E6257"], [checkRun.error, "#9F2D24"]].forEach(([text, color]) => {
      if (!text) return;
      const line = document.createElement("p");
      line.setAttribute("role", "status");
      line.textContent = text;
      css(line, { margin: "6px 0 0", color, fontSize: "12px" });
      section.append(line);
    });

    const list = document.createElement("ul");
    css(list, { margin: "6px 0 0", padding: "0", listStyle: "none", maxHeight: "200px", overflowY: "auto" });
    checklist.rows.forEach((row) => {
      // Line 1: seller + link; line 2: status.
      const item = document.createElement("li");
      css(item, { padding: "4px 0", borderTop: "1px solid #F1EADF", fontSize: "12px" });
      const top = document.createElement("div");
      css(top, { display: "flex", gap: "6px", alignItems: "baseline" });
      const name = document.createElement("span");
      name.textContent = row.sellerName;
      css(name, { flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: "600" });
      top.append(name);
      const loaded = row.status === "loaded";
      const hasOffers = !loaded && row.checked && row.checked.hits > 0;
      if (row.wantsUrl && isCardmarketUrl(row.wantsUrl)) {
        const link = document.createElement("a");
        link.href = row.wantsUrl; // same tab
        link.textContent = hasOffers ? "Load →" : row.status === "not-loaded" ? "Open wants page" : "Reload";
        css(link, { ...NEUTRAL_LINK, fontWeight: hasOffers ? "700" : "500" });
        top.append(link);
      }
      const status = document.createElement("div");
      status.textContent = rowStatusText(row);
      css(status, { color: loaded ? "#4F7A5A" : hasOffers ? "#1C1A17" : "#A89D8F" });
      item.append(top, status);
      list.append(item);
    });
    section.append(list);

    if (next && isCardmarketUrl(next.wantsUrl)) {
      const nextBtn = smallButton(`Next seller → ${next.sellerName}`, true);
      nextBtn.addEventListener("click", () => {
        location.assign(next.wantsUrl);
      });
      section.append(nextBtn);
    } else if (checklist.loadedCount === checklist.total) {
      const done = document.createElement("p");
      done.textContent = "All cart sellers loaded ✓";
      css(done, { margin: "6px 0 0", color: "#4F7A5A", fontSize: "12px", fontWeight: "700" });
      section.append(done);
    }

    if (checklist.extras.length) {
      const extrasTitle = document.createElement("p");
      extrasTitle.textContent = "Extra sellers (not in this cart)";
      css(extrasTitle, { margin: "8px 0 2px", fontWeight: "600", fontSize: "12px", color: "#1C1A17" });
      const extras = document.createElement("ul");
      css(extras, { margin: "0", padding: "0", listStyle: "none", maxHeight: "90px", overflowY: "auto" });
      checklist.extras.forEach((extra) => {
        const item = document.createElement("li");
        item.textContent = `${extra.sellerName} · ${offersText(extra.offerCount, extra.hits)} · ${Flow.formatAge(extra.ageMs)}${extra.sameWantsList ? "" : " · other wants list (not sent)"}`;
        css(item, { fontSize: "12px", color: "#6E6257", padding: "1px 0" });
        extras.append(item);
      });
      section.append(extrasTitle, extras);
    }
  }

  // ── Cart extraction helpers ───────────────────────────────────────────────

  function extractCartPayload(root) {
    const sellerSections = findSellerSections(root);
    const extracted = sellerSections
      .map(extractSeller)
      .filter((seller) => seller.items.length || seller.sellerName !== "Unknown seller");
    const sellers = Rows ? Rows.dedupeSellers(extracted) : extracted;
    const warnings = [];

    if (!sellers.length) {
      warnings.push("No seller sections were recognized. Cardmarket may have changed the cart markup.");
    }
    if (Rows) {
      sellers.forEach((seller) => {
        const contents = Rows.readContentsCount(seller.rawText);
        const read = Rows.articleCount(seller.items);
        if (contents !== null && read !== contents) {
          warnings.push(`${seller.sellerName}: read ${read} article(s), Cardmarket says ${contents}.`);
        }
      });
    }

    return {
      source: "cartforge-cardmarket-extension",
      version: 1,
      url: location.href,
      extractedAt: new Date().toISOString(),
      // Wants list(s) behind the sellers' "Articles on My Wants List" links. KAIKATA
      // asks the extension only for wants stock captured from these lists.
      wantsListIds: [...new Set(sellers.map((seller) => seller.wantsListId).filter(Boolean))],
      sellers,
      warnings
    };
  }

  function findSellerSections(root) {
    // Prefer the known Cardmarket shipment-block pattern (section[id^="seller"]).
    // This is the most reliable anchor: it is exactly one element per seller and
    // always contains the flag tooltip with the seller's country.
    const shipmentBlocks = renderedOnly([
      ...root.querySelectorAll('section[id^="seller"], section.shipment-block')
    ]).filter((el) => /(?:€|EUR|\d+[,.]\d{2})/.test(visibleText(el)));
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
    const read = renderedOnly(findItemRows(section))
      .map((row, rowIndex) => ({ ...extractItem(row, sellerIndex, rowIndex), articleId: readArticleId(row) }))
      .filter((item) => item.cardName || item.price !== null);
    const rows = (Rows ? Rows.dedupeItems(read, { contentsCount: Rows.readContentsCount(text) }) : read)
      .map(({ articleId, ...item }) => item);
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
    const wantsLink = Flow
      ? Flow.findWantsLink(sectionLinks(section), location.href)
      : { wantsUrl: "", wantsListId: "" };

    if (CARTFORGE_DEBUG) {
      // eslint-disable-next-line no-console
      console.log("[Kaikata] extractSeller", {
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
      wantsUrl: wantsLink.wantsUrl,
      wantsListId: wantsLink.wantsListId,
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

  // Rendered = laid out on screen. Rows the "Only removals" filter hid still count.
  function isRendered(element) {
    return element.getClientRects().length > 0 || Boolean(element.closest("[data-cartforge-hidden]"));
  }

  function renderedOnly(elements) {
    return Rows ? Rows.pickRendered(elements, isRendered) : elements;
  }

  // Each link once, rendered ones first (both layouts carry the same links).
  function sectionLinks(section) {
    const anchors = [...section.querySelectorAll("a[href]")];
    const ordered = [...anchors.filter(isRendered), ...anchors.filter((a) => !isRendered(a))];
    const links = ordered.map((a) => ({ text: visibleText(a), href: a.href }));
    return Rows ? Rows.dedupeLinks(links, location.href) : links;
  }

  function readArticleId(row) {
    const id = row.getAttribute("data-article-id") || row.getAttribute("data-id-article") || "";
    if (id) return id;
    const match = String(row.id || "").match(/(\d{5,})/);
    return match ? match[1] : "";
  }

  function findItemRows(section) {
    const rowCandidates = [
      ...section.querySelectorAll("tr, [role='row'], .article-row, .cart-item, .item-row, .product-row")
    ].filter((row) => {
      if (row.closest("[data-cartforge-badge]")) return false;
      const text = visibleText(row);
      // A leading "1x" quantity marker means this is a real item row, even if a
      // seller's own comment happens to contain a word (e.g. "Fast Shipping!")
      // that would otherwise look like the seller-level summary/shipping/total field.
      const looksLikeItemRow = /^\s*\d+\s*[x×]\s*\S/i.test(text);
      return (
        /(?:€|EUR|\d+[,.]\d{2})/.test(text) &&
        (looksLikeItemRow || !/\b(summary|shipping|shipment|trustee|total)\b/i.test(text))
      );
    });

    if (rowCandidates.length) {
      return dropNestedDuplicateRows(rowCandidates);
    }

    return [...section.querySelectorAll("li, div")].filter((row) => {
      if (row.closest("[data-cartforge-badge]") || row.matches(MARK_SELECTOR)) return false;
      const text = visibleText(row);
      return (
        /\b(?:near mint|mint|excellent|good|light played|played|poor|nm|ex|gd|lp|pl)\b/i.test(text) &&
        /(?:€|EUR|\d+[,.]\d{2})/.test(text)
      );
    });
  }

  // Cardmarket nests one row element inside another. The outer/inner copy can yield a
  // flattened innerText ("1xFecundityFecundity#145EX00150,39 €1") in which a seller
  // comment glues onto the price. For each nested pair keep the row with clean
  // multi-line text; if both are equally clean, keep the inner (more specific) one.
  function dropNestedDuplicateRows(rows) {
    const isClean = (row) => visibleText(row).includes("\n");
    const prefer = (candidate, other) => {
      const candidateClean = isClean(candidate);
      if (candidateClean !== isClean(other)) return candidateClean;
      return other.contains(candidate);
    };
    return rows.filter((row) => !rows.some((other) => (
      other !== row &&
      (other.contains(row) || row.contains(other)) &&
      prefer(other, row)
    )));
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

  // KAIKATA marks inside the element are removed from its text, so extraction reads
  // the same text with or without the overlay.
  function visibleText(element) {
    const raw = String(element?.innerText || element?.textContent || "");
    const marks = element?.querySelectorAll ? [...element.querySelectorAll(MARK_SELECTOR)] : [];
    const text = marks.length && Matching
      ? Matching.stripMarkText(raw, marks.map((mark) => mark.innerText || mark.textContent || ""))
      : raw;
    return text
      .replace(/ /g, " ")
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
