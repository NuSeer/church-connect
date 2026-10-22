// Public Supabase project values only. NEVER put a service_role key here.
// One codebase, several hosted environments: the address in the browser decides which Supabase project (and therefore which church's
// data) this copy talks to. A church's real members live in its own environment; the demo environment has no real church in it.
(function () {
  var BASE = {
    name: 'Church Connect',
    // Optional module settings for this installation.
    modules: {messaging: true, membership: true, ministries: true, website: false, giving: false},
    // The church's own website and name come from the database (Administration Center -> Church settings); these are only fallbacks.
    existingWebsiteUrl: '',
    // Multi-church: set to one church's id to pin an address to that church. Blank = the signed-in person's church / the only church.
    churchId: '',
    tagline: 'A place to belong. A community to grow.',
    vapidPublicKey: '',
    supabaseUrl: '',
    supabaseAnonKey: ''
  };
  // New Beginnings Outreach Center's environment (the existing project that holds the church's real members and messages).
  var NBOC = {
    supabaseUrl: 'https://vizcmyqyoaazkcytcunp.supabase.co',
    supabaseAnonKey: 'sb_publishable_ugyikgHimwHU3wGMFmxojg_qGYRCg61',
    vapidPublicKey: 'BPY9qrXtRt2EGqN5pd-S-m_0a4_Bc-3BHEr0FaF78YOJeEXDpJ8QmKzF1Va97fXcMjMMl6QZ0CppPFsrIuyEnIk'
  };
  // The clean demo / platform environment (a separate, empty Supabase project). Public values only.
  var DEMO = {supabaseUrl: 'https://khnakybowzrfpqwakphi.supabase.co', supabaseAnonKey: 'sb_publishable_ftUugSYhXbtSHNLeY-e4vw_dIoNkHlN', vapidPublicKey: ''};
  // Addresses that belong to a specific church's environment.
  var HOSTS = {
    'connect.newbeginningsoutreachctrcogic.org': NBOC,
    'nboc-connect.vercel.app': NBOC
  };
  // Until the demo project is filled in above, every other address keeps using the current project, so nothing changes by accident.
  var env = HOSTS[location.hostname] || (DEMO.supabaseUrl ? DEMO : NBOC);
  window.CHURCH_CONFIG = Object.assign({}, BASE, env);
})();

// Links marked data-church-site ("Public website", "View website") go to the church's real website (set in Church settings).
document.addEventListener('DOMContentLoaded', function () {
  var url = (window.CHURCH_CONFIG && window.CHURCH_CONFIG.existingWebsiteUrl || '').trim();
  if (!/^https:\/\//.test(url)) return;
  document.querySelectorAll('a[data-church-site]').forEach(function (a) { a.href = url; a.target = '_blank'; a.rel = 'noopener'; });
});
