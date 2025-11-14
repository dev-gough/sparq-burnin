'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface TestData {
  test_id: number;
  serial_number: string;
  overall_status: string;
  data_points?: Array<Record<string, unknown>>;
  _metadata?: {
    mode: string;
    total_points: number;
    returned_points: number;
    decimated: boolean;
    decimation_factor: number;
  };
}

export default function TestBatchPrefetch() {
  const [testIds, setTestIds] = useState('927,928,929');
  const [mode, setMode] = useState<'quick' | 'full'>('quick');
  const [results, setResults] = useState<Record<string, TestData> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timing, setTiming] = useState<number | null>(null);

  async function testBatchEndpoint() {
    setLoading(true);
    setError(null);
    setResults(null);
    setTiming(null);

    const startTime = performance.now();

    try {
      const response = await fetch(`/api/tests/batch?test_ids=${testIds}&mode=${mode}`);

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || 'Request failed');
        return;
      }

      const data = await response.json();
      const endTime = performance.now();

      setResults(data);
      setTiming(endTime - startTime);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function testIndividualRequests() {
    setLoading(true);
    setError(null);
    setResults(null);
    setTiming(null);

    const ids = testIds.split(',').map(id => id.trim());
    const startTime = performance.now();

    try {
      const promises = ids.map(id =>
        fetch(`/api/test/${id}?mode=${mode}`).then(r => r.json())
      );

      const dataArray = await Promise.all(promises);
      const endTime = performance.now();

      // Convert array to object keyed by test_id
      const data: Record<string, TestData> = {};
      dataArray.forEach(test => {
        data[test.test_id] = test;
      });

      setResults(data);
      setTiming(endTime - startTime);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  const testCount = results ? Object.keys(results).length : 0;
  const totalDataPoints = results
    ? Object.values(results).reduce((sum: number, test: TestData) =>
        sum + (test.data_points?.length || 0), 0)
    : 0;

  return (
    <div className="container mx-auto p-8 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle>Batch Prefetch Endpoint Test</CardTitle>
          <CardDescription>
            Test the batch endpoint performance vs individual requests
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Input Controls */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Test IDs (comma-separated)
              </label>
              <Input
                value={testIds}
                onChange={(e) => setTestIds(e.target.value)}
                placeholder="927,928,929"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Mode</label>
              <div className="flex gap-2">
                <Button
                  variant={mode === 'quick' ? 'default' : 'outline'}
                  onClick={() => setMode('quick')}
                >
                  Quick (Decimated)
                </Button>
                <Button
                  variant={mode === 'full' ? 'default' : 'outline'}
                  onClick={() => setMode('full')}
                >
                  Full (All Data)
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={testBatchEndpoint}
                disabled={loading}
                className="flex-1"
              >
                {loading ? 'Testing...' : 'Test Batch Endpoint'}
              </Button>
              <Button
                onClick={testIndividualRequests}
                disabled={loading}
                variant="outline"
                className="flex-1"
              >
                {loading ? 'Testing...' : 'Test Individual Requests'}
              </Button>
            </div>
          </div>

          {/* Results */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700">
              <strong>Error:</strong> {error}
            </div>
          )}

          {timing && (
            <div className="p-4 bg-green-50 border border-green-200 rounded">
              <div className="text-2xl font-bold text-green-700">
                {timing.toFixed(0)}ms
              </div>
              <div className="text-sm text-green-600">
                {testCount} tests loaded, {totalDataPoints.toLocaleString()} data points
              </div>
            </div>
          )}

          {results && (
            <div className="space-y-4">
              <h3 className="font-semibold">Results:</h3>
              <div className="space-y-2">
                {Object.entries(results).map(([testId, test]: [string, TestData]) => (
                  <div key={testId} className="p-3 bg-gray-50 rounded border">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium">Test {testId}</div>
                        <div className="text-sm text-gray-600">
                          {test.serial_number} - {test.overall_status}
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <div>
                          {test._metadata?.returned_points?.toLocaleString() || test.data_points?.length} points
                        </div>
                        {test._metadata?.decimated && (
                          <div className="text-xs text-gray-500">
                            (of {test._metadata.total_points.toLocaleString()} total)
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="text-xs text-gray-500 mt-4">
                Check the server console for detailed profiling information
              </div>
            </div>
          )}

          {/* Instructions */}
          <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded">
            <h4 className="font-semibold text-blue-900 mb-2">How to use:</h4>
            <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
              <li>Enter test IDs (find failed tests from dashboard)</li>
              <li>Choose mode (quick = ~1000 points, full = all points)</li>
              <li>Click &quot;Test Batch Endpoint&quot; to fetch all at once</li>
              <li>Click &quot;Test Individual Requests&quot; to compare performance</li>
              <li>Check server console for detailed profiling</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
