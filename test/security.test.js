/**
 * Unit tests for Security module
 * @jest-environment jsdom
 */

describe('Security Module', () => {
  let YouTubePlusSecurity;

  beforeAll(() => {
    // Load the module once before all tests
    require('../src/security.js');
    YouTubePlusSecurity = window.YouTubePlusSecurity;
    if (!YouTubePlusSecurity) {
      throw new Error('YouTubePlusSecurity failed to load');
    }
  });

  describe('sanitizeHTML', () => {
    it('should escape HTML special characters', () => {
      const input = '<div>Hello World</div>';
      const result = YouTubePlusSecurity.sanitizeHTML(input);
      expect(result).not.toContain('<div>');
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
      expect(result).toContain('Hello World');
    });

    it('should remove script tags', () => {
      const input = 'Hello <script>alert(1)</script> World';
      const result = YouTubePlusSecurity.sanitizeHTML(input);
      expect(result).not.toContain('script');
      expect(result).not.toContain('alert');
    });

    it('should remove iframe tags', () => {
      const input = '<iframe src="evil.com"></iframe>';
      const result = YouTubePlusSecurity.sanitizeHTML(input);
      expect(result).not.toContain('iframe');
    });

    it('should remove javascript: protocol', () => {
      const input = '<a href="javascript:alert(1)">Click</a>';
      const result = YouTubePlusSecurity.sanitizeHTML(input);
      expect(result.toLowerCase()).not.toContain('javascript:');
    });

    it('should remove event handlers', () => {
      const input = '<div onclick="alert(1)">Click</div>';
      const result = YouTubePlusSecurity.sanitizeHTML(input);
      expect(result.toLowerCase()).not.toContain('onclick');
    });

    it('should handle empty input', () => {
      expect(YouTubePlusSecurity.sanitizeHTML('')).toBe('');
    });

    it('should handle non-string input', () => {
      expect(YouTubePlusSecurity.sanitizeHTML(null)).toBe('');
      expect(YouTubePlusSecurity.sanitizeHTML(undefined)).toBe('');
      expect(YouTubePlusSecurity.sanitizeHTML(123)).toBe('');
    });

    it('should truncate very long content', () => {
      const longString = 'a'.repeat(2000000);
      const result = YouTubePlusSecurity.sanitizeHTML(longString);
      expect(result.length).toBeLessThanOrEqual(1000000);
    });

    it('should escape all dangerous characters', () => {
      const input = '< > & " \' / ` =';
      const result = YouTubePlusSecurity.sanitizeHTML(input);
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
      expect(result).toContain('&amp;');
      expect(result).toContain('&quot;');
      expect(result).toContain('&#39;');
      expect(result).toContain('&#x2F;');
      expect(result).toContain('&#x60;');
      expect(result).toContain('&#x3D;');
    });
  });

  describe('validateURL', () => {
    it('should validate HTTP URLs', () => {
      const result = YouTubePlusSecurity.validateURL('http://example.com');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBeTruthy();
      expect(result.error).toBeNull();
    });

    it('should validate HTTPS URLs', () => {
      const result = YouTubePlusSecurity.validateURL('https://example.com');
      expect(result.valid).toBe(true);
    });

    it('should reject javascript: URLs', () => {
      const result = YouTubePlusSecurity.validateURL('javascript:alert(1)');
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should reject data: URLs', () => {
      const result = YouTubePlusSecurity.validateURL('data:text/html,<script>alert(1)</script>');
      expect(result.valid).toBe(false);
    });

    it('should reject file: URLs', () => {
      const result = YouTubePlusSecurity.validateURL('file:///etc/passwd');
      expect(result.valid).toBe(false);
    });

    it('should reject URLs with whitespace', () => {
      const result = YouTubePlusSecurity.validateURL(' http://example.com ');
      expect(result.valid).toBe(false);
    });

    it('should reject URLs that are too long', () => {
      const longUrl = 'http://example.com/' + 'a'.repeat(3000);
      const result = YouTubePlusSecurity.validateURL(longUrl);
      expect(result.valid).toBe(false);
    });

    it('should handle non-string input', () => {
      const result = YouTubePlusSecurity.validateURL(null);
      expect(result.valid).toBe(false);
    });

    it('should require HTTPS when specified', () => {
      const result = YouTubePlusSecurity.validateURL('http://example.com', {
        requireHttps: true,
      });
      expect(result.valid).toBe(false);
    });

    it('should allow HTTPS when required', () => {
      const result = YouTubePlusSecurity.validateURL('https://example.com', {
        requireHttps: true,
      });
      expect(result.valid).toBe(true);
    });

    it('should enforce domain whitelist', () => {
      const result = YouTubePlusSecurity.validateURL('https://evil.com', {
        allowedDomains: ['youtube.com', 'google.com'],
      });
      expect(result.valid).toBe(false);
    });

    it('should allow whitelisted domains', () => {
      const result = YouTubePlusSecurity.validateURL('https://youtube.com/watch', {
        allowedDomains: ['youtube.com', 'google.com'],
      });
      expect(result.valid).toBe(true);
    });

    it('should allow subdomains of whitelisted domains', () => {
      const result = YouTubePlusSecurity.validateURL('https://www.youtube.com/watch', {
        allowedDomains: ['youtube.com'],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('validateVideoId', () => {
    it('should validate correct video IDs', () => {
      expect(YouTubePlusSecurity.validateVideoId('dQw4w9WgXcQ')).toBe(true);
      expect(YouTubePlusSecurity.validateVideoId('abcdefghijk')).toBe(true);
      expect(YouTubePlusSecurity.validateVideoId('ABC_-123456')).toBe(true);
    });

    it('should reject invalid video IDs', () => {
      expect(YouTubePlusSecurity.validateVideoId('short')).toBe(false);
      expect(YouTubePlusSecurity.validateVideoId('toolongvideoID')).toBe(false);
      expect(YouTubePlusSecurity.validateVideoId('invalid@char')).toBe(false);
      expect(YouTubePlusSecurity.validateVideoId('')).toBe(false);
    });

    it('should handle non-string input', () => {
      expect(YouTubePlusSecurity.validateVideoId(null)).toBe(false);
      expect(YouTubePlusSecurity.validateVideoId(undefined)).toBe(false);
      expect(YouTubePlusSecurity.validateVideoId(123)).toBe(false);
    });
  });

  describe('validateEmail', () => {
    it('should validate correct email addresses', () => {
      expect(YouTubePlusSecurity.validateEmail('test@example.com')).toBe(true);
      expect(YouTubePlusSecurity.validateEmail('user.name+tag@example.co.uk')).toBe(true);
    });

    it('should reject invalid email addresses', () => {
      expect(YouTubePlusSecurity.validateEmail('invalid')).toBe(false);
      expect(YouTubePlusSecurity.validateEmail('@example.com')).toBe(false);
      expect(YouTubePlusSecurity.validateEmail('test@')).toBe(false);
      expect(YouTubePlusSecurity.validateEmail('test @example.com')).toBe(false);
    });

    it('should handle non-string input', () => {
      expect(YouTubePlusSecurity.validateEmail(null)).toBe(false);
      expect(YouTubePlusSecurity.validateEmail(123)).toBe(false);
    });

    it('should reject emails that are too long', () => {
      const longEmail = 'a'.repeat(300) + '@example.com';
      expect(YouTubePlusSecurity.validateEmail(longEmail)).toBe(false);
    });
  });

  describe('validateStorageKey', () => {
    it('should validate correct storage keys', () => {
      expect(YouTubePlusSecurity.validateStorageKey('valid_key')).toBe(true);
      expect(YouTubePlusSecurity.validateStorageKey('valid-key')).toBe(true);
      expect(YouTubePlusSecurity.validateStorageKey('valid.key')).toBe(true);
    });

    it('should reject invalid storage keys', () => {
      expect(YouTubePlusSecurity.validateStorageKey('')).toBe(false);
      expect(YouTubePlusSecurity.validateStorageKey('invalid key')).toBe(false);
      expect(YouTubePlusSecurity.validateStorageKey('invalid@key')).toBe(false);
    });

    it('should reject keys that are too long', () => {
      const longKey = 'a'.repeat(150);
      expect(YouTubePlusSecurity.validateStorageKey(longKey)).toBe(false);
    });
  });

  describe('sanitizeInput', () => {
    it('should trim whitespace by default', () => {
      const result = YouTubePlusSecurity.sanitizeInput('  test  ');
      expect(result).toBe('test');
    });

    it('should remove control characters', () => {
      const result = YouTubePlusSecurity.sanitizeInput('test\x00\x01\x02');
      expect(result).toBe('test');
    });

    it('should truncate to max length', () => {
      const longInput = 'a'.repeat(20000);
      const result = YouTubePlusSecurity.sanitizeInput(longInput, { maxLength: 100 });
      expect(result.length).toBe(100);
    });

    it('should remove newlines when not allowed', () => {
      const result = YouTubePlusSecurity.sanitizeInput('line1\nline2', {
        allowNewlines: false,
      });
      expect(result).not.toContain('\n');
    });

    it('should preserve newlines when allowed', () => {
      const result = YouTubePlusSecurity.sanitizeInput('line1\nline2', {
        allowNewlines: true,
      });
      expect(result).toContain('line1');
      expect(result).toContain('line2');
    });

    it('should handle non-string input', () => {
      expect(YouTubePlusSecurity.sanitizeInput(null)).toBe('');
      expect(YouTubePlusSecurity.sanitizeInput(123)).toBe('');
    });
  });

  describe('validateJSON', () => {
    it('should validate correct JSON', () => {
      const result = YouTubePlusSecurity.validateJSON('{"key": "value"}');
      expect(result.valid).toBe(true);
      expect(result.parsed).toEqual({ key: 'value' });
      expect(result.error).toBeNull();
    });

    it('should reject invalid JSON', () => {
      const result = YouTubePlusSecurity.validateJSON('{invalid}');
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should handle non-string input', () => {
      const result = YouTubePlusSecurity.validateJSON(null);
      expect(result.valid).toBe(false);
    });

    it('should reject JSON that is too large', () => {
      const largeJSON = '{"data": "' + 'a'.repeat(6000000) + '"}';
      const result = YouTubePlusSecurity.validateJSON(largeJSON);
      expect(result.valid).toBe(false);
    });

    it('should parse arrays', () => {
      const result = YouTubePlusSecurity.validateJSON('[1, 2, 3]');
      expect(result.valid).toBe(true);
      expect(result.parsed).toEqual([1, 2, 3]);
    });
  });

  describe('generateNonce', () => {
    it('should generate a nonce', () => {
      const nonce = YouTubePlusSecurity.generateNonce();
      expect(typeof nonce).toBe('string');
      expect(nonce.length).toBeGreaterThan(0);
    });

    it('should generate unique nonces', () => {
      const nonce1 = YouTubePlusSecurity.generateNonce();
      const nonce2 = YouTubePlusSecurity.generateNonce();
      expect(nonce1).not.toBe(nonce2);
    });

    it('should generate hex string', () => {
      const nonce = YouTubePlusSecurity.generateNonce();
      expect(/^[0-9a-f]+$/.test(nonce)).toBe(true);
    });
  });

  describe('isSecureContext', () => {
    it('should check if context is secure', () => {
      const result = YouTubePlusSecurity.isSecureContext();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('RateLimiter', () => {
    it('should create a rate limiter', () => {
      const limiter = new YouTubePlusSecurity.RateLimiter(5, 1000);
      expect(limiter).toBeDefined();
    });

    it('should allow calls under limit', () => {
      const limiter = new YouTubePlusSecurity.RateLimiter(3, 1000);
      expect(limiter.isAllowed()).toBe(true);
      expect(limiter.isAllowed()).toBe(true);
      expect(limiter.isAllowed()).toBe(true);
    });

    it('should block calls over limit', () => {
      const limiter = new YouTubePlusSecurity.RateLimiter(2, 1000);
      expect(limiter.isAllowed()).toBe(true);
      expect(limiter.isAllowed()).toBe(true);
      expect(limiter.isAllowed()).toBe(false);
    });

    it('should reset rate limiter', () => {
      const limiter = new YouTubePlusSecurity.RateLimiter(1, 1000);
      limiter.isAllowed();
      expect(limiter.isAllowed()).toBe(false);
      limiter.reset();
      expect(limiter.isAllowed()).toBe(true);
    });

    it('should track different keys separately', () => {
      const limiter = new YouTubePlusSecurity.RateLimiter(1, 1000);
      expect(limiter.isAllowed('key1')).toBe(true);
      expect(limiter.isAllowed('key2')).toBe(true);
      expect(limiter.isAllowed('key1')).toBe(false);
      expect(limiter.isAllowed('key2')).toBe(false);
    });
  });

  describe('Constants', () => {
    it('should expose PATTERNS', () => {
      expect(YouTubePlusSecurity.PATTERNS).toBeDefined();
      expect(YouTubePlusSecurity.PATTERNS.URL).toBeInstanceOf(RegExp);
      expect(YouTubePlusSecurity.PATTERNS.VIDEO_ID).toBeInstanceOf(RegExp);
    });

    it('should expose MAX_LENGTHS', () => {
      expect(YouTubePlusSecurity.MAX_LENGTHS).toBeDefined();
      expect(typeof YouTubePlusSecurity.MAX_LENGTHS.URL).toBe('number');
      expect(YouTubePlusSecurity.MAX_LENGTHS.URL).toBeGreaterThan(0);
    });
  });
});
