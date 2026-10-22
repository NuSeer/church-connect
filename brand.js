// The platform is generic: the church's name and website come from the database, not from the code.
// Signed in -> your own church. Signed out -> the church named in config.js (churchId), or the only church if there is just one,
// or the platform's own name when several churches share this address.
import {db} from './data.js';

export async function loadBrand() {
  const cfg = window.CHURCH_CONFIG || {};
  let church = null;
  if (db) {
    try {
      let id = cfg.churchId || null;
      if (!id) { const {data: {session}} = await db.auth.getSession(); if (session) id = (await db.rpc('cc_my_church_id')).data || null }
      const pick = async cols => id ? await db.from('churches').select(cols).eq('id', id).maybeSingle() : await db.from('churches').select(cols).order('created_at').limit(2);
      let r = await pick('id,name,website_url,brand_primary,brand_accent,brand_text');
      if (r.error) r = await pick('id,name,website_url,brand_primary,brand_accent'); // lettering choice not set up yet
      if (r.error) r = await pick('id,name,website_url'); // colors not set up in the database yet
      if (r.error) r = await pick('id,name'); // older database: name only
      church = id ? r.data : (Array.isArray(r.data) && r.data.length === 1 ? r.data[0] : null);
    } catch (e) { /* fall back to config.js */ }
  }
  const name = (church && church.name) || cfg.name || 'Church Connect';
  document.querySelectorAll('[data-church]').forEach(el => { el.textContent = name });
  const site = String((church && church.website_url) || cfg.existingWebsiteUrl || '').trim();
  if (/^https:\/\//.test(site)) document.querySelectorAll('a[data-church-site]').forEach(a => { a.href = site; a.target = '_blank'; a.rel = 'noopener' });
  applyColors(church && church.brand_primary, church && church.brand_accent, church && church.brand_text);
  try { localStorage.setItem('cc-brand', JSON.stringify({name, primary: church && church.brand_primary || null, accent: church && church.brand_accent || null, text: church && church.brand_text || null})) } catch (e) { /* private window */ }
  window.CHURCH_BRAND = {name, website: site || null, churchId: church && church.id || null, primary: church && church.brand_primary || null, accent: church && church.brand_accent || null};
  return window.CHURCH_BRAND;
}

// The color rules live in brand-boot.js, which runs first on every page so there is no flash of the standard colors.
// 'white' or 'black' lettering for a background color: an explicit choice wins, otherwise whichever reads better.
export const readableOn = (color, choice) => window.ccReadableOn(color, choice);
export const applyColors = (primary, accent, text) => window.ccApplyColors(primary, accent, text);
