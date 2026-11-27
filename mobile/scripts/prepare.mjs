// Copies the per-church values the bundled offline page needs from church.config.json into www/.
// Runs automatically before `npm run sync`.
import fs from 'node:fs';
const church = JSON.parse(fs.readFileSync(new URL('../church.config.json', import.meta.url), 'utf8'));
const out = { name: church.name, hostedUrl: church.hostedUrl };
fs.writeFileSync(new URL('../www/church-config.js', import.meta.url), `window.CHURCH = ${JSON.stringify(out)};\n`);
