/**
 * Integration tests for build system
 */

const fs = require('fs');
const path = require('path');

describe('Build System', () => {
  const ROOT = path.resolve(__dirname, '..');
  const BUILD_ORDER_PATH = path.join(ROOT, 'build.order.json');
  const BUILD_SCRIPT_PATH = path.join(ROOT, 'build.js');
  const SRC_DIR = path.join(ROOT, 'src');

  test('build.order.json should exist', () => {
    expect(fs.existsSync(BUILD_ORDER_PATH)).toBe(true);
  });

  test('build.order.json should be valid JSON', () => {
    const content = fs.readFileSync(BUILD_ORDER_PATH, 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  test('all modules in build.order.json should exist', () => {
    const buildOrder = JSON.parse(fs.readFileSync(BUILD_ORDER_PATH, 'utf8'));
    expect(Array.isArray(buildOrder)).toBe(true);

    buildOrder.forEach(
      /** @param {string} filename */ filename => {
        const filePath = path.join(SRC_DIR, filename);
        expect(fs.existsSync(filePath)).toBe(true);
      }
    );
  });

  test('all source files should be in build.order.json', () => {
    const buildOrder = JSON.parse(fs.readFileSync(BUILD_ORDER_PATH, 'utf8'));
    const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));

    files.forEach(
      /** @param {string} file */ file => {
        expect(buildOrder).toContain(file);
      }
    );
  });

  test('error-boundary.js and logger.js should be the first two modules', () => {
    // error-boundary.js is loaded first so window.YouTubeErrorBoundary is
    // available for the back-compat bridge in logger.js. logger.js follows
    // immediately so window.YouTubePlusLogger is published before consumers.
    const buildOrder = JSON.parse(fs.readFileSync(BUILD_ORDER_PATH, 'utf8'));
    expect(buildOrder[0]).toBe('error-boundary.js');
    expect(buildOrder[1]).toBe('logger.js');
  });

  test('infrastructure modules should come early in build order', () => {
    const buildOrder = JSON.parse(fs.readFileSync(BUILD_ORDER_PATH, 'utf8'));
    // Check that infrastructure modules are in the first 7
    const firstSeven = buildOrder.slice(0, 7);
    expect(firstSeven).toContain('error-boundary.js');
    expect(firstSeven).toContain('logger.js');
    expect(firstSeven).toContain('utils.js');
    // error-boundary.js must be first, logger.js must be before utils.js
    expect(buildOrder[0]).toBe('error-boundary.js');
    expect(buildOrder.indexOf('logger.js')).toBeGreaterThan(buildOrder.indexOf('error-boundary.js'));
    expect(buildOrder.indexOf('utils.js')).toBeGreaterThan(buildOrder.indexOf('logger.js'));
  });

  test('source files should have valid JavaScript syntax', () => {
    const buildOrder = JSON.parse(fs.readFileSync(BUILD_ORDER_PATH, 'utf8'));

    buildOrder.forEach(
      /** @param {string} filename */ filename => {
        const filePath = path.join(SRC_DIR, filename);
        const content = fs.readFileSync(filePath, 'utf8');

        // Basic syntax check - should not throw
        expect(() => {
          // Just check if it's parseable, not executable
          new Function(content);
        }).not.toThrow();
      }
    );
  });

  test('build script supports __YTPLUS_INLINE_CSS__ replacement marker', () => {
    const buildScript = fs.readFileSync(BUILD_SCRIPT_PATH, 'utf8');

    expect(buildScript).toContain("content?.includes('__YTPLUS_INLINE_CSS__')");
    expect(buildScript).toContain('/__YTPLUS_INLINE_CSS__\\(\\s*[\'\"]([^\'\"]+?)[\'\"]\\s*\\)/g');
  });
});
