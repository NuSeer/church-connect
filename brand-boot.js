// Runs first on every page (before anything is drawn). It re-applies the church's last known colors and name from this device, so moving
// between pages never flashes the standard purple or the demo name while the real values load. brand.js refreshes the saved copy every time.
(function () {
  var HEX = /^#[0-9a-f]{6}$/i, STANDARD = '#5542a8';
  function readableOn(color, choice) {
    if (choice === 'white' || choice === 'black') return choice;
    var n = parseInt(String(color).slice(1), 16), lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    return lum > 0.55 ? 'black' : 'white';
  }
  function apply(primary, accent, text) {
    var root = document.documentElement.style;
    var ink = readableOn(HEX.test(primary || '') ? primary : STANDARD, text) === 'black';
    root.setProperty('--on-primary', ink ? '#111111' : '#ffffff'); root.setProperty('--on-primary-soft', ink ? '#2a2a2a' : '#e3e6e9');
    if (HEX.test(primary || '')) {
      root.setProperty('--church-primary', primary); root.setProperty('--cc-purple', primary);
      root.setProperty('--church-secondary', 'color-mix(in srgb, ' + primary + ', #ffffff 25%)');
      root.setProperty('--church-ink', 'color-mix(in srgb, ' + primary + ' 55%, #000000)');
      var mix = function (pct) { return 'color-mix(in srgb, ' + primary + ' ' + pct + '%, #ffffff)' };
      root.setProperty('--church-tint', mix(11)); root.setProperty('--church-tint-strong', mix(20));
      root.setProperty('--church-wash', mix(4)); root.setProperty('--church-surface', mix(4)); root.setProperty('--church-line', mix(14)); root.setProperty('--line', mix(14));
      document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) { m.setAttribute('content', primary) });
    } else {
      ['--church-primary', '--cc-purple', '--church-secondary', '--church-ink', '--church-tint', '--church-tint-strong', '--church-wash', '--church-surface', '--church-line', '--line'].forEach(function (k) { root.removeProperty(k) });
    }
    if (HEX.test(accent || '')) {
      root.setProperty('--on-accent', readableOn(accent) === 'black' ? '#1b1932' : '#ffffff');
      root.setProperty('--church-accent', accent); root.setProperty('--gold', accent);
      root.setProperty('--church-accent-tint', 'color-mix(in srgb, ' + accent + ' 18%, #ffffff)'); root.setProperty('--church-accent-ink', 'color-mix(in srgb, ' + accent + ' 55%, #000000)');
    } else {
      ['--on-accent', '--church-accent', '--gold', '--church-accent-tint', '--church-accent-ink'].forEach(function (k) { root.removeProperty(k) });
    }
  }
  window.ccReadableOn = readableOn; window.ccApplyColors = apply;
  try {
    var saved = JSON.parse(localStorage.getItem('cc-brand') || 'null');
    if (saved) {
      apply(saved.primary, saved.accent, saved.text);
      if (saved.name) document.addEventListener('DOMContentLoaded', function () { document.querySelectorAll('[data-church]').forEach(function (el) { el.textContent = saved.name }) });
    }
  } catch (e) { /* private window: the colors just load a moment later */ }
})();
