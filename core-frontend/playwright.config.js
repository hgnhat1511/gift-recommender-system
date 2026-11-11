import { defineConfig } from '@playwright/test';
import path from 'node:path';
import process from 'node:process';
import { randomBytes } from 'node:crypto';

const backendDirectory = path.resolve(process.cwd(), '../core-backend');
const testDatabase = process.env.PLAYWRIGHT_DB_NAME || 'giftly_e2e_test';
const backendPort = Number(process.env.E2E_BACKEND_PORT) || 5001;
const frontendPort = Number(process.env.E2E_FRONTEND_PORT) || 5174;
const backendUrl = process.env.E2E_BACKEND_URL || `http://localhost:${backendPort}`;
process.env.E2E_BACKEND_URL = backendUrl;
const frontendUrl = process.env.E2E_FRONTEND_URL || `http://localhost:${frontendPort}`;
process.env.E2E_FRONTEND_URL = frontendUrl;
const vnpayHashSecret = process.env.E2E_VNPAY_HASH_SECRET || randomBytes(32).toString('hex');

export default defineConfig({
  globalSetup: './e2e/global-setup.js',
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: frontendUrl,
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
        E2E_DEMO_USER_PASSWORD: process.env.E2E_DEMO_USER_PASSWORD,
        E2E_GHN_SHOP_ID: process.env.E2E_GHN_SHOP_ID,
        E2E_GHN_WEBHOOK_SECRET: process.env.E2E_GHN_WEBHOOK_SECRET,
        GHN_SHOP_ID: process.env.E2E_GHN_SHOP_ID,
        GHN_WEBHOOK_SECRET: process.env.E2E_GHN_WEBHOOK_SECRET,
        RETURN_WINDOW_DAYS: process.env.RETURN_WINDOW_DAYS || '7',
        NODE_ENV: 'test',
        PORT: String(backendPort),
        CORS_ORIGIN: frontendUrl,
        VNPAY_TMN_CODE: 'GIFTLYTEST',
        VNPAY_HASH_SECRET: vnpayHashSecret,
        VNPAY_RETURN_URL: `${backendUrl}/api/payments/vnpay/return`,
      },
      url: `${backendUrl}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm.cmd run dev -- --host localhost --port ${frontendPort}`,
      cwd: process.cwd(),
      url: `http://localhost:${frontendPort}/`,
      env: { VITE_API_BASE_URL: `${backendUrl}/api` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
