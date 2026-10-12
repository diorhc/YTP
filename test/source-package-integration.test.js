/**
 * The source-package self-sufficiency proof runs
 * through `npm run test:source-package-integration`, which drives
 * scripts/run-source-package-integration.js. This suite only asserts that
 * wiring, so a plain `jest` run needs no gated test.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('source package integration wiring', () => {
  test('the integration and packaging entry points are wired in package.json', () => {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    expect(pkgJson.scripts['test:source-package-integration']).toBeDefined();
    expect(pkgJson.scripts['test:source-package-integration']).toContain(
      'run-source-package-integration.js'
    );
    expect(pkgJson.scripts['package:source']).toContain('package-source.js');
  });
});
