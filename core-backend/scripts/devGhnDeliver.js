'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to send a development GHN webhook in production.');
  process.exit(1);
}

const dbName = (process.env.DB_NAME || '').trim();
const testDbName = (process.env.TEST_DB_NAME || '').trim();
if (dbName !== 'giftly_e2e_test' || testDbName !== 'giftly_e2e_test') {
  console.error('Refusing to send a development GHN webhook unless DB_NAME and TEST_DB_NAME are both giftly_e2e_test.');
  process.exit(2);
}

const [clientOrderCode, ghnOrderCode] = process.argv.slice(2);
if (!clientOrderCode || !ghnOrderCode) {
  console.error('Usage: node scripts/devGhnDeliver.js <giftly-order-code> <ghn-order-code>');
  process.exit(2);
}

const shopId = process.env.GHN_SHOP_ID;
const secret = process.env.GHN_WEBHOOK_SECRET;
if (!shopId || !secret) {
  console.error('Set GHN_SHOP_ID and GHN_WEBHOOK_SECRET in core-backend/.env.');
  process.exit(2);
}

const apiBase = new URL(process.env.GIFTLY_LOCAL_API_URL || 'http://127.0.0.1:5000/api');
if (apiBase.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(apiBase.hostname)) {
  console.error('GIFTLY_LOCAL_API_URL must point to a local HTTP backend.');
  process.exit(2);
}

async function sendEvent(status, offsetSeconds) {
  const event = {
    OrderCode: ghnOrderCode,
    ClientOrderCode: clientOrderCode,
    ShopID: shopId,
    Status: status,
    Type: 'switch_status',
    Time: new Date(Date.now() + offsetSeconds * 1000).toISOString(),
  };
  const endpoint = `${apiBase.toString().replace(/\/$/, '')}/shipments/ghn/webhook`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-giftly-shipping-secret': secret },
    body: JSON.stringify(event),
  });
  const result = await response.json();
  if (!response.ok || result.success !== true || result.ignored === true) {
    throw new Error(`Webhook ${status} rejected (HTTP ${response.status}): ${result.message || JSON.stringify(result)}`);
  }
  console.log(`GHN webhook ${status}: accepted`);
}

(async () => {
  await sendEvent('delivering', 1);
  await sendEvent('delivered', 2);
  console.log(`Local demo order ${clientOrderCode} delivered through GHN webhooks.`);
})().catch((error) => {
  console.error('Local GHN webhook failed:', error.message);
  process.exitCode = 1;
});
