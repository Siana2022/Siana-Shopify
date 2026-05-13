'use strict';

const { buildPurchasePayload } = require('../lib/payload');

const SGTM_ENDPOINT  = process.env.SGTM_ENDPOINT      || '';
const SGTM_SECRET    = process.env.SGTM_BEARER_SECRET  || '';
const EVENT_NAME     = process.env.EVENT_NAME          || 'siana_purchase';
const PREVIEW_TOKEN  = process.env.SGTM_PREVIEW_TOKEN  || '';
const DEBUG          = process.env.DEBUG === 'true';

// Dominios de Shopify permitidos (añade el tuyo si tienes dominio propio)
const ALLOWED_ORIGINS = [
  'https://siana-shopify-verde.vercel.app',
  '.myshopify.com',
  '.shopify.com',
];

module.exports = async function handler(req, res) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.url}`);

  // --- CORS ---
  const origin = req.headers['origin'] || '';
  const allowed = ALLOWED_ORIGINS.some(o => origin.endsWith(o) || origin === o);
  if (allowed) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // --- Leer body ---
  let data;
  try {
    const buffers = [];
    for await (const chunk of req) buffers.push(Buffer.from(chunk));
    const raw = Buffer.concat(buffers).toString('utf8');
    data = JSON.parse(raw);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { event, transaction_id, value, currency, customer_email, items } = data;

  console.log(`[${ts}] Pixel event: ${event} — order: ${transaction_id} — ${value} ${currency}`);

  if (!transaction_id || !value) {
    return res.status(400).json({ error: 'Missing required fields: transaction_id, value' });
  }

  // --- Construir payload compatible con buildPurchasePayload de lib/payload ---
  // Mapeamos los datos del pixel al formato de orden que espera payload.js
  const orderLike = {
    id:               transaction_id,
    order_number:     transaction_id,
    email:            customer_email || '',
    total_price:      value,
    currency:         currency || 'EUR',
    financial_status: 'paid',
    source_name:      data.source_name || 'web',
    line_items:       (items || []).map(i => ({
      title:         i.item_name || '',
      quantity:      i.quantity  || 1,
      price:         i.price     || 0,
      sku:           i.item_id   || '',
      variant_id:    i.variant_id || '',
      product_id:    i.product_id || '',
    })),
    customer: {
      email: customer_email || '',
      phone: data.customer_phone || '',
    },
    shipping_address: data.shipping_address || {},
    billing_address:  data.billing_address  || {},
  };

  let payload;
  try {
    payload = buildPurchasePayload(orderLike, EVENT_NAME);
  } catch (e) {
    console.log(`[${ts}] Error payload: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }

  if (DEBUG) console.log(`[${ts}] Payload: ${JSON.stringify(payload, null, 2)}`);
  else console.log(`[${ts}] Payload OK — ${payload.event_name} — ${payload.ecommerce?.value} ${payload.ecommerce?.currency}`);

  if (!SGTM_ENDPOINT) {
    return res.status(500).json({ error: 'SGTM_ENDPOINT not configured' });
  }

  // --- Enviar a sGTM ---
  const body = JSON.stringify(payload);
  const reqHeaders = {
    'Content-Type':   'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body).toString(),
    'User-Agent':     'Siana-Shopify-Pixel/1.0.0',
    'X-Platform':     'shopify-pixel',
  };
  if (SGTM_SECRET)   { reqHeaders['Authorization'] = `Bearer ${SGTM_SECRET}`; reqHeaders['X-Webhook-Secret'] = SGTM_SECRET; }
  if (PREVIEW_TOKEN) { reqHeaders['X-Gtm-Server-Preview'] = PREVIEW_TOKEN; }

  let sgtmRes;
  try {
    sgtmRes = await fetch(SGTM_ENDPOINT, {
      method:  'POST',
      headers: reqHeaders,
      body,
      signal:  AbortSignal.timeout(15000),
    });
  } catch (e) {
    console.log(`[${ts}] Error red sGTM: ${e.message}`);
    return res.status(200).json({ ok: false, error: e.message });
  }

  const sgtmBody = await sgtmRes.text();
  console.log(`[${ts}] sGTM HTTP ${sgtmRes.status} — ${sgtmBody}`);

  return res.status(200).json({
    ok:          sgtmRes.status >= 200 && sgtmRes.status < 300,
    order:       transaction_id,
    event:       EVENT_NAME,
    sgtm_status: sgtmRes.status,
  });
};
