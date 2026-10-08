// Giving, shared by the church app's Give tab and the public /give page: amount, fund, how often,
// cover the fee, then Stripe's secure payment form inside the page (card, bank account, Apple Pay
// or Google Pay). Card numbers go straight to Stripe, never through this site.
import { get, post, patch, html, mount, icon, toast, fail, confirm, dialog, fmtDate } from './lib.js';

const money = (c) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cents = (v) => Math.round(Number(String(v ?? '').replace(/[$,\s]/g, '')) * 100);
const coverFee = (amount, fee) => Math.max(0, Math.ceil((amount + fee.fixed_cents) / (1 - fee.percent / 100)) - amount);
const PRESETS = [25, 50, 100, 250, 500];

let stripeJs;
function loadStripe(key) {
  stripeJs ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/';
    s.onload = () => resolve(window.Stripe(key));
    s.onerror = () => { stripeJs = null; reject(new Error('Couldn’t load the secure payment form. Check your connection and try again.')); };
    document.head.append(s);
  });
  return stripeJs;
}

// The thank-you after Stripe sends the giver back (?done=session id).
export async function giveThanks(el, sessionId, { again, mine } = {}) {
  const s = await get(`/giving/session/${encodeURIComponent(sessionId)}`).catch(() => null);
  mount(el, html`<div class="card give-thanks">${icon('heart')}
    <h2>Thank you${s ? `!` : ''}</h2>
    ${s ? html`<p><b>${money(s.amount_cents)}</b> to <b>${s.fund}</b>${s.every ? html` · ${s.every}` : ''}</p>
      <p class="muted small">${s.processing ? 'Bank payments take a few business days to finish; we’ll email a receipt when it does.' : `A receipt is on its way${s.email ? ` to ${s.email}` : ''}.`}</p>`
      : html`<p class="muted">Your gift is being processed. A receipt will be emailed to you.</p>`}
    <div class="row" style="justify-content:center">${again ? html`<a class="btn" href="${again}">Give again</a>` : ''}${mine ? html`<a class="btn primary" href="${mine}">My giving</a>` : ''}</div></div>`);
}

// cfg: GET /giving/config. returnTo: 'app' | 'web'.
export function giveForm(el, cfg, { returnTo = 'app', mineHref = '' } = {}) {
  const def = cfg.funds.find((f) => f.is_default) || cfg.funds[0];
  const state = { amount: '', fund: def?.id, every: 'once', cover: true };
  const sections = [...new Set(cfg.funds.map((f) => f.section))];

  function total() {
    const a = cents(state.amount);
    const fee = state.cover && a >= 100 ? coverFee(a, cfg.fee) : 0;
    return { a, fee, all: a + fee };
  }

  function draw() {
    const { a, fee, all } = total();
    mount(el, html`<form class="card give-form" autocomplete="on" novalidate>
      <label class="give-amount"><span>$</span><input type="text" inputmode="decimal" name="amount" placeholder="0" value="${state.amount}" aria-label="Amount"></label>
      <div class="give-presets">${PRESETS.map((p) => html`<button type="button" class="chip ${cents(state.amount) === p * 100 ? 'on' : ''}" data-preset="${p}">$${p}</button>`)}</div>
      <label class="field">Fund<select name="fund">${sections.map((sec) => html`<optgroup label="${sec || 'Funds'}">${cfg.funds.filter((f) => f.section === sec).map((f) => html`<option value="${f.id}" ${f.id === state.fund ? 'selected' : ''}>${f.name}</option>`)}</optgroup>`)}</select></label>
      <div class="field"><span>How often</span><div class="seg give-every">${[['once', 'One time'], ...Object.entries(cfg.every)].map(([k, label]) => html`<button type="button" class="${state.every === k ? 'on' : ''}" data-every="${k}">${label.replace(/^every /, 'Every ').replace(/^Every week$/, 'Weekly').replace(/^Every month$/, 'Monthly')}</button>`)}</div></div>
      <label class="check give-cover"><input type="checkbox" name="cover" ${state.cover ? 'checked' : ''}> <span>Add ${a >= 100 ? money(fee) : 'a little'} to cover processing fees, so the church receives the full ${a >= 100 ? money(a) : 'gift'}</span></label>
      ${cfg.me ? html`<p class="muted small" style="margin:0">Giving as <b>${cfg.me.name}</b> · receipt to ${cfg.me.email}</p>`
        : html`<div class="form"><label class="field">Your name<input type="text" name="name" autocomplete="name" required></label>
          <label class="field">Email for your receipt<input type="email" name="email" autocomplete="email" required></label></div>`}
      <button class="btn primary give-go" ${a >= 100 ? '' : 'disabled'}>${a >= 100 ? `Give ${money(all)}${state.every !== 'once' ? ` ${cfg.every[state.every]}` : ''}` : 'Enter an amount'}</button>
      <p class="muted small give-secure">${icon('lock', 'ic small-ic')} Secure payment by Stripe: card, bank account, Apple Pay or Google Pay.${mineHref ? html` <a href="${mineHref}">My giving</a>` : ''}</p>
    </form><div data-checkout></div>`);
    const input = el.querySelector('[name=amount]');
    input.oninput = () => { state.amount = input.value.replace(/[^\d.,]/g, ''); refresh(); };
  }
  // Update the totals without redrawing (keeps the keyboard up while typing).
  function refresh() {
    const { a, fee, all } = total();
    const go = el.querySelector('.give-go');
    go.disabled = a < 100;
    go.textContent = a >= 100 ? `Give ${money(all)}${state.every !== 'once' ? ` ${cfg.every[state.every]}` : ''}` : 'Enter an amount';
    el.querySelector('.give-cover span').textContent = `Add ${a >= 100 ? money(fee) : 'a little'} to cover processing fees, so the church receives the full ${a >= 100 ? money(a) : 'gift'}`;
    el.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('on', a === Number(b.dataset.preset) * 100));
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.type === 'submit' || b.matches('.give-go')) return;
    if (b.dataset.preset) { state.amount = b.dataset.preset; draw(); }
    if (b.dataset.every) { state.every = b.dataset.every; draw(); }
  });
  el.addEventListener('change', (e) => {
    if (e.target.name === 'fund') state.fund = Number(e.target.value);
    if (e.target.name === 'cover') { state.cover = e.target.checked; refresh(); }
  });
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const { a } = total();
    if (a < 100) return;
    const go = f.querySelector('.give-go');
    go.disabled = true;
    go.textContent = 'Opening secure payment…';
    try {
      const [stripe, s] = await Promise.all([loadStripe(cfg.publishable_key), post('/giving/checkout', {
        amount: a / 100, fund_id: state.fund, every: state.every === 'once' ? null : state.every, cover_fee: state.cover,
        name: f.name?.value, email: f.email?.value, return_to: returnTo,
      })]);
      const box = el.querySelector('[data-checkout]');
      f.classList.add('hidden');
      mount(box, html`<button type="button" class="btn ghost small" data-back>${icon('back')} Change amount</button><div class="give-checkout" data-mount></div>`);
      const checkout = await stripe.initEmbeddedCheckout({ fetchClientSecret: async () => s.client_secret });
      checkout.mount(box.querySelector('[data-mount]'));
      box.querySelector('[data-back]').onclick = () => { checkout.destroy(); box.replaceChildren(); f.classList.remove('hidden'); refresh(); };
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      fail(err);
      go.disabled = false;
      refresh();
    }
  });
  draw();
}

// ---------------------------------------------------------------- my giving (signed in)
export async function myGiving(el, { year } = {}) {
  const d = await get(`/giving/mine${year ? `?year=${year}` : ''}`);
  const cfg = await get('/giving/config');
  const thisYear = new Date().getFullYear();
  const status = { pending: html` <span class="pill warn">Processing</span>`, failed: html` <span class="pill bad">Didn’t go through</span>`, refunded: html` <span class="pill">Refunded</span>` };
  mount(el, html`<div class="card"><div class="row"><h2 style="margin:0">Giving in</h2>
      <select data-year aria-label="Year">${[0, 1, 2, 3].map((n) => html`<option ${String(thisYear - n) === d.year ? 'selected' : ''}>${thisYear - n}</option>`)}</select></div>
      <p class="give-total">${money(d.total_cents)}</p><p class="muted small" style="margin:0">Gifts that went through in ${d.year}. Your year-end statement comes by email in January.</p>
      ${d.gifts.some((g) => g.status === 'succeeded') ? html`<a class="btn small ghost" style="margin-top:10px" href="/api/giving/statement?year=${d.year}" target="_blank" rel="noopener">${icon('printer')} ${d.year} statement</a>` : ''}</div>
    <div class="card"><div class="card-head"><h2>Recurring gifts</h2></div>
      ${d.recurring.length ? d.recurring.map((g) => html`<div class="give-row"><div class="grow"><b>${money(g.amount_cents)}</b> ${g.every_label} · ${g.fund}${g.fee_cents ? html`<span class="muted small"> (+${money(g.fee_cents)} fees)</span>` : ''}
          ${g.status === 'past_due' ? html`<br><span class="pill bad">Last payment didn’t go through: update your payment method</span>` : ''}</div>
          <button class="btn small" data-change="${g.id}">Change</button><button class="btn small ghost danger" data-cancel="${g.id}">Stop</button></div>`)
        : html`<p class="muted small" style="margin:0">None. Choose Weekly or Monthly when you give to set one up.</p>`}
      ${d.recurring.length ? html`<button class="btn small ghost" data-card>${icon('edit')} Update card or bank account</button>` : ''}</div>
    <div class="card"><div class="card-head"><h2>Gifts</h2></div>
      ${d.gifts.length ? d.gifts.map((g) => html`<div class="give-row"><span class="muted small nowrap">${fmtDate(g.given_on)}</span><span class="grow">${g.fund}${status[g.status] || ''}</span>
        <span class="muted small">${g.method === 'bank' ? 'Bank' : g.method === 'card' ? 'Card' : g.method[0].toUpperCase() + g.method.slice(1)}</span><b>${money(g.amount_cents)}</b></div>`)
        : html`<p class="muted small" style="margin:0">No gifts in ${d.year}.</p>`}</div>`);
  el.onchange = (e) => { if (e.target.matches('[data-year]')) myGiving(el, { year: e.target.value }).catch(fail); };
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.cancel) {
        if (!(await confirm('Stop this recurring gift?', 'No more gifts will be taken. Gifts already made aren’t affected.', 'Stop gift'))) return;
        await post(`/giving/recurring/${b.dataset.cancel}/cancel`);
        toast('Recurring gift stopped.');
      }
      if (b.dataset.change) {
        const g = d.recurring.find((x) => x.id === Number(b.dataset.change));
        const out = await dialog({
          title: 'Change recurring gift',
          body: html`<div class="form"><label class="field">Amount<input type="text" inputmode="decimal" name="amount" value="${(g.amount_cents / 100).toFixed(2)}"></label>
            <label class="field">Fund<select name="fund">${cfg.funds.map((f) => html`<option value="${f.id}" ${f.id === g.fund_id ? 'selected' : ''}>${f.name}</option>`)}</select></label></div>
            <p class="muted small">Starts with the next gift, ${g.every_label}.</p>`,
          onSubmit: (f) => patch(`/giving/recurring/${g.id}`, { amount: f.amount.value, fund_id: Number(f.fund.value) }),
        });
        if (out) toast('Updated.');
      }
      if (b.matches('[data-card]')) { location.href = (await post('/giving/payment-method')).url; return; }
      myGiving(el, { year: d.year }).catch(fail);
    } catch (err) { fail(err); }
  };
}
