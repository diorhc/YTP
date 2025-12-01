/**
 * Code optimization utility
 * Analyzes codebase for optimization opportunities
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');

/**
 * Analyze file for potential optimizations
 * @param {string} filePath - Path to file
 * @returns {Object} Analysis results
 */
function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const stats = {
    file: path.relative(ROOT, filePath),
    totalLines: lines.length,
    codeLines: 0,
    commentLines: 0,
    emptyLines: 0,
    longLines: [],
    duplicateStrings: {},
    largeComments: [],
    opportunities: [],
  };

  let inBlockComment = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // Track comment blocks
    if (trimmed.startsWith('/*')) inBlockComment = true;
    if (trimmed.endsWith('*/')) inBlockComment = false;

    // Classify line types
    if (!trimmed) {
      stats.emptyLines++;
    } else if (inBlockComment || trimmed.startsWith('//') || trimmed.startsWith('*')) {
      stats.commentLines++;
      if (trimmed.length > 200) {
        stats.largeComments.push({ line: index + 1, length: trimmed.length });
      }
    } else {
      stats.codeLines++;
    }

    // Check for excessively long lines (potential for splitting)
    if (line.length > 120) {
      stats.longLines.push({ line: index + 1, length: line.length });
    }

    // Look for repeated string literals (candidates for constants)
    const stringMatches = line.match(/'([^']{20,})'|"([^"]{20,})"/g);
    if (stringMatches) {
      stringMatches.forEach(str => {
        stats.duplicateStrings[str] = (stats.duplicateStrings[str] || 0) + 1;
      });
    }
  });

  // Identify optimization opportunities
  const commentRatio = stats.commentLines / stats.totalLines;
  const emptyRatio = stats.emptyLines / stats.totalLines;

  if (commentRatio > 0.3) {
    stats.opportunities.push({
      type: 'high-comment-ratio',
      message: `High comment ratio (${(commentRatio * 100).toFixed(1)}%). Consider if all comments add value.`,
    });
  }

  if (emptyRatio > 0.2) {
    stats.opportunities.push({
      type: 'high-empty-ratio',
      message: `High empty line ratio (${(emptyRatio * 100).toFixed(1)}%). Consider condensing whitespace.`,
    });
  }

  if (stats.longLines.length > 10) {
    stats.opportunities.push({
      type: 'many-long-lines',
      message: `${stats.longLines.length} lines exceed 120 characters. Consider splitting for readability.`,
    });
  }

  // Find duplicate strings (optimization opportunity)
  const duplicates = Object.entries(stats.duplicateStrings).filter(([_, count]) => count > 2);
  if (duplicates.length > 0) {
    stats.opportunities.push({
      type: 'duplicate-strings',
      message: `${duplicates.length} string literals repeated 3+ times. Consider extracting to constants.`,
      details: duplicates.slice(0, 5).map(([str, count]) => ({ string: str, count })),
    });
  }

  return stats;
}

/**
 * Main analysis function
 */
function main() {
  console.log('🔍 Code Optimization Analysis\n');
  console.log('='.repeat(80));

  const files = fs
    .readdirSync(SRC)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(SRC, f));

  const allStats = files.map(analyzeFile);

  // Summary statistics
  const totalStats = allStats.reduce(
    (acc, stats) => ({
      files: acc.files + 1,
      totalLines: acc.totalLines + stats.totalLines,
      codeLines: acc.codeLines + stats.codeLines,
      commentLines: acc.commentLines + stats.commentLines,
      emptyLines: acc.emptyLines + stats.emptyLines,
      opportunities: acc.opportunities + stats.opportunities.length,
    }),
    { files: 0, totalLines: 0, codeLines: 0, commentLines: 0, emptyLines: 0, opportunities: 0 }
  );

  console.log('\n📊 Overall Statistics:\n');
  console.log(`Total Files: ${totalStats.files}`);
  console.log(`Total Lines: ${totalStats.totalLines.toLocaleString()}`);
  console.log(
    `  Code: ${totalStats.codeLines.toLocaleString()} (${((totalStats.codeLines / totalStats.totalLines) * 100).toFixed(1)}%)`
  );
  console.log(
    `  Comments: ${totalStats.commentLines.toLocaleString()} (${((totalStats.commentLines / totalStats.totalLines) * 100).toFixed(1)}%)`
  );
  console.log(
    `  Empty: ${totalStats.emptyLines.toLocaleString()} (${((totalStats.emptyLines / totalStats.totalLines) * 100).toFixed(1)}%)`
  );
  console.log(`\n🎯 Optimization Opportunities Found: ${totalStats.opportunities}\n`);

  // Top files by size
  console.log('\n📈 Largest Files:\n');
  const largestFiles = [...allStats].sort((a, b) => b.totalLines - a.totalLines).slice(0, 5);
  largestFiles.forEach((stats, i) => {
    console.log(`${i + 1}. ${stats.file}: ${stats.totalLines} lines (${stats.codeLines} code)`);
  });

  // Files with most opportunities
  console.log('\n⚠️  Files with Most Optimization Opportunities:\n');
  const filesWithOpportunities = allStats
    .filter(s => s.opportunities.length > 0)
    .sort((a, b) => b.opportunities.length - a.opportunities.length)
    .slice(0, 10);

  filesWithOpportunities.forEach(stats => {
    console.log(`\n📄 ${stats.file}:`);
    stats.opportunities.forEach(opp => {
      console.log(`   • ${opp.message}`);
      if (opp.details) {
        opp.details.forEach(detail => {
          console.log(`     - ${detail.string.substring(0, 50)}... (${detail.count}x)`);
        });
      }
    });
  });

  // Calculate potential savings
  console.log('\n💡 Potential Optimizations:\n');
  const potentialSavings = {
    emptyLines: totalStats.emptyLines,
    excessiveComments: Math.max(0, totalStats.commentLines - totalStats.codeLines * 0.2),
  };

  const totalPotentialSavings = potentialSavings.emptyLines + potentialSavings.excessiveComments;
  const savingsPercent = ((totalPotentialSavings / totalStats.totalLines) * 100).toFixed(1);

  console.log(`Removing excessive empty lines: ~${potentialSavings.emptyLines} lines`);
  console.log(`Optimizing comments: ~${Math.floor(potentialSavings.excessiveComments)} lines`);
  console.log(
    `\nTotal Potential Reduction: ~${Math.floor(totalPotentialSavings)} lines (${savingsPercent}%)`
  );

  console.log(`\n${'='.repeat(80)}`);
  console.log('\n✅ Analysis complete!\n');
}

main();
