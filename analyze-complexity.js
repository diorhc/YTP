/**
 * Code Complexity Analyzer
 * Analyzes JavaScript code complexity and provides refactoring suggestions
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const SRC_DIR = path.join(ROOT, 'src');

/**
 * Analyze function complexity
 * @param {string} code - Function code
 * @returns {Object} Complexity metrics
 */
function analyzeComplexity(code) {
  const metrics = {
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

  // Estimate max nesting depth (simplified)
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

  // Count parameters (simplified - looks for function declarations)
  const functionMatch = code.match(/function\s*\w*\s*\(([^)]*)\)/);
  if (functionMatch && functionMatch[1]) {
    metrics.parameters = functionMatch[1].split(',').filter(p => p.trim()).length;
  }

  return metrics;
}

/**
 * Extract functions from code
 * @param {string} code - Source code
 * @param {string} filename - Filename
 * @returns {Array} Array of function objects
 */
function extractFunctions(code, filename) {
  const functions = [];

  // Match function declarations and arrow functions
  const functionRegex = /(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/g;
  let match;

  while ((match = functionRegex.exec(code)) !== null) {
    const name = match[1] || match[2];
    const startIndex = match.index;

    // Try to find function body
    let braceCount = 0;
    let inFunction = false;
    let endIndex = startIndex;

    for (let i = startIndex; i < code.length; i++) {
      if (code[i] === '{') {
        braceCount++;
        inFunction = true;
      } else if (code[i] === '}') {
        braceCount--;
        if (inFunction && braceCount === 0) {
          endIndex = i + 1;
          break;
        }
      }
    }

    const functionCode = code.substring(startIndex, endIndex);
    const metrics = analyzeComplexity(functionCode);

    functions.push({
      name,
      filename,
      metrics,
      startIndex,
      endIndex,
    });
  }

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
  if (complexity <= 20) {
    return { rating: 'High', color: '🟠', risk: 'High' };
  }
  return { rating: 'Very High', color: '🔴', risk: 'Very High' };
}

/**
 * Analyze all source files
 */
function analyzeProject() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   Code Complexity Analysis Report      ║');
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

  console.log('📊 Top 15 Most Complex Functions:\n');
  console.log('Rank | Function | File     | Complexity | Lines | Nesting | Rating');
  console.log('-----|----------|----------|------------|-------|---------|-------');

  allFunctions.slice(0, 15).forEach((fn, i) => {
    const rating = getComplexityRating(fn.metrics.cyclomaticComplexity);
    console.log(
      `${(i + 1).toString().padEnd(4)} | ${fn.name.padEnd(8).substring(0, 8)} | ` +
        `${fn.filename.padEnd(8).substring(0, 8)} | ${fn.metrics.cyclomaticComplexity.toString().padStart(10)} | ` +
        `${fn.metrics.lines.toString().padStart(5)} | ${fn.metrics.nesting.toString().padStart(7)} | ${rating.color} ${rating.rating}`
    );
  });

  // Summary statistics
  const totalFunctions = allFunctions.length;
  const avgComplexity =
    allFunctions.reduce((sum, fn) => sum + fn.metrics.cyclomaticComplexity, 0) / totalFunctions;
  const highComplexity = allFunctions.filter(fn => fn.metrics.cyclomaticComplexity > 10).length;
  const veryHighComplexity = allFunctions.filter(fn => fn.metrics.cyclomaticComplexity > 20).length;

  console.log('\n📈 Summary Statistics:\n');
  console.log(`Total Functions Analyzed: ${totalFunctions}`);
  console.log(`Average Complexity: ${avgComplexity.toFixed(2)}`);
  console.log(
    `High Complexity (>10): ${highComplexity} (${((highComplexity / totalFunctions) * 100).toFixed(1)}%)`
  );
  console.log(
    `Very High Complexity (>20): ${veryHighComplexity} (${((veryHighComplexity / totalFunctions) * 100).toFixed(1)}%)`
  );

  // Recommendations
  console.log('\n💡 Refactoring Recommendations:\n');

  const needsRefactoring = allFunctions.filter(fn => fn.metrics.cyclomaticComplexity > 15);
  if (needsRefactoring.length > 0) {
    console.log(`⚠️  ${needsRefactoring.length} functions need refactoring (complexity > 15):`);
    needsRefactoring.slice(0, 5).forEach(fn => {
      console.log(
        `   - ${fn.name} in ${fn.filename} (complexity: ${fn.metrics.cyclomaticComplexity})`
      );
      console.log(`     Suggestions: Break into smaller functions, reduce nesting`);
    });
  } else {
    console.log('✅ All functions have acceptable complexity levels');
  }

  console.log('\n');

  return {
    totalFunctions,
    avgComplexity,
    highComplexity,
    veryHighComplexity,
    needsRefactoring: needsRefactoring.length,
  };
}

// Run analysis
try {
  const results = analyzeProject();

  // Exit with error if too many complex functions
  if (results.veryHighComplexity > 10) {
    console.error('❌ Too many very complex functions. Consider refactoring.');
    process.exit(1);
  }
} catch (error) {
  console.error('Error during analysis:', error.message);
  process.exit(1);
}
