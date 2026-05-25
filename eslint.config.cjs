// ESLint flat config for ESLint v9+
const security = require('eslint-plugin-security');
const noUnsanitized = require('eslint-plugin-no-unsanitized');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'youtube.user.js',
      'youtube.user.unoptimized.js',
      'dist/**',
      'coverage/**',
      'test/**',
      'e2e-report/**',
      'test-results/**',
    ],
  },
  // Security plugin (recommended), with the noisy false-positive disabled.
  {
    ...security.configs.recommended,
    rules: {
      ...(security.configs.recommended.rules || {}),
      // Dynamic property access is pervasive in this codebase (settings keys,
      // i18n maps, etc.) — keep as warning instead of erroring/noisy.
      'security/detect-object-injection': 'off',
      // Keep ReDoS-related rules visible as warnings.
      'security/detect-unsafe-regex': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  // No-unsanitized (XSS via innerHTML / createContextualFragment).
  {
    plugins: { 'no-unsanitized': noUnsanitized },
    rules: {
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        // Browser globals for userscript
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        location: 'readonly',
        navigator: 'readonly',
        history: 'readonly',
        trustedTypes: 'readonly',
        queueMicrotask: 'readonly',
        customElements: 'readonly',
        unsafeWindow: 'readonly',
        // DOM APIs
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        DOMParser: 'readonly',
        CustomEvent: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        StorageEvent: 'readonly',
        MutationObserver: 'readonly',
        IntersectionObserver: 'readonly',
        ResizeObserver: 'readonly',
        AbortController: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        requestIdleCallback: 'readonly',
        getComputedStyle: 'readonly',
        confirm: 'readonly',
        performance: 'readonly',
        // DOM types/constructors
        Element: 'readonly',
        HTMLElement: 'readonly',
        SVGElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLIFrameElement: 'readonly',
        HTMLMediaElement: 'readonly',
        HTMLSelectElement: 'readonly',
        Node: 'readonly',
        Document: 'readonly',
        DocumentFragment: 'readonly',
        Window: 'readonly',
        CustomElementRegistry: 'readonly',
        // Userscript globals (Tampermonkey/Greasemonkey)
        GM_xmlhttpRequest: 'readonly',
        // Project-specific globals (defined in main.js, shared across modules)
        YouTubeUtils: 'readonly',
        YouTubeSecurityUtils: 'readonly',
        YouTubeDOMCache: 'readonly',
        closestFromAnchor: 'readonly',
        _querySelector: 'readonly',
        $$: 'readonly',
        findContentsRenderer: 'readonly',
        isVideoPlaying: 'readonly',
        // Build script needs Node.js globals
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^(_|\\$|byId)',
          caughtErrorsIgnorePattern: '^(_|e)$',
        },
      ],
      'no-console': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['warn', 'smart'],
      curly: ['warn', 'multi-line'],
      'no-undef': ['error', { typeof: false }],
      'no-prototype-builtins': 'warn',
      // Allow debug flag patterns like: DEBUG && console.log()
      'no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      // Security rules
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'warn',
      'no-with': 'error',
      radix: 'warn',
      'no-restricted-properties': [
        'error',
        {
          object: 'document',
          property: 'write',
          message: 'document.write is unsafe. Use DOM manipulation instead.',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'eval',
          message: 'eval() is unsafe and should not be used.',
        },
      ],
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "CallExpression[callee.name='setTimeout'][arguments.1.type='Literal'][arguments.1.value>=1000]",
          message:
            'Use setTimeout_ wrapper for long delays (>= 1000ms) to keep timer lifecycle centralized.',
        },
        {
          selector:
            "CallExpression[callee.property.name='setTimeout'][arguments.1.type='Literal'][arguments.1.value>=1000]",
          message:
            'Use setTimeout_ wrapper for long delays (>= 1000ms) to keep timer lifecycle centralized.',
        },
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message:
            'Direct innerHTML assignment is restricted. Use YouTubeSafeDOM.setHTML or a template/fragment renderer.',
        },
        {
          selector: 'VariableDeclarator[id.name=/[A-Za-z0-9_]*Any[A-Za-z0-9_]*/]',
          message:
            'Avoid *Any aliases. Prefer typed interfaces from types/index.d.ts or src/types.d.ts.',
        },
        {
          selector: 'VariableDeclarator[id.name=/^wAny\d*$/]',
          message: 'Avoid window any aliases (wAny). Use typed window interfaces instead.',
        },
      ],
    },
  },
];
