module.exports = {
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    url: 'https://www.youtube.com/',
  },
  testMatch: ['**/test/**/*.test.js', '**/test/**/*.spec.js'],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
  // Keep coverage meaningful: only include modules currently exercised by unit tests.
  // Large DOM-heavy runtime modules are validated by lint/build/e2e and will be added here
  // as dedicated unit tests are introduced.
  collectCoverageFrom: [
    'src/event-delegation.js',
    'src/i18n.js',
    'src/logger.js',
    'src/module-registry.js',
    'src/safe-dom.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/test/',
    '<rootDir>/coverage/',
    'youtube.user.js',
  ],
  // Coverage thresholds set below the current measured baseline (~79% lines/statements,
  // ~70% branches, ~63% functions) to catch regressions without blocking CI.
  coverageThreshold: {
    global: {
      branches: 65,
      functions: 60,
      lines: 75,
      statements: 75,
    },
  },
  verbose: true,
  testTimeout: 10000,
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  moduleFileExtensions: ['js', 'json'],
  transform: {},
  coverageProvider: 'v8',
  // Only collect coverage when explicitly requested via --coverage flag
  collectCoverage: false,
  // Improve test performance
  maxWorkers: '50%',
  // Clear mocks between tests
  clearMocks: true,
  // Reset mocks between tests
  resetMocks: true,
  // Restore mocks between tests
  restoreMocks: true,
};
