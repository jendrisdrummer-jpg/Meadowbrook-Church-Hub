// Draws the home screen: widgets on a grid four columns wide, each at its own size and style.
// ctx: { app, mine (my schedule), tasks (my open tasks), edit (App Builder preview), signInHref, videoEmbed }
import { html, raw, icon, fmtDate, fmtTime, DAYS } from '../lib.js';
import { taskRow } from '../tasks.js';
import { WIDGETS, SIZES, isHex } from '../app-widgets.js';

const clock = (hhmm) => new Date(`2000-01-01T${hhmm}:00`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// White or near-black text, whichever reads better on a custom color.
function inkFor(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111418' : '#ffffff';
}

const href = (w) => (w.url ? w.url : w.tab ? `#/${w.tab}` : '');

// One widget's outer box. Links make the whole tile tappable.
function box(w, inner, { link = href(w), cls = '' } = {}) {
  const size = SIZES[w.size] || SIZES.F;
  const style = [`grid-column:span ${size.w}`, size.h ? `grid-row:span ${size.h}` : ''];
  if (w.style === 'color' && isHex(w.color)) style.push(`--wbg:${w.color}`, `--wfg:${inkFor(w.color)}`);
  if (w.image) style.push(`--wimg:url('${w.image}')`);
  const classes = `w w-${w.type} sz-${w.size} st-${w.style || 'card'} ${w.image ? 'has-img' : ''} ${cls}`;
  const css = style.filter(Boolean).join(';');
  if (link) return html`<a data-wid="${w.id}" class="${classes}" style="${css}" href="${link}" ${w.url ? raw('target="_blank" rel="noopener"') : ''}>${inner}</a>`;
  return html`<div data-wid="${w.id}" class="${classes}" style="${css}">${inner}</div>`;
}

// What a widget that has nothing to show looks like in the App Builder (it's hidden in the app).
const placeholder = (w, why) => box(w, html`<div class="w-empty">${icon('info')}<b>${WIDGETS[w.type].label}</b><span>${why}</span></div>`, { link: '', cls: 'w-ghost' });

export function widget(w, ctx) {
  const { app } = ctx;
  const tall = w.size === 'F';
  const tabFor = (type) => app.config.tabs.find((t) => t.type === type)?.id || type;
  switch (w.type) {
    case 'button':
      return box(w, html`<span class="w-ic">${icon(w.icon || 'link')}</span><b class="w-label">${w.label}</b>`);
    case 'image':
      return box(w, w.title ? html`<b class="w-caption">${w.title}</b>` : '');
    case 'welcome':
      return box(w, html`<small>${app.church_name}</small><h2>${w.title || 'Welcome'}</h2>${w.text && w.size !== 'W' ? html`<p>${w.text}</p>` : ''}`, { link: '' });
    case 'text':
      return box(w, html`${w.title ? html`<h2>${w.title}</h2>` : ''}${w.text ? html`<p>${w.text}</p>` : ''}`, { link: '' });
    case 'tasks': {
      if (!app.user) return ctx.edit ? placeholder(w, 'Shows to signed-in people') : null;
      const list = ctx.tasks || [];
      const due = list.filter((t) => t.due_date && t.due_date <= new Date().toLocaleDateString('en-CA')).length;
      if (!tall) {
        return box(w, html`<span class="w-ic">${icon('tasks')}</span><b class="w-big">${list.length}</b><span class="w-sub">${list.length ? `open task${list.length === 1 ? '' : 's'}${due ? ` · ${due} due` : ''}` : 'All caught up'}</span>`, { link: `#/${tabFor('tasks')}` });
      }
      if (!list.length) return ctx.edit ? placeholder(w, 'Hidden when someone has no open tasks') : null;
      return box(w, html`<div class="card-head"><h2>My tasks</h2><a class="btn small ghost" href="#/${tabFor('tasks')}">All</a></div>
        <div class="task-list">${list.slice(0, 4).map((t) => taskRow(t, { showWho: false }))}</div>`, { link: '' });
    }
    case 'serving': {
      const serve = tabFor('serve');
      if (!app.user) {
        return box(w, tall ? html`<div class="row">${icon('calendar')}<span class="grow"><b>Serve on a team?</b><br><span class="w-sub">Sign in to see when you’re scheduled.</span></span></div>`
          : html`<span class="w-ic">${icon('calendar')}</span><b class="w-label">Serving</b><span class="w-sub">Sign in to see your schedule</span>`, { link: ctx.signInHref(`/${serve}`) });
      }
      const next = (ctx.mine?.assignments || []).filter((a) => a.status !== 'declined');
      if (!tall) {
        const a = next[0];
        return box(w, html`<span class="w-ic">${icon('calendar')}</span><span class="w-sub">${a ? 'You’re serving' : 'Serving'}</span>
          <b class="w-label">${a ? fmtDate(a.starts_at, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Nothing scheduled'}</b>
          ${a ? html`<span class="w-sub">${a.status === 'pending' ? 'Tap to reply' : a.position}</span>` : ''}`, { link: `#/${serve}` });
      }
      if (!next.length) return ctx.edit ? placeholder(w, 'Hidden until someone is scheduled') : null;
      return box(w, html`<div class="card-head"><h2>You’re serving</h2><a class="btn small ghost" href="#/${serve}">All</a></div>
        ${next.slice(0, 3).map((a) => html`<div class="m-serving-row"><div class="what"><b>${fmtDate(a.starts_at)}</b> · ${fmtTime(a.starts_at)}<div class="w-sub">${a.position} · ${a.campus}</div></div>
          ${a.status === 'pending' ? html`<button class="btn small primary" data-accept="${a.id}">Accept</button>` : html`<a class="btn small ghost" href="#/plan/${a.service_id}">Plan</a>`}</div>`)}`, { link: '' });
    }
    case 'times': {
      if (!app.times.length) return ctx.edit ? placeholder(w, 'Add repeating services to fill this in') : null;
      if (!tall) {
        const t = nextTime(app.times);
        return box(w, html`<span class="w-ic">${icon('clock')}</span><span class="w-sub">${w.title || 'Next service'}</span>
          <b class="w-label">${DAYS[t.day_of_week]} ${clock(t.start_time)}</b><span class="w-sub">${t.campus_short || t.campus_name}</span>`,
        { link: t.address ? `https://maps.google.com/?q=${encodeURIComponent(t.address)}` : '' });
      }
      const byCampus = Map.groupBy(app.times, (t) => t.campus_id);
      return box(w, html`${w.title ? html`<h2>${w.title}</h2>` : ''}
        ${[...byCampus.values()].map((list) => {
          const c = list[0];
          const byDay = Map.groupBy(list, (t) => t.day_of_week);
          return html`<div class="campus"><b>${c.campus_name}</b>
            ${[...byDay].map(([day, ts]) => html`<div><span class="t">${DAYS[day]}s</span> · ${ts.map((t) => clock(t.start_time)).join(' & ')}</div>`)}
            ${c.address ? html`<a class="small" href="https://maps.google.com/?q=${encodeURIComponent(c.address)}" target="_blank" rel="noopener">${icon('map', 'ic small-ic')} ${c.address}</a>` : ''}</div>`;
        })}`, { link: '' });
    }
    case 'watch': {
      const watchUrl = app.config.watch_url;
      if (!tall) return box(w, html`<span class="w-ic">${icon('play')}</span><b class="w-label">${w.title || 'Watch live'}</b>`, { link: `#/${tabFor('watch')}` });
      if (!watchUrl) return ctx.edit ? placeholder(w, 'Add your livestream link below') : null;
      const embed = ctx.videoEmbed(watchUrl);
      return box(w, html`${w.title ? html`<h2>${w.title}</h2>` : ''}${embed ? html`<div class="m-video"><iframe src="${embed}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Livestream"></iframe></div>`
        : html`<a class="btn primary" href="${watchUrl}" target="_blank" rel="noopener">${icon('play')} Watch</a>`}`, { link: '' });
    }
    default:
      return null;
  }
}

// The next repeating service from now (by day of week and time).
function nextTime(times) {
  const now = new Date();
  const mins = now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes();
  const at = (t) => {
    const [h, m] = t.start_time.split(':').map(Number);
    const v = t.day_of_week * 1440 + h * 60 + m;
    return v >= mins ? v - mins : v + 7 * 1440 - mins;
  };
  return [...times].sort((a, b) => at(a) - at(b))[0];
}

export function homeGrid(home, ctx) {
  return html`<div class="w-wrap"><div class="w-grid ${ctx.edit ? 'editing' : ''}" data-grid>${home.map((w) => widget(w, ctx)).filter(Boolean)}</div></div>`;
}
