'use strict';
module.exports = function handler(req, res) {
  res.status(200).json({
    ok:      true,
    service: 'Siana Shopify Webhook',
    version: '1.0.0',
    env: {
      sgtm_endpoint:  process.env.SGTM_ENDPOINT         ? 'configurado' : 'FALTA',
      shopify_secret: process.env.SHOPIFY_WEBHOOK_SECRET ? 'configurado' : 'FALTA',
      sgtm_secret:    process.env.SGTM_BEARER_SECRET     ? 'configurado' : 'FALTA',
      event_name:     process.env.EVENT_NAME             || 'siana_purchase (default)',
    },
  });
};
