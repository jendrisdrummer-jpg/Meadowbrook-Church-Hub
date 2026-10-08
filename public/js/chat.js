// Chat, shared by the dashboard and the member app: the list of chats, and one conversation
// with replies, @mentions, photos and files, and reactions. Open chats update live.
import { get, post, patch, del, html, raw, mount, icon, avatar, displayName, esc, toast, fail, dialog, confirm, pickPeople, shrinkImage } from './lib.js';

const MAX_FILE = 25 * 1024 * 1024;
const touch = matchMedia('(pointer: coarse)').matches;

// One chat page at a time: its live stream and listeners are dropped when you leave.
let live = null;
function stop() {
  live?.();
  live = null;
  document.body.classList.remove('chat-on', 'chat-open');
}
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/chat')) stop(); });

// ---------------------------------------------------------------- formatting
const utc = (t) => new Date(`${t.replace(' ', 'T')}Z`);
const clock = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const sameDay = (a, b) => a.toDateString() === b.toDateString();
function dayLabel(d) {
  const now = new Date();
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, new Date(now - 864e5))) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
function shortWhen(t) {
  const d = utc(t);
  const now = new Date();
  if (sameDay(d, now)) return clock(d);
  if (now - d < 6 * 864e5) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const size = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameParts = (name) => ({ first_name: name.split(' ')[0], last_name: name.split(' ').slice(1).join(' ') });

// Message text: links become links and @mentions are highlighted; everything else is escaped.
function formatBody(m, members, myPersonId) {
  const tags = m.mentions.map((pid) => members.find((x) => x.person_id === pid)).filter(Boolean)
    .map((x) => ({ tag: `@${displayName(x)}`, me: x.person_id === myPersonId })).sort((a, b) => b.tag.length - a.tag.length);
  const re = new RegExp([String.raw`https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]`, ...tags.map((t) => reEsc(t.tag))].join('|'), 'g');
  let out = '';
  let i = 0;
  for (const hit of m.body.matchAll(re)) {
    out += esc(m.body.slice(i, hit.index));
    const t = hit[0];
    if (t.startsWith('@')) out += `<span class="chat-at ${tags.find((x) => x.tag === t)?.me ? 'me' : ''}">${esc(t)}</span>`;
    else out += `<a href="${esc(t)}" target="_blank" rel="noopener">${esc(t)}</a>`;
    i = hit.index + t.length;
  }
  return raw(out + esc(m.body.slice(i)));
}

// ---------------------------------------------------------------- the page
// split: the list and the open chat side by side (wide dashboard screens).
export async function openChat(el, { id = null, split = false, setTitle, onUnread = () => {} }) {
  stop();
  const S = { id, list: null, chat: null, msgs: [], more: false, reply: null, files: [], mentions: new Map(), loadingOlder: false };
  document.body.classList.add('chat-on');
  if (id && !split) document.body.classList.add('chat-open');
  mount(el, split
    ? html`<div class="chat-split"><aside class="chat-side" data-side></aside><section class="chat-main" data-main></section></div>`
    : html`<div class="chat-single" data-main></div>`);
  const side = el.querySelector('[data-side]');
  const main = el.querySelector('[data-main]');

  // The page fills the screen down to the bottom bar, so only the messages scroll.
  function fit() {
    const bar = [...document.querySelectorAll('.bottomnav, .m-tabs')].find((b) => getComputedStyle(b).display !== 'none');
    const h = (window.visualViewport?.height || innerHeight) - el.getBoundingClientRect().top - (bar ? bar.offsetHeight : 0) - 8;
    el.style.height = `${Math.max(280, h)}px`;
  }

  // ------------------------------------------------ live updates
  let es = null;
  const connect = () => {
    es?.close();
    es = new EventSource(`/api/chats/stream${S.id ? `?viewing=${S.id}` : ''}`);
    es.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch { /* ignore */ } };
  };
  const onVisible = () => {
    if (document.hidden) { es?.close(); es = null; return; }
    connect();
    refreshList();
    if (S.id) loadLatest().catch(() => {});
  };
  const onResize = () => { const bottom = atBottom(); fit(); if (bottom) toBottom(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  live = () => {
    es?.close();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('resize', onResize);
  };

  function onEvent(ev) {
    if (ev.type === 'message') {
      if (ev.chat_id === S.id) {
        upsert(ev.message);
        if (ev.message.user_id !== S.list?.me && !document.hidden) markRead();
      }
      refreshList();
    }
    if (ev.type === 'chats') {
      refreshList();
      if (S.id) get(`/chats/${S.id}`).then((c) => { S.chat = c; drawHead(); }).catch(() => { toast('That chat is no longer available.'); location.hash = '#/chat'; });
    }
  }

  // ------------------------------------------------ the list
  let listTimer;
  const refreshList = () => {
    clearTimeout(listTimer);
    listTimer = setTimeout(async () => {
      try {
        S.list = await get('/chats');
        if (side || !S.id) drawList();
        onUnread();
      } catch { /* offline: try again on the next event */ }
    }, 250);
  };

  function drawList() {
    const box = side || main;
    const L = S.list;
    const mine = L.chats.filter((c) => c.member);
    const others = L.chats.filter((c) => !c.member);
    const item = (c) => html`<a href="#/chat/${c.id}" class="chat-item ${c.id === S.id ? 'on' : ''} ${c.unread ? 'unread' : ''}">
      <span class="chat-ico" style="${c.color ? `background:${c.color}` : ''}">${c.kind === 'team' ? (c.name[0] || '#').toUpperCase() : icon('people')}</span>
      <span class="chat-item-text"><span class="chat-item-top"><b>${c.name}</b><span class="muted small">${c.last ? shortWhen(c.last.at) : ''}</span></span>
        <span class="chat-preview">${c.last ? `${c.last.mine ? 'You' : c.last.name.split(' ')[0]}: ${c.last.body || (c.last.files ? 'Sent an attachment' : '')}` : 'No messages yet'}</span></span>
      ${c.muted ? html`<span class="muted" title="Muted">${icon('bellOff', 'ic small-ic')}</span>` : ''}
      ${c.unread ? html`<span class="chat-badge">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}</a>`;
    mount(box, html`${split ? html`<div class="chat-side-head"><b>Chats</b>${L.can_create ? html`<button class="btn small" data-new>${icon('plus')} New group</button>` : ''}</div>` : ''}
      <div class="chat-list">${mine.length ? mine.map(item) : html`<div class="chat-empty">${icon('chat')}<p>No chats yet. You’ll see a chat for each team you’re on${L.can_create ? ', and any groups you start' : ''}.</p></div>`}</div>
      ${others.length ? html`<details class="chat-others"><summary class="muted small">Other team chats (${others.length})</summary><div class="chat-list">${others.map(item)}</div></details>` : ''}`);
  }

  async function newGroup() {
    const name = await dialog({
      title: 'New group',
      submit: 'Next: add people',
      body: html`<label class="field">Group name<input type="text" name="name" maxlength="80" placeholder="Staff, Elders, Easter planning…" required></label>
        <p class="muted small">Team chats are made for you. Groups are for people who aren’t one team.</p>`,
      onSubmit: (f) => f.name.value.trim(),
    });
    if (!name) return;
    const { people } = await pickPeople(`Who’s in ${name}?`, { submit: 'Create group', exclude: new Set(S.list.person_id ? [S.list.person_id] : []), already: 'That’s you' });
    const c = await post('/chats', { name, person_ids: people.map((p) => p.id) });
    location.hash = `#/chat/${c.id}`;
  }

  // ------------------------------------------------ one chat
  const scroller = () => main.querySelector('[data-scroll]');
  const atBottom = () => { const s = scroller(); return !s || s.scrollHeight - s.scrollTop - s.clientHeight < 80; };
  const toBottom = () => { const s = scroller(); if (s) s.scrollTop = s.scrollHeight; };

  function upsert(m) {
    const bottom = atBottom();
    const i = S.msgs.findIndex((x) => x.id === m.id);
    if (i >= 0) S.msgs[i] = m;
    else { S.msgs.push(m); S.msgs.sort((a, b) => a.id - b.id); }
    drawMsgs();
    if (bottom || m.user_id === S.list?.me) toBottom();
    else if (i < 0) main.querySelector('[data-jump]')?.classList.remove('hidden');
  }

  let readTimer;
  function markRead() {
    clearTimeout(readTimer);
    readTimer = setTimeout(() => {
      const last = S.msgs.at(-1)?.id;
      if (!last || !S.chat?.member) return;
      post(`/chats/${S.id}/read`, { last_id: last }).then(() => {
        const c = S.list?.chats.find((x) => x.id === S.id);
        if (c?.unread) { c.unread = 0; if (side) drawList(); }
        onUnread();
      }).catch(() => {});
    }, 300);
  }

  async function loadLatest() {
    const d = await get(`/chats/${S.id}/messages`);
    S.msgs = d.messages;
    S.more = d.more;
    drawMsgs();
    toBottom();
    markRead();
  }

  async function loadOlder() {
    if (!S.more || S.loadingOlder || !S.msgs.length) return;
    S.loadingOlder = true;
    try {
      const s = scroller();
      const d = await get(`/chats/${S.id}/messages?before=${S.msgs[0].id}`);
      const from = s.scrollHeight - s.scrollTop;
      S.msgs = [...d.messages, ...S.msgs];
      S.more = d.more;
      drawMsgs();
      s.scrollTop = s.scrollHeight - from;
    } finally { S.loadingOlder = false; }
  }

  function headActions() {
    const c = S.chat;
    return html`<button class="icon-btn" data-mute title="${c.muted ? 'Unmute' : 'Mute'}" aria-label="${c.muted ? 'Unmute' : 'Mute'}">${icon(c.muted ? 'bellOff' : 'bell')}</button>
      <button class="icon-btn" data-info title="People in this chat" aria-label="People in this chat">${icon('people')}</button>`;
  }
  // On phones the chat's own header (with a way back) replaces the page's title bar.
  function drawHead() {
    const c = S.chat;
    const sub = `${c.members.length} ${c.members.length === 1 ? 'person' : 'people'}${c.member ? '' : ' · you’re not on this team'}`;
    if (!split) setTitle(c.name);
    mount(main.querySelector('[data-head]'), html`${split ? '' : html`<a class="icon-btn chat-back" href="#/chat" aria-label="All chats">${icon('back')}</a>`}
      <button class="chat-title" data-info><b>${c.name}</b><span class="muted small">${sub}</span></button>${headActions()}`);
  }

  function msgHtml(m, prev) {
    const d = utc(m.created_at);
    const grouped = prev && !m.reply && prev.user_id === m.user_id && !prev.deleted && d - utc(prev.created_at) < 5 * 60e3 && sameDay(d, utc(prev.created_at));
    const mine = m.user_id === S.list.me;
    const canDelete = mine || S.chat.manage;
    return html`${!prev || !sameDay(utc(prev.created_at), d) ? html`<div class="chat-day"><span>${dayLabel(d)}</span></div>` : ''}
      <div class="chat-msg ${grouped ? 'grouped' : ''} ${m.deleted ? 'deleted' : ''}" data-id="${m.id}">
        <span class="chat-av">${grouped ? html`<span class="chat-time-hover">${clock(d)}</span>` : avatar({ ...nameParts(m.name), photo: m.photo })}</span>
        <div class="chat-content">
          ${grouped ? '' : html`<div class="chat-meta"><b>${m.name}</b><span class="muted small">${clock(d)}</span></div>`}
          ${m.deleted ? html`<div class="muted small"><i>Message deleted</i></div>` : html`
            ${m.reply ? html`<button type="button" class="chat-quote" data-goto="${m.reply.id}"><b>${m.reply.name}</b> <span>${m.reply.deleted ? 'Message deleted' : m.reply.body || (m.reply.files ? 'Attachment' : '')}</span></button>` : ''}
            ${m.body ? html`<div class="chat-body">${formatBody(m, S.chat.members, S.list.person_id)}${m.edited_at ? html` <span class="muted small">(edited)</span>` : ''}</div>` : ''}
            ${m.files.length ? html`<div class="chat-files">${m.files.map((f) => (f.mime.startsWith('image/') && f.mime !== 'image/heic'
              ? html`<a class="chat-img" href="${f.url}" target="_blank" rel="noopener"><img src="${f.url}" alt="${f.name}" loading="lazy"></a>`
              : html`<a class="chat-file" href="${f.url}" target="_blank" rel="noopener">${icon('file')}<span><b>${f.name}</b><br><span class="muted small">${size(f.size)}</span></span></a>`))}</div>` : ''}
            ${m.reactions.length ? html`<div class="chat-reacts">${m.reactions.map((r) => html`<button type="button" class="chat-react ${r.user_ids.includes(S.list.me) ? 'mine' : ''}" data-react="${r.emoji}" title="${r.names.join(', ')}">${r.emoji} <span>${r.user_ids.length}</span></button>`)}</div>` : ''}`}
        </div>
        ${m.deleted ? '' : html`<div class="chat-tools" role="toolbar">
          <div class="chat-emoji">${S.list.reactions.map((e) => html`<button type="button" data-react="${e}" aria-label="React ${e}">${e}</button>`)}</div>
          <button type="button" class="icon-btn" data-pick title="React" aria-label="React">${icon('smile')}</button>
          <button type="button" class="icon-btn" data-reply title="Reply" aria-label="Reply">${icon('reply')}</button>
          ${mine ? html`<button type="button" class="icon-btn" data-edit title="Edit" aria-label="Edit">${icon('edit')}</button>` : ''}
          ${canDelete ? html`<button type="button" class="icon-btn danger" data-delete title="Delete" aria-label="Delete">${icon('trash')}</button>` : ''}
        </div>`}
      </div>`;
  }

  function drawMsgs() {
    const box = main.querySelector('[data-msgs]');
    if (!box) return;
    const top = scroller().scrollTop;
    mount(box, html`${S.more ? html`<button type="button" class="btn small ghost chat-older" data-older>Load earlier messages</button>` : ''}
      ${S.msgs.length ? S.msgs.map((m, i) => msgHtml(m, S.msgs[i - 1])) : html`<div class="chat-empty">${icon('chat')}<p>No messages yet. Say hello to ${S.chat.name}!</p></div>`}`);
    scroller().scrollTop = top;
  }

  function drawComposer() {
    const box = main.querySelector('[data-extras]');
    mount(box, html`${S.reply ? html`<div class="chat-replybar">${icon('reply', 'ic small-ic')}<span class="grow">Replying to <b>${S.reply.name}</b>: ${S.reply.body.slice(0, 80) || 'Attachment'}</span><button type="button" class="icon-btn" data-cancel-reply aria-label="Cancel reply">${icon('x')}</button></div>` : ''}
      ${S.files.length ? html`<div class="chat-pending">${S.files.map((f, i) => html`<span class="chip ${f.id ? '' : 'busy'}">${icon(f.image ? 'image' : 'file', 'ic small-ic')} ${f.name}${f.id ? '' : ' · uploading…'}<button type="button" data-unfile="${i}" aria-label="Remove">×</button></span>`)}</div>` : ''}`);
  }

  async function openConversation() {
    mount(main, html`<div class="chat-conv">
      <div class="chat-head" data-head></div>
      <div class="chat-scroll" data-scroll><div class="chat-msgs" data-msgs><p class="muted small" style="padding:16px">Loading…</p></div></div>
      <button type="button" class="chat-jump hidden" data-jump>New messages ${icon('down', 'ic small-ic')}</button>
      <div class="chat-composer">
        <div data-extras></div>
        <div class="chat-mentions hidden" data-mention-menu role="listbox"></div>
        <form class="chat-form" data-form>
          <label class="icon-btn chat-attach" title="Add a photo or file">${icon('attach')}<input type="file" multiple data-file hidden></label>
          <textarea rows="1" data-text placeholder="Message ${S.chat.name}" aria-label="Message"></textarea>
          <button class="btn primary chat-send" aria-label="Send">${icon('send')}</button>
        </form>
      </div></div>`);
    drawHead();
    fit();
    await loadLatest();
    wireConversation();
    if (!touch) main.querySelector('[data-text]').focus();
  }

  // ------------------------------------------------ composing
  function wireConversation() {
    const text = main.querySelector('[data-text]');
    const menu = main.querySelector('[data-mention-menu]');
    const s = scroller();
    let picks = [];
    let pick = 0;

    const grow = () => { text.style.height = 'auto'; text.style.height = `${Math.min(160, text.scrollHeight)}px`; };
    s.addEventListener('scroll', () => {
      if (s.scrollTop < 60) loadOlder().catch(fail);
      if (atBottom()) main.querySelector('[data-jump]').classList.add('hidden');
    });

    // @mentions: type @ and a name, then pick from the people in this chat.
    function mentionQuery() {
      const before = text.value.slice(0, text.selectionStart);
      const m = before.match(/(?:^|\s)@([\p{L}'’-]*(?: [\p{L}'’-]*)?)$/u);
      return m ? m[1].toLowerCase() : null;
    }
    function drawMentions() {
      const q = mentionQuery();
      const people = S.chat.members.filter((x) => x.person_id !== S.list.person_id);
      picks = q == null ? [] : people.filter((x) => displayName(x).toLowerCase().split(' ').some((w, i, all) => all.slice(i).join(' ').startsWith(q))).slice(0, 6);
      pick = Math.min(pick, Math.max(0, picks.length - 1));
      menu.classList.toggle('hidden', !picks.length);
      mount(menu, picks.map((x, i) => html`<button type="button" class="${i === pick ? 'on' : ''}" data-mention="${i}">${avatar(x)}<span>${displayName(x)}${x.user_id ? '' : html` <span class="muted small">· not on the app yet</span>`}</span></button>`));
    }
    function choose(x) {
      const tag = `@${displayName(x)}`;
      const before = text.value.slice(0, text.selectionStart).replace(/@[^@]*$/, `${tag} `);
      text.value = before + text.value.slice(text.selectionStart);
      text.setSelectionRange(before.length, before.length);
      S.mentions.set(x.person_id, tag);
      picks = [];
      menu.classList.add('hidden');
      text.focus();
      grow();
    }
    menu.addEventListener('mousedown', (e) => e.preventDefault());
    menu.addEventListener('click', (e) => { const b = e.target.closest('[data-mention]'); if (b) choose(picks[b.dataset.mention]); });
    text.addEventListener('input', () => { grow(); drawMentions(); });
    text.addEventListener('keydown', (e) => {
      if (picks.length && ['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); pick = (pick + (e.key === 'ArrowDown' ? 1 : picks.length - 1)) % picks.length; drawMentions(); return; }
      if (picks.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); choose(picks[pick]); return; }
      if (e.key === 'Escape' && picks.length) { picks = []; menu.classList.add('hidden'); return; }
      if (e.key === 'Escape' && S.reply) { S.reply = null; drawComposer(); return; }
      if (e.key === 'Enter' && !e.shiftKey && !touch) { e.preventDefault(); send(); }
    });
    text.addEventListener('blur', () => setTimeout(() => menu.classList.add('hidden'), 150));

    async function send() {
      const body = text.value.trim();
      if (S.files.some((f) => !f.id)) return toast('Wait for the upload to finish.');
      if (!body && !S.files.length) return;
      const mentions = [...S.mentions].filter(([, tag]) => body.includes(tag)).map(([pid]) => pid);
      const btn = main.querySelector('.chat-send');
      btn.disabled = true;
      try {
        const m = await post(`/chats/${S.id}/messages`, { body, mentions, reply_to: S.reply?.id || null, file_ids: S.files.map((f) => f.id) });
        text.value = '';
        S.reply = null;
        S.files = [];
        S.mentions.clear();
        grow();
        drawComposer();
        upsert(m);
        toBottom();
      } catch (err) { fail(err); } finally { btn.disabled = false; text.focus(); }
    }
    main.querySelector('[data-form]').addEventListener('submit', (e) => { e.preventDefault(); send(); });

    // Photos and files upload as soon as they're picked; photos are shrunk first.
    main.querySelector('[data-file]').addEventListener('change', async (e) => {
      const list = [...e.target.files];
      e.target.value = '';
      for (const file of list) {
        if (file.size > MAX_FILE) { toast(`${file.name} is over 25 MB.`, 'bad'); continue; }
        const entry = { name: file.name, image: file.type.startsWith('image/') };
        S.files.push(entry);
        drawComposer();
        try {
          Object.assign(entry, await upload(file));
        } catch (err) {
          fail(err);
          S.files = S.files.filter((x) => x !== entry);
        }
        drawComposer();
      }
    });
  }

  async function upload(file) {
    let blob = file;
    let name = file.name || 'file';
    let type = file.type || 'application/octet-stream';
    if (/^image\/(jpeg|png|webp|heic|heif)$/.test(type)) {
      try {
        blob = await shrinkImage(file, 1600);
        type = 'image/jpeg';
        name = `${name.replace(/\.[^.]+$/, '')}.jpg`;
      } catch { /* this browser can't read it (e.g. HEIC): send the original */ }
    }
    const res = await fetch(`/api/chats/${S.id}/files`, { method: 'POST', headers: { 'x-mb': '1', 'content-type': 'application/octet-stream', 'x-file-type': type, 'x-file-name': encodeURIComponent(name) }, body: blob });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Couldn’t upload ${name}.`);
    return data;
  }

  // ------------------------------------------------ people in the chat
  async function info() {
    const c = S.chat;
    const group = c.kind === 'group';
    const inIt = c.members.some((x) => x.person_id === S.list.person_id);
    await dialog({
      title: c.name,
      submit: null,
      cancel: 'Close',
      body: html`${group && c.manage ? html`<form class="row" data-rename style="margin-bottom:12px"><input type="text" name="name" value="${c.name}" maxlength="80" aria-label="Group name" style="flex:1"><button class="btn small">Rename</button></form>` : ''}
        <div class="row" style="margin-bottom:6px"><b>${c.members.length} ${c.members.length === 1 ? 'person' : 'people'}</b><span class="spacer"></span>${group && c.manage ? html`<button type="button" class="btn small" data-add>${icon('plus')} Add people</button>` : ''}</div>
        <div class="chat-members">${c.members.map((x) => html`<div class="row">${avatar(x)}<span class="grow">${displayName(x)}${x.person_id === S.list.person_id ? ' (you)' : ''}
            ${x.is_admin ? html` <span class="pill info">${group ? 'Admin' : 'Leader'}</span>` : ''}${x.user_id ? '' : html`<br><span class="muted small">Not on the app yet, so they won’t see messages</span>`}</span>
          ${group && c.manage && x.person_id !== S.list.person_id ? html`<button type="button" class="icon-btn" data-remove="${x.person_id}" title="Remove from group" aria-label="Remove">${icon('x')}</button>` : ''}</div>`)}</div>
        ${group ? '' : html`<p class="muted small">This chat follows the team roster: people added to the team join it, and people taken off leave it.</p>`}
        ${group ? html`<div class="row" style="margin-top:14px">${inIt ? html`<button type="button" class="btn small ghost" data-leave>${icon('logout')} Leave group</button>` : ''}<span class="spacer"></span>${c.manage ? html`<button type="button" class="btn small danger" data-delete-group>${icon('trash')} Delete group</button>` : ''}</div>` : ''}`,
      onOpen: (d, close) => {
        d.querySelector('[data-rename]')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          try { await patch(`/chats/${c.id}`, { name: e.target.name.value }); close(); reloadChat(); } catch (err) { fail(err); }
        });
        d.addEventListener('click', async (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          try {
            if (b.matches('[data-add]')) {
              close();
              const { people } = await pickPeople(`Add people to ${c.name}`, { exclude: new Set(c.members.map((x) => x.person_id)), already: 'Already in this group' });
              if (people.length) { await post(`/chats/${c.id}/members`, { person_ids: people.map((p) => p.id) }); toast('Added.'); }
              return reloadChat();
            }
            if (b.dataset.remove) { await del(`/chats/${c.id}/members/${b.dataset.remove}`); close(); return reloadChat(); }
            if (b.matches('[data-leave]')) {
              close();
              if (!(await confirm(`Leave ${c.name}?`, 'You won’t see its messages any more. Someone who runs the group can add you back.', 'Leave'))) return;
              await del(`/chats/${c.id}/members/${S.list.person_id}`);
              location.hash = '#/chat';
            }
            if (b.matches('[data-delete-group]')) {
              close();
              if (!(await confirm(`Delete ${c.name}?`, 'All its messages and files are deleted for everyone. This can’t be undone.'))) return;
              await del(`/chats/${c.id}`);
              location.hash = '#/chat';
            }
          } catch (err) { fail(err); }
        });
      },
    });
  }
  async function reloadChat() {
    S.chat = await get(`/chats/${S.id}`);
    drawHead();
    drawMsgs();
  }

  // ------------------------------------------------ clicks
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button, [data-goto]');
    const msgEl = e.target.closest('.chat-msg');
    // On phones, tap a message to show its tools.
    if (touch && msgEl && !b && !e.target.closest('a')) {
      el.querySelectorAll('.chat-msg.sel').forEach((x) => x !== msgEl && x.classList.remove('sel', 'picking'));
      msgEl.classList.toggle('sel');
      return;
    }
    if (!b) return;
    const m = msgEl && S.msgs.find((x) => x.id === Number(msgEl.dataset.id));
    try {
      if (b.matches('[data-new]')) return await newGroup();
      if (b.matches('[data-info]')) return await info();
      if (b.matches('[data-mute]')) return await toggleMute();
      if (b.matches('[data-older]')) return await loadOlder();
      if (b.matches('[data-jump]')) { toBottom(); b.classList.add('hidden'); return; }
      if (b.matches('[data-cancel-reply]')) { S.reply = null; return drawComposer(); }
      if (b.dataset.unfile) { S.files.splice(Number(b.dataset.unfile), 1); return drawComposer(); }
      if (b.dataset.goto) {
        const target = el.querySelector(`.chat-msg[data-id="${b.dataset.goto}"]`);
        if (target) { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1500); }
        return;
      }
      if (!m) return;
      if (b.matches('[data-pick]')) { msgEl.classList.toggle('picking'); return; }
      if (b.dataset.react) { msgEl.classList.remove('picking', 'sel'); return upsert(await post(`/messages/${m.id}/reactions`, { emoji: b.dataset.react })); }
      if (b.matches('[data-reply]')) {
        S.reply = m;
        drawComposer();
        msgEl.classList.remove('sel');
        return main.querySelector('[data-text]').focus();
      }
      if (b.matches('[data-edit]')) {
        const body = await dialog({
          title: 'Edit message',
          body: html`<textarea name="body" rows="4" maxlength="4000" style="width:100%">${m.body}</textarea>`,
          onSubmit: (f) => f.body.value,
        });
        if (body != null && body !== true) upsert(await patch(`/messages/${m.id}`, { body }));
        return;
      }
      if (b.matches('[data-delete]')) {
        if (!(await confirm('Delete this message?', 'It’s removed for everyone in the chat.'))) return;
        await del(`/messages/${m.id}`);
        upsert({ ...m, deleted: true, body: '', files: [], reactions: [] });
      }
    } catch (err) { fail(err); }
  });
  const actions = document.querySelector('[data-actions]');
  async function toggleMute() {
    const muted = !S.chat.muted;
    await patch(`/chats/${S.id}/me`, { muted });
    S.chat.muted = muted;
    drawHead();
    refreshList();
    toast(muted ? 'Muted. You’ll still hear when someone @mentions you.' : 'Notifications on for this chat.');
  }

  // ------------------------------------------------ start
  S.list = await get('/chats');
  if (split || !S.id) setTitle('Chat', !split && S.list.can_create ? html`<button class="btn small" data-new-top>${icon('plus')} New group</button>` : '');
  if (!split && !S.id && actions) actions.onclick = (e) => { if (e.target.closest('[data-new-top]')) newGroup().catch(fail); };
  if (side || !S.id) drawList();
  if (S.id) {
    try {
      S.chat = await get(`/chats/${S.id}`);
    } catch (err) {
      if (err.status !== 404) throw err;
      toast('That chat isn’t available to you.', 'bad');
      location.hash = '#/chat';
      return;
    }
    await openConversation();
  } else if (split) {
    mount(main, html`<div class="chat-empty big">${icon('chat')}<p>Pick a chat on the left.</p></div>`);
  }
  fit();
  connect();
  onUnread();
}

// For menus and buttons elsewhere: how many unread messages.
export async function chatUnread() {
  try { return (await get('/chats/unread')).total; } catch { return 0; }
}
