// Applies the person's light/dark choice and the church's brand colour before the page paints,
// from values cached in this browser (app.js refreshes them from the server after sign-in).
(function () {
  var root = document.documentElement;
  try {
    root.dataset.theme = localStorage.getItem('mb.theme') || 'light';
    var accent = localStorage.getItem('mb.accent');
    if (/^#[0-9a-f]{6}$/i.test(accent || '')) root.style.setProperty('--accent', accent);
  } catch (e) {
    root.dataset.theme = 'light';
  }
})();
