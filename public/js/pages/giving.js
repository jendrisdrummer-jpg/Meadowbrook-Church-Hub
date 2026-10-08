// Finance → Giving: totals, every gift, donors, recurring gifts and funds. Only accounts with the
// Finance permission see this page (the server enforces it too).
import { get, post, patch, put, del, html, mount, icon, toast, fail, pickPerson, fmtDate, dialog, displayName, confirm } from '../lib.js';
import { setTitle, go, state } from '../app.js';

const TABS = [['overview', 'Overview'], ['gifts', 'Gifts'], ['record', 'Cash & checks'], ['donors', 'Donors'], ['recurring', 'Recurring'], ['statements', 'Statements'], ['funds', 'Funds']];
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
    ${['funds', 'recurring', 'record', 'statements'].includes(tab) ? '' : html`<div class="row giving-range">${ranges().map(([k, label, a, b]) => html`<button class="chip link ${a === from && b === to ? 'on' : ''}" data-range="${a}|${b}">${label}</button>`)}
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
  await ({ overview, gifts, donors, recurring, funds, record, statements }[tab] || overview)(panel, q);
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

// ---------------------------------------------------------------- cash & checks
// Offering counts: enter the gifts in a batch (date, campus, label), one line each.
async function record(panel) {
  const batches = await get('/finance/batches');
  mount(panel, html`<div class="card"><div class="card-head"><h2>Cash & check batches</h2><button class="btn primary" data-new>${icon('plus')} New batch</button></div>
    <p class="muted small">Enter each Sunday’s offering (or any cash and checks) as a batch. Gifts with a name go on that person’s giving statement; loose cash counts toward the fund totals.</p>
    <table class="list"><thead><tr><th>Date</th><th>Batch</th><th>Campus</th><th>Gifts</th><th style="text-align:right">Total</th><th></th></tr></thead><tbody>
    ${batches.map((b) => html`<tr><td class="nowrap">${fmtDate(b.given_on)}</td><td>${b.label || '—'}</td><td>${b.campus || ''}</td><td>${b.gifts}</td><td style="text-align:right"><b>${money(b.total)}</b></td>
      <td style="text-align:right" class="nowrap"><button class="btn small ghost" data-edit="${b.id}">Open</button><button class="icon-btn danger" data-del="${b.id}" title="Delete batch">${icon('trash')}</button></td></tr>`)}
    ${batches.length ? '' : html`<tr><td colspan="6" class="muted">No batches yet.</td></tr>`}</tbody></table></div><div data-editor></div>`);
  panel.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.matches('[data-new]')) return batchEditor(panel);
      if (b.dataset.edit) return batchEditor(panel, await get(`/finance/batches/${b.dataset.edit}`));
      if (b.dataset.del) {
        if (!(await confirm('Delete this batch?', 'All its gifts come off the totals and statements.'))) return;
        await del(`/finance/batches/${b.dataset.del}`);
        record(panel);
      }
    } catch (err) { fail(err); }
  };
}

async function batchEditor(panel, batch = null) {
  const funds = (await get('/finance/funds')).funds.filter((f) => f.active || batch);
  const def = funds.find((f) => f.is_default) || funds[0];
  const lastSunday = (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toLocaleDateString('en-CA'); })();
  const b = { label: batch?.label || 'Sunday offering', given_on: batch?.given_on || lastSunday, campus_id: batch?.campus_id ?? state.campusId ?? state.campuses[0]?.id ?? null };
  let rows = batch ? batch.gifts.map((g) => ({ person: g.person_id ? { id: g.person_id, first_name: g.first_name, last_name: g.last_name, nickname: g.nickname } : null, name: g.person_id ? '' : g.name, fund_id: g.fund_id, method: g.method, check_number: g.check_number, amount: (g.amount_cents / 100).toFixed(2) }))
    : [{ person: null, name: '', fund_id: def.id, method: 'check', check_number: '', amount: '' }];
  const box = panel.querySelector('[data-editor]');
  const total = () => rows.reduce((s, r) => s + Math.round(Number(String(r.amount).replace(/[$,]/g, '')) * 100 || 0), 0);

  function draw(focus) {
    mount(box, html`<form class="card batch" data-batch>
      <div class="card-head"><h2>${batch ? 'Batch' : 'New batch'}</h2><b data-total>${money(total())}</b></div>
      <div class="form"><label class="field">Date given<input type="date" name="given_on" value="${b.given_on}" required></label>
        <label class="field">Label<input type="text" name="label" value="${b.label}" maxlength="120"></label>
        ${state.campuses.length > 1 ? html`<label class="field">Campus<select name="campus_id">${state.campuses.map((c) => html`<option value="${c.id}" ${c.id === b.campus_id ? 'selected' : ''}>${c.name}</option>`)}</select></label>` : ''}</div>
      <table class="list batch-rows"><thead><tr><th>Giver</th><th>Fund</th><th>How</th><th>Check #</th><th style="text-align:right">Amount</th><th></th></tr></thead><tbody>
      ${rows.map((r, i) => html`<tr data-i="${i}">
        <td>${r.person ? html`<span class="row nowrap" style="gap:4px"><b>${displayName(r.person)}</b><button type="button" class="icon-btn" data-unperson="${i}" title="Remove">${icon('x')}</button></span>`
          : html`<span class="row nowrap" style="gap:4px"><input type="text" data-f="name" value="${r.name}" placeholder="Loose cash / no name"><button type="button" class="btn small ghost" data-person="${i}">${icon('search')} Person</button></span>`}</td>
        <td><select data-f="fund_id">${funds.map((f) => html`<option value="${f.id}" ${f.id === r.fund_id ? 'selected' : ''}>${f.name}</option>`)}</select></td>
        <td><select data-f="method"><option value="check" ${r.method === 'check' ? 'selected' : ''}>Check</option><option value="cash" ${r.method === 'cash' ? 'selected' : ''}>Cash</option><option value="other" ${r.method === 'other' ? 'selected' : ''}>Other</option></select></td>
        <td><input type="text" data-f="check_number" value="${r.check_number}" ${r.method === 'check' ? '' : 'disabled'} style="width:90px"></td>
        <td><input type="text" inputmode="decimal" data-f="amount" value="${r.amount}" placeholder="0.00" style="width:110px;text-align:right"></td>
        <td><button type="button" class="icon-btn" data-remove="${i}" title="Remove line">${icon('trash')}</button></td></tr>`)}</tbody></table>
      <div class="row"><button type="button" class="btn small" data-add-row>${icon('plus')} Add line</button><span class="muted small">Tip: press Enter in an amount to add the next line.</span>
        <span class="spacer"></span><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">${icon('check')} Save batch</button></div></form>`);
    box.scrollIntoView({ block: 'nearest' });
    if (focus != null) box.querySelector(`tr[data-i="${focus}"] [data-f="${rows[focus].person ? 'amount' : 'name'}"]`)?.focus();
  }

  box.oninput = (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (tr && e.target.dataset.f) {
      rows[tr.dataset.i][e.target.dataset.f] = e.target.dataset.f === 'fund_id' ? Number(e.target.value) : e.target.value;
      box.querySelector('[data-total]').textContent = money(total());
    }
    if (e.target.name) b[e.target.name] = e.target.name === 'campus_id' ? Number(e.target.value) : e.target.value;
  };
  box.onchange = (e) => { if (e.target.dataset.f === 'method') { box.oninput(e); draw(); } };
  const addRow = () => { const last = rows.at(-1); rows.push({ person: null, name: '', fund_id: last?.fund_id ?? def.id, method: last?.method || 'check', check_number: '', amount: '' }); draw(rows.length - 1); };
  box.onkeydown = (e) => { if (e.key === 'Enter' && e.target.dataset.f === 'amount') { e.preventDefault(); addRow(); } };
  box.onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-add-row]')) return addRow();
    if (t.matches('[data-close]')) return box.replaceChildren();
    if (t.dataset.remove) { rows.splice(Number(t.dataset.remove), 1); if (!rows.length) rows.push({ person: null, name: '', fund_id: def.id, method: 'check', check_number: '', amount: '' }); return draw(); }
    if (t.dataset.unperson) { rows[t.dataset.unperson].person = null; return draw(); }
    if (t.dataset.person) {
      const p = await pickPerson('Who gave this?');
      if (p) { rows[t.dataset.person].person = p; rows[t.dataset.person].name = ''; draw(Number(t.dataset.person)); }
    }
  };
  box.onsubmit = async (e) => {
    e.preventDefault();
    const lines = rows.filter((r) => String(r.amount).trim());
    const body = { ...b, gifts: lines.map((r) => ({ person_id: r.person?.id ?? null, name: r.name, fund_id: r.fund_id, method: r.method, check_number: r.method === 'check' ? r.check_number : '', amount: r.amount })) };
    try {
      if (batch) await put(`/finance/batches/${batch.id}`, body); else await post('/finance/batches', body);
      toast(`Saved: ${lines.length} gift${lines.length === 1 ? '' : 's'}, ${money(total())}.`);
      record(panel);
    } catch (err) { fail(err); }
  };
  draw(0);
}

// ---------------------------------------------------------------- statements
async function statements(panel, _q, year) {
  const thisYear = new Date().getFullYear();
  const d = await get(`/finance/statements${year ? `?year=${year}` : ''}`);
  const toSend = d.donors.filter((x) => x.email && !x.sent_at);
  const i = d.info;
  mount(panel, html`<div class="card"><div class="card-head"><h2>Giving statements</h2>
      <select data-year aria-label="Year">${[1, 0, 2, 3].map((n) => thisYear - n).sort((a, b) => b - a).map((y) => html`<option ${String(y) === d.year ? 'selected' : ''}>${y}</option>`)}</select>
      <span class="spacer"></span>${d.mail ? html`<button class="btn primary" data-send-all ${toSend.length ? '' : 'disabled'}>${icon('send')} Email ${toSend.length} statement${toSend.length === 1 ? '' : 's'}</button>` : html`<span class="pill warn">Email isn’t set up</span>`}</div>
    <p class="muted small">Everyone who gave in ${d.year} with a name or email: one statement each, listing every gift and the total (including fees they chose to cover). Emailing skips anyone already sent. Givers can also download theirs from the app (More → My giving).</p>
    <table class="list"><thead><tr><th>Giver</th><th>Email</th><th>Gifts</th><th style="text-align:right">Total</th><th>Sent</th><th></th></tr></thead><tbody>
    ${d.donors.map((x) => html`<tr><td>${x.person_id ? html`<a href="#/people/${x.person_id}">${x.name}</a>` : x.name}</td><td class="small">${x.email || html`<span class="pill warn">No email</span>`}</td>
      <td>${x.gifts}</td><td style="text-align:right"><b>${money(x.total)}</b></td><td class="small muted nowrap">${x.sent_at ? fmtDate(x.sent_at.slice(0, 10)) : ''}</td>
      <td style="text-align:right" class="nowrap"><a class="btn small ghost" href="/api/finance/statements/${encodeURIComponent(x.key)}?year=${d.year}" target="_blank" rel="noopener">${icon('printer')} View</a>
        ${x.email && d.mail ? html`<button class="btn small ghost" data-send="${x.key}">${x.sent_at ? 'Resend' : 'Send'}</button>` : ''}</td></tr>`)}
    ${d.donors.length ? '' : html`<tr><td colspan="6" class="muted">No gifts with a name in ${d.year}.</td></tr>`}</tbody></table></div>
    <form class="card stack" data-info style="max-width:720px"><h2 style="margin:0">On every statement</h2>
      <div class="form"><label class="field">Church’s legal name<input type="text" name="org" value="${i.org}" maxlength="120"></label>
        <label class="field">EIN<input type="text" name="ein" value="${i.ein}" maxlength="20" placeholder="12-3456789"></label>
        <label class="field wide">Address<textarea name="address" rows="2" maxlength="300">${i.address}</textarea></label>
        <label class="field wide">Message<textarea name="note" rows="3" maxlength="1000">${i.note}</textarea><span class="muted small">Keep the “no goods or services were provided” wording: the IRS asks for it on gift acknowledgements.</span></label>
        <label class="field wide">Signed<input type="text" name="signer" value="${i.signer}" maxlength="200" placeholder="Pastor Jane Smith, Lead Pastor"></label></div>
      <div class="row end"><button class="btn primary">Save</button></div></form>`);
  panel.onchange = (e) => { if (e.target.matches('[data-year]')) statements(panel, null, e.target.value).catch(fail); };
  panel.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.matches('[data-send-all]')) {
        if (!(await confirm(`Email ${toSend.length} ${d.year} statements?`, 'Each giver gets their own statement by email. Anyone already sent is skipped.', 'Send statements'))) return;
        b.disabled = true;
        b.textContent = 'Sending…';
        const r = await post('/finance/statements/send', { year: d.year });
        toast(`Sent ${r.sent}.${r.failed ? ` ${r.failed} failed; try again.` : ''}`);
      }
      if (b.dataset.send) {
        await post('/finance/statements/send', { year: d.year, keys: [b.dataset.send] });
        toast('Sent.');
      }
      statements(panel, null, d.year);
    } catch (err) { fail(err); }
  };
  panel.querySelector('[data-info]').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try { await put('/finance/statement-info', { org: f.org.value, ein: f.ein.value, address: f.address.value, note: f.note.value, signer: f.signer.value }); toast('Saved.'); } catch (err) { fail(err); }
  };
}
