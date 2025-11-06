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
  coverageThreshold: {
    global: {
      branches: 30,
      functions: 30,
      lines: 30,
      statements: 30,
    },
  },
  verbose: true,
  testTimeout: 10000,
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  moduleFileExtensions: ['js', 'json'],
  transform: {},
  // Fix coverage collection - transform is empty but we need to collect from source files
  collectCoverage: false, // Only when explicitly requested via --coverage flag
  // Force coverage collection when running with --coverage
  forceCoverageMatch: ['**/src/**/*.js'],
};
