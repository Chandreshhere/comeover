// API Gateway WebSocket client. Auth via ?token=<Cognito access token> on
// $connect; channels: activity:{id}, conversation:{id}, user:{id}:notifications.
// Envelope: { type: 'message.created'|'join.updated'|'activity.updated'|'notification.created', data }.
import { AppState } from 'react-native';
import config from '@/config';
import { getAccessToken } from '@/api/session';

let ws = null;
let handler = () => {};
let retry = 0;
let timer = null;
let stopped = true;
const channels = new Set();

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

async function connect() {
  if (stopped || !config.WS_URL) return;
  const token = await getAccessToken().catch(() => null);
  if (!token) return;
  ws = new WebSocket(`${config.WS_URL}?token=${encodeURIComponent(token)}`);
  ws.onopen = () => {
    retry = 0;
    channels.forEach((channel) => send({ action: 'subscribe', channel }));
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg?.type) handler(msg);
    } catch (err) {
      // ignore malformed frames
    }
  };
  ws.onclose = () => {
    ws = null;
    if (stopped) return;
    const delay = Math.min(30000, 1000 * 2 ** retry++);
    timer = setTimeout(connect, delay);
  };
  ws.onerror = () => ws?.close();
}

export const realtime = {
  start(onEvent) {
    handler = onEvent;
    if (!stopped) return;
    stopped = false;
    connect();
  },
  stop() {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
    ws = null;
  },
  subscribe(channel) {
    if (channels.has(channel)) return;
    channels.add(channel);
    send({ action: 'subscribe', channel });
  },
  unsubscribe(channel) {
    channels.delete(channel);
    send({ action: 'unsubscribe', channel });
  },
};

// Reconnect when the app returns to the foreground; drop the socket in background.
AppState.addEventListener('change', (s) => {
  if (stopped) return;
  if (s === 'active' && !ws) connect();
  if (s === 'background') ws?.close();
});

export default realtime;
