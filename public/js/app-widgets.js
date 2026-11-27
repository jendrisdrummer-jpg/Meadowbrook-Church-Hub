// The member app's home screen widgets: what each kind is, the sizes it comes in and how it can
// be styled. Shared by the server (to check App Builder saves) and the browser (to draw them).
// The home screen is a grid four columns wide; a size is columns × rows (rows: 0 = as tall as
// its content).

// plain: what a size means in everyday words (the App Builder shows it under the size choices).
export const SIZES = {
  S: { w: 1, h: 1, label: 'Small', plain: 'Small — a quarter of the width' },
  M: { w: 2, h: 1, label: 'Medium', plain: 'Medium — half the width, one row' },
  T: { w: 2, h: 2, label: 'Square', plain: 'Square — half the width, two rows tall' },
  W: { w: 4, h: 1, label: 'Wide', plain: 'Wide — the full width, one row' },
  L: { w: 4, h: 2, label: 'Large', plain: 'Large — the full width, two rows tall' },
  F: { w: 4, h: 0, label: 'Full', plain: 'Full width — as tall as it needs to be' },
};

export const STYLES = { card: 'White', soft: 'Tinted', accent: 'Brand color', color: 'Custom color' };

// fields: what the App Builder lets you fill in. image: can show a picture behind it.
export const WIDGETS = {
  button: { label: 'Button', hint: 'A tile that opens a tab, page or website.', sizes: ['S', 'M', 'T', 'W'], size: 'M', style: 'soft', fields: ['label', 'icon', 'link'], image: true },
  image: { label: 'Picture', hint: 'A photo or graphic, for an event or series. Can open a link.', sizes: ['M', 'T', 'W', 'L'], size: 'L', style: 'card', fields: ['title', 'link'], image: true },
  welcome: { label: 'Welcome banner', hint: 'A big greeting at the top.', sizes: ['W', 'L', 'F'], size: 'F', style: 'accent', fields: ['title', 'text'], image: true },
  countdown: { label: 'Next service countdown', hint: 'Counts down to the next service from your repeating services, then says “We’re live” and opens Watch while it’s on.', sizes: ['T', 'W', 'F'], size: 'W', style: 'accent', fields: ['title', 'campus'] },
  events: { label: 'Upcoming events', hint: 'The next events from Events in the hub. Square shows the next one with its picture.', sizes: ['T', 'W', 'L', 'F'], size: 'F', style: 'card', fields: ['title'] },
  thisweek: { label: 'This week', hint: 'One card for each person: the next service at their campus, what they’re serving, events they’re going to, and one next step. Guests see service times.', sizes: ['F'], size: 'F', style: 'card', fields: ['title'] },
  serving: { label: 'My serving', hint: 'Signed-in volunteers see when they serve next, with Accept.', sizes: ['T', 'F'], size: 'F', style: 'card', fields: [] },
  tasks: { label: 'My tasks', hint: 'Open tasks for whoever is signed in. Hidden for guests.', sizes: ['T', 'F'], size: 'F', style: 'card', fields: [] },
  times: { label: 'Service times', hint: 'From your repeating services, with each campus address.', sizes: ['T', 'F'], size: 'F', style: 'card', fields: ['title'] },
  sermon: { label: 'Latest message', hint: 'The newest message from Media in the hub, with its picture. Says “Live now” while you’re live.', sizes: ['T', 'W', 'L', 'F'], size: 'L', style: 'card', fields: ['title'] },
  watch: { label: 'Livestream', hint: 'The player (Full), or a tile that opens Watch.', sizes: ['T', 'F'], size: 'F', style: 'card', fields: ['title'] },
  text: { label: 'Text', hint: 'A heading and a few lines.', sizes: ['T', 'W', 'F'], size: 'F', style: 'card', fields: ['title', 'text'] },
  announcement: { label: 'Announcement', hint: 'A short banner for news people shouldn’t miss. It can open a tab or website, and hides itself after the date you choose.', sizes: ['W', 'F'], size: 'F', style: 'soft', fields: ['title', 'text', 'link', 'ends'] },
  linklist: { label: 'Link list', hint: 'A tidy list of links (up to 8), each opening a tab or a website.', sizes: ['T', 'F'], size: 'F', style: 'card', fields: ['title', 'links'] },
};

export const MAX_LINKS = 8;

// A YYYY-MM-DD date that exists on the calendar.
export const isDay = (v) => { const d = new Date(`${v}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };

// An announcement stays up through its end date and hides the day after. `today` is the church's
// own date (YYYY-MM-DD); it is passed in so nothing here reads the clock.
export const announcementLive = (w, today) => !w.ends || !today || w.ends >= today;

// Can a button or link open this tab? Link tabs go to a website instead of a screen, and a Page
// tab that is switched off isn't offered; the built-in tabs always open (from More when off).
// "giving" is My giving, which isn't a tab.
export const linkableTab = (tabs, tabId) => tabId === 'giving' || (tabs || []).some((t) => t.id === tabId && t.type !== 'link' && (t.on || t.type !== 'page'));

export const ICONS = ['home', 'calendar', 'user', 'people', 'play', 'video', 'heart', 'gift', 'hand', 'chat', 'bell', 'book', 'music', 'map', 'phone', 'clock', 'check', 'tasks', 'info', 'link', 'image', 'send', 'coffee', 'shirt', 'menu'];

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

// What a new church's app starts with (the App Builder's "Reset to starting layout" too).
export const DEFAULT_APP = {
  tabs: [
    { id: 'home', type: 'home', label: 'Home', icon: 'home', on: true },
    { id: 'serve', type: 'serve', label: 'Serve', icon: 'calendar', on: true },
    { id: 'events', type: 'events', label: 'Events', icon: 'calendar', on: false },
    { id: 'watch', type: 'watch', label: 'Watch', icon: 'play', on: true },
    { id: 'give', type: 'give', label: 'Give', icon: 'heart', on: true },
    { id: 'connect', type: 'connect', label: 'Connect', icon: 'hand', on: false },
    { id: 'chat', type: 'chat', label: 'Chat', icon: 'chat', on: false },
    { id: 'tasks', type: 'tasks', label: 'Tasks', icon: 'check', on: false },
    { id: 'more', type: 'more', label: 'More', icon: 'menu', on: true },
  ],
  home: [
    { id: 'thisweek', type: 'thisweek', size: 'F', style: 'card' },
    { id: 'welcome', type: 'welcome', size: 'F', style: 'accent', title: 'Welcome home', text: 'We’re so glad you’re here.' },
    { id: 'new', type: 'button', size: 'M', style: 'accent', label: 'I’m new here', icon: 'hand', tab: 'connect' },
    { id: 'live', type: 'button', size: 'M', style: 'soft', label: 'Watch live', icon: 'play', tab: 'watch' },
    { id: 'serving', type: 'serving', size: 'T', style: 'card' },
    { id: 'give', type: 'button', size: 'T', style: 'soft', label: 'Give', icon: 'heart', tab: 'give' },
    { id: 'tasks', type: 'tasks', size: 'F', style: 'card' },
    { id: 'times', type: 'times', size: 'F', style: 'card', title: 'Service times' },
  ],
  watch_url: '',
  give_url: '',
  connect: {
    title: 'We’d love to meet you',
    intro: 'Let us know you were here, and how we can help.',
    interests: ['Learning more about the church', 'Baptism', 'Joining a small group', 'Serving on a team', 'Talking with a pastor'],
  },
};
