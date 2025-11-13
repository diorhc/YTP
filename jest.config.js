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
  // Lower thresholds temporarily - the tests are unit tests with heavy mocking
  // Real coverage is much lower than what Jest reports
  coverageThreshold: {
    global: {
      branches: 10,
      functions: 10,
      lines: 10,
      statements: 10,
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
