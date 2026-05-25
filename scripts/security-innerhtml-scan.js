#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');

if (!fs.existsSync(SRC_DIR)) {
  console.error(`Source directory not found: ${SRC_DIR}`);
  process.exit(1);
}

/** @type {string[]} */
const jsFiles = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.js')) {
      jsFiles.push(fullPath);
    }
  }
}

walk(SRC_DIR);

const suspiciousAssignment = /innerHTML\s*=\s*[^'"`]/;
const allowList = ["innerHTML = ''"];

/** @type {string[]} */
const findings = [];

for (const filePath of jsFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!suspiciousAssignment.test(line)) continue;
    if (allowList.some(allowed => line.includes(allowed))) continue;

    findings.push(`${path.relative(ROOT, filePath)}:${i + 1}: ${line.trim()}`);
  }
}

if (findings.length > 0) {
  console.error('Potential unsafe innerHTML usage found:');
  for (const finding of findings) {
    console.error(finding);
  }
  process.exit(1);
}

console.log('CSP compatibility check passed');