import { useState, useCallback } from 'react'

interface FailureInfo {
  test_id: number
  start_time: string
  failure_description?: string
}

interface TestData {
  test_id: number
  inv_id: number
  serial_number: string
  firmware_version: string
  start_time: string
  end_time: string
  overall_status: string
  failure_description?: string
  data_points: any[]  // eslint-disable-line @typescript-eslint/no-explicit-any
  navigation: {
    previous_failed_test?: FailureInfo
    next_failed_test?: FailureInfo
    current_failure_index?: number
    total_failed_tests: number
  }
}

interface PrefetchCache {
  previousTest?: TestData
  nextTest?: TestData
}

export const usePrefetchedTests = () => {
  const [cache, setCache] = useState<PrefetchCache>({})

  const prefetchTest = useCallback(async (testId: number, type: 'previous' | 'next') => {
    try {
      const response = await fetch(`/api/test/${testId}`)
      if (!response.ok) {
        console.warn(`Failed to prefetch test ${testId}:`, response.statusText)
        return
      }
      
      const testData: TestData = await response.json()
      
      setCache(prev => ({
        ...prev,
        [type === 'previous' ? 'previousTest' : 'nextTest']: testData
      }))
      
      console.log(`✅ Prefetched ${type} test ${testId}`)
    } catch (error) {
      console.warn(`Error prefetching test ${testId}:`, error)
    }
  }, [])

  const prefetchAdjacentTests = useCallback((navigation: TestData['navigation']) => {
    // Clear existing cache first
    setCache({})
    
    // Prefetch in background with small delay to avoid blocking UI
    setTimeout(() => {
      if (navigation.previous_failed_test) {
        prefetchTest(navigation.previous_failed_test.test_id, 'previous')
      }
      if (navigation.next_failed_test) {
        prefetchTest(navigation.next_failed_test.test_id, 'next')
      }
    }, 100)
  }, [prefetchTest])

  const getCachedTest = useCallback((testId: number): TestData | null => {
    if (cache.previousTest?.test_id === testId) {
      console.log(`🚀 Using cached previous test ${testId}`)
      return cache.previousTest
    }
    if (cache.nextTest?.test_id === testId) {
      console.log(`🚀 Using cached next test ${testId}`)
      return cache.nextTest
    }
    return null
  }, [cache])

  const clearCache = useCallback(() => {
    setCache({})
  }, [])

  return {
    prefetchAdjacentTests,
    getCachedTest,
    clearCache,
    hasCachedTest: useCallback((testId: number) => {
      return cache.previousTest?.test_id === testId || cache.nextTest?.test_id === testId
    }, [cache])
  }
}