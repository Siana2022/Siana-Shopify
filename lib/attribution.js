'use strict';

function extractAttribution(order) {
  const attrs = {};
  const cartAttrs = order.cart_attributes || order.attributes || [];
  const noteAttrs = order.note_attributes || [];

  [...cartAttrs, ...noteAttrs].forEach(({ name, value }) => {
    if (name && value) attrs[name] = value;
  });

  const get = (...keys) => {
    for (const k of keys) {
      if (attrs[k] && attrs[k] !== '') return attrs[k];
    }
    return '';
  };

  const fbclid = get('_siana_fbclid', 'fbclid');
  const fbc    = get('_siana_fbc', '_fbc') || (fbclid ? `fb.1.${Date.now()}.${fbclid}` : '');

  return {
    client_id:     get('_siana_client_id',    'client_id'),
    session_id:    get('_siana_session_id',   'session_id'),
    gclid:         get('_siana_gclid',        'gclid'),
    gclsrc:        get('_siana_gclsrc',       'gclsrc'),
    wbraid:        get('_siana_wbraid',       'wbraid'),
    gbraid:        get('_siana_gbraid',       'gbraid'),
    fbp:           get('_siana_fbp',          '_fbp'),
    fbc,
    fbclid,
    ttclid:        get('_siana_ttclid',       'ttclid'),
    ttp:           get('_siana_ttp',          '_ttp'),
    msclkid:       get('_siana_msclkid',      'msclkid'),
    li_fat_id:     get('_siana_li_fat_id',    'li_fat_id'),
    source:        get('_siana_utm_source',   'utm_source'),
    medium:        get('_siana_utm_medium',   'utm_medium'),
    campaign:      get('_siana_utm_campaign', 'utm_campaign'),
    term:          get('_siana_utm_term',     'utm_term'),
    content:       get('_siana_utm_content',  'utm_content'),
    campaign_id:   get('_siana_utm_id',       'utm_id'),
    landing_page:  get('_siana_landing_page', 'landing_page'),
    page_referrer: get('_siana_referrer',     'referrer'),
    page_location: get('_siana_page_location','page_location'),
    user_agent:    get('_siana_user_agent')   || '',
    user_ip:       order.browser_ip           || get('_siana_user_ip') || '',
  };
}

module.exports = { extractAttribution };
