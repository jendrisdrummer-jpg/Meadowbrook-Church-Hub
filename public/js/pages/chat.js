// Chat: team chats and groups. Wide screens show the list beside the open chat.
import { openChat } from '../chat.js';
import { setTitle, refreshChatBadge } from '../app.js';

export default function chat(el, id) {
  return openChat(el, { id: id ? Number(id) : null, split: matchMedia('(min-width: 900px)').matches, setTitle, onUnread: refreshChatBadge });
}
