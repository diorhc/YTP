/**
 * JSDoc Coverage Analyzer
 * Analyzes JavaScript files for JSDoc documentation coverage
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const SRC_DIR = path.join(ROOT, 'src');

/**
 * Check if a function has JSDoc documentation
 * @param {string} content - File content
 * @param {number} functionLine - Line where function is declared
 * @returns {boolean} True if has JSDoc
 */
function hasJSDoc(content, functionLine) {
  const lines = content.split('\n');
  // Check 5 lines before function for JSDoc
  for (let i = Math.max(0, functionLine - 5); i < functionLine; i++) {
    if (lines[i].includes('/**') || lines[i].includes('@param') || lines[i].includes('@returns')) {
      return true;
    }
  }
  return false;
}

/**
 * Extract function declarations from file
 * @param {string} content - File content
 * @returns {Array<{name: string, line: number, hasDoc: boolean}>} Function info
 */
function extractFunctions(content) {
  const functions = [];
  const lines = content.split('\n');

  // Match various function patterns
  const patterns = [
    /function\s+(\w+)\s*\(/, // function name()
    /const\s+(\w+)\s*=\s*function/, // const name = function
    /const\s+(\w+)\s*=\s*\([^)]*\)\s*=>/, // const name = () =>
    /(\w+):\s*function\s*\(/, // obj: function()
    /(\w+):\s*\([^)]*\)\s*=>/, // obj: () =>
    /async\s+function\s+(\w+)/, // async function name()
  ];

  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const hasDoc = hasJSDoc(content, index);
        functions.push({
          name: match[1],
          line: index + 1,
          hasDoc,
        });
      }
    }
  });

  return functions;
}

/**
 * Analyze a JavaScript file
 * @param {string} filePath - Path to file
 * @returns {Object} Analysis results
 */
function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const functions = extractFunctions(content);

  const documented = functions.filter(f => f.hasDoc).length;
  const total = functions.length;
  const coverage = total > 0 ? ((documented / total) * 100).toFixed(1) : 100;

  return {
    file: path.basename(filePath),
    functions,
    documented,
    total,
    coverage: parseFloat(coverage),
    undocumented: functions.filter(f => !f.hasDoc),
  };
}

/**
 * Main analysis function
 */
function main() {
  console.log('🔍 Analyzing JSDoc Coverage...\n');

  const files = fs
    .readdirSync(SRC_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(SRC_DIR, f));

  const results = files.map(analyzeFile);

  // Sort by coverage (lowest first)
  results.sort((a, b) => a.coverage - b.coverage);

  console.log('📊 JSDoc Coverage Report\n');
  console.log('File                           Total    Documented    Coverage');
  console.log('─'.repeat(70));

  let totalFunctions = 0;
  let totalDocumented = 0;

  results.forEach(result => {
    totalFunctions += result.total;
    totalDocumented += result.documented;

    let emoji;
    if (result.coverage >= 80) {
      emoji = '✅';
    } else if (result.coverage >= 50) {
      emoji = '⚠️';
    } else {
      emoji = '❌';
    }
    const file = result.file.padEnd(30);
    const total = result.total.toString().padStart(5);
    const documented = result.documented.toString().padStart(11);
    const coverage = `${result.coverage}%`.padStart(10);

    console.log(`${emoji} ${file} ${total}    ${documented}    ${coverage}`);
  });

  console.log('─'.repeat(70));
  const overallCoverage =
    totalFunctions > 0 ? ((totalDocumented / totalFunctions) * 100).toFixed(1) : 100;
  console.log(
    `Total: ${totalFunctions} functions, ${totalDocumented} documented (${overallCoverage}%)\n`
  );

  // Show files needing improvement
  const needsImprovement = results.filter(r => r.coverage < 80 && r.undocumented.length > 0);

  if (needsImprovement.length > 0) {
    console.log('\n⚠️  Files Needing Improvement:\n');
    needsImprovement.forEach(result => {
      console.log(`${result.file} (${result.coverage}% coverage):`);
      result.undocumented.slice(0, 5).forEach(fn => {
        console.log(`  - ${fn.name} (line ${fn.line})`);
      });
      if (result.undocumented.length > 5) {
        console.log(`  ... and ${result.undocumented.length - 5} more`);
      }
      console.log('');
    });
  } else {
    console.log('✅ All files have good JSDoc coverage!\n');
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { analyzeFile, extractFunctions };
