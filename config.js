// Public Supabase project values only. NEVER put a service_role key here.
window.CHURCH_CONFIG = {
  name: 'Church Connect',
  // Optional module settings for this installation. Configure before deployment.
  modules: {messaging:true,membership:true,ministries:true,website:false,giving:false},
  // If the church already has a website, provide its HTTPS address.
  existingWebsiteUrl: '',
  // Multi-church: set to this church's id (from the `churches` table) so the public site and sign-up use the right church. Blank is fine while only one church exists.
  churchId: '',
  // Generate VAPID keys and set the public key here. See PUSH-SETUP.md.
  vapidPublicKey: 'BP38ZyxA9W__ujZDa_LenX8qd8Bgr0BaCFLpqmSo-YSD-kc2sNdoBhDEATbuiPjLvKNThE7umKf8YRwvFDBzj5U',
  tagline: 'A place to belong. A community to grow.',
  supabaseUrl: 'https://vizcmyqyoaazkcytcunp.supabase.co',
  supabaseAnonKey: 'sb_publishable_ugyikgHimwHU3wGMFmxojg_qGYRCg61'
};

// Links marked data-church-site ("Public website", "View website") go to the church's real website.
document.addEventListener('DOMContentLoaded', function () {
  var url = (window.CHURCH_CONFIG && window.CHURCH_CONFIG.existingWebsiteUrl || '').trim();
  if (!/^https:\/\//.test(url)) return;
  document.querySelectorAll('a[data-church-site]').forEach(function (a) { a.href = url; a.target = '_blank'; a.rel = 'noopener'; });
});
