#!/usr/bin/env node
/**
 * analyze-performance.js
 * Analyzes performance patterns and potential bottlenecks
 */

'use strict';

const fs = require('fs');
const path = require('path');

function analyzePerformance() {
  console.log('🔍 Analyzing performance patterns...\n');

  const srcDir = path.join(__dirname, 'src');
  const files = fs
    .readdirSync(srcDir)
    .filter(f => f.endsWith('.js'))
    .sort();

  const findings = {
    domQueries: [],
    eventListeners: [],
    timers: [],
    observers: [],
  };

  files.forEach(file => {
    const filePath = path.join(srcDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    // Count DOM queries
    const queries = [
      (content.match(/querySelector\(/g) || []).length,
      (content.match(/querySelectorAll\(/g) || []).length,
      (content.match(/getElementById\(/g) || []).length,
      (content.match(/getElementsBy/g) || []).length,
    ].reduce((a, b) => a + b, 0);

    if (queries > 0) {
      findings.domQueries.push({ file, count: queries });
    }

    // Count event listeners
    const listeners = (content.match(/addEventListener\(/g) || []).length;
    if (listeners > 0) {
      findings.eventListeners.push({ file, count: listeners });
    }

    // Count timers
    const timers = (content.match(/setTimeout|setInterval/g) || []).length;
    if (timers > 0) {
      findings.timers.push({ file, count: timers });
    }

    // Count observers
    const observers = (content.match(/MutationObserver|IntersectionObserver|ResizeObserver/g) || [])
      .length;
    if (observers > 0) {
      findings.observers.push({ file, count: observers });
    }
  });

  console.log('📊 Performance Metrics:');
  console.log('═'.repeat(70));

  if (findings.domQueries.length > 0) {
    console.log('\n📍 DOM Queries:');
    findings.domQueries
      .sort((a, b) => b.count - a.count)
      .forEach(({ file, count }) => {
        const indicator = count > 20 ? '⚠️ ' : count > 10 ? '⚡' : '✓ ';
        console.log(`  ${indicator}${file.padEnd(30)} ${count} queries`);
      });
  }

  if (findings.eventListeners.length > 0) {
    console.log('\n👂 Event Listeners:');
    findings.eventListeners
      .sort((a, b) => b.count - a.count)
      .forEach(({ file, count }) => {
        const indicator = count > 10 ? '⚠️ ' : count > 5 ? '⚡' : '✓ ';
        console.log(`  ${indicator}${file.padEnd(30)} ${count} listeners`);
      });
  }

  if (findings.timers.length > 0) {
    console.log('\n⏱️  Timers:');
    findings.timers
      .sort((a, b) => b.count - a.count)
      .forEach(({ file, count }) => {
        console.log(`  ✓ ${file.padEnd(30)} ${count} timers`);
      });
  }

  if (findings.observers.length > 0) {
    console.log('\n👁️  Observers:');
    findings.observers
      .sort((a, b) => b.count - a.count)
      .forEach(({ file, count }) => {
        console.log(`  ✓ ${file.padEnd(30)} ${count} observers`);
      });
  }

  console.log('\n' + '═'.repeat(70));

  const highDomQueries = findings.domQueries.filter(f => f.count > 20);
  const highListeners = findings.eventListeners.filter(f => f.count > 10);

  if (highDomQueries.length > 0 || highListeners.length > 0) {
    console.log('\n💡 Recommendations:');
    if (highDomQueries.length > 0) {
      console.log('  - Consider caching frequently accessed DOM elements');
    }
    if (highListeners.length > 0) {
      console.log('  - Review event listener usage and consider event delegation');
    }
  }

  console.log('\n✅ Performance analysis complete!\n');
}

try {
  analyzePerformance();
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
