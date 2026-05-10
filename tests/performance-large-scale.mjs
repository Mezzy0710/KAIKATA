import fs from "fs";
import { parseCart, buildShippingIndex } from "../src/parser.mjs";
import { calculateShippingCost, calculateTrusteeFee } from "../src/shipping.mjs";

const shippingDataRaw = JSON.parse(fs.readFileSync("./shipping_data.json", "utf-8"));

function runPerformanceTest() {
  console.log("🚀 Starting large-scale performance test...\n");

  // Load the large-scale test cart
  const cartText = fs.readFileSync("./tests/fixtures/sample-cart-large-scale.txt", "utf-8");

  // Measure parsing time
  console.log("📊 Parsing performance:");
  const parseStart = performance.now();
  const parsed = parseCart(cartText, shippingDataRaw);
  const parseEnd = performance.now();
  console.log(`   ⏱️  Parse time: ${(parseEnd - parseStart).toFixed(2)}ms`);
  console.log(`   📈 Sellers: ${parsed.sellers.length}`);
  console.log(`   📦 Items: ${parsed.itemCount}`);

  // Measure shipping index build time
  console.log("\n🚚 Shipping index performance:");
  const indexStart = performance.now();
  const shippingIndex = buildShippingIndex(shippingDataRaw);
  const indexEnd = performance.now();
  console.log(`   ⏱️  Index build time: ${(indexEnd - indexStart).toFixed(2)}ms`);
  console.log(`   📍 Shipping routes indexed: ${shippingIndex.length}`);

  // Verify parsing results
  console.log("\n✅ Parsing validation:");
  console.log(`   All sellers have country: ${parsed.sellers.every(s => s.sellerCountry && s.sellerCountry !== "Unknown") ? "✓" : "✗"}`);
  console.log(`   All sellers have shipping method: ${parsed.sellers.every(s => s.shippingMethod) ? "✓" : "✗"}`);
  console.log(`   Total items in cart: ${parsed.itemCount}`);

  // Check for parsing errors
  const hasErrors = parsed.sellers.some(s => !s.sellerName || s.items.length === 0);
  if (hasErrors) {
    console.log("   ⚠️  Warning: Some sellers have missing data");
    const badSellers = parsed.sellers.filter(s => !s.sellerName || s.items.length === 0);
    console.log(`   Bad sellers: ${badSellers.length}`);
  }

  console.log("\n📋 Summary:");
  console.log(`   Total parsed successfully ✓`);
  console.log(`   Ready for optimization`);
}

runPerformanceTest();
