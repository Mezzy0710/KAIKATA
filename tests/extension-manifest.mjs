import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifestPath = new URL("../extension/manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const cartScript = manifest.content_scripts.find((entry) =>
  Array.isArray(entry.js) && entry.js.includes("content-script.js")
);
assert.ok(cartScript, "Manifest should register content-script.js for Cardmarket.");

const matches = cartScript.matches || [];
assert.ok(
  matches.some((pattern) => pattern.includes("*/*/ShoppingCart")),
  "Manifest must match nested cart URLs like /en/Magic/ShoppingCart (Chrome match patterns use one * per path segment)."
);

console.log(JSON.stringify({ extensionManifestCartMatches: matches.length }, null, 2));
