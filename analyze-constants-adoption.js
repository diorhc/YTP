#!/usr/bin/env node
/**
 * analyze-constants-adoption.js
 * Analyzes adoption of constants and best practices
 */

'use strict';

const fs = require('fs');
const path = require('path');

function analyzeConstantsAdoption() {
  console.log('🔍 Analyzing constants adoption...\n');

  const srcDir = path.join(__dirname, 'src');
  const files = fs
    .readdirSync(srcDir)
    .filter(f => f.endsWith('.js'))
    .sort();

  let totalConst = 0;
  let totalLet = 0;
  let totalVar = 0;

  console.log('Variable Declaration Usage:');
  console.log('─'.repeat(70));

  files.forEach(file => {
    const filePath = path.join(srcDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    const constCount = (content.match(/\bconst\s+/g) || []).length;
    const letCount = (content.match(/\blet\s+/g) || []).length;
    const varCount = (content.match(/\bvar\s+/g) || []).length;

    totalConst += constCount;
    totalLet += letCount;
    totalVar += varCount;

    const total = constCount + letCount + varCount;
    const constPercent = total > 0 ? ((constCount / total) * 100).toFixed(1) : 0;

    console.log(
      `  ${file.padEnd(30)} const: ${constCount.toString().padStart(3)}  let: ${letCount.toString().padStart(3)}  var: ${varCount.toString().padStart(3)}  (${constPercent}% const)`
    );
  });

  console.log('─'.repeat(70));
  console.log(`\n📊 Summary:`);
  console.log(`  Total const: ${totalConst}`);
  console.log(`  Total let: ${totalLet}`);
  console.log(`  Total var: ${totalVar}`);

  const total = totalConst + totalLet + totalVar;
  const constPercent = ((totalConst / total) * 100).toFixed(1);

  console.log(`  Overall const usage: ${constPercent}%`);

  if (totalVar > 0) {
    console.log(`\n⚠️  Found ${totalVar} 'var' declarations (consider migrating to const/let)`);
  }

  console.log('\n✅ Constants adoption analysis complete!\n');
}

try {
  analyzeConstantsAdoption();
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
