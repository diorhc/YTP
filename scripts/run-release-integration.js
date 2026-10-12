#!/usr/bin/env node
// @ts-check

/**
 * Cross-platform runner for the release integration suite.
 *
 * Sets RUN_RELEASE_INTEGRATION=1 and executes Jest on
 * test/release-integration.test.js, propagating the exit code. Kept as a Node
 * script so `npm run test:release-integration` behaves identically on Windows
 * and Linux.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const result = spawnSync(
  process.execPath,
  [
    path.join('node_modules', 'jest', 'bin', 'jest.js'),
    'test/release-integration.test.js',
    '--runInBand',
  ],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, RUN_RELEASE_INTEGRATION: '1' },
  }
);

process.exit(result.status ?? 1);
