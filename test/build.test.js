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

    buildOrder.forEach(filename => {
      const filePath = path.join(SRC_DIR, filename);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  test('all source files should be in build.order.json', () => {
    const buildOrder = JSON.parse(fs.readFileSync(BUILD_ORDER_PATH, 'utf8'));
    const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));

    files.forEach(file => {
      expect(buildOrder).toContain(file);
    });
  });

  test('constants.js should be first in build order', () => {
    const buildOrder = JSON.parse(fs.readFileSync(BUILD_ORDER_PATH, 'utf8'));
    expect(buildOrder[0]).toBe('constants.js');
  });

  test('infrastructure modules should come early in build order', () => {
    const buildOrder = JSON.parse(fs.readFileSync(BUILD_ORDER_PATH, 'utf8'));
    // Verify first 13 items are core infrastructure modules
    const first13 = buildOrder.slice(0, 13);
    expect(first13).toContain('constants.js');
    expect(first13).toContain('debug-config.js');
    expect(first13).toContain('logger.js');
    expect(first13).toContain('security.js');
    expect(first13).toContain('dom-manager.js');
    expect(first13).toContain('settings-manager.js');
    expect(first13).toContain('style-manager.js');
    expect(first13).toContain('notification-manager.js');
    // constants.js should always be first
    expect(buildOrder[0]).toBe('constants.js');
  });

  test('source files should have valid JavaScript syntax', () => {
    const buildOrder = JSON.parse(fs.readFileSync(BUILD_ORDER_PATH, 'utf8'));

    buildOrder.forEach(filename => {
      const filePath = path.join(SRC_DIR, filename);
      const content = fs.readFileSync(filePath, 'utf8');

      // Basic syntax check - should not throw
      expect(() => {
        // Just check if it's parseable, not executable
        new Function(content);
      }).not.toThrow();
    });
  });
});
