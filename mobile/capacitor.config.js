// Capacitor reads this when you run `npx cap sync`. Every per-church value comes from church.config.json.
const church = require('./church.config.json');
const url = new URL(church.hostedUrl);

module.exports = {
  appId: church.bundleId,
  appName: church.name,
  webDir: 'www',
  backgroundColor: church.colors.background,
  server: {
    // Load the live member app. Only this host may load inside the app; other links open in Safari.
    url: church.hostedUrl,
    allowNavigation: [url.host],
    // Shown if the hosted app can't be reached (www/offline.html).
    errorPath: 'offline.html',
  },
  ios: {
    contentInset: 'automatic',
  },
};
