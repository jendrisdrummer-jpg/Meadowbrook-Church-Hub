// Live updates shared by chat and tasks: each open chat page holds a server-sent event stream,
// and the two route files reach each other through a few hooks (set up by the chat routes).
export const streams = new Set();

// Ends open streams for an account, for one session, or both (those matching everything given).
// Used on sign-out, deactivation, and role or campus changes; the page reconnects with fresh access.
export function closeStreams({ userId, token } = {}) {
  if (userId == null && !token) return 0;
  let n = 0;
  for (const s of [...streams]) {
    if ((userId != null && s.userId !== userId) || (token && s.token !== token)) continue;
    streams.delete(s);
    s.stop?.();
    try { s.res.end(); } catch { /* already gone */ }
    n++;
  }
  return n;
}

// Sends an event to these accounts' open pages, and to anyone looking at chatId.
export function send(userIds, chatId, event) {
  const ids = new Set(userIds);
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const s of [...streams]) {
    const direct = ids.has(s.userId);
    if (!direct && (!chatId || s.viewing !== chatId)) continue;
    // A session that has expired or been removed stops receiving.
    if (s.valid && !s.valid()) { closeStreams({ token: s.token }); continue; }
    if (direct) { s.res.write(data); continue; }
    // Matched only because they're looking at this chat: check they still may (removed from the
    // roster, group archived…), and stop sending if not.
    let ok = true;
    if (s.req) { try { ok = Boolean(hooks.chatAccess(s.req, chatId)); } catch { ok = false; } } // fail closed
    if (!ok) { s.viewing = null; continue; }
    s.res.write(data);
  }
}

// Filled in by the chat routes:
// chatAccess(req, chatId) → { kind, team_id, member, manage } | null
// chatPeople(chatId) → person ids in the chat
// myGroups(req) → [{ id, name }] groups this account is in
// taskPosted(taskId, req) → posts the task as a card in its chat
// taskChanged(taskId, messageIds?) → refreshes its cards and the chat's Tasks tab
// chatUsers(chatId), chatName(chatId); callPosted(callId, chatId, userId) → who is watching;
// callChanged(callId) → refreshes its cards
export const hooks = {
  chatAccess: () => null,
  chatPeople: () => [],
  myGroups: () => [],
  taskPosted: () => {},
  taskChanged: () => {},
};
