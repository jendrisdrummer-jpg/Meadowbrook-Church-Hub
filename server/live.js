// Live updates shared by chat and tasks: each open chat page holds a server-sent event stream,
// and the two route files reach each other through a few hooks (set up by the chat routes).
export const streams = new Set();

// Sends an event to these accounts' open pages, and to anyone looking at chatId.
export function send(userIds, chatId, event) {
  const ids = new Set(userIds);
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const s of streams) if (ids.has(s.userId) || (chatId && s.viewing === chatId)) s.res.write(data);
}

// Filled in by the chat routes:
// chatAccess(req, chatId) → { kind, team_id, member, manage } | null
// chatPeople(chatId) → person ids in the chat
// myGroups(req) → [{ id, name }] groups this account is in
// taskPosted(taskId, req) → posts the task as a card in its chat
// taskChanged(taskId, messageIds?) → refreshes its cards and the chat's Tasks tab
export const hooks = {
  chatAccess: () => null,
  chatPeople: () => [],
  myGroups: () => [],
  taskPosted: () => {},
  taskChanged: () => {},
};
