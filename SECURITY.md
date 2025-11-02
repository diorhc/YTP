/\*\*

- Security Best Practices for YouTube+ Userscript
  \*/

# Security Guidelines

## Content Security Policy (CSP) Compliance

### TrustedTypes Implementation

The project uses TrustedTypes to prevent DOM-based XSS attacks:

```javascript
// ✅ Good: Using TrustedTypes policy
const { createHTML } = ensureTrustedTypesPolicy();
element.innerHTML = createHTML(userContent);

// ❌ Bad: Direct innerHTML assignment
element.innerHTML = userContent; // XSS risk!
```

### CSP Headers

Recommended CSP headers for serving the userscript:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  connect-src 'self' https://www.youtube.com;
  img-src 'self' https://i.ytimg.com;
```

## Input Validation

### User Input Sanitization

Always validate and sanitize user input:

```javascript
// ✅ Good: Validate before use
function setVideoTime(time) {
  const parsed = parseFloat(time);
  if (isNaN(parsed) || parsed < 0) {
    throw new Error('Invalid time value');
  }
  video.currentTime = Math.min(parsed, video.duration);
}

// ❌ Bad: Direct use without validation
function setVideoTime(time) {
  video.currentTime = time; // Could crash or behave unexpectedly
}
```

### DOM Selector Injection Prevention

```javascript
// ✅ Good: Use predefined selectors
const allowedSelectors = ['#video', '.player', '[data-id]'];
if (!allowedSelectors.includes(selector)) {
  throw new Error('Invalid selector');
}

// ❌ Bad: User-controlled selectors
const element = document.querySelector(userInput); // DOM injection risk
```

## Data Storage Security

### localStorage Best Practices

```javascript
// ✅ Good: Validate data from storage
function loadSettings() {
  try {
    const data = localStorage.getItem('settings');
    if (!data) return defaultSettings;

    const parsed = JSON.parse(data);
    // Validate structure
    if (typeof parsed !== 'object' || !parsed.version) {
      return defaultSettings;
    }
    return { ...defaultSettings, ...parsed };
  } catch (e) {
    console.error('Failed to load settings', e);
    return defaultSettings;
  }
}

// ❌ Bad: Trust data blindly
function loadSettings() {
  return JSON.parse(localStorage.getItem('settings'));
}
```

### Sensitive Data

- ⚠️ Never store passwords or tokens in localStorage
- ⚠️ Use sessionStorage for temporary data
- ⚠️ Consider encrypting sensitive data
- ⚠️ Clear sensitive data on logout

## External Resource Loading

### Script Injection Prevention

```javascript
// ✅ Good: Validate external resources
function loadExternalScript(url) {
  const allowedDomains = ['cdn.example.com', 'trusted.cdn.net'];
  const urlObj = new URL(url);

  if (!allowedDomains.includes(urlObj.hostname)) {
    throw new Error('Untrusted domain');
  }

  const script = document.createElement('script');
  script.src = url;
  script.integrity = 'sha384-...'; // Use SRI
  script.crossOrigin = 'anonymous';
  document.head.appendChild(script);
}
```

### GM_xmlhttpRequest Security

```javascript
// ✅ Good: Validate URLs and responses
GM_xmlhttpRequest({
  method: 'GET',
  url: 'https://api.trusted.com/data',
  onload: function (response) {
    try {
      const data = JSON.parse(response.responseText);
      // Validate response structure
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response');
      }
      processData(data);
    } catch (e) {
      console.error('Request failed', e);
    }
  },
  onerror: function (error) {
    console.error('Request error', error);
  },
});
```

## Error Handling Security

### Don't Leak Sensitive Information

```javascript
// ✅ Good: Generic error messages to users
try {
  // operation
} catch (e) {
  console.error('[Internal]', e); // Detailed log for debugging
  showUserError('Operation failed. Please try again.'); // Generic message
}

// ❌ Bad: Exposing stack traces to users
catch (e) {
  alert(e.stack); // Exposes internal implementation
}
```

## Rate Limiting

### Prevent Resource Exhaustion

```javascript
// ✅ Good: Rate limiting
const rateLimiter = {
  calls: new Map(),
  limit: 10,
  window: 60000, // 1 minute

  check(key) {
    const now = Date.now();
    const calls = this.calls.get(key) || [];

    // Remove old calls
    const recentCalls = calls.filter(time => now - time < this.window);

    if (recentCalls.length >= this.limit) {
      throw new Error('Rate limit exceeded');
    }

    recentCalls.push(now);
    this.calls.set(key, recentCalls);
  },
};

// Use before expensive operations
function expensiveOperation(userId) {
  rateLimiter.check(userId);
  // ... perform operation
}
```

## Cross-Site Scripting (XSS) Prevention

### Event Handler Injection

```javascript
// ✅ Good: Use addEventListener
element.addEventListener('click', handler);

// ❌ Bad: Inline event handlers with user data
element.onclick = new Function(userData); // XSS risk!
```

### URL Manipulation

```javascript
// ✅ Good: Validate and sanitize URLs
function safeRedirect(url) {
  try {
    const parsed = new URL(url);
    // Only allow YouTube domains
    if (!parsed.hostname.endsWith('youtube.com')) {
      throw new Error('Invalid domain');
    }
    window.location.href = parsed.href;
  } catch (e) {
    console.error('Invalid URL', e);
  }
}

// ❌ Bad: Direct navigation
window.location.href = userInput; // Open redirect vulnerability
```

## Regular Security Audits

### Automated Checks

```bash
# Run security audit
npm audit

# Fix vulnerabilities
npm audit fix

# Check for outdated dependencies
npm outdated

# Update dependencies
npm update
```

### Manual Review Checklist

- [ ] Review all user input handling
- [ ] Check for XSS vulnerabilities
- [ ] Validate external resource loading
- [ ] Review error messages for information leakage
- [ ] Check localStorage usage
- [ ] Verify CSP compliance
- [ ] Test rate limiting
- [ ] Review permission requirements

## Secure Coding Practices

### Principle of Least Privilege

```javascript
// ✅ Only request necessary permissions in userscript metadata
// @grant GM_getValue
// @grant GM_setValue

// ❌ Don't request unnecessary permissions
// @grant GM_deleteValue  // If not needed
// @grant GM_xmlhttpRequest  // If not needed
```

### Defense in Depth

- Multiple layers of validation
- Error boundaries around risky operations
- Fail securely (deny by default)
- Log security events

### Keep Dependencies Updated

```json
{
  "scripts": {
    "security:audit": "npm audit --audit-level=moderate",
    "security:fix": "npm audit fix",
    "deps:check": "npm outdated",
    "deps:update": "npm update"
  }
}
```

## Incident Response

### Security Issue Template

If you discover a security vulnerability:

1. **DO NOT** open a public GitHub issue
2. Email: [security@example.com] with:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
3. Wait for response before disclosure
4. Follow responsible disclosure timeline

### Timeline

- Day 0: Report received
- Day 1-7: Acknowledge and investigate
- Day 7-30: Develop and test fix
- Day 30-90: Deploy fix and coordinate disclosure

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [MDN Web Security](https://developer.mozilla.org/en-US/docs/Web/Security)
- [TrustedTypes API](https://web.dev/trusted-types/)
- [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Userscript Security](https://wiki.greasespot.net/Security)

## Conclusion

Security is an ongoing process. Regular audits, dependency updates, and following best practices are essential for maintaining a secure userscript. Always validate input, sanitize output, and fail securely.
