import { readFile } from "node:fs/promises";
import { parseCart } from "../src/parser.mjs";

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

const samplePath = new URL("../sample-cart-mobile.txt", import.meta.url);
const shippingPath = new URL("../shipping_data.json", import.meta.url);
let sample = "";

try {
  sample = await readFile(samplePath, "utf8");
} catch {
  console.log("sample-cart-mobile.txt not found; skipping repository fixture smoke test.");
  process.exit(0);
}

const shippingData = await readOptionalJson(shippingPath);
const parsed = parseCart(sample, shippingData);

console.log(JSON.stringify({
  sellers: parsed.sellerCount,
  items: parsed.itemCount,
  shippingDataLoaded: parsed.shippingIndex.loaded,
  warnings: parsed.warnings
}, null, 2));

if (parsed.sellerCount === 0) {
  throw new Error("Expected at least one seller block.");
}

if (parsed.itemCount === 0) {
  throw new Error("Expected at least one item row.");
}
