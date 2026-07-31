'use strict';

const { createHash } = require('crypto');
const { extractAttribution } = require('./attribution');

function sha256(value) {
  if (!value) return '';
  return createHash('sha256').update(value).digest('hex');
}

// ---------------------------------------------------------------------------
// Mapa ISO 3166-1 alpha-2 → prefijo telefónico internacional
// ---------------------------------------------------------------------------
const COUNTRY_DIAL_CODES = {
  ES: '34',  PT: '351', FR: '33',  DE: '49',  IT: '39',
  GB: '44',  NL: '31',  BE: '32',  CH: '41',  AT: '43',
  PL: '48',  SE: '46',  NO: '47',  DK: '45',  FI: '358',
  IE: '353', CZ: '420', RO: '40',  HU: '36',  GR: '30',
  US: '1',   CA: '1',   MX: '52',  BR: '55',  AR: '54',
  CO: '57',  CL: '56',  PE: '51',
  AU: '61',  NZ: '64',  JP: '81',  CN: '86',  IN: '91',
  AE: '971', SA: '966', MA: '212', ZA: '27',
};

function normalizePhone(rawPhone, countryCode = 'ES') {
  if (!rawPhone) return '';
  const cleaned = rawPhone.replace(/[\s\-().]/g, '').trim();
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) return cleaned;
  const dialCode = COUNTRY_DIAL_CODES[(countryCode || 'ES').toUpperCase()];
  if (!dialCode) return cleaned;
  if (cleaned.startsWith(dialCode)) return '+' + cleaned;
  return '+' + dialCode + cleaned;
}
// ---------------------------------------------------------------------------

const FRECUENCIA_PLATOS = { semanal: 6, quincenal: 12, mensual: 24 };

function buildPurchasePayload(order, eventName = 'siana_purchase') {
  const attribution = extractAttribution(order);

  const purchaseType = attribution.purchase_type || null;
  const subscriptionFrequency = purchaseType === 'suscripcion'
    ? (attribution.subscription_frequency || null)
    : null;
  const subscriptionDishes = subscriptionFrequency
    ? (FRECUENCIA_PLATOS[subscriptionFrequency] || null)
    : null;
  // --- INICIO DE LA MEJORA PARA TIKTOK ---
  // Si el pedido viene de TikTok Shop, forzamos la fuente de atribución
  if (order.source_name === 'tiktok' || order.source_name === 'tiktok_shop' || order.source_name === '6712272') {
    attribution.utm_source = attribution.utm_source || 'tiktok';
    attribution.utm_medium = attribution.utm_medium || 'social_shop';
    attribution.utm_campaign = attribution.utm_campaign || 'tiktok_shop_integration';
    // Si no hay User Agent (común en webhooks), ponemos uno genérico para que sGTM no lo descarte
    attribution.user_agent = attribution.user_agent || 'TikTokShop/1.0';
  }
  const total    = parseFloat(order.total_price || 0);
  const tax      = parseFloat(order.total_tax   || 0);
  const shipping = parseFloat(order.total_shipping_price_set?.shop_money?.amount || 0);
  const revenue  = Math.round((total - tax - shipping) * 10000) / 10000;
  const items    = buildItems(order.line_items || [], purchaseType, subscriptionFrequency, subscriptionDishes);
  const coupon   = (order.discount_codes || []).map(d => d.code).join(',');
  const customer = order.customer       || {};
  const billing  = order.billing_address  || {};
  const shipping_a = order.shipping_address || {};
  const email    = customer.email || order.email || billing.email || '';

  // --- ÚNICA MODIFICACIÓN: normalización del teléfono ---
  const rawPhone    = customer.phone || shipping_a.phone || billing.phone || order.phone || '';
  const countryCode = billing.country_code || shipping_a.country_code || 'ES';
  const phone       = normalizePhone(rawPhone, countryCode);
  // ------------------------------------------------------

  const payload = {
    event_name:      eventName,
    event:           eventName,
    event_id:        `purchase_shopify_${order.id}_${order.order_number}`,
    timestamp:       new Date().toISOString(),
    timestamp_unix:  Math.floor(Date.now() / 1000),
    timestamp_gads:  new Date(order.processed_at || order.created_at)
                  .toISOString()
                  .substring(0, 19)
                  .replace('T', ' ') + '+00:00',
    source:          'shopify',

    ecommerce: {
      transaction_id: String(order.order_number || order.id),
      affiliation:    order.source_name || 'Shopify',
      value:          total,
      revenue,
      tax,
      shipping,
      currency:       order.currency || 'EUR',
      coupon,
      payment_method: order.payment_gateway || '',
      items,
    },

    customer: {
      id:              customer.id || null,
      email,
      email_sha256:    sha256(email.toLowerCase().trim()),
      phone,
      phone_sha256:    sha256(phone),
      first_name:      customer.first_name || billing.first_name || '',
      last_name:       customer.last_name  || billing.last_name  || '',
      is_new_customer: (customer.orders_count || 1) <= 1,
      order_count:     customer.orders_count || 1,
      lifetime_value:  parseFloat(customer.total_spent || total),
    },

    billing: {
      address_1: billing.address1 || '',
      address_2: billing.address2 || '',
      city:      billing.city     || '',
      state:     billing.province || '',
      postcode:  billing.zip      || '',
      country:   billing.country_code || billing.country || '',
      company:   billing.company  || '',
    },

    shipping: {
      method:    (order.shipping_lines || [])[0]?.title || '',
      address_1: shipping_a.address1 || '',
      address_2: shipping_a.address2 || '',
      city:      shipping_a.city     || '',
      state:     shipping_a.province || '',
      postcode:  shipping_a.zip      || '',
      country:   shipping_a.country_code || shipping_a.country || '',
    },

    order: {
      id:             order.id,
      number:         order.order_number,
      name:           order.name,
      status:         order.financial_status,
      fulfillment:    order.fulfillment_status || 'unfulfilled',
      date_created:   order.created_at,
      date_processed: order.processed_at,
      source:         order.source_name || 'web',
      item_count:     (order.line_items || []).reduce((s, i) => s + i.quantity, 0),
      tags:           order.tags || '',
      note:           order.note || '',
    },

    attribution,
    user_ip:    attribution.user_ip    || order.browser_ip || '',
    user_agent: attribution.user_agent || '',

    user_data: {
      email_address: email,
      phone_number:  phone,
      address: {
        first_name:  customer.first_name || billing.first_name || '',
        last_name:   customer.last_name  || billing.last_name  || '',
        street:      [billing.address1, billing.address2].filter(Boolean).join(' '),
        city:        billing.city     || '',
        region:      billing.province || '',
        postal_code: billing.zip      || '',
        country:     billing.country_code || billing.country || '',
      },
    },

    site: {
      platform:       'shopify',
      plugin_version: '1.0.0',
    },
  };

  return payload;
}

function hasLineItemProperty(item, propName) {
  return (item.properties || []).some(
    p => p && p.name === propName && p.value !== undefined && p.value !== null && p.value !== ''
  );
}

function getBundleType(item) {
  if (hasLineItemProperty(item, '_isPresetBundleProduct') || item.product_type === 'Pack') {
    return 'predefinido';
  }
  if (hasLineItemProperty(item, '_bundleId')) {
    return 'personalizado';
  }
  return null;
}
function buildItems(lineItems) {
  return lineItems.map(item => ({
    item_id:            item.product_id,
    item_variant_id:    item.variant_id || null,
    item_name:          item.name || item.title,
    item_sku:           item.sku || '',
    item_brand:         item.vendor || '',
    item_category:      item.product_type || '',
    item_categories:    item.product_type ? [item.product_type] : [],
    item_variant:       item.variant_title || '',
    price:              parseFloat(item.price || 0),
    quantity:           item.quantity || 1,
    total:              Math.round(parseFloat(item.price || 0) * (item.quantity || 1) * 10000) / 10000,
    tax:                parseFloat(item.tax_lines?.[0]?.price || 0),
    requires_shipping:  item.requires_shipping,
    fulfillment_status: item.fulfillment_status || '',
    bundle_type:             getBundleType(item),
    purchase_type:           purchaseType,
    subscription_frequency:  subscriptionFrequency,
    subscription_dishes:     subscriptionDishes,
  }));
}

module.exports = { buildPurchasePayload };
