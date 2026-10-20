// Public Supabase project values only. NEVER put a service_role key here.
window.CHURCH_CONFIG = {
  name: 'Your Church',
  // Optional module settings for this installation. Configure before deployment.
  modules: {messaging:true,membership:true,ministries:true,website:false,giving:false},
  // If the church already has a website, provide its HTTPS address.
  existingWebsiteUrl: '',
  // Generate VAPID keys and set the public key here. See PUSH-SETUP.md.
  vapidPublicKey: 'BP38ZyxA9W__ujZDa_LenX8qd8Bgr0BaCFLpqmSo-YSD-kc2sNdoBhDEATbuiPjLvKNThE7umKf8YRwvFDBzj5U',
  tagline: 'A place to belong. A community to grow.',
  supabaseUrl: 'https://vizcmyqyoaazkcytcunp.supabase.co',
  supabaseAnonKey: 'sb_publishable_ugyikgHimwHU3wGMFmxojg_qGYRCg61'
};
