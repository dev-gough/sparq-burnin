#!/bin/bash

# Test script for batch prefetch endpoint

echo "🧪 Testing Batch Prefetch Endpoint"
echo "=================================="
echo ""

# Check if server is running
if ! curl -s http://localhost:3000 > /dev/null; then
    echo "❌ Server not running on localhost:3000"
    echo "   Start with: npm run dev"
    exit 1
fi

echo "✅ Server is running"
echo ""

echo "⚠️  NOTE: API endpoints require authentication"
echo "   This script won't work without a session cookie"
echo "   Use the browser test page instead:"
echo "   http://localhost:3000/test-batch-prefetch"
echo ""
echo "   Or check the server console for profiling output"
echo "   when navigating in the browser."
echo ""
exit 0

# Test 1: Single test
echo "Test 1: Single test (quick mode)"
echo "---------------------------------"
curl -s "http://localhost:3000/api/tests/batch?test_ids=927&mode=quick" | \
    jq '{test_count: (. | length), "927": ."927"._metadata}'
echo ""

# Test 2: Multiple tests
echo "Test 2: Multiple tests (quick mode)"
echo "------------------------------------"
curl -s "http://localhost:3000/api/tests/batch?test_ids=927,928,929&mode=quick" | \
    jq '{
        test_count: (. | length),
        tests: (. | to_entries | map({
            id: .key,
            points: .value._metadata.returned_points,
            total: .value._metadata.total_points,
            decimated: .value._metadata.decimated
        }))
    }'
echo ""

# Test 3: Full mode
echo "Test 3: Full mode (all data)"
echo "----------------------------"
curl -s "http://localhost:3000/api/tests/batch?test_ids=927&mode=full" | \
    jq '{
        test_id: ."927".test_id,
        metadata: ."927"._metadata
    }'
echo ""

# Test 4: Timing comparison
echo "Test 4: Performance Comparison"
echo "-------------------------------"
echo -n "Quick mode (3 tests): "
time curl -s "http://localhost:3000/api/tests/batch?test_ids=927,928,929&mode=quick" > /dev/null 2>&1
echo ""
echo -n "Individual requests (3 tests): "
time (
    curl -s "http://localhost:3000/api/test/927?mode=quick" > /dev/null &&
    curl -s "http://localhost:3000/api/test/928?mode=quick" > /dev/null &&
    curl -s "http://localhost:3000/api/test/929?mode=quick" > /dev/null
) 2>&1
echo ""

echo "✅ All tests complete!"
echo ""
echo "Check server console for profiling output"
