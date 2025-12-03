#!/usr/bin/env node
/**
 * analyze-optimization.js
 * Analyzes code for optimization opportunities
 */

'use strict';

const fs = require('fs');
const path = require('path');

function analyzeOptimizations() {
  console.log('🔍 Analyzing optimization opportunities...\n');

  const srcDir = path.join(__dirname, 'src');
  const files = fs
    .readdirSync(srcDir)
    .filter(f => f.endsWith('.js'))
    .sort();

  const findings = {
    stringConcatenation: [],
    inefficientLoops: [],
    missingSafeNavigation: [],
    largeFunctions: [],
  };

  files.forEach(file => {
    const filePath = path.join(srcDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // Check for string concatenation in loops
    const loopConcatPattern = /for\s*\([^)]+\)[^{]*{[^}]*\+=\s*['"`]/;
    if (loopConcatPattern.test(content)) {
      findings.stringConcatenation.push(file);
    }

    // Check for large functions (>100 lines)
    const functionMatches = content.match(/function\s+(\w+)|const\s+(\w+)\s*=/g);
    if (functionMatches) {
      const functionCount = functionMatches.length;
      const avgLinesPerFunction = lines.length / Math.max(functionCount, 1);
      if (avgLinesPerFunction > 100) {
        findings.largeFunctions.push({
          file,
          avgLines: Math.round(avgLinesPerFunction),
        });
      }
    }

    // Check for potential null pointer issues
    const propertyAccessCount = (content.match(/\.\w+\./g) || []).length;
    const safeAccessCount = (content.match(/\?\.|\?\?/g) || []).length;
    if (propertyAccessCount > 20 && safeAccessCount < propertyAccessCount * 0.3) {
      findings.missingSafeNavigation.push({
        file,
        accesses: propertyAccessCount,
        safe: safeAccessCount,
      });
    }
  });

  console.log('📊 Optimization Report:');
  console.log('═'.repeat(70));

  if (findings.stringConcatenation.length > 0) {
    console.log('\n⚠️  String concatenation in loops detected:');
    findings.stringConcatenation.forEach(file => {
      console.log(`    - ${file} (consider using array.join())`);
    });
  }

  if (findings.largeFunctions.length > 0) {
    console.log('\n⚠️  Large functions detected:');
    findings.largeFunctions.forEach(({ file, avgLines }) => {
      console.log(`    - ${file}: ~${avgLines} lines/function (consider refactoring)`);
    });
  }

  if (findings.missingSafeNavigation.length > 0) {
    console.log('\n⚡ Files with potential null-safety improvements:');
    findings.missingSafeNavigation.forEach(({ file, accesses, safe }) => {
      console.log(`    - ${file}: ${accesses} accesses, ${safe} safe (?. or ??)`);
    });
  }

  const totalIssues =
    findings.stringConcatenation.length +
    findings.largeFunctions.length +
    findings.missingSafeNavigation.length;

  console.log('\n' + '═'.repeat(70));
  console.log(`\n✅ Analysis complete! Found ${totalIssues} optimization opportunities.\n`);
}

try {
  analyzeOptimizations();
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
