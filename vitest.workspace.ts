import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['packages/core/test/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'integration',
      include: ['packages/adapters/test/**/*.integration.test.ts'],
      environment: 'node',
      testTimeout: 30_000,
    },
  },
]);
