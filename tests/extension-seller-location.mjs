/**
 * Tests for the seller location extraction logic used in content-script.js.
 *
 * readCountry() must use a targeted '[title^="Item location:"]' selector so it
 * does not accidentally pick up unrelated tooltips (shipment, condition, rarity,
 * expansion name, etc.) that also live inside the same seller section.
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
 */
function makeSection(elements) {
  return {
    querySelector(selector) {
      const m = selector.match(/\[(\w+)\^="([^"]+)"\]/);
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

function readCountry(section) {
  const locationEl = section.querySelector('[title^="Item location:"]');
  const locationTitle = locationEl
    ?.getAttribute("title")
    ?.replace(/^Item location:\s*/i, "")
    ?.trim();
  return locationTitle || null;
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
// "Item location:".  readCountry must return null, not a spurious match.
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

console.log(JSON.stringify({ sellerLocationTests: "all passed" }, null, 2));
