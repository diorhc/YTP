const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const BUILD_OUTPUT = path.join(ROOT, 'youtube.user.js');

// Size limits in bytes
const SIZE_LIMITS = {
  ERROR: 500 * 1024, // 500 KB - build fails
  WARNING: 350 * 1024, // 350 KB - warning only
  TARGET: 250 * 1024, // 250 KB - ideal size
};

/**
 * Format bytes to human-readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Calculate percentage difference
 * @param {number} current - Current size
 * @param {number} limit - Limit size
 * @returns {string} Percentage string
 */
function percentDiff(current, limit) {
  const diff = ((current - limit) / limit) * 100;
  return diff > 0 ? `+${diff.toFixed(1)}%` : `${diff.toFixed(1)}%`;
}

/**
 * Get emoji based on status
 * @param {string} status - Status string
 * @returns {string} Emoji
 */
function getStatusEmoji(status) {
  switch (status) {
    case 'excellent':
      return '✨';
    case 'good':
      return '✅';
    case 'warning':
      return '⚠️';
    case 'error':
      return '❌';
    default:
      return '📊';
  }
}

/**
 * Check bundle size and report
 * @param {boolean} failOnError - Whether to exit with error code
 * @returns {Promise<boolean>} Success status
 */
async function checkBundleSize(failOnError = false) {
  console.log('━━━ Bundle Size Check ━━━\n');

  if (!fs.existsSync(BUILD_OUTPUT)) {
    console.error('❌ Build output not found. Run `npm run build` first.');
    return false;
  }

  const stats = fs.statSync(BUILD_OUTPUT);
  const size = stats.size;

  let status = 'excellent';
  let message = 'Bundle size is excellent!';

  if (size > SIZE_LIMITS.ERROR) {
    status = 'error';
    message = 'Bundle size exceeds error limit!';
  } else if (size > SIZE_LIMITS.WARNING) {
    status = 'warning';
    message = 'Bundle size exceeds warning limit';
  } else if (size > SIZE_LIMITS.TARGET) {
    status = 'good';
    message = 'Bundle size is acceptable';
  }

  // Display results
  console.log(`${getStatusEmoji(status)} ${message}\n`);
  console.log(`Current size: ${formatSize(size)}`);
  console.log(`Target size:  ${formatSize(SIZE_LIMITS.TARGET)}`);
  console.log(`Warning at:   ${formatSize(SIZE_LIMITS.WARNING)}`);
  console.log(`Error at:     ${formatSize(SIZE_LIMITS.ERROR)}`);

  if (size > SIZE_LIMITS.TARGET) {
    console.log(`\nOver target by: ${percentDiff(size, SIZE_LIMITS.TARGET)}`);
  }

  // Show module breakdown if verbose
  if (process.argv.includes('--verbose') || process.argv.includes('-v')) {
    console.log('\n━━━ Module Breakdown ━━━\n');
    const content = fs.readFileSync(BUILD_OUTPUT, 'utf8');
    const modulePattern = /\/\/ --- MODULE: (.+?) ---/g;
    const modules = [];
    let match;
    let lastIndex = 0;

    while ((match = modulePattern.exec(content)) !== null) {
      if (lastIndex > 0) {
        const prevMatch = modules[modules.length - 1];
        prevMatch.size = match.index - prevMatch.start;
      }
      modules.push({
        name: match[1],
        start: match.index,
        size: 0,
      });
      lastIndex = match.index;
    }

    // Calculate size of last module
    if (modules.length > 0) {
      modules[modules.length - 1].size = content.length - modules[modules.length - 1].start;
    }

    // Sort by size descending
    modules.sort((a, b) => b.size - a.size);

    // Display top 10 largest modules
    modules.slice(0, 10).forEach((mod, idx) => {
      const percent = ((mod.size / size) * 100).toFixed(1);
      console.log(
        `${idx + 1}. ${mod.name.padEnd(30)} ${formatSize(mod.size).padStart(10)} (${percent}%)`
      );
    });
  }

  // Recommendations
  if (size > SIZE_LIMITS.WARNING) {
    console.log('\n━━━ Recommendations ━━━\n');
    console.log('Consider the following optimizations:');
    console.log('  • Run `npm run build:minify` to create a minified build');
    console.log('  • Remove unused code and dependencies');
    console.log('  • Split large modules into smaller ones');
    console.log('  • Use lazy loading for non-critical features');
    console.log('  • Check for duplicate code across modules');
  }

  // Write size report
  const report = {
    timestamp: new Date().toISOString(),
    size,
    sizeFormatted: formatSize(size),
    status,
    limits: {
      target: SIZE_LIMITS.TARGET,
      warning: SIZE_LIMITS.WARNING,
      error: SIZE_LIMITS.ERROR,
    },
  };

  fs.writeFileSync(
    path.join(ROOT, 'bundle-size-report.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Exit with error if over limit and failOnError is true
  if (status === 'error' && failOnError) {
    console.error('Bundle size check failed!');
    process.exit(1);
  }

  return status !== 'error';
}

// Run if called directly
if (require.main === module) {
  const failOnError = process.argv.includes('--fail-on-error');
  checkBundleSize(failOnError).then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { checkBundleSize, SIZE_LIMITS, formatSize };
