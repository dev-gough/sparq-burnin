'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface DataPoint {
  timestamp: string;
  vgrid?: number;
  pgrid?: number;
  qgrid?: number;
  vpv1?: number;
  ppv1?: number;
  vpv2?: number;
  ppv2?: number;
  vpv3?: number;
  ppv3?: number;
  vpv4?: number;
  ppv4?: number;
  frequency?: number;
  vbus?: number;
  extstatus?: number;
  status?: number;
  temperature?: number;
  epv1?: number;
  epv2?: number;
  epv3?: number;
  epv4?: number;
  activeenergy?: number;
  reactiveenergy?: number;
  extstatus_latch?: string;
  status_latch?: string;
  vgrid_inst_latch?: number;
  vntrl_inst_latch?: number;
  igrid_inst_latch?: number;
  vbus_inst_latch?: number;
  vpv1_inst_latch?: number;
  ipv1_inst_latch?: number;
  vpv2_inst_latch?: number;
  ipv2_inst_latch?: number;
  vpv3_inst_latch?: number;
  ipv3_inst_latch?: number;
  vpv4_inst_latch?: number;
  ipv4_inst_latch?: number;
  status_bits?: string;
}

interface TestData {
  test_id: number;
  inv_id: number;
  serial_number: string;
  firmware_version: string;
  start_time: string;
  end_time: string;
  overall_status: string;
  failure_description?: string;
  data_points: DataPoint[];
  _metadata?: {
    mode: string;
    total_points: number;
    returned_points: number;
    decimated: boolean;
    decimation_factor: number;
  };
}

interface TestDataCacheContextType {
  cache: Map<number, TestData>;
  getTest: (testId: number) => TestData | null;
  setTest: (testId: number, data: TestData) => void;
  prefetchTests: (testIds: number[]) => Promise<void>;
  clearCache: () => void;
  isPrefetching: boolean;
}

const TestDataCacheContext = createContext<TestDataCacheContextType | null>(null);

export function TestDataCacheProvider({ children }: { children: ReactNode }) {
  const [cache, setCache] = useState<Map<number, TestData>>(new Map());
  const [isPrefetching, setIsPrefetching] = useState(false);

  const getTest = useCallback((testId: number): TestData | null => {
    return cache.get(testId) || null;
  }, [cache]);

  const setTest = useCallback((testId: number, data: TestData) => {
    setCache(prev => {
      const newCache = new Map(prev);
      newCache.set(testId, data);
      return newCache;
    });
  }, []);

  const prefetchTests = useCallback(async (testIds: number[]) => {
    if (testIds.length === 0) return;

    // Filter out already cached tests
    const uncachedIds = testIds.filter(id => !cache.has(id));

    if (uncachedIds.length === 0) {
      console.log('All tests already cached');
      return;
    }

    setIsPrefetching(true);

    try {
      console.log(`Prefetching ${uncachedIds.length} tests:`, uncachedIds);

      // Batch fetch in chunks of 20 to avoid overly large requests
      const chunkSize = 20;
      for (let i = 0; i < uncachedIds.length; i += chunkSize) {
        const chunk = uncachedIds.slice(i, i + chunkSize);

        const response = await fetch(
          `/api/tests/batch?test_ids=${chunk.join(',')}&mode=quick`
        );

        if (!response.ok) {
          throw new Error(`Batch fetch failed: ${response.statusText}`);
        }

        const data = await response.json();

        // Add to cache
        setCache(prev => {
          const newCache = new Map(prev);
          Object.entries(data).forEach(([id, testData]) => {
            newCache.set(parseInt(id), testData as TestData);
          });
          return newCache;
        });

        console.log(`Cached ${chunk.length} tests (chunk ${Math.floor(i / chunkSize) + 1})`);
      }

      console.log(`✅ Prefetch complete: ${uncachedIds.length} tests cached`);
    } catch (error) {
      console.error('Prefetch failed:', error);
    } finally {
      setIsPrefetching(false);
    }
  }, [cache]);

  const clearCache = useCallback(() => {
    setCache(new Map());
    console.log('Cache cleared');
  }, []);

  return (
    <TestDataCacheContext.Provider
      value={{
        cache,
        getTest,
        setTest,
        prefetchTests,
        clearCache,
        isPrefetching
      }}
    >
      {children}
    </TestDataCacheContext.Provider>
  );
}

export function useTestDataCache() {
  const context = useContext(TestDataCacheContext);
  if (!context) {
    throw new Error('useTestDataCache must be used within TestDataCacheProvider');
  }
  return context;
}
