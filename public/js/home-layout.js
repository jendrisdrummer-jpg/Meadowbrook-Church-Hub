// Customise Home: which cards, in what order. Pure, so it can be tested without a browser.
// DEFAULT_ORDER must match HOME_CARDS in server/routes/me.js (the server only accepts these ids).
export const DEFAULT_ORDER = ['attention', 'services', 'serving', 'attendance', 'away', 'totals'];
export const CARD_NAMES = {
  attention: 'Needs your attention',
  services: 'This week’s services',
  serving: 'Your next time serving',
  attendance: 'Latest attendance',
  away: 'Away this week',
  totals: 'People totals',
};

// `available` are the cards this person's role can see (in default order). Returns every available
// card in the order to show it, with `hidden: true` on the ones they turned off. Ids in the saved
// layout that this person can't see are ignored. A card the saved order doesn't know about (added
// since they saved) goes in its default place: right after the card that precedes it by default.
export function arrange(available, layout) {
  const known = (id) => available.includes(id);
  const order = [];
  for (const id of layout?.order || []) if (known(id) && !order.includes(id)) order.push(id);
  for (const id of available) {
    if (order.includes(id)) continue;
    const before = available.slice(0, available.indexOf(id)).reverse().find((x) => order.includes(x));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id);
  }
  const hidden = new Set(layout?.hidden || []);
  return order.map((id) => ({ id, hidden: hidden.has(id) }));
}

// Does this arrangement equal the standard Home (default order, nothing hidden)?
export const isStandard = (cards, available) => cards.every((c, i) => !c.hidden && c.id === available[i]);
