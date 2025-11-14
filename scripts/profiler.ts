/**
 * Simple profiler for tracking operation timing and performance
 */

export interface ProfileEntry {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

export class Profiler {
  private entries: Map<string, ProfileEntry[]> = new Map();
  private activeTimers: Map<string, number> = new Map();
  private globalStart: number;

  constructor() {
    this.globalStart = Date.now();
  }

  /**
   * Start timing an operation
   */
  start(name: string, metadata?: Record<string, any>): void {
    const startTime = Date.now();
    this.activeTimers.set(name, startTime);

    if (!this.entries.has(name)) {
      this.entries.set(name, []);
    }

    this.entries.get(name)!.push({
      name,
      startTime,
      metadata
    });
  }

  /**
   * Stop timing an operation
   */
  stop(name: string): number | null {
    const endTime = Date.now();
    const startTime = this.activeTimers.get(name);

    if (!startTime) {
      console.warn(`Profiler: No active timer found for "${name}"`);
      return null;
    }

    this.activeTimers.delete(name);
    const duration = endTime - startTime;

    // Update the most recent entry for this operation
    const entries = this.entries.get(name);
    if (entries && entries.length > 0) {
      const lastEntry = entries[entries.length - 1];
      lastEntry.endTime = endTime;
      lastEntry.duration = duration;
    }

    return duration;
  }

  /**
   * Time an async operation
   */
  async time<T>(name: string, fn: () => Promise<T>, metadata?: Record<string, any>): Promise<T> {
    this.start(name, metadata);
    try {
      const result = await fn();
      this.stop(name);
      return result;
    } catch (error) {
      this.stop(name);
      throw error;
    }
  }

  /**
   * Time a synchronous operation
   */
  timeSync<T>(name: string, fn: () => T, metadata?: Record<string, any>): T {
    this.start(name, metadata);
    try {
      const result = fn();
      this.stop(name);
      return result;
    } catch (error) {
      this.stop(name);
      throw error;
    }
  }

  /**
   * Get statistics for an operation
   */
  getStats(name: string): {
    count: number;
    totalDuration: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
  } | null {
    const entries = this.entries.get(name);
    if (!entries || entries.length === 0) {
      return null;
    }

    const durations = entries.filter(e => e.duration !== undefined).map(e => e.duration!);
    if (durations.length === 0) {
      return null;
    }

    const totalDuration = durations.reduce((sum, d) => sum + d, 0);

    return {
      count: durations.length,
      totalDuration,
      avgDuration: totalDuration / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations)
    };
  }

  /**
   * Get all entries for an operation
   */
  getEntries(name: string): ProfileEntry[] {
    return this.entries.get(name) || [];
  }

  /**
   * Get all operation names
   */
  getOperationNames(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms.toFixed(0)}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(2)}s`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = ((ms % 60000) / 1000).toFixed(0);
      return `${minutes}m ${seconds}s`;
    }
  }

  /**
   * Print a summary report
   */
  printSummary(): void {
    const totalTime = Date.now() - this.globalStart;

    console.log('\n' + '='.repeat(80));
    console.log('⏱️  PERFORMANCE PROFILE SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total execution time: ${this.formatDuration(totalTime)}`);
    console.log('');

    const operations = this.getOperationNames();
    const statsWithPercentage = operations
      .map(name => {
        const stats = this.getStats(name);
        if (!stats) return null;
        return {
          name,
          stats,
          percentage: (stats.totalDuration / totalTime) * 100
        };
      })
      .filter(Boolean)
      .sort((a, b) => b!.stats.totalDuration - a!.stats.totalDuration);

    console.log('Top Operations by Total Time:');
    console.log('-'.repeat(80));

    for (const item of statsWithPercentage) {
      if (!item) continue;
      const { name, stats, percentage } = item;

      console.log(`\n📊 ${name}`);
      console.log(`   Total:   ${this.formatDuration(stats.totalDuration)} (${percentage.toFixed(1)}% of total)`);
      console.log(`   Count:   ${stats.count} operations`);
      console.log(`   Average: ${this.formatDuration(stats.avgDuration)}`);
      console.log(`   Min:     ${this.formatDuration(stats.minDuration)}`);
      console.log(`   Max:     ${this.formatDuration(stats.maxDuration)}`);
    }

    console.log('\n' + '='.repeat(80));
  }

  /**
   * Print detailed report for a specific operation
   */
  printOperationDetails(name: string): void {
    const entries = this.getEntries(name);
    const stats = this.getStats(name);

    if (!entries || entries.length === 0) {
      console.log(`No entries found for operation: ${name}`);
      return;
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📋 Detailed Report: ${name}`);
    console.log('='.repeat(80));

    if (stats) {
      console.log(`Count: ${stats.count}, Total: ${this.formatDuration(stats.totalDuration)}, Avg: ${this.formatDuration(stats.avgDuration)}`);
      console.log('-'.repeat(80));
    }

    console.log('Individual operations:');
    entries.forEach((entry, idx) => {
      const duration = entry.duration !== undefined ? this.formatDuration(entry.duration) : 'in progress';
      const metadata = entry.metadata ? ` - ${JSON.stringify(entry.metadata)}` : '';
      console.log(`  ${idx + 1}. ${duration}${metadata}`);
    });

    console.log('='.repeat(80));
  }

  /**
   * Reset all profiling data
   */
  reset(): void {
    this.entries.clear();
    this.activeTimers.clear();
    this.globalStart = Date.now();
  }
}

// Export class and singleton instance
export { Profiler };
export const profiler = new Profiler();
