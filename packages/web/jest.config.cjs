/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  transform: {
    "^.+\\.(ts|tsx)$": "babel-jest"
  },
  moduleNameMapper: {
    "\\.(css|scss)$": "identity-obj-proxy"
  },
  setupFilesAfterEnv: ["<rootDir>/src/setupTests.ts"],
  coverageDirectory: "coverage",
  // view-types.ts is types only - it compiles to an empty module, so counting
  // it would report a permanent 0% for a file that has no runtime behaviour.
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/main.tsx", "!src/setupTests.ts", "!src/view-types.ts"],
  coverageReporters: ["text", "lcov", "json-summary", "cobertura"]
};
