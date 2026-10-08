// The member app's home screen widgets: what each kind is, the sizes it comes in and how it can
// be styled. Shared by the server (to check App Builder saves) and the browser (to draw them).
// The home screen is a grid four columns wide; a size is columns × rows (rows: 0 = as tall as
// its content).

export const SIZES = {
  S: { w: 1, h: 1, label: 'Small' },
  M: { w: 2, h: 1, label: 'Medium' },
  T: { w: 2, h: 2, label: 'Square' },
  W: { w: 4, h: 1, label: 'Wide' },
  L: { w: 4, h: 2, label: 'Large' },
  F: { w: 4, h: 0, label: 'Full' },
};

export const STYLES = { card: 'White', soft: 'Tinted', accent: 'Brand color', color: 'Custom color' };

// fields: what the App Builder lets you fill in. image: can show a picture behind it.
export const WIDGETS = {
  button: { label: 'Button', hint: 'A tile that opens a tab, page or website.', sizes: ['S', 'M', 'T', 'W'], size: 'M', style: 'soft', fields: ['label', 'icon', 'link'], image: true },
  image: { label: 'Picture', hint: 'A photo or graphic, for an event or series. Can open a link.', sizes: ['M', 'T', 'W', 'L'], size: 'L', style: 'card', fields: ['title', 'link'], image: true },
  welcome: { label: 'Welcome banner', hint: 'A big greeting at the top.', sizes: ['W', 'L', 'F'], size: 'F', style: 'accent', fields: ['title', 'text'], image: true },
  serving: { label: 'My serving', hint: 'Signed-in volunteers see when they serve next, with Accept.', sizes: ['T', 'F'], size: 'F', style: 'card', fields: [] },
  tasks: { label: 'My tasks', hint: 'Open tasks for whoever is signed in. Hidden for guests.', sizes: ['T', 'F'], size: 'F', style: 'card', fields: [] },
  times: { label: 'Service times', hint: 'From your repeating services, with each campus address.', sizes: ['T', 'F'], size: 'F', style: 'card', fields: ['title'] },
  watch: { label: 'Livestream', hint: 'The player (Full), or a tile that opens Watch.', sizes: ['T', 'F'], size: 'F', style: 'card', fields: ['title'] },
  text: { label: 'Text', hint: 'A heading and a few lines.', sizes: ['T', 'W', 'F'], size: 'F', style: 'card', fields: ['title', 'text'] },
};

export const ICONS = ['home', 'calendar', 'user', 'people', 'play', 'video', 'heart', 'gift', 'hand', 'chat', 'bell', 'book', 'music', 'map', 'phone', 'clock', 'check', 'tasks', 'info', 'link', 'image', 'send', 'menu'];

export const isHex = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ''));
export const isAppImage = (v) => /^\/uploads\/app\/[\w-]+\.(jpg|png|webp)$/.test(String(v || ''));

// Home screens saved before widgets: a "buttons" block becomes one Button widget per button,
// and everything else keeps its place at full width.
export function upgradeHome(home = []) {
  return home.flatMap((b, i) => {
    if (b.type === 'buttons') {
      return (b.items || []).map((x, j) => ({
        id: `${b.id || `b${i}`}-${j}`, type: 'button', size: 'M', style: j === 0 ? 'accent' : 'soft',
        label: x.label, icon: guessIcon(x), ...(x.url ? { url: x.url } : { tab: x.tab }),
      }));
    }
    return [{ ...b, size: b.size || WIDGETS[b.type]?.size || 'F' }];
  });
}

function guessIcon(x) {
  const t = `${x.tab || ''} ${x.label || ''}`.toLowerCase();
  if (/give|giving/.test(t)) return 'heart';
  if (/watch|live|stream/.test(t)) return 'play';
  if (/new|connect|visit/.test(t)) return 'hand';
  if (/serve|schedule/.test(t)) return 'calendar';
  if (/chat/.test(t)) return 'chat';
  return 'link';
}
