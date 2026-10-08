/**
 * NEUTRON realtime notification WebSocket server.
 *
 * Mounted on the Node HTTP server at /api/notifications/stream. Vercel
 * serverless functions cannot hold WebSocket connections, so this only runs
 * on the Node server (Render). The web app opens it against the resolved
 * auth backend.
 *
 * Auth: browsers cannot send an Authorization header on the WebSocket
 * handshake, so the client sends {"type":"auth","token":"<session>"} as its
 * first message. The token is kept OUT of the URL so it never lands in
 * access logs, and it is never logged or retained after validation. The
 * connection is closed if no valid auth arrives within 10s.
 *
 * Protocol (JSON frames):
 *   -> {"type":"auth","token":"..."}   authenticate; replies {"type":"ready","unreadCount":n}
 *   -> {"type":"ping"}                 replies {"type":"pong"}
 *   <- {"type":"notification","notification":{...},"unreadCount":n}
 *
 * Persistence stays authoritative: delivery writes to the store first and
 * the broadcast here is best-effort instant push to online clients.
 */
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import { getAuthStore } from "./api";
import type { AuthStore } from "./store";
import { setNotificationBroadcastHook } from "./notify-events";

export const NOTIFY_WS_PATH = "/api/notifications/stream";
/** Marker so other upgrade handlers (collab) leave our claimed sockets alone. */
export const NOTIFY_WS_CLAIMED = "__neutronNotifyClaimed";

const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;
/** 64KB: notification payloads are tiny; anything bigger is abusive. */
const MAX_WS_PAYLOAD = 64 * 1024;
/** Max inbound messages per socket per minute. */
const MAX_INBOUND_PER_MIN = 30;

export interface NotifySocketOptions {
  getStore?: () => AuthStore;
  authTimeoutMs?: number;
  heartbeatMs?: number;
}

interface ConnState {
  authed: boolean;
  userId: string | null;
  inbound: number;
  windowStart: number;
  alive: boolean;
}

export class NotifySocketServer {
  readonly path = NOTIFY_WS_PATH;
  private wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD });
  /** userId -> live sockets */
  private clients = new Map<string, Set<WebSocket>>();
  private timers: NodeJS.Timeout[] = [];
  private getStore: () => AuthStore;
  private authTimeoutMs: number;

  constructor(opts: NotifySocketOptions = {}) {
    this.getStore = opts.getStore ?? (() => getAuthStore(undefined));
    this.authTimeoutMs = opts.authTimeoutMs ?? AUTH_TIMEOUT_MS;
    const hbMs = opts.heartbeatMs ?? HEARTBEAT_MS;
    this.timers.push(
      setInterval(() => this.heartbeat(), hbMs),
    );
    // Register the broadcast hook so admin sends reach online clients instantly.
    setNotificationBroadcastHook((userIds, payload) => {
      void this.pushToUsers(userIds, payload);
    });
  }

  attach(http: HttpServer): void {
    http.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
      let pathname = "";
      try {
        pathname = new URL(req.url || "", "http://localhost").pathname;
      } catch {
        return; // not ours; leave for other handlers
      }
      if (pathname !== this.path) return;
      (socket as unknown as Record<string, unknown>)[NOTIFY_WS_CLAIMED] = true;
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
    });
  }

  /** Number of currently connected (open) sockets. Exported for status/tests. */
  connectionCount(): number {
    let n = 0;
    for (const set of this.clients.values()) n += set.size;
    return n;
  }

  /** Best-effort push of a delivered notification to online recipients. */
  async pushToUsers(userIds: string[], payload: Record<string, unknown>): Promise<void> {
    for (const uid of userIds) {
      const set = this.clients.get(uid);
      if (!set || !set.size) continue;
      let unreadCount = 0;
      try {
        unreadCount = await this.getStore().getUnreadCount(uid);
      } catch {
        /* fall through with 0 */
      }
      const frame = JSON.stringify({ type: "notification", notification: payload, unreadCount });
      for (const ws of set) {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(frame);
          } catch {
            /* ignore broken sockets; heartbeat sweeps them */
          }
        }
      }
    }
  }

  close(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const set of this.clients.values()) {
      for (const ws of set) {
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
      }
    }
    this.clients.clear();
    try {
      this.wss.close();
    } catch {
      /* ignore */
    }
    setNotificationBroadcastHook(null);
  }

  private onConnection(ws: WebSocket): void {
    const st: ConnState = { authed: false, userId: null, inbound: 0, windowStart: Date.now(), alive: true };
    // Stash state on the socket so the heartbeat sweep can find it.
    (ws as unknown as { __notifyState?: ConnState }).__notifyState = st;
    const authTimer = setTimeout(() => {
      if (!st.authed) {
        try {
          ws.close(4400, "authentication timeout");
        } catch {
          /* ignore */
        }
      }
    }, this.authTimeoutMs);
    try {
      (authTimer as unknown as { unref?: () => void }).unref?.();
    } catch {
      /* ignore */
    }

    ws.on("pong", () => {
      st.alive = true;
    });

    ws.on("message", (data) => {
      // Inbound rate limit (sliding 60s window).
      const now = Date.now();
      if (now - st.windowStart > 60_000) {
        st.windowStart = now;
        st.inbound = 0;
      }
      st.inbound++;
      if (st.inbound > MAX_INBOUND_PER_MIN) {
        try {
          ws.close(4429, "rate limited");
        } catch {
          /* ignore */
        }
        return;
      }

      let msg: { type?: unknown; token?: unknown };
      try {
        const parsed: unknown = JSON.parse(String(data));
        if (!parsed || typeof parsed !== "object") throw new Error("bad frame");
        msg = parsed as { type?: unknown; token?: unknown };
      } catch {
        return; // ignore malformed frames
      }

      if (msg.type === "ping") {
        try {
          ws.send(JSON.stringify({ type: "pong" }));
        } catch {
          /* ignore */
        }
        return;
      }

      if (msg.type === "auth") {
        if (st.authed) return;
        const token = typeof msg.token === "string" ? msg.token.trim() : "";
        if (!token) {
          try {
            ws.close(4401, "missing token");
          } catch {
            /* ignore */
          }
          return;
        }
        void this.authenticate(ws, st, token).catch(() => {
          try {
            ws.close(4401, "invalid token");
          } catch {
            /* ignore */
          }
        });
        return;
      }
      // Unknown frame types are ignored.
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      if (st.userId) {
        const set = this.clients.get(st.userId);
        if (set) {
          set.delete(ws);
          if (!set.size) this.clients.delete(st.userId);
        }
      }
    });

    ws.on("error", () => {
      /* connection-level errors are handled via close */
    });
  }

  private async authenticate(ws: WebSocket, st: ConnState, token: string): Promise<void> {
    // Never log the token.
    const auth = await this.getStore().getSession(token);
    if (!auth || ws.readyState !== WebSocket.OPEN) {
      throw new Error("invalid session");
    }
    st.authed = true;
    st.userId = auth.user.id;
    let set = this.clients.get(st.userId);
    if (!set) {
      set = new Set();
      this.clients.set(st.userId, set);
    }
    set.add(ws);
    let unreadCount = 0;
    try {
      unreadCount = await this.getStore().getUnreadCount(st.userId);
    } catch {
      /* fall through */
    }
    ws.send(JSON.stringify({ type: "ready", unreadCount }));
  }

  private heartbeat(): void {
    for (const [uid, set] of this.clients) {
      for (const ws of set) {
        if (ws.readyState !== WebSocket.OPEN) {
          set.delete(ws);
          continue;
        }
        const st = (ws as unknown as { __notifyState?: ConnState }).__notifyState;
        if (st && !st.alive) {
          // Missed the last pong: drop the dead socket.
          try {
            ws.terminate();
          } catch {
            /* ignore */
          }
          set.delete(ws);
          continue;
        }
        if (st) st.alive = false;
        try {
          ws.ping();
        } catch {
          set.delete(ws);
        }
      }
      if (!set.size) this.clients.delete(uid);
    }
  }
}
