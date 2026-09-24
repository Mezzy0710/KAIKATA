// KAIKATA on Cardmarket's "Seller's Articles on My Wants List" pages
// (/<lang>/<game>/Users/<seller>/Offers/Singles?idWantslist=<id>).
//
// - Captures the seller's offers for KAIKATA, only when the user clicks a button:
//   pages are fetched one at a time, 2–4 s apart, at most 15 pages, and the walk stops at
//   the first error, login redirect, challenge page or HTTP 429.
// - With a confirmed plan, marks the articles the plan adds (ADD ×N) and can tick their
//   checkboxes / amounts. It never submits anything: the user clicks Cardmarket's button.
(() => {
  const PANEL_ID = "cartforge-wants-panel";
  const CANDIDATES_KEY = "cartforgeCandidatesV1";
  const PLAN_KEY = "cartforgeConfirmedPlanV3";
  const STALE_MS = 24 * 60 * 60 * 1000;
  const Parser = globalThis.CartforgeWantsParser;
  const LINK_BUTTON = { background: "none", border: "none", padding: "0", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", color: "#6E6257" };

  const pageUrl = new URL(location.href);
  if (!pageUrl.searchParams.get("idWantslist") || !Parser || document.getElementById(PANEL_ID)) {
    return;
  }

  const current = Parser.parseWantsPage(document.documentElement.outerHTML, location.href);
  const meta = current.meta;
  const sellerKey = normalizeSellerName(meta.sellerName);
  let capturing = false;
  let cancelRequested = false;

  const ui = buildPanel();
  refreshCaptureList();
  applyPlanMarks();

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

  async function saveCapture(offers, details, { merge }) {
    const all = (await storageGet(CANDIDATES_KEY)) || {};
    const previous = all[sellerKey];
    const keepPrevious = merge && previous && previous.wantsListId === meta.wantsListId
      && Date.now() - Date.parse(previous.capturedAt) <= STALE_MS;
    const byId = new Map((keepPrevious ? previous.offers : []).map((offer) => [offer.idArticle, offer]));
    offers.forEach((offer) => byId.set(offer.idArticle, offer));
    all[sellerKey] = {
      sellerName: meta.sellerName,
      sellerCountry: meta.sellerCountry || previous?.sellerCountry || "",
      wantsListId: meta.wantsListId,
      capturedAt: new Date().toISOString(),
      hits: meta.hits,
      totalPages: details.totalPages ?? meta.pages,
      pagesFetched: details.pagesFetched,
      stoppedReason: details.stoppedReason || null,
      offers: [...byId.values()]
    };
    await storageSet(CANDIDATES_KEY, all);
    return all[sellerKey];
  }

  // ── Capture ───────────────────────────────────────────────────────────────

  async function captureSeller() {
    if (capturing) return;
    capturing = true;
    cancelRequested = false;
    setBusy(true);
    const result = await Parser.walkWantsPages({
      startUrl: location.href,
      fetchPage: (url) => fetch(url, { credentials: "include", redirect: "follow" }),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      isCancelled: () => cancelRequested,
      onProgress: ({ page, totalPages, offers, waitingMs }) => {
        setStatus(waitingMs
          ? `Page ${page} of ${totalPages} done · ${offers} offers · pausing ${Math.round(waitingMs / 100) / 10} s…`
          : `Page ${page} of ${totalPages} · ${offers} offers`);
      }
    });
    if (result.offers.length) {
      const saved = await saveCapture(result.offers, result, { merge: false });
      setStatus(`${result.stoppedReason ? `Stopped: ${result.stoppedReason} ` : ""}Captured ${saved.offers.length} offers from ${result.pagesFetched} page(s).`, Boolean(result.stoppedReason));
    } else {
      setStatus(`Nothing captured. ${result.stoppedReason || "No offers found."}`, true);
    }
    capturing = false;
    setBusy(false);
    refreshCaptureList();
  }

  async function capturePage() {
    if (capturing) return;
    const parsed = Parser.parseWantsPage(document.documentElement.outerHTML, location.href);
    if (!parsed.offers.length) {
      setStatus("No offers found on this page.", true);
      return;
    }
    const saved = await saveCapture(parsed.offers, { pagesFetched: 1, totalPages: parsed.meta.pages }, { merge: true });
    setStatus(`Captured ${parsed.offers.length} offers from this page (${saved.offers.length} for this seller in total).`);
    refreshCaptureList();
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
    setStatus(`Selected ${selected} planned article${selected === 1 ? "" : "s"}${elsewhere ? ` (${elsewhere} on other pages)` : ""}. Now use Cardmarket's own button to put them in your cart.`);
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
    const info = document.createElement("p");
    css(info, { margin: "0 0 8px", color: "#6E6257" });
    info.textContent = [
      meta.sellerName,
      meta.sellerCountry || "country unknown",
      meta.hits !== null ? `${meta.hits} hits` : "",
      `${meta.pages} page${meta.pages === 1 ? "" : "s"}${meta.pages > Parser.MAX_PAGES ? ` (first ${Parser.MAX_PAGES} captured)` : ""}`
    ].filter(Boolean).join(" · ");

    const captureBtn = button("Capture this seller", true);
    const pageBtn = button("Capture this page only", false);
    const stopBtn = button("Stop", false);
    stopBtn.style.display = "none";
    const selectBtn = button("Select planned articles on this page", true);
    selectBtn.style.display = "none";

    const planLine = document.createElement("p");
    css(planLine, { margin: "8px 0 6px", fontWeight: "600", display: "none" });
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    css(status, { margin: "8px 0 0", color: "#6E6257", minHeight: "1em" });

    const listTitle = document.createElement("p");
    listTitle.textContent = "Captured sellers";
    css(listTitle, { margin: "10px 0 4px", fontWeight: "600" });
    const list = document.createElement("ul");
    css(list, { margin: "0", padding: "0", listStyle: "none", maxHeight: "140px", overflowY: "auto" });
    const clearAll = button("Clear all", false);
    css(clearAll, { ...LINK_BUTTON, marginTop: "4px", color: "#9F2D24" });

    body.append(info, captureBtn, pageBtn, stopBtn, planLine, selectBtn, status, listTitle, list, clearAll);
    panel.append(header, body);
    document.body.append(panel);

    captureBtn.addEventListener("click", captureSeller);
    pageBtn.addEventListener("click", capturePage);
    stopBtn.addEventListener("click", () => {
      cancelRequested = true;
      setStatus("Stopping after the current page…");
    });
    selectBtn.addEventListener("click", selectPlanned);
    clearAll.addEventListener("click", async () => {
      await storageSet(CANDIDATES_KEY, {});
      refreshCaptureList();
    });
    collapse.addEventListener("click", () => {
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "block" : "none";
      collapse.textContent = hidden ? "–" : "+";
    });

    return { captureBtn, pageBtn, stopBtn, selectBtn, planLine, status, list };
  }

  function button(label, primary) {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = label;
    css(el, {
      display: "block", width: "100%", marginTop: "6px", padding: "7px 12px", borderRadius: "999px",
      fontFamily: "inherit", fontSize: "12.5px", fontWeight: "600", cursor: "pointer",
      ...(primary
        ? { background: "#D84A2B", color: "#FFFFFF", border: "1.5px solid #D84A2B" }
        : { background: "transparent", color: "#1C1A17", border: "1.5px solid #DED3C2" })
    });
    return el;
  }

  function setBusy(busy) {
    ui.captureBtn.disabled = busy;
    ui.pageBtn.disabled = busy;
    ui.captureBtn.style.opacity = busy ? "0.6" : "1";
    ui.pageBtn.style.opacity = busy ? "0.6" : "1";
    ui.stopBtn.style.display = busy ? "block" : "none";
  }

  function setStatus(message, warning = false) {
    ui.status.textContent = message;
    ui.status.style.color = warning ? "#9F2D24" : "#6E6257";
  }

  async function refreshCaptureList() {
    const all = (await storageGet(CANDIDATES_KEY)) || {};
    ui.list.replaceChildren();
    const entries = Object.entries(all).sort((a, b) => Date.parse(b[1].capturedAt) - Date.parse(a[1].capturedAt));
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.textContent = "None yet.";
      css(empty, { color: "#6E6257" });
      ui.list.append(empty);
      return;
    }
    entries.forEach(([key, entry]) => {
      const item = document.createElement("li");
      css(item, { display: "flex", gap: "6px", alignItems: "baseline", padding: "2px 0" });
      const label = document.createElement("span");
      const ageMs = Date.now() - Date.parse(entry.capturedAt);
      label.textContent = `${entry.sellerName} · ${entry.offers.length} offers · ${formatAge(ageMs)}${ageMs > STALE_MS ? " (stale)" : ""}`;
      css(label, { flex: "1", color: ageMs > STALE_MS ? "#9F2D24" : "#1C1A17" });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      css(remove, LINK_BUTTON);
      remove.addEventListener("click", async () => {
        const latest = (await storageGet(CANDIDATES_KEY)) || {};
        delete latest[key];
        await storageSet(CANDIDATES_KEY, latest);
        refreshCaptureList();
      });
      item.append(label, remove);
      ui.list.append(item);
    });
  }

  function formatAge(ms) {
    const minutes = Math.max(0, Math.round(ms / 60000));
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
  }

  function normalizeSellerName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function css(el, styles) {
    Object.assign(el.style, styles);
  }
})();
