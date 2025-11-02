/**
 * Performance benchmark script for YouTube+ build system
 * Measures build time, module processing, and overall performance
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname);
const ITERATIONS = 5;

/**
 * Format duration in ms
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted string
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Calculate statistics
 * @param {number[]} values - Array of values
 * @returns {Object} Statistics
 */
function calculateStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / values.length,
    median: sorted[Math.floor(sorted.length / 2)],
    total: sum,
  };
}

/**
 * Measure build time
 * @returns {number} Duration in ms
 */
function measureBuild() {
  const start = performance.now();
  try {
    execSync('node build.js --no-eslint', {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return performance.now() - start;
  } catch (error) {
    console.error('Build failed:', error.message);
    return -1;
  }
}

/**
 * Measure module sizes
 * @returns {Object} Module size information
 */
function measureModuleSizes() {
  const srcDir = path.join(ROOT, 'src');
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));

  const sizes = files.map(file => {
    const filePath = path.join(srcDir, file);
    const stats = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').length;

    return {
      name: file,
      size: stats.size,
      lines,
      kbSize: (stats.size / 1024).toFixed(2),
    };
  });

  return sizes.sort((a, b) => b.size - a.size);
}

/**
 * Measure output size
 * @returns {Object} Output file stats
 */
function measureOutputSize() {
  const outputPath = path.join(ROOT, 'youtube.user.js');
  if (!fs.existsSync(outputPath)) {
    return null;
  }

  const stats = fs.statSync(outputPath);
  const content = fs.readFileSync(outputPath, 'utf8');
  const lines = content.split('\n').length;

  return {
    size: stats.size,
    lines,
    kbSize: (stats.size / 1024).toFixed(2),
  };
}

/**
 * Run benchmarks
 */
async function runBenchmarks() {
  console.log('🚀 YouTube+ Build Performance Benchmark\n');
  console.log('='.repeat(60));

  // Module sizes
  console.log('\n📦 Module Sizes:');
  console.log('-'.repeat(60));
  const moduleSizes = measureModuleSizes();
  moduleSizes.forEach(mod => {
    console.log(
      `  ${mod.name.padEnd(25)} ${mod.kbSize.padStart(8)} KB  ${mod.lines.toString().padStart(6)} lines`
    );
  });

  const totalSize = moduleSizes.reduce((sum, m) => sum + m.size, 0);
  const totalLines = moduleSizes.reduce((sum, m) => sum + m.lines, 0);
  console.log('-'.repeat(60));
  console.log(
    `  Total: ${moduleSizes.length} modules`.padEnd(25) +
      `${(totalSize / 1024).toFixed(2).padStart(8)} KB  ${totalLines.toString().padStart(6)} lines`
  );

  // Build performance
  console.log('\n⚡ Build Performance:');
  console.log('-'.repeat(60));
  console.log(`  Running ${ITERATIONS} iterations...\n`);

  const buildTimes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    process.stdout.write(`  Iteration ${i + 1}/${ITERATIONS}... `);
    const duration = measureBuild();
    if (duration === -1) {
      console.log('FAILED');
      return;
    }
    buildTimes.push(duration);
    console.log(`${formatDuration(duration)}`);
  }

  const stats = calculateStats(buildTimes);
  console.log('\n  Build Time Statistics:');
  console.log(`    Min:     ${formatDuration(stats.min)}`);
  console.log(`    Max:     ${formatDuration(stats.max)}`);
  console.log(`    Average: ${formatDuration(stats.avg)}`);
  console.log(`    Median:  ${formatDuration(stats.median)}`);

  // Output size
  console.log('\n📄 Output File:');
  console.log('-'.repeat(60));
  const outputStats = measureOutputSize();
  if (outputStats) {
    console.log(`  File:  youtube.user.js`);
    console.log(`  Size:  ${outputStats.kbSize} KB`);
    console.log(`  Lines: ${outputStats.lines}`);

    const compressionRatio = ((1 - outputStats.size / totalSize) * 100).toFixed(2);
    console.log(`  Compression: ${compressionRatio}% (vs sum of modules)`);
  }

  // Performance metrics
  console.log('\n📊 Performance Metrics:');
  console.log('-'.repeat(60));
  const throughput = totalLines / (stats.avg / 1000);
  console.log(`  Throughput: ${Math.round(throughput)} lines/second`);
  console.log(`  Build speed: ${(totalSize / 1024 / (stats.avg / 1000)).toFixed(2)} KB/second`);

  console.log('\n' + '='.repeat(60));
  console.log('✅ Benchmark completed successfully!\n');
}

// Run benchmarks
runBenchmarks().catch(error => {
  console.error('\n❌ Benchmark failed:', error);
  process.exit(1);
});
