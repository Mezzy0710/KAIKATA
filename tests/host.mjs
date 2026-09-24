import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { encodeCartForgePayload } from "../src/importer.mjs";
import {
  CANDIDATES_KEY,
  CONFIRMED_PLAN_KEY,
  INCOMING_CART_KEY,
  createExtensionHost,
  createHost,
  createWebHost,
  detectExtensionHost,
  host
} from "../src/host.mjs";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const minutesAgo = (minutes) => new Date(NOW - minutes * 60000).toISOString();
const plain = (value) => JSON.parse(JSON.stringify(value)); // sandbox objects → this realm
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// chrome.storage.local + onChanged, as far as host.mjs and background.js use them.
function fakeChrome(initial = {}) {
  const data = { ...initial };
  const listeners = new Set();
  const emit = (changes) => listeners.forEach((listener) => listener(changes, "local"));
  const keysOf = (keys) => (Array.isArray(keys) ? keys : [keys]);
  return {
    data,
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries(keysOf(keys).filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
        },
        async set(items) {
          const changes = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: data[key], newValue: structuredClone(value) };
            data[key] = structuredClone(value);
          }
          emit(changes);
        },
        async remove(keys) {
          const changes = {};
          for (const key of keysOf(keys)) {
            if (!(key in data)) continue;
            changes[key] = { oldValue: data[key] };
            delete data[key];
          }
          if (Object.keys(changes).length) emit(changes);
        }
      },
      onChanged: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn)
      }
    }
  };
}

// The extension's pure helpers, loaded the way the packaged page loads them (classic script).
const flowSource = await readFile(new URL("../extension/cartforge-wants-flow.js", import.meta.url), "utf8");
const sandbox = { URL };
vm.runInNewContext(flowSource, sandbox);
const Flow = sandbox.CartforgeWantsFlow;

// background.js in a sandbox with the same fake storage and a fixed clock.
async function loadBackground(chrome) {
  let listener = null;
  const context = vm.createContext({
    URL,
    console,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [NOW])); }
      static now() { return NOW; }
    },
    chrome: {
      ...chrome,
      runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
      action: { onClicked: { addListener: () => {} } }
    }
  });
  context.importScripts = () => vm.runInContext(flowSource, context);
  vm.runInContext(await readFile(new URL("../extension/background.js", import.meta.url), "utf8"), context);
  return (message) => new Promise((resolve) => {
    assert.equal(listener(message, {}, resolve), true, "Async response");
  });
}

// --- 1. Host detection: Node and the website get the web host.
assert.equal(detectExtensionHost(globalThis), false);
assert.equal(host.kind, "web", "Node tests (and the website) keep today's transports.");
assert.equal(detectExtensionHost({ location: { protocol: "chrome-extension:" }, chrome: {} }), false, "No chrome.storage → web.");
assert.equal(detectExtensionHost({ location: { protocol: "https:" }, chrome: { storage: {} } }), false);
assert.equal(
  createHost({ location: { protocol: "chrome-extension:" }, chrome: fakeChrome(), CartforgeWantsFlow: Flow }).kind,
  "extension"
);

// --- 2. Incoming cart: read once, then removed.
{
  const cart = { url: "https://www.cardmarket.com/en/Magic/ShoppingCart", sellers: [{ sellerName: "A", items: [] }] };
  const chrome = fakeChrome({ [INCOMING_CART_KEY]: { payload: cart, storedAt: minutesAgo(1) } });
  const extension = createExtensionHost({ chrome, flow: Flow, now: () => NOW });
  assert.deepEqual(await extension.loadIncomingCart(), cart);
  assert.equal(INCOMING_CART_KEY in chrome.data, false, "Removed after reading.");
  assert.equal(await extension.loadIncomingCart(), null, "A second read finds nothing.");

  // A cart sent while the tab is open: the listener fires for the write, not for our remove.
  let incoming = 0;
  extension.onIncomingCart(() => { incoming += 1; });
  await chrome.storage.local.set({ [INCOMING_CART_KEY]: { payload: cart, storedAt: minutesAgo(0) } });
  assert.equal(incoming, 1);
  assert.deepEqual(await extension.loadIncomingCart(), cart);
  assert.equal(incoming, 1, "Removing the entry does not count as a new cart.");
}

// Web host: the URL-hash path, unchanged.
{
  const cart = { sellers: [{ sellerName: "Web", items: [] }] };
  let replaced = null;
  const win = {
    location: { hash: `#cartforge=${encodeCartForgePayload(cart)}`, pathname: "/KAIKATA/", search: "?source=cardmarket-extension" },
    history: { replaceState: (_state, _title, url) => { replaced = url; } }
  };
  assert.deepEqual(await createWebHost({ window: win, document: null }).loadIncomingCart(), cart);
  assert.equal(replaced, "/KAIKATA/?source=cardmarket-extension", "The hash is cleared.");
  assert.equal(await createWebHost({ window: { location: { hash: "" } }, document: null }).loadIncomingCart(), null);
}

// --- 3. Candidates: same result as filterCapturesForTransfer and as background.js.
{
  const capture = (sellerName, wantsListId, capturedAt, offers = [{ cardName: "Card", price: 1 }]) => ({
    sellerName, sellerCountry: "Germany", wantsListId, capturedAt, offers
  });
  const stored = {
    sameList: capture("SameList", "111", minutesAgo(10)),
    otherList: capture("OtherList", "222", minutesAgo(10)),
    stale: capture("Stale", "111", minutesAgo(25 * 60)),
    noList: capture("NoList", "", minutesAgo(5)),
    noOffers: { sellerName: "NoOffers", wantsListId: "111", capturedAt: minutesAgo(1) },
    noCountry: { sellerName: "NoCountry", wantsListId: "111", capturedAt: minutesAgo(2), offers: [] }
  };
  const chrome = fakeChrome({ [CANDIDATES_KEY]: stored });
  const extension = createExtensionHost({ chrome, flow: Flow, now: () => NOW });
  const askBackground = await loadBackground(fakeChrome({ [CANDIDATES_KEY]: stored }));

  for (const wantsListIds of [["111"], ["111", "222"], ["999"], [], undefined]) {
    const fromHost = plain(await extension.getCandidates({ wantsListIds }));
    const filtered = plain(Flow.filterCapturesForTransfer(stored, wantsListIds || [], NOW));
    assert.deepEqual(fromHost.sellers.map((entry) => entry.sellerName), filtered.sellers.map((entry) => entry.sellerName), `ids ${wantsListIds}`);
    assert.deepEqual(fromHost.excluded, filtered.excluded);
    assert.equal(fromHost.fallback, filtered.fallback);
    const fromBackground = plain(await askBackground({ type: "CARTFORGE_V3_GET_CANDIDATES", wantsListIds }));
    assert.deepEqual(plain(fromHost), fromBackground, `Same response as the background for ids ${wantsListIds}.`);
  }
  const sameList = plain(await extension.getCandidates({ wantsListIds: ["111"] }));
  assert.deepEqual(sameList.sellers.map((entry) => [entry.sellerName, entry.sellerCountry, entry.stale]), [["SameList", "Germany", false], ["NoCountry", "", false]]);
  assert.deepEqual(sameList.excluded, { stale: 1, otherWantsList: 2 });

  const empty = await createExtensionHost({ chrome: fakeChrome(), flow: Flow, now: () => NOW }).getCandidates({ wantsListIds: ["111"] });
  assert.deepEqual(plain(empty), { ok: true, sellers: [], excluded: { stale: 0, otherWantsList: 0 }, fallback: false });
  assert.equal((await createExtensionHost({ chrome, flow: null }).getCandidates({})).ok, false, "Helpers missing → ok: false.");
}

// --- 4. Confirmed plan: same envelope and result as background.js.
{
  const plan = {
    schemaVersion: 2,
    optimizationSessionId: "session-1",
    cartFingerprint: "fp-1",
    sellers: [{ sellerName: "A" }],
    rows: [{ decision: "keep" }]
  };
  const hostChrome = fakeChrome();
  const backgroundChrome = fakeChrome();
  const extension = createExtensionHost({ chrome: hostChrome, flow: Flow, now: () => NOW });
  const askBackground = await loadBackground(backgroundChrome);

  const fromHost = await extension.storeConfirmedPlan(plan);
  const fromBackground = plain(await askBackground({ type: "CARTFORGE_V3_STORE_CONFIRMED_PLAN", plan }));
  assert.deepEqual(fromHost, fromBackground);
  assert.deepEqual(hostChrome.data[CONFIRMED_PLAN_KEY], backgroundChrome.data[CONFIRMED_PLAN_KEY]);
  assert.deepEqual(Object.keys(hostChrome.data[CONFIRMED_PLAN_KEY]), ["plan", "storedAt", "expiresAt"]);
  assert.equal(hostChrome.data[CONFIRMED_PLAN_KEY].expiresAt, new Date(NOW + 24 * 3600000).toISOString());

  // The background reads the host's envelope back (cart page overlay path).
  const readBack = plain(await (await loadBackground(hostChrome))({ type: "CARTFORGE_V3_GET_CONFIRMED_PLAN" }));
  assert.equal(readBack.ok, true);
  assert.deepEqual(readBack.plan, plan);

  for (const invalid of [null, { ...plan, schemaVersion: 3 }, { ...plan, optimizationSessionId: "" }, { ...plan, cartFingerprint: 7 }, { ...plan, rows: null }]) {
    const hostResult = await createExtensionHost({ chrome: fakeChrome(), flow: Flow, now: () => NOW }).storeConfirmedPlan(invalid);
    const backgroundResult = plain(await (await loadBackground(fakeChrome()))({ type: "CARTFORGE_V3_STORE_CONFIRMED_PLAN", plan: invalid }));
    assert.equal(hostResult.ok, false);
    assert.deepEqual(hostResult, backgroundResult, "Same validation errors as the background.");
  }
}

// --- 5. onCandidatesChanged fires on a storage change (once per burst of writes).
{
  const chrome = fakeChrome();
  const extension = createExtensionHost({ chrome, flow: Flow, now: () => NOW });
  let calls = 0;
  const stop = extension.onCandidatesChanged(() => { calls += 1; }, 5);
  await chrome.storage.local.set({ unrelatedKey: 1 });
  await tick(20);
  assert.equal(calls, 0, "Other keys are ignored.");
  await chrome.storage.local.set({ [CANDIDATES_KEY]: { a: {} } });
  await chrome.storage.local.set({ [CANDIDATES_KEY]: { a: {}, b: {} } });
  await tick(20);
  assert.equal(calls, 1, "Two quick writes → one refresh.");
  await chrome.storage.local.remove(CANDIDATES_KEY);
  await tick(20);
  assert.equal(calls, 2, "Clearing captures also refreshes.");
  stop();
  await chrome.storage.local.set({ [CANDIDATES_KEY]: {} });
  await tick(20);
  assert.equal(calls, 2, "Unsubscribed.");

  // Web host: visibilitychange, as before.
  const doc = new EventTarget();
  doc.visibilityState = "hidden";
  let webCalls = 0;
  createWebHost({ window: null, document: doc }).onCandidatesChanged(() => { webCalls += 1; });
  doc.dispatchEvent(new Event("visibilitychange"));
  doc.visibilityState = "visible";
  doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(webCalls, 1, "Only when the tab becomes visible.");
}

console.log(JSON.stringify({ host: "ok" }));
