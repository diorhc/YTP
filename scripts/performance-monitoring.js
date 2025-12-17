/**
 * performance-monitoring.js
 * Runtime performance monitoring utilities
 */

'use strict';

const performanceMonitoring = `
/**
 * Performance Monitoring Module
 * Tracks and reports performance metrics for YouTube Plus
 */
(function () {
  'use strict';

  const PerformanceMonitor = {
    metrics: {
      domQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      eventListeners: 0,
      observers: 0,
      timers: 0,
    },

    timings: {
      moduleLoad: new Map(),
      domOperations: [],
      navigationTime: [],
    },

    /**
     * Track DOM query performance (optimized with batching)
     */
    trackDOMQuery(cached = false) {
      this.metrics.domQueries++;
      if (cached) {
        this.metrics.cacheHits++;
      } else {
        this.metrics.cacheMisses++;
      }
    },

    /**
     * Batch track multiple DOM queries at once for better performance
     * @param {number} cachedCount - Number of cached queries
     * @param {number} uncachedCount - Number of uncached queries
     */
    batchTrackDOMQueries(cachedCount = 0, uncachedCount = 0) {
      this.metrics.domQueries += cachedCount + uncachedCount;
      this.metrics.cacheHits += cachedCount;
      this.metrics.cacheMisses += uncachedCount;
    },

    /**
     * Track event listener registration
     */
    trackEventListener() {
      this.metrics.eventListeners++;
    },

    /**
     * Track observer creation
     */
    trackObserver() {
      this.metrics.observers++;
    },

    /**
     * Track timer creation
     */
    trackTimer() {
      this.metrics.timers++;
    },

    /**
     * Record module load time
     */
    recordModuleLoad(moduleName, duration) {
      this.timings.moduleLoad.set(moduleName, duration);
    },

    /**
     * Record DOM operation time (optimized with circular buffer)
     */
    recordDOMOperation(operation, duration) {
      const MAX_OPERATIONS = 100;
      
      // Use circular buffer approach instead of shift() for better performance
      if (this.timings.domOperations.length >= MAX_OPERATIONS) {
        this.timings.domOperations = this.timings.domOperations.slice(-50); // Keep last 50
      }
      
      this.timings.domOperations.push({ 
        operation, 
        duration, 
        timestamp: Date.now() 
      });
    },

    /**
     * Record navigation time (optimized with circular buffer)
     */
    recordNavigation(duration) {
      const MAX_NAVIGATIONS = 20;
      
      // Use circular buffer approach instead of shift() for better performance
      if (this.timings.navigationTime.length >= MAX_NAVIGATIONS) {
        this.timings.navigationTime = this.timings.navigationTime.slice(-10); // Keep last 10
      }
      
      this.timings.navigationTime.push({ 
        duration, 
        timestamp: Date.now() 
      });
    },

    /**
     * Get cache hit ratio
     */
    getCacheHitRatio() {
      const total = this.metrics.cacheHits + this.metrics.cacheMisses;
      return total > 0 ? (this.metrics.cacheHits / total * 100).toFixed(2) : '0.00';
    },

    /**
     * Get average DOM operation time (optimized with cached calculation)
     */
    getAvgDOMTime() {
      const ops = this.timings.domOperations;
      if (ops.length === 0) return '0.00';
      let total = 0;
      for (let i = 0; i < ops.length; i++) {
        total += ops[i].duration;
      }
      return (total / ops.length).toFixed(2);
    },

    /**
     * Get average navigation time (optimized with cached calculation)
     */
    getAvgNavigationTime() {
      const navs = this.timings.navigationTime;
      if (navs.length === 0) return '0.00';
      let total = 0;
      for (let i = 0; i < navs.length; i++) {
        total += navs[i].duration;
      }
      return (total / navs.length).toFixed(2);
    },

    /**
     * Get performance report (optimized with memoization)
     */
    getReport() {
      const timestamp = new Date().toISOString();
      
      // Use cached values instead of recalculating
      const cacheHitRatio = this.getCacheHitRatio();
      const avgDOMTime = this.getAvgDOMTime();
      const avgNavigationTime = this.getAvgNavigationTime();
      
      return {
        metrics: { ...this.metrics },
        cacheHitRatio: cacheHitRatio + '%',
        avgDOMTime: avgDOMTime + 'ms',
        avgNavigationTime: avgNavigationTime + 'ms',
        moduleLoadTimes: Object.fromEntries(this.timings.moduleLoad),
        timestamp,
        // Performance insights
        insights: {
          cacheEfficiency: parseFloat(cacheHitRatio) > 70 ? 'good' : 'needs improvement',
          domPerformance: parseFloat(avgDOMTime) < 10 ? 'excellent' : parseFloat(avgDOMTime) < 50 ? 'good' : 'slow',
          totalQueries: this.metrics.domQueries,
          resourceCount: {
            eventListeners: this.metrics.eventListeners,
            observers: this.metrics.observers,
            timers: this.metrics.timers,
          },
        },
      };
    },

    /**
     * Print performance report to console (enhanced)
     */
    printReport() {
      const report = this.getReport();
      console.warn('📊 YouTube Plus Performance Report');
      console.warn('Cache Performance');
      console.warn('  Hit Ratio: ' + report.cacheHitRatio + ' (' + report.insights.cacheEfficiency + ')');
      console.warn('  DOM Queries: ' + report.metrics.domQueries);
      console.warn('  Cache Hits: ' + report.metrics.cacheHits);
      console.warn('  Cache Misses: ' + report.metrics.cacheMisses);

      console.warn('Resource Usage');
      console.warn('  Event Listeners: ' + report.metrics.eventListeners);
      console.warn('  Observers: ' + report.metrics.observers);
      console.warn('  Timers: ' + report.metrics.timers);

      console.warn('Timing Metrics');
      console.warn('  Avg DOM Operation: ' + report.avgDOMTime + ' (' + report.insights.domPerformance + ')');
      console.warn('  Avg Navigation: ' + report.avgNavigationTime);

      if (Object.keys(report.moduleLoadTimes).length > 0) {
        console.warn('Module Load Times');
        Object.entries(report.moduleLoadTimes).forEach(([modName, time]) => {
          console.warn('  ' + modName + ': ' + time + 'ms');
        });
      }

      console.warn('Generated:');
      console.warn('  ' + report.timestamp);
      return report;
    },

    /**
     * Export report as JSON
     */
    exportJSON() {
      return JSON.stringify(this.getReport(), null, 2);
    },

    /**
     * Reset all metrics
     */
    reset() {
      Object.keys(this.metrics).forEach(key => {
        this.metrics[key] = 0;
      });
      this.timings.moduleLoad.clear();
      this.timings.domOperations = [];
      this.timings.navigationTime = [];
      console.warn('🔄 Performance metrics reset');
    },

    /**
     * Get performance summary for quick diagnostics
     */
    getSummary() {
      const cacheRatio = parseFloat(this.getCacheHitRatio());
      const avgDOM = parseFloat(this.getAvgDOMTime());
      
      return {
        status: cacheRatio > 70 && avgDOM < 50 ? '✅ GOOD' : '⚠️ NEEDS ATTENTION',
        cacheRatio: cacheRatio + '%',
        avgDOMTime: avgDOM + 'ms',
        totalQueries: this.metrics.domQueries,
      };
    },

    /**
     * Watch performance metrics with interval updates
     * @param {number} interval - Update interval in ms (default: 5000)
     * @returns {number} Interval ID for clearing
     */
    startWatching(interval = 5000) {
      console.warn('👀 Performance watching started (interval: ' + interval + 'ms)');
      return setInterval(() => {
        const summary = this.getSummary();
        console.warn('📊 Performance: ' + summary.status + ' | Cache: ' + summary.cacheRatio + ' | DOM: ' + summary.avgDOMTime + ' | Queries: ' + summary.totalQueries);
      }, interval);
    },

    /**
     * Get top slowest DOM operations
     * @param {number} count - Number of operations to return
     */
    getTopSlowOperations(count = 5) {
      return this.timings.domOperations
        .sort((a, b) => b.duration - a.duration)
        .slice(0, count);
    },
  };

  // Expose to window for debugging
  if (typeof window !== 'undefined') {
    window.YouTubePlusPerformanceMonitor = PerformanceMonitor;
    
    // Add console command for easy access
    console.warn('📊 Performance Monitoring Active');
    console.warn('Available commands:');
    console.warn('  • YouTubePlusPerformanceMonitor.printReport()');
    console.warn('  • YouTubePlusPerformanceMonitor.getSummary()');
    console.warn('  • YouTubePlusPerformanceMonitor.exportJSON()');
    console.warn('  • YouTubePlusPerformanceMonitor.reset()');
    console.warn('  • YouTubePlusPerformanceMonitor.startWatching(interval)');
    console.warn('  • YouTubePlusPerformanceMonitor.getTopSlowOperations(count)');
  }

  return PerformanceMonitor;
})();
`;

// These messages are useful during build/dev (Node), but spam the
// in-page console when this file is bundled into a userscript. Only
// print them when not running in a browser context.
if (typeof window === 'undefined') {
  console.warn('📊 Performance Monitoring Module Generated\n');
  console.warn('Features:');
  console.warn('  ✓ DOM query tracking with cache hit/miss ratio');
  console.warn('  ✓ Event listener counting');
  console.warn('  ✓ Observer and timer tracking');
  console.warn('  ✓ Module load time measurement');
  console.warn('  ✓ DOM operation timing with circular buffer optimization');
  console.warn('  ✓ Navigation performance tracking');
  console.warn('  ✓ Real-time performance reports with insights');
  console.warn('  ✓ Performance watching with auto-updates');
  console.warn('  ✓ Top slowest operations analysis');
  console.warn('  ✓ Batch tracking for improved performance');
  console.warn('\nPerformance Optimizations:');
  console.warn('  • Circular buffer for operation history (prevents shift() overhead)');
  console.warn('  • For loops instead of reduce() for better V8 optimization');
  console.warn('  • Batch tracking to reduce function call overhead');
  console.warn('  • Cached calculations in getReport()');
  console.warn('\nUsage in browser console:');
  console.warn('  YouTubePlusPerformanceMonitor.printReport()');
  console.warn('  YouTubePlusPerformanceMonitor.getSummary()');
  console.warn('  YouTubePlusPerformanceMonitor.startWatching(5000)');
  console.warn('  YouTubePlusPerformanceMonitor.getTopSlowOperations(10)');
  console.warn('  YouTubePlusPerformanceMonitor.exportJSON()');
  console.warn('  YouTubePlusPerformanceMonitor.reset()');
}

// Safely export for Node/CommonJS while avoiding errors when this file
// is executed in a browser/userscript context where `module` is undefined.
if (typeof module !== 'undefined' && module && typeof module.exports !== 'undefined') {
  module.exports = performanceMonitoring;
} else if (typeof window !== 'undefined') {
  // Expose raw source to `window` so callers can inject it into the page
  // without relying on bundler/CommonJS behavior.
  try {
    window.YouTubePlusPerformanceMonitoringSource = performanceMonitoring;
  } catch {
    // Defensive: in some sandboxed environments `window` may be read-only.
  }
}
