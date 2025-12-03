#!/usr/bin/env node
/**
 * analyze-complexity.js
 * Analyzes code complexity metrics for the YouTube+ project
 */

'use strict';

const fs = require('fs');
const path = require('path');

function analyzeComplexity() {
  console.log('🔍 Analyzing code complexity...\n');

  const srcDir = path.join(__dirname, 'src');
  const files = fs
    .readdirSync(srcDir)
    .filter(f => f.endsWith('.js'))
    .sort();

  let totalFiles = 0;
  let totalLines = 0;
  let totalFunctions = 0;

  console.log('File Metrics:');
  console.log('─'.repeat(70));

  files.forEach(file => {
    const filePath = path.join(srcDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').length;
    const functions = (content.match(/function\s+\w+|=>\s*{|function\s*\(/g) || []).length;

    totalFiles++;
    totalLines += lines;
    totalFunctions += functions;

    console.log(
      `  ${file.padEnd(30)} ${lines.toString().padStart(5)} lines  ${functions.toString().padStart(3)} functions`
    );
  });

  console.log('─'.repeat(70));
  console.log(`\n📊 Summary:`);
  console.log(`  Total Files: ${totalFiles}`);
  console.log(`  Total Lines: ${totalLines}`);
  console.log(`  Total Functions: ${totalFunctions}`);
  console.log(`  Avg Lines/File: ${Math.round(totalLines / totalFiles)}`);
  console.log(`  Avg Functions/File: ${Math.round(totalFunctions / totalFiles)}`);
  console.log('\n✅ Complexity analysis complete!\n');
}

try {
  analyzeComplexity();
} catch (error) {
  console.error('❌ Error analyzing complexity:', error.message);
  process.exit(1);
}
