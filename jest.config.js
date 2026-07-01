module.exports = {
  testEnvironment: "jsdom",
  testEnvironmentOptions: {
    url: "https://www.youtube.com/",
  },
  testMatch: ["**/test/**/*.test.js", "**/test/**/*.spec.js"],
  testPathIgnorePatterns: ["/node_modules/", "/e2e/"],
  // Track every runtime module. The legacy src/types.d.ts was removed
  // when the global type definitions were consolidated into types/index.d.ts,
  // but the explicit exclusion is kept here as a safety net in case the
  // file ever reappears (e.g. during a partial re-merge).
  collectCoverageFrom: ["src/**/*.js", "!src/types.d.ts"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html", "json-summary"],
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "<rootDir>/test/",
    "<rootDir>/coverage/",
    "youtube.user.js",
  ],
  // Phase-2 thresholds. Tracking every module pulls in large DOM-heavy
  // runtime files with shallow test coverage, so the global thresholds
  // are set modestly to catch regressions while still accepting the
  // current coverage distribution.
  //
  // The dominant uncovered files are main.js (6085 lines, @ts-nocheck,
  // 5.6% covered — only the outer boot IIFE is testable in jsdom) and
  // timecode.js (2201 lines, 0% — an IIFE that requires full YouTube
  // page DOM). Excluding them from the threshold is not ideal because
  // it hides regressions; instead, thresholds are set just below
  // current aggregate values so CI stays green while preventing
  // meaningful drops in the well-tested modules.
  //
  // Current CI coverage (v8): lines 28.88%, functions 42.78%, branches 51.48%.
  // Thresholds set below CI baseline to prevent false negatives.
  coverageThreshold: {
    global: {
      branches: 51,
      functions: 42,
      lines: 28,
      statements: 28,
    },
  },
  verbose: true,
  testTimeout: 10000,
  setupFilesAfterEnv: ["<rootDir>/test/setup.js"],
  moduleFileExtensions: ["js", "json"],
  transform: {},
  coverageProvider: "v8",
  // Only collect coverage when explicitly requested via --coverage flag
  collectCoverage: false,
  // Improve test performance
  maxWorkers: "50%",
  // Clear mocks between tests
  clearMocks: true,
  // Reset mocks between tests
  resetMocks: true,
  // Restore mocks between tests
  restoreMocks: true,
};
