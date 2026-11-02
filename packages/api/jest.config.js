/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  setupFiles: ["<rootDir>/test/setup.ts"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.test.json" }],
    // Fastify 5 depends on the ESM-only `cookie` package. Jest runs CommonJS,
    // so that one dependency has to be transpiled rather than ignored.
    "^.+\\.js$": ["babel-jest", { presets: [["@babel/preset-env", { targets: { node: "current" } }]] }]
  },
  transformIgnorePatterns: ["/node_modules/(?!cookie)/"],
  clearMocks: true,
  coverageDirectory: "coverage",
  collectCoverageFrom: ["src/**/*.ts", "!src/index.ts", "!src/db/migrations/**"],
  coverageReporters: ["text", "lcov", "json-summary", "cobertura"]
};
