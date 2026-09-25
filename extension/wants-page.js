// KAIKATA on Cardmarket's "Seller's Articles on My Wants List" pages
// (/<lang>/<game>/Users/<seller>/Offers/Singles?idWantslist=<id>).
//
// - Asks once: "Load <seller>'s wanted cards for KAIKATA?" and loads the seller's offers
//   only when the user clicks: pages are fetched one at a time, 2–4 s apart, at most 15
//   pages, and the walk stops at the first error, login redirect, challenge page or HTTP 429.
// - Ends with a result card: how many of the cart's cards this seller has (and how many
//   cheaper), with "Next seller →" and "Back to cart" (both plain user-clicked links).
// - With a confirmed plan, marks the articles the plan adds (ADD ×N) and can tick their
//   checkboxes / amounts. It never submits anything: the user clicks Cardmarket's button.
(() => {
  const PANEL_ID = "cartforge-wants-panel";
  const CANDIDATES_KEY = "cartforgeCandidatesV1";
  const SNAPSHOT_KEY = "cartforgeCartSnapshotV1";
  const PLAN_KEY = "cartforgeConfirmedPlanV3";
  const STALE_MS = 24 * 60 * 60 * 1000;
  const SECONDS_PER_PAGE = 3; // average of the 2–4 s pause
  const Parser = globalThis.CartforgeWantsParser;
  const Flow = globalThis.CartforgeWantsFlow;
  const LINK_BUTTON = { background: "none", border: "none", padding: "0", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", color: "#6E6257" };

  const pageUrl = new URL(location.href);
  if (!pageUrl.searchParams.get("idWantslist") || !Parser || document.getElementById(PANEL_ID)) {
    return;
  }

  const current = Parser.parseWantsPage(document.documentElement.outerHTML, location.href);
  const meta = current.meta;
  const sellerKey = normalizeSellerName(meta.sellerName);
  const pagesToLoad = Math.min(Math.max(1, meta.pages || 1), Parser.MAX_PAGES);
  let capturing = false;
  let cancelRequested = false;

  const ui = buildPanel();
  showStart();
  refreshCaptureList();
  refreshHeader();
  applyPlanMarks();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[CANDIDATES_KEY]) {
        refreshCaptureList();
        refreshHeader();
      }
    });
  } catch {
    // Storage events unavailable: the header still updates after this tab's own loads.
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  function storageGet(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([key], (result) => resolve(result?.[key]));
      } catch {
        resolve(undefined);
      }
    });
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

  // A full load (merge: false) replaces this seller's entry; "this page only" adds to a
  // fresh entry for the same wants list.
  async function saveCapture(offers, details, { merge }) {
    const all = (await storageGet(CANDIDATES_KEY)) || {};
    const previous = all[sellerKey];
    const keepPrevious = merge && previous && previous.wantsListId === meta.wantsListId
      && Date.now() - Date.parse(previous.capturedAt) <= STALE_MS;
    const byId = new Map((keepPrevious ? previous.offers : []).map((offer) => [offer.idArticle, offer]));
    offers.forEach((offer) => byId.set(offer.idArticle, offer));
    const mergedOffers = [...byId.values()];
    all[sellerKey] = {
      sellerName: meta.sellerName,
      sellerCountry: meta.sellerCountry || previous?.sellerCountry || "",
      wantsListId: meta.wantsListId,
      capturedAt: new Date().toISOString(),
      hits: meta.hits,
      totalPages: details.totalPages ?? meta.pages,
      pagesFetched: details.pagesFetched,
      stoppedReason: details.stoppedReason || null,
      unique: mergedOffers.length,
      passes: details.passes ?? previous?.passes ?? 1,
      offers: mergedOffers
    };
    await storageSet(CANDIDATES_KEY, all);
    return all[sellerKey];
  }

  // This seller's capture for this wants list, if it is less than 24 h old.
  async function freshCapture() {
    const entry = ((await storageGet(CANDIDATES_KEY)) || {})[sellerKey];
    if (!entry || entry.wantsListId !== meta.wantsListId) return null;
    return Date.now() - Date.parse(entry.capturedAt) <= STALE_MS ? entry : null;
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  async function loadSeller() {
    if (capturing) return;
    capturing = true;
    cancelRequested = false;
    showProgress();
    const result = await Parser.walkWantsPages({
      startUrl: location.href,
      fetchPage: (url) => fetch(url, { credentials: "include", redirect: "follow" }),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      isCancelled: () => cancelRequested,
      onProgress: ({ page, totalPages, offers, waitingMs, pass }) => {
        setProgress(page, totalPages, offers, waitingMs, pass);
      }
    });
    capturing = false;
    if (result.offers.length) {
      const saved = await saveCapture(result.offers, result, { merge: false });
      await showResult(saved, { stoppedReason: result.stoppedReason, pagesFetched: result.pagesFetched });
    } else {
      showStart(`Nothing loaded. ${result.stoppedReason || "No offers found."}`);
    }
    refreshCaptureList();
    refreshHeader();
  }

  async function loadPageOnly() {
    if (capturing) return;
    const parsed = Parser.parseWantsPage(document.documentElement.outerHTML, location.href);
    if (!parsed.offers.length) {
      setNote("No offers found on this page.", true);
      return;
    }
    const saved = await saveCapture(parsed.offers, { pagesFetched: 1, totalPages: parsed.meta.pages }, { merge: true });
    await showResult(saved, { pageOnly: parsed.offers.length });
    refreshCaptureList();
    refreshHeader();
  }

  // ── Views: start prompt → progress → result card ──────────────────────────

  async function showStart(note = "") {
    const loaded = await freshCapture();
    ui.prompt.style.display = "block";
    ui.progress.style.display = "none";
    ui.result.style.display = "none";
    if (loaded) {
      ui.promptTitle.textContent = `${meta.sellerName}'s wanted cards are loaded`;
      ui.promptInfo.textContent = `Loaded ${formatAge(Date.now() - Date.parse(loaded.capturedAt))} · ${offersText(loaded.offers.length)}`;
      ui.loadBtn.textContent = "Reload";
      // Show what the stored stock means for the cart, with the same next steps.
      await showResult(loaded, { alreadyLoaded: true });
      ui.prompt.style.display = "block";
    } else {
      ui.promptTitle.textContent = `Load ${meta.sellerName}'s wanted cards for KAIKATA?`;
      const offers = meta.hits !== null ? `${meta.hits} offers on ` : "";
      const limit = meta.pages > Parser.MAX_PAGES ? ` (first ${Parser.MAX_PAGES} of ${meta.pages})` : "";
      ui.promptInfo.textContent = `${offers}${pagesToLoad} page${pagesToLoad === 1 ? "" : "s"}${limit} · takes about ${pagesToLoad * SECONDS_PER_PAGE} s`;
      ui.loadBtn.textContent = "Load";
    }
    setNote(note, Boolean(note));
  }

  function showProgress() {
    ui.prompt.style.display = "none";
    ui.result.style.display = "none";
    ui.progress.style.display = "block";
    setProgress(0, pagesToLoad, 0, 0);
  }

  function setProgress(page, totalPages, offers, waitingMs, pass = 1) {
    const total = Math.max(1, totalPages || pagesToLoad);
    ui.progressFill.style.width = `${Math.round((Math.min(page, total) / total) * 100)}%`;
    const label = pass === 2 ? `Second pass (Z→A): page ${Math.max(page, 1)} of ${total}` : `Page ${Math.max(page, 1)} of ${total}`;
    ui.progressText.textContent = `${label} · ${offers} offers${waitingMs ? ` · pausing ${Math.round(waitingMs / 100) / 10} s` : ""}`;
  }

  async function showResult(saved, { stoppedReason = null, pageOnly = 0, alreadyLoaded = false } = {}) {
    ui.progress.style.display = "none";
    ui.prompt.style.display = alreadyLoaded ? "block" : "none";
    ui.result.style.display = "block";
    ui.result.replaceChildren();

    if (!alreadyLoaded && pageOnly) {
      ui.result.append(paragraph(`✓ Loaded ${offersText(pageOnly)} from this page (${saved.offers.length} for this seller).`, { fontWeight: "700", color: "#4F7A5A" }));
    } else if (!pageOnly) {
      // Cardmarket's paging repeats some rows and skips others; the walker tries a
      // second, reverse-sorted pass to recover them (see walkWantsPages). What's left
      // after that is a gap, not an unrecognized row.
      const hits = Number.isFinite(saved.hits) ? saved.hits : meta.hits;
      const outcome = Parser.captureResultText(saved.offers.length, hits);
      if (!alreadyLoaded || !outcome.complete) {
        ui.result.append(paragraph(outcome.text, !alreadyLoaded && outcome.complete
          ? { fontWeight: "700", color: "#4F7A5A" }
          : { color: "#6E6257" }));
      }
    }
    if (stoppedReason) {
      ui.result.append(paragraph(`Stopped: ${stoppedReason}`, { color: "#9F2D24" }));
    }

    const snapshot = await storageGet(SNAPSHOT_KEY);
    if (!snapshot || !Flow) {
      ui.result.append(paragraph("Open your cart once so KAIKATA can compare.", { color: "#6E6257" }));
    } else {
      const comparison = Flow.compareStockToCart(snapshot, saved.offers);
      if (!comparison.found) {
        ui.result.append(paragraph("None of your cart's cards are in this seller's stock; KAIKATA will ignore it.", { color: "#6E6257" }));
      } else {
        const line = document.createElement("p");
        css(line, { margin: "6px 0 0" });
        const strong = document.createElement("strong");
        strong.textContent = `${comparison.found} of your cart's cards are in this seller's stock`;
        line.append(strong, document.createTextNode(`, ${comparison.cheaper} of them cheaper than in your cart.`));
        ui.result.append(line);
      }
    }

    const actions = document.createElement("div");
    css(actions, { display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" });
    const captures = (await storageGet(CANDIDATES_KEY)) || {};
    const step = snapshot && Flow ? Flow.nextStepLine(snapshot, captures, Date.now(), meta.sellerName) : null;
    if (step) {
      ui.result.append(paragraph(step.text, step.complete
        ? { color: "#4F7A5A", fontWeight: "600" }
        : { color: "#6E6257" }));
    }
    const next = step?.next || null;
    if (next && isCardmarketUrl(next.wantsUrl)) {
      actions.append(linkButton(`Next seller → ${next.sellerName}`, next.wantsUrl, true));
    }
    actions.append(linkButton("Back to cart", cartUrl(snapshot), !next));
    ui.result.append(actions);
  }

  // ── Planned additions ─────────────────────────────────────────────────────

  async function plannedAdds() {
    const envelope = await storageGet(PLAN_KEY);
    const rows = envelope?.plan?.rows || [];
    return rows.filter((row) => row.decision === "add" && row.articleId
      && normalizeSellerName(row.sellerDisplayName) === sellerKey);
  }

  async function applyPlanMarks() {
    const adds = await plannedAdds();
    if (!adds.length) return;
    let onPage = 0;
    adds.forEach((row) => {
      const rowEl = document.getElementById(`stockRow${row.articleId}`);
      if (!rowEl) return;
      onPage += 1;
      if (rowEl.querySelector("[data-cartforge-add]")) return;
      const pill = document.createElement("span");
      pill.setAttribute("data-cartforge-add", row.articleId);
      pill.className = "cartforge-add-pill";
      pill.textContent = `ADD ×${row.addQuantity || row.selectedQuantity || 1}`;
      css(pill, {
        display: "inline-block", marginRight: "6px", padding: "1px 8px", borderRadius: "999px",
        background: "#4F7A5A", color: "#FFFFFF", fontSize: "10.5px", fontWeight: "700", letterSpacing: ".04em",
        fontFamily: "'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", verticalAlign: "middle", whiteSpace: "nowrap"
      });
      const host = rowEl.querySelector(".col-sellerProductInfo") || rowEl;
      host.prepend(pill);
    });
    ui.planLine.textContent = `Plan: ${adds.length} article${adds.length === 1 ? "" : "s"} to add from ${meta.sellerName} · ${onPage} on this page`;
    ui.planLine.style.display = "block";
    ui.selectBtn.style.display = onPage ? "block" : "none";
  }

  // Ticks the planned rows and sets their amounts. Never submits the form.
  async function selectPlanned() {
    const adds = await plannedAdds();
    let selected = 0;
    adds.forEach((row) => {
      const rowEl = document.getElementById(`stockRow${row.articleId}`);
      if (!rowEl) return;
      const wanted = String(row.addQuantity || row.selectedQuantity || 1);
      const select = rowEl.querySelector(`select[name="amount[${row.articleId}]"]`);
      if (select) {
        const values = [...select.options].map((option) => option.value);
        select.value = values.includes(wanted) ? wanted : values[values.length - 1];
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const checkbox = rowEl.querySelector('input[type="checkbox"]');
      if (checkbox && !checkbox.checked) {
        checkbox.click();
      }
      selected += 1;
    });
    const elsewhere = adds.length - selected;
    setNote(`Selected ${selected} planned article${selected === 1 ? "" : "s"}${elsewhere ? ` (${elsewhere} on other pages)` : ""}. Now use Cardmarket's own button to put them in your cart.`);
  }

  // ── Panel ─────────────────────────────────────────────────────────────────

  function buildPanel() {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "cartforge-wants-panel";
    css(panel, {
      position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483647", width: "300px",
      font: "13px/1.45 'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: "#1C1A17",
      background: "#FFF9EF", border: "1.5px solid #DED3C2", borderRadius: "12px",
      boxShadow: "0 4px 16px rgba(28,26,23,0.12)", padding: "12px 14px"
    });

    const header = document.createElement("div");
    css(header, { display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" });
    const title = document.createElement("strong");
    title.textContent = "KAIKATA";
    css(title, { letterSpacing: ".08em", fontSize: "12px", flex: "1" });
    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.textContent = "–";
    collapse.setAttribute("aria-label", "Collapse KAIKATA panel");
    css(collapse, { ...LINK_BUTTON, fontSize: "18px", lineHeight: "1" });
    header.append(title, collapse);

    const body = document.createElement("div");
    const progressHeader = paragraph("", {
      margin: "0 0 8px", padding: "6px 8px", borderRadius: "8px", fontWeight: "700", fontSize: "12px",
      color: "#1C1A17", background: "rgba(79,122,90,0.10)", display: "none"
    });
    const info = paragraph([
      meta.sellerName,
      meta.sellerCountry || "country unknown",
      meta.hits !== null ? `${meta.hits} hits` : "",
      `${meta.pages} page${meta.pages === 1 ? "" : "s"}`
    ].filter(Boolean).join(" · "), { margin: "0 0 8px", color: "#6E6257", fontSize: "12px" });

    // Start prompt.
    const prompt = document.createElement("div");
    const promptTitle = paragraph("", { margin: "0", fontWeight: "700", fontSize: "13.5px" });
    const promptInfo = paragraph("", { margin: "2px 0 0", color: "#6E6257", fontSize: "12px" });
    const promptButtons = document.createElement("div");
    css(promptButtons, { display: "flex", gap: "6px" });
    const loadBtn = button("Load", true);
    const notNowBtn = button("Not now", false);
    promptButtons.append(loadBtn, notNowBtn);
    const pageBtn = button("Capture this page only", false);
    css(pageBtn, { ...LINK_BUTTON, display: "block", marginTop: "6px", textDecoration: "underline" });
    prompt.append(promptTitle, promptInfo, promptButtons, pageBtn);

    // Progress.
    const progress = document.createElement("div");
    progress.style.display = "none";
    const track = document.createElement("div");
    track.setAttribute("role", "progressbar");
    css(track, { height: "6px", borderRadius: "999px", background: "#EDE3D4", overflow: "hidden", marginTop: "2px" });
    const progressFill = document.createElement("div");
    css(progressFill, { height: "100%", width: "0%", background: "#D84A2B", transition: "width .3s ease" });
    track.append(progressFill);
    const progressText = paragraph("", { margin: "6px 0 0", color: "#6E6257", fontSize: "12px" });
    progressText.setAttribute("role", "status");
    const stopBtn = button("Stop", false);
    progress.append(track, progressText, stopBtn);

    // Result card.
    const result = document.createElement("div");
    css(result, { marginTop: "8px", padding: "10px 12px", borderRadius: "10px", background: "#FFFFFF", border: "1.5px solid #DED3C2", display: "none" });

    const planLine = paragraph("", { margin: "8px 0 6px", fontWeight: "600", display: "none" });
    const selectBtn = button("Select planned articles on this page", true);
    selectBtn.style.display = "none";
    const note = paragraph("", { margin: "8px 0 0", color: "#6E6257", minHeight: "0" });
    note.setAttribute("role", "status");

    // Everything loaded so far, for housekeeping.
    const details = document.createElement("details");
    css(details, { marginTop: "10px" });
    const summary = document.createElement("summary");
    css(summary, { cursor: "pointer", fontWeight: "600", fontSize: "12px" });
    const list = document.createElement("ul");
    css(list, { margin: "4px 0 0", padding: "0", listStyle: "none", maxHeight: "140px", overflowY: "auto" });
    const clearAll = button("Clear all", false);
    css(clearAll, { ...LINK_BUTTON, marginTop: "4px", color: "#9F2D24" });
    details.append(summary, list, clearAll);

    body.append(progressHeader, info, prompt, progress, result, planLine, selectBtn, note, details);
    panel.append(header, body);
    document.body.append(panel);

    loadBtn.addEventListener("click", loadSeller);
    pageBtn.addEventListener("click", loadPageOnly);
    notNowBtn.addEventListener("click", () => setCollapsed(true));
    stopBtn.addEventListener("click", () => {
      cancelRequested = true;
      progressText.textContent = "Stopping after the current page…";
    });
    selectBtn.addEventListener("click", selectPlanned);
    clearAll.addEventListener("click", async () => {
      await storageSet(CANDIDATES_KEY, {});
      refreshCaptureList();
      refreshHeader();
      showStart();
    });
    collapse.addEventListener("click", () => setCollapsed(body.style.display !== "none"));

    function setCollapsed(collapsed) {
      body.style.display = collapsed ? "none" : "block";
      collapse.textContent = collapsed ? "+" : "–";
    }

    return { progressHeader, prompt, promptTitle, promptInfo, loadBtn, progress, progressFill, progressText, result, planLine, selectBtn, note, details, summary, list };
  }

  function paragraph(text, styles = {}) {
    const el = document.createElement("p");
    el.textContent = text;
    css(el, { margin: "6px 0 0", ...styles });
    return el;
  }

  function button(label, primary) {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = label;
    css(el, {
      display: "block", width: "100%", marginTop: "8px", padding: "7px 12px", borderRadius: "999px",
      fontFamily: "inherit", fontSize: "12.5px", fontWeight: "600", cursor: "pointer",
      ...(primary
        ? { background: "#D84A2B", color: "#FFFFFF", border: "1.5px solid #D84A2B" }
        : { background: "transparent", color: "#1C1A17", border: "1.5px solid #DED3C2" })
    });
    return el;
  }

  // A navigation the user clicks (same tab). Never followed automatically.
  function linkButton(label, href, primary) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    css(link, {
      display: "block", textAlign: "center", padding: "7px 10px", borderRadius: "999px", fontSize: "12.5px",
      fontWeight: "600", textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      ...(primary
        ? { background: "#D84A2B", color: "#FFFFFF", border: "1.5px solid #D84A2B" }
        : { background: "transparent", color: "#1C1A17", border: "1.5px solid #DED3C2" })
    });
    return link;
  }

  function setNote(message, warning = false) {
    ui.note.textContent = message;
    ui.note.style.display = message ? "block" : "none";
    ui.note.style.color = warning ? "#9F2D24" : "#6E6257";
  }

  async function refreshCaptureList() {
    const all = (await storageGet(CANDIDATES_KEY)) || {};
    ui.list.replaceChildren();
    const entries = Object.entries(all).sort((a, b) => Date.parse(b[1].capturedAt) - Date.parse(a[1].capturedAt));
    ui.summary.textContent = `Loaded sellers (${entries.length})`;
    ui.details.open = entries.length >= 2;
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.textContent = "None yet.";
      css(empty, { color: "#6E6257" });
      ui.list.append(empty);
      return 0;
    }
    entries.forEach(([key, entry]) => {
      const isCurrent = key === sellerKey;
      const item = document.createElement("li");
      css(item, {
        display: "flex", gap: "6px", alignItems: "baseline", padding: "2px 4px",
        borderRadius: "6px", background: isCurrent ? "rgba(79,122,90,0.12)" : "transparent"
      });
      const label = document.createElement("span");
      const ageMs = Date.now() - Date.parse(entry.capturedAt);
      label.textContent = `${entry.sellerName}${isCurrent ? " (this seller)" : ""} · ${offersText(entry.offers.length, entry.hits)} · `
        + `${formatAge(ageMs)}${ageMs > STALE_MS ? " (stale)" : ""}`;
      css(label, { flex: "1", fontWeight: isCurrent ? "700" : "400", color: ageMs > STALE_MS ? "#9F2D24" : "#1C1A17" });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      css(remove, LINK_BUTTON);
      remove.addEventListener("click", async () => {
        const latest = (await storageGet(CANDIDATES_KEY)) || {};
        delete latest[key];
        await storageSet(CANDIDATES_KEY, latest);
        refreshCaptureList();
        refreshHeader();
        if (key === sellerKey) showStart();
      });
      item.append(label, remove);
      ui.list.append(item);
    });
    return entries.length;
  }

  // Progress header, always visible at the top of the panel: cart-scoped once a cart
  // snapshot exists, every fresh capture otherwise.
  async function refreshHeader() {
    if (!Flow) return;
    const snapshot = await storageGet(SNAPSHOT_KEY);
    const captures = (await storageGet(CANDIDATES_KEY)) || {};
    const progress = Flow.wantsStockProgress(snapshot, captures, Date.now());
    ui.progressHeader.textContent = progress.text;
    ui.progressHeader.style.display = "block";
    const mine = progress.hasCart
      ? Flow.sellerChecklist(snapshot, captures, Date.now()).rows.find((row) => normalizeSellerName(row.sellerName) === sellerKey)
      : null;
    const included = Boolean(mine && mine.status === "loaded");
    css(ui.progressHeader, {
      background: included ? "rgba(79,122,90,0.20)" : "rgba(79,122,90,0.10)",
      color: included ? "#4F7A5A" : "#1C1A17"
    });
  }

  // The cart URL from the snapshot, else /<lang>/<game>/ShoppingCart on this site.
  function cartUrl(snapshot) {
    if (snapshot?.cartUrl && isCardmarketUrl(snapshot.cartUrl)) return snapshot.cartUrl;
    const [lang = "en", game = "Magic"] = location.pathname.split("/").filter(Boolean);
    return `${location.origin}/${lang}/${game}/ShoppingCart`;
  }

  function isCardmarketUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && /(^|\.)cardmarket\.com$/i.test(parsed.hostname);
    } catch {
      return false;
    }
  }

  function offersText(count, hits) {
    if (Number.isFinite(hits) && count < hits) return `${count}/${hits} offers`;
    return `${count} offer${count === 1 ? "" : "s"}`;
  }

  function formatAge(ms) {
    if (Flow) return Flow.formatAge(ms);
    const minutes = Math.max(0, Math.round(ms / 60000));
    return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
  }

  function normalizeSellerName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function css(el, styles) {
    Object.assign(el.style, styles);
  }
})();
