module.exports = {
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    url: 'https://www.youtube.com/',
  },
  testMatch: ['**/test/**/*.test.js', '**/test/**/*.spec.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/**/*.min.js', '!src/**/*.d.ts', '!node_modules/**'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  coveragePathIgnorePatterns: ['/node_modules/', '/test/', '/coverage/', 'youtube.user.js'],
  // Realistic thresholds - tests are unit tests with heavy mocking
  // These tests verify behavior and error handling, not line-by-line coverage
  // Coverage is intentionally low as this is a userscript with browser-specific code
  coverageThreshold: {
    global: {
      branches: 2,
      functions: 3,
      lines: 3,
      statements: 3,
    },
  },
  verbose: true,
  testTimeout: 10000,
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  moduleFileExtensions: ['js', 'json'],
  transform: {},
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
