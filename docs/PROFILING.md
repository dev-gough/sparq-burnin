# Performance Profiling Guide

## Ingestion Profiling

The ingestion process is automatically profiled. Results appear at the end of `npm run ingest` or `npm run reprocess`.

## API Endpoint Profiling

### Test Detail Page (`/api/test/[id]`)

**Instrumented operations:**
- `db_connect` - Database connection time
- `query_test_metadata` - Fetching test info (serial number, status, etc.)
- `query_test_data` - **THE BIG ONE** - Fetching all data points (can be 44k+ rows)
- `query_navigation` - Finding prev/next failed tests
- `build_response` - Serializing data to JSON
- `total_request` - End-to-end request time

**How to view:**
1. Start dev server: `npm run dev`
2. Load a test detail page in browser
3. Check terminal output for profile summary like:

```
[API /api/test/927] Performance Profile:
================================================================================
⏱️  PERFORMANCE PROFILE SUMMARY
================================================================================
Total execution time: 12.5s

Top Operations by Total Time:
--------------------------------------------------------------------------------

📊 query_test_data
   Total:   10.2s (81.6% of total)
   Count:   1 operations
   Average: 10.2s
   Min:     10.2s
   Max:     10.2s
   Metadata: {"test_id":927}
   
📊 build_response
   Total:   1.8s (14.4% of total)
   Count:   1 operations
   Average: 1.8s
   Min:     1.8s
   Max:     1.8s
   Metadata: {"data_points_count":44621}
...
```

## Known Bottlenecks

### Test Detail Page - Large Data Sets

**Problem:** Failed tests with 44k+ data points take 10-20s to load
- Query time: ~10s for 44k rows × 40 columns
- Network transfer: 50-100+ MB JSON payload
- Client parsing: Several seconds

**Potential Solutions:**
1. **Server-side decimation** - Reduce data points before sending (e.g., max 2000 points)
2. **Pagination** - Load data in chunks
3. **Lazy loading** - Initial load shows downsampled data, load full resolution on zoom
4. **Database index** - Add index on `test_id` in TestData table (if not exists)
5. **Response streaming** - Stream large responses instead of buffering
6. **Column selection** - Only fetch columns actually displayed

**Quick Win:** Add LIMIT clause for initial load:
```sql
-- Instead of fetching all 44k rows:
SELECT * FROM TestData WHERE test_id = $1 ORDER BY timestamp ASC

-- Fetch decimated/limited set:
SELECT * FROM TestData WHERE test_id = $1 
ORDER BY timestamp ASC
LIMIT 2000  -- Or use WHERE MOD(data_id, N) = 0 for decimation
```

## Database Indexes

Check if TestData has an index on test_id:
```sql
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'testdata';
```

If not, add one:
```sql
CREATE INDEX idx_testdata_test_id ON TestData(test_id);
```

