#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const BUILD_OUTPUT = path.join(ROOT, 'youtube.user.js');

const SIZE_LIMITS = {
  ERROR: 1200 * 1024,
  WARNING: 1100 * 1024,
  TARGET: 950 * 1024,
};

function listSourceFiles() {
  return fs
    .readdirSync(SRC_DIR)
    .filter(file => file.endsWith('.js'))
    .sort();
}

function readSource(file) {
  return fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
}

function estimateCyclomaticComplexity(content) {
  const decisions = [
    /\bif\s*\(/g,
    /\bwhile\s*\(/g,
    /\bfor\s*\(/g,
    /\bcase\s+/g,
    /\bcatch\s*\(/g,
    /\?\s*.*\s*:/g,
    /&&/g,
    /\|\|/g,
  ];

  let complexity = 1;
  for (const pattern of decisions) {
    const matches = content.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }

  return complexity;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function percentDiff(current, limit) {
  const diff = ((current - limit) / limit) * 100;
  return diff > 0 ? `+${diff.toFixed(1)}%` : `${diff.toFixed(1)}%`;
}

function getStatusEmoji(status) {
  switch (status) {
    case 'excellent':
      return '✨';
    case 'good':
      return '✅';
    case 'warning':
      return '⚠️';
    case 'error':
      return '❌';
    default:
      return '📊';
  }
}

function analyzeComplexity() {
  console.log('Enhanced Complexity Analysis\n');

  const files = listSourceFiles();
  const results = [];
  let totalComplexity = 0;

  for (const file of files) {
    const content = readSource(file);
    const lines = content.split('\n').length;
    const complexity = estimateCyclomaticComplexity(content);
    const functions = (content.match(/function\s+\w+|=>\s*{|function\s*\(/g) || []).length;

    totalComplexity += complexity;
    results.push({
      file,
      lines,
      functions,
      complexity,
      complexityPerFunction: functions > 0 ? (complexity / functions).toFixed(2) : '0',
    });
  }

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

  for (const r of results) {
    const indicator = r.complexity > 50 ? '⚠️ ' : r.complexity > 30 ? '⚡' : '✓ ';
    console.log(
      indicator +
        r.file.padEnd(28) +
        String(r.lines).padStart(8) +
        String(r.functions).padStart(12) +
        String(r.complexity).padStart(14) +
        String(r.complexityPerFunction).padStart(12)
    );
  }

  console.log('─'.repeat(90));
  console.log('\nSummary:');
  console.log(`  Total Files: ${results.length}`);
  console.log(`  Total Complexity: ${totalComplexity}`);
  console.log(`  Average Complexity: ${(totalComplexity / results.length).toFixed(2)}`);
  console.log(`  Highest Complexity: ${results[0].file} (${results[0].complexity})`);

  const highComplexity = results.filter(r => r.complexity > 50);
  if (highComplexity.length > 0) {
    console.log('\nFiles with high complexity (>50):');
    for (const r of highComplexity) {
      console.log(`  - ${r.file}: ${r.complexity}`);
    }
  }

  console.log('\nComplexity analysis complete.\n');
}

function analyzeOptimization() {
  console.log('Analyzing optimization opportunities...\n');

  const files = listSourceFiles();
  const findings = {
    stringConcatenation: [],
    largeFunctions: [],
    missingSafeNavigation: [],
  };

  for (const file of files) {
    const content = readSource(file);
    const lines = content.split('\n');

    const loopConcatPattern = /for\s*\([^)]+\)[^{]*{[^}]*\+=\s*['"`]/;
    if (loopConcatPattern.test(content)) {
      findings.stringConcatenation.push(file);
    }

    const functionMatches = content.match(/function\s+(\w+)|const\s+(\w+)\s*=/g);
    if (functionMatches) {
      const functionCount = functionMatches.length;
      const avgLinesPerFunction = lines.length / Math.max(functionCount, 1);
      if (avgLinesPerFunction > 100) {
        findings.largeFunctions.push({ file, avgLines: Math.round(avgLinesPerFunction) });
      }
    }

    const propertyAccessCount = (content.match(/\.\w+\./g) || []).length;
    const safeAccessCount = (content.match(/\?\.|\?\?/g) || []).length;
    if (propertyAccessCount > 20 && safeAccessCount < propertyAccessCount * 0.3) {
      findings.missingSafeNavigation.push({
        file,
        accesses: propertyAccessCount,
        safe: safeAccessCount,
      });
    }
  }

  console.log('Optimization Report:');
  console.log('═'.repeat(70));

  if (findings.stringConcatenation.length > 0) {
    console.log('\nString concatenation in loops:');
    for (const file of findings.stringConcatenation) {
      console.log(`  - ${file}`);
    }
  }

  if (findings.largeFunctions.length > 0) {
    console.log('\nLarge functions:');
    for (const item of findings.largeFunctions) {
      console.log(`  - ${item.file}: ~${item.avgLines} lines/function`);
    }
  }

  if (findings.missingSafeNavigation.length > 0) {
    console.log('\nPotential null-safety improvements:');
    for (const item of findings.missingSafeNavigation) {
      console.log(`  - ${item.file}: ${item.accesses} accesses, ${item.safe} safe`);
    }
  }

  console.log('\nOptimization analysis complete.\n');
}

function analyzePerformance() {
  console.log('Analyzing performance patterns...\n');

  const files = listSourceFiles();
  const findings = {
    domQueries: [],
    eventListeners: [],
    timers: [],
    observers: [],
  };

  for (const file of files) {
    const content = readSource(file);
    const queries = [
      (content.match(/querySelector\(/g) || []).length,
      (content.match(/querySelectorAll\(/g) || []).length,
      (content.match(/getElementById\(/g) || []).length,
      (content.match(/getElementsBy/g) || []).length,
    ].reduce((a, b) => a + b, 0);

    if (queries > 0) {
      findings.domQueries.push({ file, count: queries });
    }

    const listeners = (content.match(/addEventListener\(/g) || []).length;
    if (listeners > 0) {
      findings.eventListeners.push({ file, count: listeners });
    }

    const timers = (content.match(/setTimeout|setInterval/g) || []).length;
    if (timers > 0) {
      findings.timers.push({ file, count: timers });
    }

    const observers = (content.match(/MutationObserver|IntersectionObserver|ResizeObserver/g) || [])
      .length;
    if (observers > 0) {
      findings.observers.push({ file, count: observers });
    }
  }

  console.log('Performance Metrics:');
  console.log('═'.repeat(70));

  if (findings.domQueries.length > 0) {
    console.log('\nDOM Queries:');
    findings.domQueries.sort((a, b) => b.count - a.count);
    for (const item of findings.domQueries) {
      const indicator = item.count > 20 ? '⚠️ ' : item.count > 10 ? '⚡' : '✓ ';
      console.log(`  ${indicator}${item.file.padEnd(30)} ${item.count} queries`);
    }
  }

  if (findings.eventListeners.length > 0) {
    console.log('\nEvent Listeners:');
    findings.eventListeners.sort((a, b) => b.count - a.count);
    for (const item of findings.eventListeners) {
      const indicator = item.count > 10 ? '⚠️ ' : item.count > 5 ? '⚡' : '✓ ';
      console.log(`  ${indicator}${item.file.padEnd(30)} ${item.count} listeners`);
    }
  }

  if (findings.timers.length > 0) {
    console.log('\nTimers:');
    findings.timers.sort((a, b) => b.count - a.count);
    for (const item of findings.timers) {
      console.log(`  ✓ ${item.file.padEnd(30)} ${item.count} timers`);
    }
  }

  if (findings.observers.length > 0) {
    console.log('\nObservers:');
    findings.observers.sort((a, b) => b.count - a.count);
    for (const item of findings.observers) {
      console.log(`  ✓ ${item.file.padEnd(30)} ${item.count} observers`);
    }
  }

  console.log('\nPerformance analysis complete.\n');
}

function analyzeJSDoc() {
  console.log('Analyzing JSDoc documentation...\n');

  const files = listSourceFiles();
  let totalFunctions = 0;
  let documentedFunctions = 0;

  console.log('Documentation Coverage:');
  console.log('─'.repeat(70));

  for (const file of files) {
    const content = readSource(file);
    // Match a wider range of function declarations so the coverage
    // metric reflects JSDoc discipline across styles:
    //   - function name(...)
    //   - const name = (...), const name = function, const name = async (...) =>
    //   - class methods (shorthand `name(...)` and key `name: function`).
    // We exclude common control-flow openers (if/for/while/...) and
    // built-in constructors (new MutationObserver(function (e) { ... })
    // where the trailing `function` is a value, not a declaration.
    const functionDeclRegex = new RegExp(
      [
        // 1. `function name(...)` declaration.
        'function\\s+\\w+\\s*\\(',
        // 2. `const name = (...), const name = function, const name = async (...) =>`.
        'const\\s+\\w+\\s*=\\s*(?:async\\s+)?(?:function|\\([^)]*\\)\\s*=>)',
        // 3. Class/object shorthand: a name followed by `(...) {` that is
        //    NOT a control-flow opener AND has a non-`new`/`return`/etc.
        //    prefix. We anchor on the line so the name appears as a
        //    statement start (indent or `,` or `=` or `{`).
        '(?:^\\s*(?:[\\w$]+\\s*[,{=;]\\s*|[,;{]\\s*))(?:async\\s+)?(?!(?:if|for|while|switch|catch|do|return|throw|new|typeof|void|delete|in|of|yield|await|function|class|const|let|var|return)\\b)(\\w+)\\s*\\([^)]*\\)\\s*\\{',
        // 4. Object key + function: `name: function (...)` or `name: (...) =>`.
        '\\b\\w+\\s*:\\s*(?:async\\s+)?(?:function|\\([^)]*\\)\\s*=>)',
      ].join('|'),
      'gm'
    );
    const functions = content.match(functionDeclRegex);
    const functionCount = functions ? functions.length : 0;

    const jsdocComments = content.match(/\/\*\*[\s\S]*?\*\//g);
    const jsdocCount = jsdocComments ? jsdocComments.length : 0;

    totalFunctions += functionCount;
    documentedFunctions += Math.min(jsdocCount, functionCount);

    const coverage = functionCount > 0 ? ((jsdocCount / functionCount) * 100).toFixed(1) : '0';
    const indicator = Number(coverage) >= 80 ? '✓ ' : Number(coverage) >= 50 ? '⚡' : '⚠️ ';
    console.log(`  ${indicator}${file.padEnd(30)} ${jsdocCount}/${functionCount} (${coverage}%)`);
  }

  console.log('─'.repeat(70));
  const overallCoverage =
    totalFunctions > 0 ? ((documentedFunctions / totalFunctions) * 100).toFixed(1) : '0';

  console.log('\nSummary:');
  console.log(`  Total Functions: ${totalFunctions}`);
  console.log(`  Documented: ${documentedFunctions}`);
  console.log(`  Coverage: ${overallCoverage}%`);
  console.log('\nJSDoc analysis complete.\n');
}

function analyzeConstants() {
  console.log('Analyzing constants adoption...\n');

  const files = listSourceFiles();
  let totalConst = 0;
  let totalLet = 0;
  let totalVar = 0;

  console.log('Variable Declaration Usage:');
  console.log('─'.repeat(70));

  for (const file of files) {
    const content = readSource(file);
    const constCount = (content.match(/\bconst\s+/g) || []).length;
    const letCount = (content.match(/\blet\s+/g) || []).length;
    const varCount = (content.match(/\bvar\s+/g) || []).length;

    totalConst += constCount;
    totalLet += letCount;
    totalVar += varCount;

    const total = constCount + letCount + varCount;
    const constPercent = total > 0 ? ((constCount / total) * 100).toFixed(1) : '0';
    console.log(
      `  ${file.padEnd(30)} const: ${String(constCount).padStart(3)}  let: ${String(letCount).padStart(3)}  var: ${String(varCount).padStart(3)}  (${constPercent}% const)`
    );
  }

  console.log('─'.repeat(70));
  const total = totalConst + totalLet + totalVar;
  const constPercent = total > 0 ? ((totalConst / total) * 100).toFixed(1) : '0';

  console.log('\nSummary:');
  console.log(`  Total const: ${totalConst}`);
  console.log(`  Total let: ${totalLet}`);
  console.log(`  Total var: ${totalVar}`);
  console.log(`  Overall const usage: ${constPercent}%`);
  console.log('\nConstants analysis complete.\n');
}

function analyzeBuild() {
  console.log('Analyzing built userscript...\n');

  if (!fs.existsSync(BUILD_OUTPUT)) {
    console.error('Build output not found. Run npm run build first.');
    process.exit(1);
  }

  const content = fs.readFileSync(BUILD_OUTPUT, 'utf8');
  const lines = content.split('\n');
  const modules = content.match(/\/\/ --- MODULE: .+ ---/g);

  console.log(`Total lines: ${lines.length}`);
  console.log(`Modules found: ${modules ? modules.length : 0}`);

  const youtubeUtilsExport =
    content.includes('window.YouTubeUtils') || content.includes('window).YouTubeUtils');
  console.log(`YouTubeUtils export: ${youtubeUtilsExport ? 'yes' : 'no'}`);

  const iifes = (content.match(/\(function\s*\(\s*\)\s*\{/g) || []).length;
  console.log(`IIFE count: ${iifes}`);

  const sizeKB = (content.length / 1024).toFixed(2);
  console.log(`Bundle size: ${sizeKB} KB\n`);
}

function analyzeSize() {
  console.log('Bundle Size Check\n');

  if (!fs.existsSync(BUILD_OUTPUT)) {
    console.error('Build output not found. Run npm run build first.');
    process.exit(1);
  }

  const size = fs.statSync(BUILD_OUTPUT).size;
  let status = 'excellent';
  let message = 'Bundle size is excellent.';

  if (size > SIZE_LIMITS.ERROR) {
    status = 'error';
    message = 'Bundle size exceeds error limit.';
  } else if (size > SIZE_LIMITS.WARNING) {
    status = 'warning';
    message = 'Bundle size exceeds warning limit.';
  } else if (size > SIZE_LIMITS.TARGET) {
    status = 'good';
    message = 'Bundle size is acceptable.';
  }

  console.log(`${getStatusEmoji(status)} ${message}\n`);
  console.log(`Current size: ${formatSize(size)}`);
  console.log(`Target size:  ${formatSize(SIZE_LIMITS.TARGET)}`);
  console.log(`Warning at:   ${formatSize(SIZE_LIMITS.WARNING)}`);
  console.log(`Error at:     ${formatSize(SIZE_LIMITS.ERROR)}`);

  if (size > SIZE_LIMITS.TARGET) {
    console.log(`Over target by: ${percentDiff(size, SIZE_LIMITS.TARGET)}`);
  }

  const report = {
    timestamp: new Date().toISOString(),
    size,
    sizeFormatted: formatSize(size),
    status,
    limits: {
      target: SIZE_LIMITS.TARGET,
      warning: SIZE_LIMITS.WARNING,
      error: SIZE_LIMITS.ERROR,
    },
  };

  fs.writeFileSync(
    path.join(ROOT, 'bundle-size-report.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );

  if (status === 'error' && process.argv.includes('--fail-on-error')) {
    process.exit(1);
  }

  console.log('\nSize analysis complete.\n');
}

function runAll() {
  analyzeComplexity();
  analyzeOptimization();
  analyzePerformance();
  analyzeJSDoc();
  analyzeConstants();
  analyzeBuild();
  analyzeSize();
}

const command = process.argv[2] || 'all';

try {
  switch (command) {
    case 'complexity':
      analyzeComplexity();
      break;
    case 'optimization':
      analyzeOptimization();
      break;
    case 'performance':
      analyzePerformance();
      break;
    case 'jsdoc':
      analyzeJSDoc();
      break;
    case 'constants':
      analyzeConstants();
      break;
    case 'build':
      analyzeBuild();
      break;
    case 'size':
      analyzeSize();
      break;
    case 'all':
      runAll();
      break;
    default:
      console.error(
        'Unknown command. Use one of: all, complexity, optimization, performance, jsdoc, constants, build, size'
      );
      process.exit(1);
  }
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
