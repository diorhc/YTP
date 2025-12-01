#!/usr/bin/env node

/**
 * Script to help adopt YouTubePlusConstants across all modules
 * This script identifies remaining opportunities and provides suggestions
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');

// Patterns to find and suggested replacements
const PATTERNS = [
  {
    name: 'SVG Namespace',
    pattern: /'http:\/\/www\.w3\.org\/2000\/svg'/g,
    replacement: "window.YouTubePlusConstants?.SVG_NS || 'http://www.w3.org/2000/svg'",
    alternatePattern: /"http:\/\/www\.w3\.org\/2000\/svg"/g,
  },
  {
    name: 'Module Name - Timecode',
    pattern: /'\[YouTube\+\]\[Timecode\]'/g,
    replacement: "window.YouTubePlusConstants?.MODULE_NAMES.TIMECODE || '[YouTube+][Timecode]'",
  },
  {
    name: 'Module Name - Thumbnail',
    pattern: /'\[YouTube\+\]\[Thumbnail\]'/g,
    replacement: "window.YouTubePlusConstants?.MODULE_NAMES.THUMBNAIL || '[YouTube+][Thumbnail]'",
  },
  {
    name: 'Module Name - Stats',
    pattern: /'\[YouTube\+\]\[Stats\]'/g,
    replacement: "window.YouTubePlusConstants?.MODULE_NAMES.STATS || '[YouTube+][Stats]'",
  },
  {
    name: 'Module Name - Enhanced',
    pattern: /'\[YouTube\+\]\[Enhanced\]'/g,
    replacement: "window.YouTubePlusConstants?.MODULE_NAMES.ENHANCED || '[YouTube+][Enhanced]'",
  },
];

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);
  const results = [];

  PATTERNS.forEach(pattern => {
    const mainMatches = content.match(pattern.pattern);
    const altMatches = pattern.alternatePattern ? content.match(pattern.alternatePattern) : null;
    const totalMatches =
      (mainMatches ? mainMatches.length : 0) + (altMatches ? altMatches.length : 0);

    if (totalMatches > 0) {
      results.push({
        file: fileName,
        pattern: pattern.name,
        occurrences: totalMatches,
        suggestion: `Replace with: ${pattern.replacement}`,
      });
    }
  });

  return results;
}

function main() {
  console.log('🔍 Analyzing codebase for constant adoption opportunities...\n');

  const files = fs
    .readdirSync(SRC_DIR)
    .filter(f => f.endsWith('.js') && f !== 'constants.js')
    .map(f => path.join(SRC_DIR, f));

  let totalOpportunities = 0;
  const opportunitiesByFile = {};

  files.forEach(file => {
    const results = analyzeFile(file);
    if (results.length > 0) {
      const fileName = path.basename(file);
      opportunitiesByFile[fileName] = results;
      results.forEach(r => (totalOpportunities += r.occurrences));
    }
  });

  // Display results
  console.log(
    `📊 Found ${totalOpportunities} opportunities across ${Object.keys(opportunitiesByFile).length} files\n`
  );

  Object.entries(opportunitiesByFile).forEach(([fileName, opportunities]) => {
    const fileTotal = opportunities.reduce((sum, o) => sum + o.occurrences, 0);
    console.log(`📄 ${fileName} (${fileTotal} occurrences):`);
    opportunities.forEach(opp => {
      console.log(`   • ${opp.pattern}: ${opp.occurrences} times`);
      console.log(`     ${opp.suggestion}`);
    });
    console.log('');
  });

  // Summary recommendations
  console.log('💡 Recommendations:\n');
  console.log('1. Create a helper function at the top of each module:');
  console.log('   ```javascript');
  console.log('   const getConstants = () => window.YouTubePlusConstants || {};');
  console.log("   const SVG_NS = getConstants().SVG_NS || 'http://www.w3.org/2000/svg';");
  console.log('   ```\n');
  console.log(
    '2. Replace all occurrences systematically, starting with the most repeated patterns'
  );
  console.log('3. Run tests after each file to ensure nothing breaks');
  console.log('4. Expected savings: ~3-5KB per 100 replacements\n');

  // Save report
  const reportPath = path.join(__dirname, 'constants-adoption-report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        totalOpportunities,
        filesAnalyzed: files.length,
        opportunitiesByFile,
      },
      null,
      2
    )
  );
  console.log(`📝 Detailed report saved to: ${path.basename(reportPath)}`);
}

main();
