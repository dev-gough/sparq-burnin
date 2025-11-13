#!/usr/bin/env tsx

/**
 * Test script to verify profiler functionality
 */

import { profiler } from './profiler';

async function simulateWork(name: string, durationMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, durationMs));
}

async function testProfiler() {
  console.log('Testing profiler...\n');

  // Test 1: Basic timing
  profiler.start('test_operation');
  await simulateWork('test', 100);
  const duration = profiler.stop('test_operation');
  console.log(`✓ Basic timing: ${duration}ms\n`);

  // Test 2: Multiple operations
  for (let i = 0; i < 5; i++) {
    await profiler.time('repeated_operation', async () => {
      await simulateWork('repeated', 50 + Math.random() * 50);
    }, { iteration: i });
  }
  console.log('✓ Repeated operations: 5 times\n');

  // Test 3: Nested operations
  await profiler.time('outer_operation', async () => {
    await profiler.time('inner_operation_1', async () => {
      await simulateWork('inner1', 100);
    });
    await profiler.time('inner_operation_2', async () => {
      await simulateWork('inner2', 150);
    });
  });
  console.log('✓ Nested operations\n');

  // Test 4: Parallel operations (simulating multiple file processing)
  await Promise.all([
    profiler.time('parallel_task', async () => {
      await simulateWork('parallel1', 100);
    }, { task: 'A' }),
    profiler.time('parallel_task', async () => {
      await simulateWork('parallel2', 120);
    }, { task: 'B' }),
    profiler.time('parallel_task', async () => {
      await simulateWork('parallel3', 80);
    }, { task: 'C' })
  ]);
  console.log('✓ Parallel operations: 3 tasks\n');

  // Print summary
  profiler.printSummary();

  // Print detailed report for one operation
  console.log('\nDetailed report for repeated_operation:');
  profiler.printOperationDetails('repeated_operation');
}

testProfiler().catch(console.error);
