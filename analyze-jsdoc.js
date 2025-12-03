#!/usr/bin/env node
/**
 * analyze-jsdoc.js
 * Analyzes JSDoc coverage and documentation quality
 */

'use strict';

const fs = require('fs');
const path = require('path');

function analyzeJSDoc() {
  console.log('🔍 Analyzing JSDoc documentation...\n');

  const srcDir = path.join(__dirname, 'src');
  const files = fs
    .readdirSync(srcDir)
    .filter(f => f.endsWith('.js'))
    .sort();

  let totalFunctions = 0;
  let documentedFunctions = 0;

  console.log('Documentation Coverage:');
  console.log('─'.repeat(70));

  files.forEach(file => {
    const filePath = path.join(srcDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    // Find all function declarations
    const functions = content.match(
      /function\s+\w+\s*\(|const\s+\w+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)/g
    );
    const functionCount = functions ? functions.length : 0;

    // Find JSDoc comments
    const jsdocComments = content.match(/\/\*\*[\s\S]*?\*\//g);
    const jsdocCount = jsdocComments ? jsdocComments.length : 0;

    totalFunctions += functionCount;
    documentedFunctions += Math.min(jsdocCount, functionCount);

    const coverage = functionCount > 0 ? ((jsdocCount / functionCount) * 100).toFixed(1) : 0;
    const indicator = coverage >= 80 ? '✓ ' : coverage >= 50 ? '⚡' : '⚠️ ';

    console.log(
      `  ${indicator}${file.padEnd(30)} ${jsdocCount}/${functionCount} functions (${coverage}%)`
    );
  });

  console.log('─'.repeat(70));
  const overallCoverage =
    totalFunctions > 0 ? ((documentedFunctions / totalFunctions) * 100).toFixed(1) : 0;

  console.log(`\n📊 Summary:`);
  console.log(`  Total Functions: ${totalFunctions}`);
  console.log(`  Documented: ${documentedFunctions}`);
  console.log(`  Coverage: ${overallCoverage}%`);

  if (overallCoverage < 50) {
    console.log('\n⚠️  Documentation coverage is low. Consider adding JSDoc comments.');
  } else if (overallCoverage < 80) {
    console.log('\n⚡ Good documentation coverage. Aim for 80%+ for better maintainability.');
  } else {
    console.log('\n✨ Excellent documentation coverage!');
  }

  console.log('\n✅ JSDoc analysis complete!\n');
}

try {
  analyzeJSDoc();
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
