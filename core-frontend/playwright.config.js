import { defineConfig } from '@playwright/test';
import path from 'node:path';
import process from 'node:process';

const backendDirectory = path.resolve(process.cwd(), '../core-backend');
const testDatabase = process.env.PLAYWRIGHT_DB_NAME || 'giftly_e2e_test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    browserName: 'chromium',
    channel: 'msedge',
    headless: true,
  },
  webServer: [
    {
      command: 'npm.cmd start',
      cwd: backendDirectory,
      env: {
        DB_NAME: testDatabase,
        TEST_DB_NAME: testDatabase,
        VNPAY_TMN_CODE: 'GIFTLYTEST',
        VNPAY_HASH_SECRET: 'playwright-only-dummy-secret-never-use-for-merchant',
        VNPAY_RETURN_URL: 'http://localhost:5000/api/payments/vnpay/return',
      },
      url: 'http://localhost:5000/',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm.cmd run dev -- --host localhost --port 5173',
      cwd: process.cwd(),
      url: 'http://localhost:5173/',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
