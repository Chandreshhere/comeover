import { personById } from '@/data/catalog';
import { relativeDay, timeLabel } from '@/utils/format';

// `users` is the store's user cache; pass it from a selector so names re-render
// when profiles arrive. Falls back to the live catalog lookup.
export const personOf = (id, users) => (users ? users[id] : null) || personById[id] || null;

export const nameOf = (id, profileName, users) => (id === 'me' ? profileName || 'You' : personOf(id, users)?.name || 'Member');

export const otherMember = (conv) => conv?.memberIds?.find((m) => m !== 'me');

export function stampLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return relativeDay(d) === 'Today' ? timeLabel(d) : relativeDay(d);
}

export const lastMessageOf = (msgs = [], blocked = []) => {
  for (let i = msgs.length - 1; i >= 0; i -= 1) if (!msgs[i].failed && !blocked.includes(msgs[i].senderId)) return msgs[i];
  return null;
};

// Newest of the server's conversation.lastMessage and anything loaded/received locally.
export function latestMessage(conv, msgs, blocked = []) {
  const local = lastMessageOf(msgs, blocked);
  const server = conv?.lastMessage && !blocked.includes(conv.lastMessage.senderId) ? conv.lastMessage : null;
  if (!local) return server;
  if (!server) return local;
  return new Date(local.createdAt) >= new Date(server.createdAt) ? local : server;
}
