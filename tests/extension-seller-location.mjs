/**
 * Tests for the seller location extraction logic used in content-script.js.
 *
 * readCountry() must use targeted attribute selectors ([title^="Item location:"]
 * and [data-bs-original-title^="Item location:"]) so it does not accidentally
 * pick up unrelated tooltips (shipment, condition, rarity, expansion name, etc.)
 * that also live inside the same seller section.
 *
 * Bootstrap 5 tooltip initialisation moves the `title` attribute value to
 * `data-bs-original-title` and sets `title` to "". Both attributes must be
 * handled so extraction works regardless of when Bootstrap runs relative to
 * the extension content-script.
 *
 * Because readCountry is inside a browser IIFE, we test the logic directly with
 * a minimal DOM-like mock that faithfully reproduces querySelector behaviour.
 */

import assert from "node:assert/strict";

// ── Minimal DOM mock ──────────────────────────────────────────────────────────

function makeElement(attrs = {}) {
  return {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
  };
}

/**
 * Returns a section-like object whose querySelector implements the subset of
 * CSS attribute selectors used by readCountry: [attr^="prefix"].
 * querySelector returns null when no element matches (mirrors browser behaviour).
 */
function makeSection(elements) {
  return {
    querySelector(selector) {
      const m = selector.match(/\[(\w[\w-]*)\^="([^"]+)"\]/);
      if (m) {
        const [, attr, prefix] = m;
        return (
          elements.find((el) => {
            const v = el.getAttribute(attr);
            return v !== null && v.startsWith(prefix);
          }) ?? null
        );
      }
      return null;
    },
  };
}

// ── The function under test (mirrors content-script.js readCountry logic) ────
//
// Bootstrap 5 tooltip init consumes the `title` attribute, storing its value
// in `data-bs-original-title` and clearing `title` to "". Check both so
// extraction works regardless of when Bootstrap runs relative to the extension.

function readCountry(section) {
  const locationEl =
    section.querySelector('[title^="Item location:"]') ||
    section.querySelector('[data-bs-original-title^="Item location:"]');
  const rawTitle =
    locationEl?.getAttribute("title") ||
    locationEl?.getAttribute("data-bs-original-title");
  return rawTitle?.replace(/^Item location:\s*/i, "")?.trim() || null;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Positive: representative fixture from a real Cardmarket cart DOM.
// The section contains multiple unrelated title attributes; only the flag
// tooltip starts with "Item location:".
{
  const section = makeSection([
    makeElement({ title: "Shipments with this user" }),
    makeElement({ title: "Item location: Ireland" }),
    makeElement({ title: "Near Mint" }),
    makeElement({ title: "Mythic" }),
    makeElement({ title: "Standard" }),
    makeElement({ title: "Shadows over Innistrad" }),
  ]);
  assert.strictEqual(
    readCountry(section),
    "Ireland",
    "Should extract country name from 'Item location: Ireland'"
  );
}

// Positive: Croatia (regression target — BowmanTCG seller).
{
  const section = makeSection([
    makeElement({ title: "Shipments with this user" }),
    makeElement({ title: "Item location: Croatia" }),
    makeElement({ title: "Near Mint" }),
    makeElement({ title: "Rare" }),
    makeElement({ title: "Innistrad" }),
  ]);
  assert.strictEqual(
    readCountry(section),
    "Croatia",
    "Should extract 'Croatia' for BowmanTCG seller fixture"
  );
}

// Positive: Netherlands (regression target — averwegen seller).
{
  const section = makeSection([
    makeElement({ title: "Shipments with this user" }),
    makeElement({ title: "Item location: Netherlands" }),
    makeElement({ title: "Excellent" }),
    makeElement({ title: "Uncommon" }),
    makeElement({ title: "Modern" }),
  ]);
  assert.strictEqual(
    readCountry(section),
    "Netherlands",
    "Should extract 'Netherlands' for averwegen seller fixture"
  );
}

// Positive: Bootstrap 5 has already initialised the tooltip, moving `title` to
// `data-bs-original-title` and clearing `title` to "". The section contains
// multiple unrelated data-bs-original-title attributes too.
{
  const section = makeSection([
    makeElement({ "data-bs-original-title": "Shipments with this user", title: "" }),
    makeElement({ "data-bs-original-title": "Item location: Ireland", title: "" }),
    makeElement({ "data-bs-original-title": "Near Mint", title: "" }),
    makeElement({ "data-bs-original-title": "Mythic", title: "" }),
  ]);
  assert.strictEqual(
    readCountry(section),
    "Ireland",
    "Should read country from data-bs-original-title after Bootstrap tooltip init"
  );
}

// Positive: Bootstrap tooltip init, Croatia variant.
{
  const section = makeSection([
    makeElement({ "data-bs-original-title": "Shipments with this user", title: "" }),
    makeElement({ "data-bs-original-title": "Item location: Croatia", title: "" }),
    makeElement({ "data-bs-original-title": "Near Mint", title: "" }),
  ]);
  assert.strictEqual(
    readCountry(section),
    "Croatia",
    "Should read Croatia from data-bs-original-title"
  );
}

// Positive: Bootstrap tooltip init, Netherlands variant.
{
  const section = makeSection([
    makeElement({ "data-bs-original-title": "Item location: Netherlands", title: "" }),
    makeElement({ "data-bs-original-title": "Near Mint", title: "" }),
  ]);
  assert.strictEqual(
    readCountry(section),
    "Netherlands",
    "Should read Netherlands from data-bs-original-title"
  );
}

// Positive: extra whitespace in the title value must be trimmed.
{
  const section = makeSection([
    makeElement({ title: "Item location:  Germany " }),
  ]);
  assert.strictEqual(
    readCountry(section),
    "Germany",
    "Should trim extra whitespace around the country name"
  );
}

// Negative: section contains many title attributes but none starts with
// "Item location:". readCountry must return null, not a spurious match.
{
  const section = makeSection([
    makeElement({ title: "Shipments with this user" }),
    makeElement({ title: "Near Mint" }),
    makeElement({ title: "Rare" }),
    makeElement({ title: "Modern" }),
    makeElement({ title: "Mirrodin" }),
  ]);
  assert.strictEqual(
    readCountry(section),
    null,
    "Should return null when no 'Item location:' element exists in the section"
  );
}

// Negative: section has data-bs-original-title attributes but none starts with
// "Item location:".
{
  const section = makeSection([
    makeElement({ "data-bs-original-title": "Shipments with this user", title: "" }),
    makeElement({ "data-bs-original-title": "Near Mint", title: "" }),
    makeElement({ "data-bs-original-title": "Rare", title: "" }),
  ]);
  assert.strictEqual(
    readCountry(section),
    null,
    "Should return null when no 'Item location:' in data-bs-original-title either"
  );
}

// Negative: a tooltip that merely contains the word "location" but does not
// start with "Item location:" must not be matched.
{
  const section = makeSection([
    makeElement({ title: "Ship to location: Germany" }),
    makeElement({ title: "No location data" }),
  ]);
  assert.strictEqual(
    readCountry(section),
    null,
    "Should not match titles that contain 'location' but don't start with 'Item location:'"
  );
}

// Negative: unrelated Cardmarket tooltips must not produce a false match.
{
  const section = makeSection([
    makeElement({ title: "Search" }),
    makeElement({ title: "Expansion: Innistrad" }),
    makeElement({ title: "Rarity: Rare" }),
    makeElement({ title: "Condition: Near Mint" }),
  ]);
  assert.strictEqual(
    readCountry(section),
    null,
    "Should not match common unrelated Cardmarket tooltip titles"
  );
}

console.log(JSON.stringify({ sellerLocationTests: "all passed" }, null, 2));
