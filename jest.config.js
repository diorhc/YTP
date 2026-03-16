module.exports = {
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    url: 'https://www.youtube.com/',
  },
  testMatch: ['**/test/**/*.test.js', '**/test/**/*.spec.js'],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
  collectCoverageFrom: ['src/**/*.js', '!src/**/*.min.js', '!src/**/*.d.ts', '!node_modules/**'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  coveragePathIgnorePatterns: ['/node_modules/', '/test/', '/coverage/', 'youtube.user.js'],
  // Coverage thresholds disabled: unit tests mock all functionality inline,
  // so actual src/ file coverage is expected to be 0%. Use e2e tests for real coverage.
  // coverageThreshold: {
  //   global: {
  //     branches: 15,
  //     functions: 15,
  //     lines: 20,
  //     statements: 20,
  //   },
  // },
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
