import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      diagnostics: false, // Skip type-checking in tests (faster)
    }],
  },
  collectCoverageFrom: [
    'strategies/**/*.ts',
    'hooks/**/*.ts',
    'utils/**/*.ts',
    'coordination/**/*.ts',
    'config/**/*.ts',
    '!**/*.d.ts',
    '!**/index.ts',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
};

export default config;
