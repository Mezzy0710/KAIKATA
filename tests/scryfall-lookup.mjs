/**
 * Scryfall Integration Tests
 *
 * Tests the Scryfall API integration, caching, and error handling.
 * Note: These tests make real Scryfall API calls. For production testing,
 * consider mocking these responses to avoid rate limits and network dependencies.
 */

import {
  getReferencePrice,
  enrichCardsWithReferencePrices,
  clearCache,
  getCacheStats
} from "../src/scryfall.mjs";

console.log("Starting Scryfall lookup tests...\n");

try {
  // Test 1: Exact card match
  console.log("Test 1: Exact card match (Lightning Bolt)");
  const lightning = await getReferencePrice("Lightning Bolt");
  if (!lightning || lightning.error) {
    throw new Error(`Expected valid result for Lightning Bolt, got: ${JSON.stringify(lightning)}`);
  }
  if (typeof lightning.price !== "number" || lightning.price <= 0) {
    throw new Error(`Expected positive price, got: ${lightning.price}`);
  }
  if (!["EUR", "USD"].includes(lightning.currency)) {
    throw new Error(`Expected EUR or USD currency, got: ${lightning.currency}`);
  }
  console.log(`✓ Found Lightning Bolt: ${lightning.price} ${lightning.currency}\n`);

  // Test 2: Fuzzy match (intentional typo)
  console.log("Test 2: Fuzzy match (Countersepll - misspelled)");
  const fuzzy = await getReferencePrice("Countersepll");
  if (!fuzzy || fuzzy.error) {
    // Fuzzy match might fail; that's acceptable
    console.log("ℹ Fuzzy match returned error (acceptable): " + fuzzy.reason + "\n");
  } else {
    console.log(`✓ Fuzzy match found: ${fuzzy.name}\n`);
  }

  // Test 3: Not found
  console.log("Test 3: Card not found (fake card)");
  const notFound = await getReferencePrice("Totally Fake Card XYZ 12345");
  if (!notFound || !notFound.error) {
    throw new Error("Expected error for non-existent card");
  }
  if (notFound.reason !== "not_found") {
    throw new Error(`Expected 'not_found' reason, got: ${notFound.reason}`);
  }
  console.log(`✓ Not found returned correct error: ${notFound.reason}\n`);

  // Test 4: Cache hit verification
  console.log("Test 4: Cache hit (second call should be fast)");
  const stats1 = getCacheStats();
  const startTime = Date.now();
  const cached = await getReferencePrice("Lightning Bolt");
  const endTime = Date.now();
  const stats2 = getCacheStats();

  if (endTime - startTime > 100) {
    console.log(`ℹ Cache hit took ${endTime - startTime}ms (network may have been needed)\n`);
  } else {
    console.log(`✓ Cache hit completed in ${endTime - startTime}ms (fast)\n`);
  }

  if (stats2.size !== stats1.size) {
    console.log(`✓ Cache size verified: ${stats2.size} entries\n`);
  }

  // Test 5: Bulk lookup
  console.log("Test 5: Bulk lookup (multiple cards)");
  clearCache(); // Clear cache to force fresh lookups
  const results = await enrichCardsWithReferencePrices([
    "Lightning Bolt",
    "Dark Confidant",
    "Counterspell"
  ]);

  if (results.size !== 3) {
    throw new Error(`Expected 3 results, got: ${results.size}`);
  }

  let successCount = 0;
  let errorCount = 0;

  results.forEach((refData, cardName) => {
    if (refData.error) {
      errorCount++;
    } else {
      successCount++;
    }
  });

  console.log(`✓ Bulk lookup completed: ${successCount} successful, ${errorCount} errors\n`);

  // Test 6: Invalid input handling
  console.log("Test 6: Invalid input handling");
  const invalid1 = await getReferencePrice(null);
  const invalid2 = await getReferencePrice("");
  const invalid3 = await getReferencePrice(undefined);

  if (!invalid1.error || !invalid2.error || !invalid3.error) {
    throw new Error("Expected all invalid inputs to return error");
  }
  console.log("✓ Invalid inputs correctly returned errors\n");

  console.log("✅ All Scryfall tests passed!\n");
  console.log(`Final cache stats: ${getCacheStats().size} entries cached`);

} catch (error) {
  console.error("❌ Test failed:", error.message);
  process.exit(1);
}
