const fs = require('fs');
const path = require('path');
const { scanContent, ALLOWLISTED_LITERALS } = require('../scripts/check-secrets.js');

describe('Runtime supply chain and secret detection', () => {
  const rootDir = path.resolve(__dirname, '..');
  const packageJsonPath = path.join(rootDir, 'package.json');

  describe('Literal-level secrets allowlist', () => {
    const allowedKey = [...ALLOWLISTED_LITERALS][0];
    const dummySecret = 'fake_secret_token_123456789012345678901234567890.abcdefg';

    test('clean line with allowlisted public literal produces 0 findings', () => {
      const content = `const supabaseAnonKey = '${allowedKey}';`;
      const findings = scanContent(content, 'src/voting.js');
      expect(findings).toHaveLength(0);
    });

    test('line with dummy secret produces finding', () => {
      const content = `const api_token = '${dummySecret}';`;
      const findings = scanContent(content, 'src/test.js');
      expect(findings.length).toBeGreaterThan(0);
    });

    test('line with allowlisted key AND dummy secret on the same line produces finding', () => {
      const content = `const supabaseAnonKey = '${allowedKey}'; const api_token = '${dummySecret}';`;
      const findings = scanContent(content, 'src/test.js');
      expect(findings.length).toBeGreaterThan(0);
    });

    test('findings report file and line but do NOT leak the secret value', () => {
      const content = `const api_token = '${dummySecret}';`;
      const findings = scanContent(content, 'src/test.js');
      for (const finding of findings) {
        expect(finding).not.toContain(dummySecret);
      }
    });

    test('clean line with legitimate i18n setting path descriptor produces 0 findings', () => {
      const content = "const descriptor = { key: 'styles.themeVariant' };";
      const findings = scanContent(content, 'src/settings-helpers.js');
      expect(findings).toHaveLength(0);
    });

    test('SEC01: line with legitimate i18n path AND dummy secret on the same line produces finding', () => {
      const namedSecret = 'fake_secret_token_1234567890123456789012345';
      const content = `const descriptor = { key: 'styles.themeVariant' }; const secret = '${namedSecret}';`;
      const findings = scanContent(content, 'src/settings-helpers.js');
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0]).toMatch(/potential named secret/);
      expect(findings[0]).not.toContain(namedSecret);
    });
  });

  test('runtime code dependencies use an explicit integrity pin', () => {
    const header = fs.readFileSync(path.join(rootDir, 'userscript.js'), 'utf8');
    const requires = [...header.matchAll(/^\/\/\s*@require\s+(\S+)/gm)].map(match => match[1]);
    expect(requires.length).toBeGreaterThan(0);
    for (const url of requires) {
      expect(url).toMatch(/^https:\/\//);
      expect(url).toMatch(/#sha256=[A-Za-z0-9+/=_-]+$/);
      expect(url).not.toMatch(/@latest|@main/);
    }
  });
  test('dependency audit includes build dependencies', () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    expect(pkg.scripts.security).toContain('npm audit');
    expect(pkg.scripts.security).not.toContain('--omit=dev');
  });
});
