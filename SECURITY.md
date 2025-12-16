# Security Policy

## Supported Versions

We actively maintain security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| < 1.0   | :x:                |

## Security Features

### 1. Content Security Policy (CSP)

- TrustedTypes policy implementation for safe HTML handling
- Strict validation of all user inputs and external data
- Sanitization utilities for XSS prevention

### 2. Input Validation

- YouTube video ID validation (11-character alphanumeric)
- YouTube channel ID validation (UC prefix + 22 characters)
- URL validation for YouTube domains only
- Number range validation

### 3. Rate Limiting

- API request rate limiting (10 requests per minute per endpoint)
- Prevents abuse and DoS attacks
- Automatic cleanup of old request records

### 4. Secure Data Handling

- No sensitive data storage
- Local storage only for user preferences
- No external data transmission except to YouTube/approved APIs

### 5. DOM Manipulation Security

- Safe innerHTML usage with TrustedTypes
- Attribute validation and sanitization
- Prevention of prototype pollution

### 6. Network Security

- HTTPS-only external requests
- Request timeouts (10 seconds default)
- Response validation
- CORS-aware fetch operations

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please follow these steps:

### 1. **DO NOT** publicly disclose the vulnerability

### 2. Report via one of these channels:

- **Preferred**: Create a [Security Advisory](https://github.com/diorhc/YTP/security/advisories/new) (private)
- **Alternative**: Email the maintainer (check GitHub profile for contact)
- **Public (non-sensitive)**: Open a [GitHub Issue](https://github.com/diorhc/YTP/issues)

### 3. Include in your report:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if available)
- Your contact information for follow-up

### 4. Response timeline:

- **Initial response**: Within 48 hours
- **Status update**: Within 7 days
- **Fix timeline**: Based on severity
  - Critical: 24-72 hours
  - High: 1-2 weeks
  - Medium: 2-4 weeks
  - Low: Next release cycle

### 5. Disclosure policy:

- We follow responsible disclosure practices
- Coordinated disclosure with reporter
- Public disclosure after fix is released
- Credit to reporter (if desired)

## Security Best Practices for Contributors

### Code Review Checklist

1. **Input Validation**
   - [ ] All user inputs are validated
   - [ ] Video IDs match regex pattern
   - [ ] URLs are from YouTube domains only
   - [ ] Numbers are within safe ranges

2. **XSS Prevention**
   - [ ] Use `textContent` for plain text
   - [ ] Use `YouTubeSecurityUtils.setInnerHTMLSafe()` for HTML
   - [ ] Never use `innerHTML` with unsanitized data
   - [ ] Validate all attributes before `setAttribute`

3. **API Security**
   - [ ] Rate limiting implemented
   - [ ] Request timeouts set
   - [ ] Response validation performed
   - [ ] HTTPS URLs only

4. **Error Handling**
   - [ ] No sensitive data in error messages
   - [ ] Proper try-catch blocks
   - [ ] User-friendly error messages
   - [ ] Logging limited to console.warn/error

5. **Code Quality**
   - [ ] ESLint passes with no security warnings
   - [ ] CodeQL analysis passes
   - [ ] No eval() or Function() constructor
   - [ ] No document.write()

## Security Testing

### Automated Testing

- **CodeQL**: Runs on every push and PR
- **ESLint**: Security rules enabled
- **Dependency scanning**: GitHub Dependabot (if enabled)

### Manual Testing

- XSS testing with malicious payloads
- Input validation testing
- Rate limiting verification
- Error handling validation

## Known Security Limitations

### Userscript Environment

- Runs in user's browser context
- Relies on Tampermonkey/Greasemonkey security
- Cannot prevent all client-side attacks
- User must trust the script source

### Third-Party APIs

- Return YouTube Dislike API (external)
- YouTube InnerTube API (official but undocumented)
- Dependency on external service availability

### Browser Compatibility

- TrustedTypes not available in all browsers
- Falls back to less secure methods when unavailable

## Security Audits

- **Last full audit**: December 16, 2025
- **Next scheduled audit**: Quarterly (Q1 2026: January 1, 2026)
- **Automated scanning**: Continuous (GitHub Actions)
- **Audit workflow**: `.github/workflows/security-audit.yml`
- **Audit schedule**: See [SECURITY_AUDIT_SCHEDULE.md](SECURITY_AUDIT_SCHEDULE.md)
- **CSP Configuration**: See [SECURITY_CSP.md](SECURITY_CSP.md)

## Dependencies

We minimize dependencies to reduce attack surface:

- No runtime dependencies
- Build-time dependencies regularly updated
- **Automated dependency updates**: Dependabot configured (`.github/dependabot.yml`)
- **Weekly dependency updates**: Every Monday at 09:00 UTC
- **Automated security updates**: Enabled for all vulnerability levels

## Incident Response Plan

1. **Detection**: Via report or automated scanning
2. **Assessment**: Severity rating (Critical/High/Medium/Low)
3. **Containment**: Disable affected features if needed
4. **Fix**: Develop and test patch
5. **Deployment**: Release patched version
6. **Communication**: Notify users and reporter
7. **Post-mortem**: Document lessons learned

## Contact

- **Security issues**: Use GitHub Security Advisories
- **General questions**: Open a GitHub Discussion

## Additional Security Documentation

- 📋 [SECURITY_CSP.md](SECURITY_CSP.md) - Content Security Policy configuration and innerHTML audit
- 📅 [SECURITY_AUDIT_SCHEDULE.md](SECURITY_AUDIT_SCHEDULE.md) - Quarterly audit schedule and checklist
- 🔧 [SECURITY_FIXES_2024-12-16.md](SECURITY_FIXES_2024-12-16.md) - Recent security improvements
- ⚙️ `.github/dependabot.yml` - Automated dependency update configuration
- 🤖 `.github/workflows/security-audit.yml` - Automated security audit workflow

---

**Last updated**: December 16, 2025  
**Version**: 2.0
