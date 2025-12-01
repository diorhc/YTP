/**
 * Performance Optimization Analyzer
 * Analyzes the codebase for performance improvement opportunities
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC_DIR = path.join(ROOT, 'src');

/**
 * Analyze file for performance issues
 * @param {string} filePath - Path to file
 * @returns {Object} Analysis results
 */
function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);
  const fileSize = Buffer.byteLength(content, 'utf8');

  const issues = [];

  // Check for console.log (should be removed in production)
  const consoleLogs = (content.match(/console\.(log|debug|info)/g) || []).length;
  if (consoleLogs > 0) {
    issues.push({
      type: 'console-logs',
      severity: 'low',
      count: consoleLogs,
      message: `Found ${consoleLogs} console.log statements (consider removing in production)`,
    });
  }

  // Check for repeated string literals (could be constants)
  const stringLiterals = content.match(/["'`][^"'`]{10,}["'`]/g) || [];
  const stringCounts = {};
  stringLiterals.forEach(str => {
    stringCounts[str] = (stringCounts[str] || 0) + 1;
  });
  const repeatedStrings = Object.entries(stringCounts).filter(([_, count]) => count > 2);
  if (repeatedStrings.length > 0) {
    issues.push({
      type: 'repeated-strings',
      severity: 'medium',
      count: repeatedStrings.length,
      message: `Found ${repeatedStrings.length} repeated string literals (consider extracting to constants)`,
      examples: repeatedStrings
        .slice(0, 3)
        .map(([str, count]) => `${str.substring(0, 40)}... (${count} times)`),
    });
  }

  // Check for large functions (>100 lines)
  const functionMatches = content.match(/function\s+\w+\s*\([^)]*\)\s*\{/g) || [];
  const arrowFunctions = content.match(/const\s+\w+\s*=\s*\([^)]*\)\s*=>\s*\{/g) || [];
  const totalFunctions = functionMatches.length + arrowFunctions.length;

  // Estimate average function size
  const lines = content.split('\n').length;
  const avgFunctionSize = totalFunctions > 0 ? Math.round(lines / totalFunctions) : 0;

  if (avgFunctionSize > 50) {
    issues.push({
      type: 'large-functions',
      severity: 'medium',
      count: totalFunctions,
      avgSize: avgFunctionSize,
      message: `Average function size is ${avgFunctionSize} lines (consider breaking down)`,
    });
  }

  // Check for inline styles (could be CSS)
  const inlineStyles = (content.match(/\.style\.\w+\s*=/g) || []).length;
  if (inlineStyles > 20) {
    issues.push({
      type: 'inline-styles',
      severity: 'low',
      count: inlineStyles,
      message: `Found ${inlineStyles} inline style assignments (consider using CSS classes)`,
    });
  }

  // Check for querySelector in loops (performance issue)
  const querySelectorsInLoops = content.match(/for\s*\([^)]*\)[^{]*\{[^}]*querySelector/g) || [];
  if (querySelectorsInLoops.length > 0) {
    issues.push({
      type: 'querySelector-in-loop',
      severity: 'high',
      count: querySelectorsInLoops.length,
      message: `Found ${querySelectorsInLoops.length} querySelector calls potentially inside loops (cache the result)`,
    });
  }

  // Check for missing JSDoc
  const functions =
    content.match(/(function\s+\w+|const\s+\w+\s*=\s*(?:\([^)]*\)\s*=>|\bfunction\b))/g) || [];
  const jsdocComments = (content.match(/\/\*\*[\s\S]*?\*\//g) || []).length;
  const jsdocCoverage =
    functions.length > 0 ? Math.round((jsdocComments / functions.length) * 100) : 0;

  if (jsdocCoverage < 80) {
    issues.push({
      type: 'missing-jsdoc',
      severity: 'low',
      coverage: jsdocCoverage,
      message: `JSDoc coverage is ${jsdocCoverage}% (target: 80%+)`,
    });
  }

  return {
    fileName,
    fileSize,
    lines,
    functions: totalFunctions,
    avgFunctionSize,
    issues,
    jsdocCoverage,
  };
}

/**
 * Main analysis function
 */
function main() {
  console.log('🔍 Performance Optimization Analyzer\n');
  console.log('='.repeat(80));

  if (!fs.existsSync(SRC_DIR)) {
    console.error('❌ Source directory not found:', SRC_DIR);
    process.exit(1);
  }

  const files = fs
    .readdirSync(SRC_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(SRC_DIR, f));

  if (files.length === 0) {
    console.error('❌ No JavaScript files found in src/');
    process.exit(1);
  }

  const results = files.map(analyzeFile);

  // Summary statistics
  const totalSize = results.reduce((sum, r) => sum + r.fileSize, 0);
  const totalLines = results.reduce((sum, r) => sum + r.lines, 0);
  const totalFunctions = results.reduce((sum, r) => sum + r.functions, 0);
  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);

  console.log('\n📊 Summary Statistics\n');
  console.log(`Total Files: ${results.length}`);
  console.log(`Total Size: ${(totalSize / 1024).toFixed(2)} KB`);
  console.log(`Total Lines: ${totalLines.toLocaleString()}`);
  console.log(`Total Functions: ${totalFunctions.toLocaleString()}`);
  console.log(`Total Issues Found: ${totalIssues}`);
  console.log(`Average Lines per File: ${Math.round(totalLines / results.length)}`);
  console.log(`Average Functions per File: ${Math.round(totalFunctions / results.length)}`);

  // Group issues by severity
  const allIssues = results.flatMap(r => r.issues.map(i => ({ ...i, file: r.fileName })));

  const highSeverity = allIssues.filter(i => i.severity === 'high');
  const mediumSeverity = allIssues.filter(i => i.severity === 'medium');
  const lowSeverity = allIssues.filter(i => i.severity === 'low');

  console.log('\n🔴 High Severity Issues: ' + highSeverity.length);
  highSeverity.forEach(issue => {
    console.log(`  ⚠️  ${issue.file}: ${issue.message}`);
  });

  console.log('\n🟡 Medium Severity Issues: ' + mediumSeverity.length);
  mediumSeverity.slice(0, 5).forEach(issue => {
    console.log(`  ⚠️  ${issue.file}: ${issue.message}`);
  });
  if (mediumSeverity.length > 5) {
    console.log(`  ... and ${mediumSeverity.length - 5} more`);
  }

  console.log('\n🟢 Low Severity Issues: ' + lowSeverity.length);
  console.log('  (Run with --verbose to see all)');

  // Largest files
  console.log('\n📦 Largest Files (Optimization Candidates)\n');
  const largestFiles = [...results].sort((a, b) => b.fileSize - a.fileSize).slice(0, 5);
  largestFiles.forEach((r, i) => {
    console.log(
      `${i + 1}. ${r.fileName.padEnd(25)} ${(r.fileSize / 1024).toFixed(2).padStart(8)} KB (${r.lines.toLocaleString()} lines, ${r.functions} functions)`
    );
  });

  // JSDoc coverage
  console.log('\n📝 JSDoc Coverage\n');
  const avgJSDocCoverage = Math.round(
    results.reduce((sum, r) => sum + r.jsdocCoverage, 0) / results.length
  );
  console.log(`Average JSDoc Coverage: ${avgJSDocCoverage}%`);

  const lowCoverage = results
    .filter(r => r.jsdocCoverage < 80)
    .sort((a, b) => a.jsdocCoverage - b.jsdocCoverage);
  if (lowCoverage.length > 0) {
    console.log('\nFiles with low JSDoc coverage (<80%):');
    lowCoverage.slice(0, 5).forEach(r => {
      console.log(`  ${r.fileName.padEnd(25)} ${r.jsdocCoverage}%`);
    });
  }

  // Recommendations
  console.log('\n💡 Optimization Recommendations\n');
  console.log('1. Fix high-severity issues first (querySelector in loops)');
  console.log('2. Extract repeated strings to constants (improves maintainability)');
  console.log('3. Consider splitting large files (>500 lines)');
  console.log('4. Add JSDoc comments to improve type safety');
  console.log('5. Remove console.log statements in production builds');
  console.log('6. Use CSS classes instead of inline styles where possible');

  // Generate report file
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalFiles: results.length,
      totalSize,
      totalLines,
      totalFunctions,
      totalIssues,
      avgJSDocCoverage,
    },
    issues: {
      high: highSeverity.length,
      medium: mediumSeverity.length,
      low: lowSeverity.length,
    },
    files: results.map(r => ({
      name: r.fileName,
      size: r.fileSize,
      lines: r.lines,
      functions: r.functions,
      jsdocCoverage: r.jsdocCoverage,
      issueCount: r.issues.length,
    })),
    detailedIssues: allIssues,
  };

  const reportPath = path.join(ROOT, 'performance-optimization-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Detailed report saved to: ${path.basename(reportPath)}`);

  console.log('\n' + '='.repeat(80));
  console.log('✅ Analysis complete!\n');
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { analyzeFile, main };
