#!/usr/bin/env node
// Anonymizes a CARTFORGE_CART= payload so a real cart can be committed as a test fixture.
//
//   node scripts/anonymize-cart.mjs _private/real-cart.txt tests/fixtures/real-cart.txt
//
// - Sellers become Seller01, Seller02, … in order; every seller name is removed from
//   rawText and rawLine (case-insensitive).
// - Identifying fields are dropped: sellerProfileUrl, sellerId, shipmentId, articleId, productUrl.
// - Free-text seller comments in clean (multi-line) rawLines become "<comment>", also where
//   that row appears inside rawText. Flattened rows ("1xFecundityFecundity#145EX00150,39 €1")
//   stay byte-identical: they are the regression case for duplicate-row handling.
// - Everything else, including the full shipping dropdown strings, is kept.
import { readFile, writeFile } from "node:fs/promises";

const PREFIX = "CARTFORGE_CART=";
const DROPPED_FIELDS = ["sellerProfileUrl", "sellerId", "shipmentId", "articleId", "productUrl"];
const CONDITION_LINE = /^(MT|NM|EX|GD|LP|PL|PO)$/i;
const PRICE_LINE = /^[\d.]+,\d{2}\s*€/;

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/anonymize-cart.mjs <input> <output>");
  process.exit(1);
}

const text = await readFile(inputPath, "utf8");
const start = text.indexOf(PREFIX);
if (start < 0) {
  console.error(`No ${PREFIX} payload found in ${inputPath}`);
  process.exit(1);
}
const payload = JSON.parse(text.slice(start + PREFIX.length));

const aliases = payload.sellers.map((seller, index) => ({
  name: String(seller.sellerName || ""),
  alias: `Seller${String(index + 1).padStart(2, "0")}`
}));
// Longest names first so a name that contains another is replaced whole.
const byLength = [...aliases].filter(({ name }) => name).sort((a, b) => b.name.length - a.name.length);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const replaceNames = (value) => byLength.reduce(
  (result, { name, alias }) => result.replace(new RegExp(escapeRegExp(name), "gi"), alias),
  String(value ?? "")
);

const isFlattened = (rawLine) => !String(rawLine).includes("\n") && /^\d+x\S/i.test(String(rawLine));

function stripComment(rawLine) {
  const lines = String(rawLine).split("\n");
  const conditionIndex = lines.findIndex((line, index) => index > 0 && CONDITION_LINE.test(line.trim()));
  const from = conditionIndex >= 0 ? conditionIndex + 1 : 1;
  const priceIndex = lines.findIndex((line, index) => index >= from && PRICE_LINE.test(line.trim()));
  if (priceIndex <= from) {
    return rawLine;
  }
  return [...lines.slice(0, from), "<comment>", ...lines.slice(priceIndex)].join("\n");
}

function dropFields(object) {
  const copy = { ...object };
  DROPPED_FIELDS.forEach((field) => delete copy[field]);
  return copy;
}

payload.sellers = payload.sellers.map((seller, index) => {
  let rawText = String(seller.rawText || "");
  const items = (seller.items || []).map((item) => {
    if (isFlattened(item.rawLine)) {
      return dropFields(item);
    }
    const anonymizedLine = stripComment(item.rawLine);
    if (anonymizedLine !== item.rawLine) {
      rawText = rawText.split(item.rawLine).join(anonymizedLine);
    }
    return dropFields({ ...item, rawLine: replaceNames(anonymizedLine) });
  });
  return dropFields({
    ...seller,
    sellerName: aliases[index].alias,
    rawText: replaceNames(rawText),
    items
  });
});

await writeFile(outputPath, `${PREFIX}${JSON.stringify(payload, null, 2)}\n`);

const output = await readFile(outputPath, "utf8");
const leaks = aliases.filter(({ name }) => name && output.toLowerCase().includes(name.toLowerCase()));
console.log(`Wrote ${outputPath}: ${payload.sellers.length} sellers.`);
if (leaks.length) {
  console.error(`Seller names still present: ${leaks.map(({ alias }) => alias).join(", ")}`);
  process.exit(1);
}
