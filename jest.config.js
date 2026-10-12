module.exports = {
  testEnvironment: "jsdom",
  testEnvironmentOptions: {
    url: "https://www.youtube.com/",
  },
  roots: ["<rootDir>/test"],
  testMatch: ["<rootDir>/test/**/*.test.js", "<rootDir>/test/**/*.spec.js"],
  // The release integration suite executes the real release pipeline and is
  // run only through `npm run test:release-integration`, which sets the gate
  // variable before invoking Jest. Outside that run the file is not collected,
  // so a plain `jest` run reports no skipped suites.
  testPathIgnorePatterns: [
    "/node_modules/",
    "/e2e/",
    "<rootDir>/docs/",
    "<rootDir>/test-results/",
    ...(process.env.RUN_RELEASE_INTEGRATION === "1"
      ? []
      : ["/test/release-integration\\.test\\.js$"]),
  ],
  // Track runtime modules. Global type definitions live in types/index.d.ts.
  collectCoverageFrom: ["src/**/*.js", "!src/types.d.ts"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html", "json-summary"],
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "<rootDir>/test/",
    "<rootDir>/coverage/",
    "youtube.user.js",
  ],
  // Global coverage thresholds. Floors sit at the highest whole values the
  // aggregate supports so any drop fails CI. Full coverage of DOM-bound player
  // modules is verified through the browser test suite.
  coverageThreshold: {
    global: {
      branches: 84,
      functions: 95,
      lines: 86,
      statements: 86,
    },
    // NOTE: do NOT add per-file path keys here — Jest excludes files matched
    // by an explicit key from the `global` aggregate, silently redefining the
    // global pool (measured: adding six high-coverage files dropped the global
    // figure from 51.8% to 48.5%). Per-file ratchets live in
    // coverage-ratchet.json, enforced by scripts/check-coverage-ratchet.js
    // after every --coverage run (see `npm run test:ratchet`).
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
