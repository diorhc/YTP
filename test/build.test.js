/**
 * Integration tests for build system
 */

const fs = require('fs');
const path = require('path');

describe('Build System', () => {
  const ROOT = path.resolve(__dirname, '..');
  const BUILD_ORDER_PATH = path.join(ROOT, 'build.order.json');
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

  test('shared-defaults.js should be first in build order', () => {
    const buildOrder = JSON.parse(fs.readFileSync(BUILD_ORDER_PATH, 'utf8'));
    expect(buildOrder[0]).toBe('shared-defaults.js');
    expect(buildOrder[1]).toBe('logger.js');
  });

  test('infrastructure modules should come early in build order', () => {
    const buildOrder = JSON.parse(fs.readFileSync(BUILD_ORDER_PATH, 'utf8'));
    // Check that infrastructure modules are in the first 5
    const firstSix = buildOrder.slice(0, 6);
    expect(firstSix).toContain('shared-defaults.js');
    expect(firstSix).toContain('logger.js');
    expect(firstSix).toContain('module-registry.js');
    expect(firstSix).toContain('utils.js');
    // shared-defaults.js must be first, then logger.js, then utils.js
    expect(buildOrder[0]).toBe('shared-defaults.js');
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
});
