'use strict';

const { createHash } = require('crypto');
const { extractAttribution } = require('./attribution');

function sha256(value) {
  if (!value) return '';
  return createHash('sha256').update(value).digest('hex');
}

function buildPurchasePayload(order, eventName = 'siana_purchase') {
  const attribution = extractAttribution(order);
  const total    = parseFloat(order.total_price || 0);
  const tax      = parseFloat(order.total_tax   || 0);
  const shipping = parseFloat(order.total_shipping_price_set?.shop_money?.amount || 0);
  const revenue  = Math.round((total - tax - shipping) * 10000) / 10000;
  const items    = buildItems(order.line_items || []);
  const coupon   = (order.discount_codes || []).map(d => d.code).join(',');
  const customer = order.customer       || {};
  const billing  = order.billing_address  || {};
  const shipping_a = order.shipping_address || {};
  const email    = customer.email || order.email || billing.email || '';
  const phone    = customer.phone || billing.phone || order.phone || '';

  const payload = {
    event_name:      eventName,
    event:           eventName,
    event_id:        `purchase_shopify_${order.id}_${order.order_number}`,
    timestamp:       new Date().toISOString(),
    timestamp_unix:  Math.floor(Date.now() / 1000),
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
      phone_sha256:    sha256(phone.replace(/\D/g, '')),
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
  }));
}

module.exports = { buildPurchasePayload };
