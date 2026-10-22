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
  window.CHURCH_BRAND = {name, website: site || null, churchId: church && church.id || null, primary: church && church.brand_primary || null, accent: church && church.brand_accent || null};
  return window.CHURCH_BRAND;
}

// A church's own colors replace the standard purple and gold. Anything that is not a plain #rrggbb value is ignored (standard look).
const HEX = /^#[0-9a-f]{6}$/i;
const STANDARD = '#5542a8';
// 'white' or 'black' lettering for a background color: an explicit choice wins, otherwise whichever reads better.
export function readableOn(color, choice) {
  if (choice === 'white' || choice === 'black') return choice;
  const n = parseInt(String(color).slice(1), 16), lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.55 ? 'black' : 'white';
}
export function applyColors(primary, accent, text) {
  const root = document.documentElement.style;
  // the lettering choice also works on the standard purple, not only on a custom color
  const ink = readableOn(HEX.test(primary || '') ? primary : STANDARD, text) === 'black';
  root.setProperty('--on-primary', ink ? '#111111' : '#ffffff'); root.setProperty('--on-primary-soft', ink ? '#2a2a2a' : '#e3e6e9');
  if (HEX.test(primary || '')) {
    root.setProperty('--church-primary', primary); root.setProperty('--cc-purple', primary);
    root.setProperty('--church-secondary', `color-mix(in srgb, ${primary}, #ffffff 25%)`);
    // soft backgrounds, tabs, panels and borders take a light tint of the church's main color
    const mix = (pct, base = '#ffffff') => `color-mix(in srgb, ${primary} ${pct}%, ${base})`;
    root.setProperty('--church-tint', mix(11)); root.setProperty('--church-tint-strong', mix(20));
    root.setProperty('--church-wash', mix(4)); root.setProperty('--church-surface', mix(4)); root.setProperty('--church-line', mix(14)); root.setProperty('--line', mix(14));
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', primary));
  }
  if (HEX.test(accent || '')) {
    root.setProperty('--on-accent', readableOn(accent) === 'black' ? '#1b1932' : '#ffffff');
    root.setProperty('--church-accent', accent); root.setProperty('--gold', accent);
    root.setProperty('--church-accent-tint', `color-mix(in srgb, ${accent} 18%, #ffffff)`); root.setProperty('--church-accent-ink', `color-mix(in srgb, ${accent} 55%, #000000)`);
  }
}
