/**
 * Notification broadcast hook registry.
 *
 * Decouples the admin notification HTTP API (notify-api.ts) from the
 * realtime delivery layer (notify-socket.ts). The HTTP layer calls
 * broadcastNotification() after persisting a delivery; whatever realtime
 * transport is attached (WebSocket server, tests) registers itself via
 * setNotificationBroadcastHook(). Persistence stays authoritative — the
 * hook is best-effort instant push and must never throw into the request.
 */
export type NotificationBroadcastFn = (userIds: string[], payload: Record<string, unknown>) => void;

let hook: NotificationBroadcastFn | null = null;

export function setNotificationBroadcastHook(fn: NotificationBroadcastFn | null): void {
  hook = fn;
}

/** Best-effort push to online clients. Never throws. */
export function broadcastNotification(userIds: string[], payload: Record<string, unknown>): void {
  if (!hook || !userIds.length) return;
  try {
    hook(userIds, payload);
  } catch {
    /* realtime is best-effort; persistence already happened */
  }
}
