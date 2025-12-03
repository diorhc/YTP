#!/usr/bin/env node
/**
 * analyze-complexity-enhanced.js
 * Enhanced complexity analysis with cyclomatic complexity estimation
 */

'use strict';

const fs = require('fs');
const path = require('path');

function estimateCyclomaticComplexity(content) {
  // Count decision points (simplified cyclomatic complexity)
  const decisions = [
    /\bif\s*\(/g,
    /\bwhile\s*\(/g,
    /\bfor\s*\(/g,
    /\bcase\s+/g,
    /\bcatch\s*\(/g,
    /\?\s*.*\s*:/g, // ternary
    /&&/g,
    /\|\|/g,
  ];

  let complexity = 1; // Base complexity
  decisions.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) complexity += matches.length;
  });

  return complexity;
}

function analyzeComplexityEnhanced() {
  console.log('🔍 Enhanced Complexity Analysis\n');

  const srcDir = path.join(__dirname, 'src');
  const files = fs
    .readdirSync(srcDir)
    .filter(f => f.endsWith('.js'))
    .sort();

  const results = [];
  let totalComplexity = 0;

  files.forEach(file => {
    const filePath = path.join(srcDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').length;
    const complexity = estimateCyclomaticComplexity(content);
    const functions = (content.match(/function\s+\w+|=>\s*{|function\s*\(/g) || []).length;

    totalComplexity += complexity;

    results.push({
      file,
      lines,
      functions,
      complexity,
      complexityPerFunction: functions > 0 ? (complexity / functions).toFixed(2) : 0,
    });
  });

  // Sort by complexity descending
  results.sort((a, b) => b.complexity - a.complexity);

  console.log('Complexity Metrics (sorted by complexity):');
  console.log('─'.repeat(90));
  console.log(
    'File'.padEnd(30) +
      'Lines'.padStart(8) +
      'Functions'.padStart(12) +
      'Complexity'.padStart(14) +
      'CC/Func'.padStart(12)
  );
  console.log('─'.repeat(90));

  results.forEach(r => {
    const indicator = r.complexity > 50 ? '⚠️ ' : r.complexity > 30 ? '⚡' : '✓ ';
    console.log(
      indicator +
        r.file.padEnd(28) +
        r.lines.toString().padStart(8) +
        r.functions.toString().padStart(12) +
        r.complexity.toString().padStart(14) +
        r.complexityPerFunction.toString().padStart(12)
    );
  });

  console.log('─'.repeat(90));
  console.log(`\n📊 Analysis Summary:`);
  console.log(`  Total Files: ${results.length}`);
  console.log(`  Total Complexity: ${totalComplexity}`);
  console.log(`  Average Complexity: ${(totalComplexity / results.length).toFixed(2)}`);
  console.log(`  Highest Complexity: ${results[0].file} (${results[0].complexity})`);

  const highComplexity = results.filter(r => r.complexity > 50);
  if (highComplexity.length > 0) {
    console.log(`\n⚠️  Files with high complexity (>50):`);
    highComplexity.forEach(r => {
      console.log(`    - ${r.file}: ${r.complexity}`);
    });
  }

  console.log('\n✅ Enhanced analysis complete!\n');
}

try {
  analyzeComplexityEnhanced();
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
