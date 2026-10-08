// Finance → Giving: totals, every gift, donors, recurring gifts and funds. Only accounts with the
// Finance permission see this page (the server enforces it too).
import { get, post, patch, html, mount, icon, toast, fail, pickPerson, fmtDate, dialog, displayName } from '../lib.js';
import { setTitle, go } from '../app.js';

const TABS = [['overview', 'Overview'], ['gifts', 'Gifts'], ['donors', 'Donors'], ['recurring', 'Recurring'], ['funds', 'Funds']];
const money = (c) => `$${((c || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METHOD = { card: 'Card', bank: 'Bank', cash: 'Cash', check: 'Check', other: 'Other' };
const STATUS = { pending: html`<span class="pill warn">Processing</span>`, failed: html`<span class="pill bad">Failed</span>`, refunded: html`<span class="pill">Refunded</span>` };

function ranges() {
  const d = new Date();
  const iso = (x) => x.toLocaleDateString('en-CA');
  const y = d.getFullYear();
  return [
    ['month', 'This month', iso(new Date(y, d.getMonth(), 1)), iso(d)],
    ['last-month', 'Last month', iso(new Date(y, d.getMonth() - 1, 1)), iso(new Date(y, d.getMonth(), 0))],
    ['year', 'This year', `${y}-01-01`, iso(d)],
    ['last-year', 'Last year', `${y - 1}-01-01`, `${y - 1}-12-31`],
  ];
}

export default async function giving(el, tab = 'overview') {
  setTitle('Giving');
  const remembered = (() => { try { return JSON.parse(sessionStorage.getItem('mb.giving.range')); } catch { return null; } })();
  let [from, to] = remembered || ranges()[2].slice(2);
  mount(el, html`<div class="tabs">${TABS.map(([k, label]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${label}</button>`)}</div>
    ${tab === 'funds' || tab === 'recurring' ? '' : html`<div class="row giving-range">${ranges().map(([k, label, a, b]) => html`<button class="chip link ${a === from && b === to ? 'on' : ''}" data-range="${a}|${b}">${label}</button>`)}
      <label class="small">From <input type="date" data-from value="${from}"></label><label class="small">to <input type="date" data-to value="${to}"></label></div>`}
    <div data-panel></div>`);
  el.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) go(`/giving/${b.dataset.tab}`); };
  const panel = el.querySelector('[data-panel]');
  const setRange = (a, b) => {
    [from, to] = [a, b];
    try { sessionStorage.setItem('mb.giving.range', JSON.stringify([a, b])); } catch { /* private window */ }
    giving(el, tab);
  };
  el.querySelector('.giving-range')?.addEventListener('click', (e) => { const b = e.target.closest('[data-range]'); if (b) setRange(...b.dataset.range.split('|')); });
  el.querySelector('.giving-range')?.addEventListener('change', () => setRange(el.querySelector('[data-from]').value, el.querySelector('[data-to]').value));
  const q = `from=${from}&to=${to}`;
  await ({ overview, gifts, donors, recurring, funds }[tab] || overview)(panel, q);
}

// ---------------------------------------------------------------- overview
async function overview(panel, q) {
  const s = await get(`/finance/summary?${q}`);
  const max = Math.max(1, ...s.by_fund.map((f) => f.total));
  const sections = [...new Set(s.by_fund.map((f) => f.section))];
  mount(panel, html`<div class="stats">
      <div class="stat"><b>${money(s.total)}</b><span>Given</span></div>
      <div class="stat"><b>${s.gifts}</b><span>Gifts</span></div>
      <div class="stat"><b>${s.givers}</b><span>Givers</span></div>
      <div class="stat"><b>${money(s.recurring.monthly)}</b><span>${s.recurring.n} recurring gifts, a month</span></div>
    </div>
    ${s.pending.n ? html`<div class="alert info" style="margin-top:14px">${s.pending.n} bank payment${s.pending.n === 1 ? '' : 's'} (${money(s.pending.total)}) still processing. They’re counted once they clear.</div>` : ''}
    <div class="grid two" style="margin-top:14px">
      <div class="card"><h2>By fund</h2>${sections.map((sec) => html`<h3 class="muted small giving-sec">${sec}</h3>
        ${s.by_fund.filter((f) => f.section === sec).map((f) => html`<div class="giving-bar"><span class="grow">${f.name}</span><b>${money(f.total)}</b>
          <span class="meter"><span style="width:${(100 * f.total) / max}%"></span></span></div>`)}`)}</div>
      <div class="stack" style="gap:14px">
        <div class="card"><h2>How people gave</h2>${s.by_method.length ? s.by_method.map((m) => html`<div class="give-row"><span class="grow">${METHOD[m.method] || m.method}</span><span class="muted small">${m.gifts} gifts</span><b>${money(m.total)}</b></div>`) : html`<p class="muted small">No gifts in this range.</p>`}
          ${s.fees ? html`<p class="muted small" style="margin:8px 0 0">Givers added ${money(s.fees)} to cover processing fees.</p>` : ''}</div>
        ${s.by_campus.length > 1 ? html`<div class="card"><h2>By campus</h2>${s.by_campus.map((c) => html`<div class="give-row"><span class="grow">${c.campus}</span><b>${money(c.total)}</b></div>`)}</div>` : ''}
        <div class="card"><h2>By week</h2>${s.by_week.length ? s.by_week.slice(-10).reverse().map((w) => html`<div class="give-row"><span class="grow">Week of ${fmtDate(w.week)}</span><b>${money(w.total)}</b></div>`) : html`<p class="muted small">No gifts in this range.</p>`}</div>
      </div></div>`);
}

// ---------------------------------------------------------------- gifts
async function gifts(panel, q, filter = {}) {
  const fundsList = (await get('/finance/funds')).funds;
  const params = new URLSearchParams(q);
  if (filter.fund_id) params.set('fund_id', filter.fund_id);
  if (filter.q) params.set('q', filter.q);
  const list = await get(`/finance/gifts?${params}`);
  const total = list.filter((g) => g.status === 'succeeded').reduce((s, g) => s + g.amount_cents, 0);
  mount(panel, html`<div class="giving-filters">
      <input type="search" data-q value="${filter.q || ''}" placeholder="Search giver name or email">
      <select data-fund><option value="">All funds</option>${fundsList.map((f) => html`<option value="${f.id}" ${String(f.id) === String(filter.fund_id || '') ? 'selected' : ''}>${f.name}</option>`)}</select>
      <a class="btn" href="/api/finance/gifts.csv?${params}">${icon('download')} Export CSV</a></div>
    <div class="card"><div class="card-head"><h2>${list.length} gifts</h2><b>${money(total)}</b></div>
    <table class="list"><thead><tr><th>Date</th><th>Giver</th><th>Fund</th><th>How</th><th style="text-align:right">Amount</th></tr></thead><tbody>
      ${list.map((g) => html`<tr><td class="nowrap">${fmtDate(g.given_on)}</td>
        <td>${g.person_id ? html`<a href="#/people/${g.person_id}">${g.giver}</a>` : html`${g.giver} <button class="btn small ghost" data-link="${g.id}" title="Not in People yet">Link to People…</button>`}
          ${g.email && !g.person_id ? html`<div class="muted small">${g.email}</div>` : ''}</td>
        <td>${g.fund || '—'}</td><td class="small">${METHOD[g.method] || g.method}${g.source === 'recurring' ? ' · recurring' : ''} ${STATUS[g.status] || ''}</td>
        <td style="text-align:right" class="nowrap"><b>${money(g.amount_cents)}</b>${g.fee_cents ? html`<div class="muted small">+${money(g.fee_cents)} fees</div>` : ''}</td></tr>`)}
      ${list.length ? '' : html`<tr><td colspan="5" class="muted">No gifts in this range.</td></tr>`}</tbody></table></div>`);
  let t;
  panel.querySelector('[data-q]').oninput = (e) => { clearTimeout(t); t = setTimeout(() => gifts(panel, q, { ...filter, q: e.target.value }).then(() => { const i = panel.querySelector('[data-q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 350); };
  panel.querySelector('[data-fund]').onchange = (e) => gifts(panel, q, { ...filter, fund_id: e.target.value });
  panel.onclick = async (e) => {
    const b = e.target.closest('[data-link]');
    if (!b) return;
    const p = await pickPerson('Who gave this?');
    if (!p) return;
    try { await patch(`/finance/gifts/${b.dataset.link}`, { person_id: p.id }); toast(`Linked to ${displayName(p)}, with their other gifts from that email.`); gifts(panel, q, filter); } catch (err) { fail(err); }
  };
}

// ---------------------------------------------------------------- donors
async function donors(panel, q) {
  const list = await get(`/finance/donors?${q}`);
  mount(panel, html`<div class="card"><div class="card-head"><h2>${list.length} givers</h2></div>
    <table class="list"><thead><tr><th>Giver</th><th>Gifts</th><th>Last gift</th><th style="text-align:right">Total</th></tr></thead><tbody>
    ${list.map((d) => html`<tr><td>${d.person_id ? html`<a href="#/people/${d.person_id}">${d.giver}</a>` : html`${d.giver} <span class="pill">Not in People</span>`}${d.email ? html`<div class="muted small">${d.email}</div>` : ''}</td>
      <td>${d.gifts}</td><td class="nowrap">${fmtDate(d.last_gift)}</td><td style="text-align:right"><b>${money(d.total)}</b></td></tr>`)}
    ${list.length ? '' : html`<tr><td colspan="4" class="muted">No gifts in this range.</td></tr>`}</tbody></table></div>`);
}

// ---------------------------------------------------------------- recurring
async function recurring(panel) {
  const list = await get('/finance/recurring');
  const pill = { active: html`<span class="pill good">Active</span>`, past_due: html`<span class="pill bad">Payment failed</span>`, canceled: html`<span class="pill">Stopped</span>` };
  mount(panel, html`<div class="card"><table class="list"><thead><tr><th>Giver</th><th>Gift</th><th>Fund</th><th>Started</th><th>Status</th></tr></thead><tbody>
    ${list.map((g) => html`<tr><td>${g.person_id ? html`<a href="#/people/${g.person_id}">${g.giver}</a>` : g.giver}</td><td class="nowrap"><b>${money(g.amount_cents)}</b> ${g.every_label}</td>
      <td>${g.fund || '—'}</td><td class="nowrap">${fmtDate(g.created_at.slice(0, 10))}</td><td>${pill[g.status] || g.status}</td></tr>`)}
    ${list.length ? '' : html`<tr><td colspan="5" class="muted">No recurring gifts yet.</td></tr>`}</tbody></table>
    <p class="muted small">Givers change or stop their own recurring gifts in the app (More → My giving).</p></div>`);
}

// ---------------------------------------------------------------- funds
async function funds(panel) {
  const { funds: list, fee } = await get('/finance/funds');
  const sections = [...new Set(list.map((f) => f.section))];
  mount(panel, html`<div class="grid two">
    <div class="card"><div class="card-head"><h2>Funds</h2><button class="btn primary small" data-add>${icon('plus')} Add fund</button></div>
      <p class="muted small">Givers pick from these, grouped by section, in this order. Hidden funds keep their history but can’t be chosen. The default is picked when the giving page opens.</p>
      ${sections.map((sec) => html`<h3 class="giving-sec">${sec || 'No section'}</h3>${list.filter((f) => f.section === sec).map((f) => html`<div class="give-row ${f.active ? '' : 'muted'}">
        <span class="grow">${f.name}${f.is_default ? html` <span class="pill info">Default</span>` : ''}${f.active ? '' : html` <span class="pill">Hidden</span>`}</span>
        <button class="btn small ghost" data-edit="${f.id}">Edit</button>
        ${f.is_default ? '' : html`<button class="btn small ghost" data-default="${f.id}">Make default</button>`}
        <button class="btn small ghost" data-toggle="${f.id}">${f.active ? 'Hide' : 'Show'}</button></div>`)}`)}</div>
    <form class="card stack" data-fees><h2 style="margin:0">Cover the fee</h2>
      <p class="muted small" style="margin:0">When givers tick “cover processing fees”, this is what’s added. Use Stripe’s rate for your account (2.2% + 30¢ with the nonprofit discount; 2.9% + 30¢ without).</p>
      <div class="form"><label class="field">Percent<input type="number" step="0.1" min="0" max="9.9" name="percent" value="${fee.percent}"></label>
        <label class="field">Plus (cents)<input type="number" step="1" min="0" max="100" name="fixed" value="${fee.fixed_cents}"></label></div>
      <div class="row end"><button class="btn primary">Save</button></div></form></div>`);
  const edit = (f = { name: '', section: sections[0] || 'Main' }) => dialog({
    title: f.id ? 'Edit fund' : 'Add fund',
    body: html`<div class="form"><label class="field">Name<input type="text" name="name" value="${f.name}" required maxlength="80"></label>
      <label class="field">Section<input type="text" name="section" value="${f.section}" list="fund-sections" maxlength="60"><datalist id="fund-sections">${sections.map((x) => html`<option value="${x}">`)}</datalist></label>
      ${f.id ? html`<label class="field">Order<input type="number" name="sort" value="${f.sort}"></label>` : ''}</div>`,
    onSubmit: (form) => (f.id ? patch(`/finance/funds/${f.id}`, { name: form.name.value, section: form.section.value, sort: Number(form.sort.value) }) : post('/finance/funds', { name: form.name.value, section: form.section.value })),
  });
  panel.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.matches('[data-add]') && await edit()) funds(panel);
      if (b.dataset.edit && await edit(list.find((f) => f.id === Number(b.dataset.edit)))) funds(panel);
      if (b.dataset.default) { await patch(`/finance/funds/${b.dataset.default}`, { is_default: true }); funds(panel); }
      if (b.dataset.toggle) { const f = list.find((x) => x.id === Number(b.dataset.toggle)); await patch(`/finance/funds/${f.id}`, { active: !f.active }); funds(panel); }
    } catch (err) { fail(err); }
  };
  panel.querySelector('[data-fees]').onsubmit = async (e) => {
    e.preventDefault();
    try { await patch('/finance/settings', { fee_percent: Number(e.target.percent.value), fee_fixed_cents: Math.round(Number(e.target.fixed.value)) }); toast('Saved.'); } catch (err) { fail(err); }
  };
}
