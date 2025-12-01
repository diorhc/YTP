/**
 * Enhanced Code Complexity Analyzer
 * Analyzes individual functions within IIFE modules
 * Ignores module wrapper complexity
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const SRC_DIR = path.join(ROOT, 'src');

/**
 * Analyze function complexity
 * @param {string} code - Function code
 * @param {string} name - Function name
 * @returns {Object} Complexity metrics
 */
function analyzeComplexity(code, name) {
  const metrics = {
    name,
    lines: code.split('\n').length,
    cyclomaticComplexity: 1, // Base complexity
    nesting: 0,
    parameters: 0,
  };

  // Count cyclomatic complexity
  const complexityPatterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bcase\s+/g,
    /\bcatch\s*\(/g,
    /\&\&/g,
    /\|\|/g,
    /\?/g,
  ];

  complexityPatterns.forEach(pattern => {
    const matches = code.match(pattern);
    if (matches) {
      metrics.cyclomaticComplexity += matches.length;
    }
  });

  // Estimate max nesting depth
  let currentNesting = 0;
  let maxNesting = 0;
  for (const char of code) {
    if (char === '{') {
      currentNesting++;
      maxNesting = Math.max(maxNesting, currentNesting);
    } else if (char === '}') {
      currentNesting--;
    }
  }
  metrics.nesting = maxNesting;

  return metrics;
}

/**
 * Check if code is IIFE module wrapper
 * @param {string} code - Code to check
 * @returns {boolean} True if IIFE module
 */
function isIIFEModule(code) {
  // Match patterns like: const ModuleName = (() => {
  return /^const\s+\w+\s*=\s*\(\(\)\s*=>\s*\{/.test(code.trim());
}

/**
 * Extract inner functions from IIFE module
 * @param {string} code - Module code
 * @returns {string} Inner code without wrapper
 */
function extractModuleContent(code) {
  // Find the opening of the IIFE
  const match = code.match(/^const\s+\w+\s*=\s*\(\(\)\s*=>\s*\{/);
  if (!match) return code;

  // Find matching closing braces
  let braceCount = 0;
  const startIndex = match[0].length;
  let endIndex = code.length - 1;

  for (let i = startIndex - 1; i < code.length; i++) {
    if (code[i] === '{') braceCount++;
    if (code[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        endIndex = i;
        break;
      }
    }
  }

  return code.substring(startIndex, endIndex);
}

/**
 * Extract functions from code
 * @param {string} code - Source code
 * @param {string} filename - Filename
 * @returns {Array} Array of function objects
 */
function extractFunctions(code, filename) {
  const functions = [];
  let processedCode = code;

  // Check if this is an IIFE module
  if (isIIFEModule(code)) {
    processedCode = extractModuleContent(code);
  }

  // Match function declarations and arrow functions
  const patterns = [
    // const funcName = (...) => { or const funcName = async (...) => {
    /const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    // function funcName(...) { or async function funcName(...) {
    /(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/g,
  ];

  patterns.forEach(pattern => {
    let match;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(processedCode)) !== null) {
      const name = match[1];
      const startIndex = match.index;

      // Skip if this looks like a module wrapper
      if (
        name &&
        /^[A-Z]/.test(name) &&
        processedCode.substring(startIndex, startIndex + 200).includes('return {')
      ) {
        continue;
      }

      // Find function body
      let braceCount = 0;
      let inFunction = false;
      let endIndex = startIndex;

      for (let i = startIndex; i < processedCode.length; i++) {
        if (processedCode[i] === '{') {
          braceCount++;
          inFunction = true;
        } else if (processedCode[i] === '}') {
          braceCount--;
          if (inFunction && braceCount === 0) {
            endIndex = i + 1;
            break;
          }
        }
      }

      const functionCode = processedCode.substring(startIndex, endIndex);
      const metrics = analyzeComplexity(functionCode, name);

      // Only include if it's a real function (not too short, not too long)
      if (metrics.lines > 3 && metrics.lines < 500) {
        functions.push({
          name,
          filename,
          metrics,
          startIndex,
          endIndex,
        });
      }
    }
  });

  return functions;
}

/**
 * Get complexity rating
 * @param {number} complexity - Cyclomatic complexity
 * @returns {Object} Rating info
 */
function getComplexityRating(complexity) {
  if (complexity <= 5) {
    return { rating: 'Low', color: '🟢', risk: 'Low' };
  }
  if (complexity <= 10) {
    return { rating: 'Moderate', color: '🟡', risk: 'Medium' };
  }
  if (complexity <= 15) {
    return { rating: 'High', color: '🟠', risk: 'High' };
  }
  return { rating: 'Very High', color: '🔴', risk: 'Very High' };
}

/**
 * Analyze all source files
 */
function analyzeProject() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Enhanced Complexity Analysis Report   ║');
  console.log('╚════════════════════════════════════════╝\n');

  const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
  const allFunctions = [];

  files.forEach(file => {
    const filePath = path.join(SRC_DIR, file);
    const code = fs.readFileSync(filePath, 'utf8');
    const functions = extractFunctions(code, file);
    allFunctions.push(...functions);
  });

  // Sort by complexity
  allFunctions.sort((a, b) => b.metrics.cyclomaticComplexity - a.metrics.cyclomaticComplexity);

  console.log('📊 Top 20 Most Complex Individual Functions:\n');
  console.log(
    'Rank | Function Name              | File              | Complexity | Lines | Nesting | Rating'
  );
  console.log(
    '-----|----------------------------|-------------------|------------|-------|---------|-------'
  );

  allFunctions.slice(0, 20).forEach((fn, i) => {
    const rating = getComplexityRating(fn.metrics.cyclomaticComplexity);
    const nameDisplay = fn.name.padEnd(26).substring(0, 26);
    const fileDisplay = fn.filename.padEnd(17).substring(0, 17);
    console.log(
      `${(i + 1).toString().padStart(4)} | ${nameDisplay} | ${fileDisplay} | ` +
        `${fn.metrics.cyclomaticComplexity.toString().padStart(10)} | ` +
        `${fn.metrics.lines.toString().padStart(5)} | ` +
        `${fn.metrics.nesting.toString().padStart(7)} | ${rating.color} ${rating.rating}`
    );
  });

  // Summary statistics
  const totalFunctions = allFunctions.length;
  const avgComplexity =
    allFunctions.reduce((sum, fn) => sum + fn.metrics.cyclomaticComplexity, 0) / totalFunctions;
  const moderateComplexity = allFunctions.filter(
    fn => fn.metrics.cyclomaticComplexity > 5 && fn.metrics.cyclomaticComplexity <= 10
  ).length;
  const highComplexity = allFunctions.filter(
    fn => fn.metrics.cyclomaticComplexity > 10 && fn.metrics.cyclomaticComplexity <= 15
  ).length;
  const veryHighComplexity = allFunctions.filter(fn => fn.metrics.cyclomaticComplexity > 15).length;

  console.log('\n📈 Summary Statistics:\n');
  console.log(`Total Functions Analyzed: ${totalFunctions}`);
  console.log(`Average Complexity: ${avgComplexity.toFixed(2)}`);
  console.log(
    `Moderate Complexity (6-10): ${moderateComplexity} (${((moderateComplexity / totalFunctions) * 100).toFixed(1)}%)`
  );
  console.log(
    `High Complexity (11-15): ${highComplexity} (${((highComplexity / totalFunctions) * 100).toFixed(1)}%)`
  );
  console.log(
    `Very High Complexity (>15): ${veryHighComplexity} (${((veryHighComplexity / totalFunctions) * 100).toFixed(1)}%)`
  );

  // Recommendations
  console.log('\n💡 Refactoring Recommendations:\n');

  const needsRefactoring = allFunctions.filter(fn => fn.metrics.cyclomaticComplexity > 10);
  if (needsRefactoring.length > 0) {
    console.log(
      `⚠️  ${needsRefactoring.length} functions could benefit from refactoring (complexity > 10):`
    );
    needsRefactoring.slice(0, 10).forEach(fn => {
      console.log(
        `   - ${fn.name} in ${fn.filename} (complexity: ${fn.metrics.cyclomaticComplexity}, lines: ${fn.metrics.lines})`
      );

      const suggestions = [];
      if (fn.metrics.complexity > 15) suggestions.push('Break into smaller functions');
      if (fn.metrics.nesting > 4) suggestions.push('Reduce nesting depth');
      if (fn.metrics.lines > 50) suggestions.push('Extract helper functions');

      if (suggestions.length > 0) {
        console.log(`     Suggestions: ${suggestions.join(', ')}`);
      }
    });
  } else {
    console.log('✅ All functions have acceptable complexity levels (≤10)');
  }

  console.log('\n📋 Complexity Distribution:\n');
  const low = allFunctions.filter(fn => fn.metrics.cyclomaticComplexity <= 5).length;
  console.log(
    `  🟢 Low (1-5):       ${low.toString().padStart(4)} (${((low / totalFunctions) * 100).toFixed(1)}%)`
  );
  console.log(
    `  🟡 Moderate (6-10): ${moderateComplexity.toString().padStart(4)} (${((moderateComplexity / totalFunctions) * 100).toFixed(1)}%)`
  );
  console.log(
    `  🟠 High (11-15):    ${highComplexity.toString().padStart(4)} (${((highComplexity / totalFunctions) * 100).toFixed(1)}%)`
  );
  console.log(
    `  🔴 Very High (>15): ${veryHighComplexity.toString().padStart(4)} (${((veryHighComplexity / totalFunctions) * 100).toFixed(1)}%)`
  );

  console.log('\n');

  return {
    totalFunctions,
    avgComplexity,
    moderateComplexity,
    highComplexity,
    veryHighComplexity,
    needsRefactoring: needsRefactoring.length,
  };
}

// Run analysis
try {
  const results = analyzeProject();

  // Exit with warning if too many complex functions
  if (results.veryHighComplexity > 20) {
    console.warn('⚠️  Warning: Many functions with very high complexity. Consider refactoring.');
  } else if (results.veryHighComplexity === 0) {
    console.log('✅ Excellent: No functions with very high complexity!');
  }
} catch (error) {
  console.error('Error during analysis:', error.message);
  process.exit(1);
}
