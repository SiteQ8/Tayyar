// Shows the page in Arabic or English. Runs before the body is drawn so the
// wrong language never flashes, and remembers the choice.
(function () {
  var root = document.documentElement;
  var titles = { ar: 'تيّار | شهادات TLS لحظة تسجيلها', en: 'Tayyar | TLS certificates as they are logged' };
  function set(lang) {
    root.lang = lang;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = titles[lang];
    try {
      localStorage.setItem('tayyar-site-lang', lang);
    } catch (e) {
      // Not remembered, still switched.
    }
  }
  var saved = null;
  try {
    saved = localStorage.getItem('tayyar-site-lang');
  } catch (e) {
    saved = null;
  }
  set(saved === 'ar' || saved === 'en' ? saved : ((navigator.language || '').toLowerCase().indexOf('ar') === 0 ? 'ar' : 'en'));
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('lang').addEventListener('click', function () {
      set(root.lang === 'ar' ? 'en' : 'ar');
    });
  });
})();
