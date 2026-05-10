#!/bin/bash

# Cardmarket Cart Optimizer - Automated Test Runner
# Runs all tests and provides a summary report

set -e

TESTS_DIR="$(dirname "$0")"
PROJECT_ROOT="$(cd "$TESTS_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test tracking
PASSED=0
FAILED=0
SKIPPED=0
TOTAL=0

# Test files to run
TEST_FILES=(
  "tests/correctness-optimizer.mjs"
  "tests/correctness-parser.mjs"
  "tests/correctness-shipping.mjs"
  "tests/correctness-ui-warning-copy.mjs"
  "tests/parser-mobile-country-aliases.mjs"
  "tests/parser-mobile-inference.mjs"
  "tests/parser-mobile-overview-seller-names.mjs"
  "tests/parser-seller-name-mapping.mjs"
  "tests/parser-smoke.mjs"
  "tests/price-verdict.mjs"
  "tests/scryfall-lookup.mjs"
  "tests/shipping-costs.mjs"
)

# Performance test (optional, can be slow)
PERF_TEST="tests/performance-large-scale.mjs"

run_with_timeout() {
  local timeout_seconds="$1"
  shift

  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_seconds" "$@"
    return $?
  fi

  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$timeout_seconds" "$@"
    return $?
  fi

  perl -e 'alarm shift @ARGV; exec @ARGV' "$timeout_seconds" "$@"
}

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║     Cardmarket Cart Optimizer - Test Suite                     ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Run core tests
echo "📋 Running core tests..."
echo "────────────────────────────────────────────────────────────────"

for test_file in "${TEST_FILES[@]}"; do
  TOTAL=$((TOTAL + 1))
  test_name=$(basename "$test_file")

  if run_with_timeout 15 node "$test_file" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} $test_name"
    PASSED=$((PASSED + 1))
  else
    echo -e "${RED}✗${NC} $test_name"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "────────────────────────────────────────────────────────────────"

# Optional performance test
if [ "$1" = "--perf" ] || [ "$1" = "-p" ]; then
  echo ""
  echo "📊 Running performance test..."
  echo "────────────────────────────────────────────────────────────────"
  if run_with_timeout 30 node "$PERF_TEST" > /tmp/perf_test.log 2>&1; then
    echo -e "${GREEN}✓${NC} $(basename "$PERF_TEST")"
    PASSED=$((PASSED + 1))
    TOTAL=$((TOTAL + 1))
    cat /tmp/perf_test.log
  else
    echo -e "${RED}✗${NC} $(basename "$PERF_TEST")"
    FAILED=$((FAILED + 1))
    TOTAL=$((TOTAL + 1))
    cat /tmp/perf_test.log
  fi
  echo "────────────────────────────────────────────────────────────────"
fi

# Summary
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                         TEST SUMMARY                           ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
  echo "   Passed:  $PASSED"
  echo "   Failed:  0"
  echo "   Total:   $TOTAL"
  echo ""
  echo "Run with --perf or -p flag to include performance tests:"
  echo "  ./tests/run-all.sh --perf"
  echo ""
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  echo "   Passed:  $PASSED"
  echo "   Failed:  $FAILED"
  echo "   Total:   $TOTAL"
  echo ""
  exit 1
fi
