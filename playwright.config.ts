import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3211',
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: 'node server/index.mjs',
    url: 'http://127.0.0.1:3211',
    env: {
      PORT: '3211',
      HOST: '127.0.0.1',
      DATA_DIR: 'test-results/e2e-data',
      ACCESS_CODE: 'workshop-test-code',
    },
    reuseExistingServer: false,
  },
});
