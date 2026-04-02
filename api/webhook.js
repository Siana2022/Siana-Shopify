'use strict';

const crypto = require('crypto');
const { buildPurchasePayload } = require('../lib/payload');

const SHOPIFY_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || '';
const SGTM_ENDPOINT  = process.env.SGTM_ENDPOINT          || '';
const SGTM_SECRET    = process.env.SGTM_BEARER_SECRET     || '';
const EVENT_NAME     = process.env.EVENT_NAME             || 'siana_purchase';
const PREVIEW_TOKEN  = process.env.SGTM_PREVIEW_TOKEN     || '';
const DEBUG          = process.env.DEBUG === 'true';

module.exports.config = { api: { bodyParser: false } };

module.exports = async function handler(req, res) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.url}`);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Cannot read body' });
  }

  if (SHOPIFY_SECRET) {
    const hmacHeader = req.headers['x-shopify-hmac-sha256'] || '';
    const computed   = crypto.createHmac('sha256', SHOPIFY_SECRET).update(rawBody).digest('base64');
    const bufA = Buffer.from(hmacHeader);
    const bufB = Buffer.from(computed);
    if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
      console.log(`[${ts}] HMAC invalido`);
      return res.status(401).json({ error: 'Unauthorized' });
    }
    console.log(`[${ts}] HMAC verificado OK`);
  }

  let order;
  try {
    order = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  console.log(`[${ts}] Pedido #${order.order_number} — ${order.email} — ${order.total_price} ${order.currency}`);

  let payload;
  try {
    payload = buildPurchasePayload(order, EVENT_NAME);
  } catch (e) {
    console.log(`[${ts}] Error payload: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }

  if (DEBUG) console.log(`[${ts}] Payload: ${JSON.stringify(payload, null, 2)}`);
  else console.log(`[${ts}] Payload OK — ${payload.event_name} — ${payload.ecommerce?.value} ${payload.ecommerce?.currency}`);

  if (!SGTM_ENDPOINT) {
    return res.status(500).json({ error: 'SGTM_ENDPOINT not configured' });
  }

  const body = JSON.stringify(payload);
  const reqHeaders = {
    'Content-Type':   'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body).toString(),
    'User-Agent':     'Siana-Shopify-Webhook/1.0.0',
    'X-Platform':     'shopify',
  };
  if (SGTM_SECRET)   { reqHeaders['Authorization'] = `Bearer ${SGTM_SECRET}`; reqHeaders['X-Webhook-Secret'] = SGTM_SECRET; }
  if (PREVIEW_TOKEN) { reqHeaders['X-Gtm-Server-Preview'] = PREVIEW_TOKEN; }

  let sgtmRes;
  try {
    sgtmRes = await fetch(SGTM_ENDPOINT, { method: 'POST', headers: reqHeaders, body, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    console.log(`[${ts}] Error red sGTM: ${e.message}`);
    return res.status(200).json({ ok: false, error: e.message });
  }

  const sgtmBody = await sgtmRes.text();
  console.log(`[${ts}] sGTM HTTP ${sgtmRes.status} — ${sgtmBody}`);

  return res.status(200).json({
    ok:          sgtmRes.status >= 200 && sgtmRes.status < 300,
    order:       order.order_number,
    event:       EVENT_NAME,
    sgtm_status: sgtmRes.status,
  });
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data',  c => chunks.push(Buffer.from(c)));
    req.on('end',   () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
