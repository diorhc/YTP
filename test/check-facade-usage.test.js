/**
 * Unit tests for scripts/check-facade-usage.js
 * Verifies that facade member analysis and ratchet enforcement work as intended.
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  analyzeFacadeUsage,
  extractDeclaredMembers,
  loadBaseline,
} = require('../scripts/check-facade-usage');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-facade-usage.js');

describe('check-facade-usage analysis', () => {
  test('extractDeclaredMembers extracts properties from facade object assignment', () => {
    const code = `
      window.YouTubePlusTestFacade = {
        foo: () => 1,
        bar: 2,
        baz() { return 3; }
      };
    `;
    const members = extractDeclaredMembers('YouTubePlusTestFacade', code);
    expect(members.has('foo')).toBe(true);
    expect(members.has('bar')).toBe(true);
    expect(members.has('baz')).toBe(true);
    expect(members.size).toBe(3);
  });

  test('flags members with zero callers in other src files and ignores used members', () => {
    const tracked = {
      YouTubePlusSample: 'src/sample.js',
    };
    const mockSrc = {
      'src/sample.js': `
        window.YouTubePlusSample = {
          usedMember: () => true,
          deadMember: () => false,
        };
      `,
      'src/consumer.js': `
        const val = window.YouTubePlusSample.usedMember();
      `,
    };
    const mockTest = {
      'test/sample.test.js': `
        expect(window.YouTubePlusSample.deadMember()).toBe(false);
      `,
    };

    const res = analyzeFacadeUsage(tracked, mockSrc, mockTest);
    expect(res.total).toBe(1);
    expect(res.violations[0].member).toBe('deadMember');
    expect(res.violations[0].testHits).toBeGreaterThan(0);
    expect(res.byFacade.YouTubePlusSample).toBe(1);
  });

  test('baseline file exists and matches current ratchet ceilings', () => {
    const baseline = loadBaseline();
    expect(typeof baseline.total).toBe('number');
    expect(baseline.total).toBe(45);
    expect(baseline.byFacade.YouTubePlusDownload).toBe(13);
    expect(baseline.byFacade.YouTubePlusMain).toBe(12);
    expect(baseline.byFacade.YouTubePlusPlaylistSearch).toBe(9);
    expect(baseline.byFacade.YouTubePlusSettingsHelpers).toBe(11);
  });

  test('script CLI exits 0 under standard execution', () => {
    const out = execFileSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(out).toContain('Facade usage:');
    expect(out).toContain('ceiling: 45');
  });

  test('script CLI --report prints breakdown by facade', () => {
    const out = execFileSync(process.execPath, [SCRIPT, '--report'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(out).toContain('YouTubePlusDownload');
    expect(out).toContain('YouTubePlusMain');
    expect(out).toContain('YouTubePlusPlaylistSearch');
    expect(out).toContain('YouTubePlusSettingsHelpers');
  });
});
