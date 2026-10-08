/**
 * Admin + user notification APIs.
 *
 * Admin routes (all require an authenticated ADMIN):
 *   GET  /api/admin/stats
 *   GET  /api/admin/users?search=
 *   POST /api/admin/notifications
 *   GET  /api/admin/notifications?type=&search=&page=&limit=
 *   GET  /api/admin/notifications/:id
 *   DELETE /api/admin/notifications/:id  (removes the notification + all user copies)
 *
 * User routes (any authenticated user, scoped to their own data):
 *   GET   /api/notifications?unreadOnly=&limit=
 *   GET   /api/notifications/unread-count
 *   PATCH /api/notifications/:id/read
 *   PATCH /api/notifications/read-all
 *   DELETE /api/notifications/:id  (removes the user's own copy)
 *
 * Node server only — needs the writable auth store (Render). The web UI
 * already falls back to the Render backend for auth calls.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { getAuthStore } from "./api";
import type { AuthStore } from "./store";
import type { NotificationType, NotificationAudience } from "./store";

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/* ----- rate limiting (per key, sliding window) ----- */
const hits = new Map<string, { n: number; reset: number }>();
function rateLimited(key: string, max = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset <= now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  h.n++;
  return h.n > max;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  const t = m ? m[1] : undefined;
  return t ? t.trim() : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(c as Buffer);
    if (chunks.reduce((n, b) => n + b.length, 0) > 100_000) {
      throw new HttpError(413, "Request body too large.");
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

/** Authenticate via Bearer token. Throws 401 when missing/invalid. */
async function requireUser(st: AuthStore, req: IncomingMessage) {
  const token = bearer(req);
  const auth = token ? await st.getSession(token) : null;
  if (!auth) throw new HttpError(401, "Authentication required.");
  return auth; // { session, user }
}

/** Authenticate + require the ADMIN role. Throws 401/403. */
async function requireAdmin(st: AuthStore, req: IncomingMessage) {
  const auth = await requireUser(st, req);
  if (auth.user.role !== "admin") {
    throw new HttpError(403, "Admin access required.");
  }
  return auth;
}

const NOTIF_TYPES: NotificationType[] = ["information", "success", "warning", "important", "system_update"];
const AUDIENCES: NotificationAudience[] = ["all", "active", "specific"];

/* ================= admin API ================= */

export async function handleAdminApi(
  dataDir: string | undefined,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const st = getAuthStore(dataDir);
  const ip = req.socket.remoteAddress ?? "unknown";
  const sub = url.pathname.slice("/api/admin".length);
  const seg = sub.split("/").filter(Boolean);

  try {
    const admin = await requireAdmin(st, req);
    const adminId = admin.user.id;

    /* GET /api/admin/stats — dashboard cards */
    if (req.method === "GET" && seg.length === 1 && seg[0] === "stats") {
      sendJson(res, 200, { ok: true, stats: await st.adminStats() });
      return;
    }

    /* GET /api/admin/users?search= — for targeting specific users */
    if (req.method === "GET" && seg.length === 1 && seg[0] === "users") {
      const search = str(url.searchParams.get("search")).slice(0, 60);
      sendJson(res, 200, { ok: true, users: await st.adminUserList(search || undefined) });
      return;
    }

    /* POST /api/admin/notifications — send a notification */
    if (req.method === "POST" && seg.length === 1 && seg[0] === "notifications") {
      // Max 10 sends per admin per minute.
      if (rateLimited(`admin-notify:${adminId}`, 10)) {
        sendJson(res, 429, { ok: false, error: "Too many requests. Slow down." });
        return;
      }
      const body = await readJsonBody(req);
      const title = str(body.title).trim().slice(0, 120);
      const message = str(body.message).trim().slice(0, 1000);
      const type = str(body.type).trim().toLowerCase() as NotificationType;
      const audience = str(body.audience).trim().toLowerCase() as NotificationAudience;
      if (!title) throw new HttpError(400, "Title is required.");
      if (!message) throw new HttpError(400, "Message is required.");
      if (!NOTIF_TYPES.includes(type)) throw new HttpError(400, "Invalid notification type.");
      if (!AUDIENCES.includes(audience)) throw new HttpError(400, "Invalid audience.");

      let specificIds: string[] | undefined;
      if (audience === "specific") {
        const raw = body.userIds;
        if (!Array.isArray(raw) || !raw.length) {
          throw new HttpError(400, "Select at least one user for a specific audience.");
        }
        if (raw.length > 100) throw new HttpError(400, "Too many specific users (max 100).");
        specificIds = [...new Set(raw.map((v) => str(v).trim()).filter(Boolean))];
        if (!specificIds.length) throw new HttpError(400, "Select at least one user.");
        // Validate IDs look like user IDs (defense against NoSQL injection).
        for (const id of specificIds) {
          if (!/^u_[A-Za-z0-9_-]{1,40}$/.test(id)) throw new HttpError(400, "Invalid user ID.");
        }
      }

      const targetIds = await st.resolveAudience(audience, specificIds);
      if (!targetIds.length) {
        sendJson(res, 200, { ok: false, error: "There are no eligible users for this notification." });
        return;
      }

      const notif = await st.createNotification({
        title, message, type, audience,
        targetUserIds: specificIds,
        createdBy: adminId,
        createdByEmail: admin.user.email,
        recipientCount: targetIds.length,
      });
      const delivered = await st.deliverNotification(notif, targetIds);

      await st.logAudit({
        adminId,
        adminEmail: admin.user.email,
        action: "SEND_NOTIFICATION",
        notificationId: notif.id,
        details: `type=${type} audience=${audience} recipients=${delivered}`,
      });

      sendJson(res, 200, {
        ok: true,
        message: `Notification sent to ${delivered} user${delivered === 1 ? "" : "s"}.`,
        recipients: delivered,
        id: notif.id,
      });
      return;
    }

    /* GET /api/admin/notifications — history with filters */
    if (req.method === "GET" && seg.length === 1 && seg[0] === "notifications") {
      const type = str(url.searchParams.get("type")).trim().toLowerCase() || undefined;
      const search = str(url.searchParams.get("search")).trim().slice(0, 80) || undefined;
      const page = Math.max(1, parseInt(str(url.searchParams.get("page")), 10) || 1);
      const limit = Math.min(50, Math.max(5, parseInt(str(url.searchParams.get("limit")), 10) || 20));
      if (type && !NOTIF_TYPES.includes(type as NotificationType)) {
        throw new HttpError(400, "Invalid type filter.");
      }
      const { items, total } = await st.listNotifications({
        type, search, limit, offset: (page - 1) * limit,
      });
      sendJson(res, 200, { ok: true, items, total, page, limit });
      return;
    }

    /* GET /api/admin/notifications/:id — details */
    if (req.method === "GET" && seg.length === 2 && seg[0] === "notifications") {
      const nid = seg[1] || "";
      if (!/^n_[A-Za-z0-9_-]{1,40}$/.test(nid)) throw new HttpError(400, "Invalid notification ID.");
      const notif = await st.getNotification(nid);
      if (!notif) throw new HttpError(404, "Notification not found.");
      sendJson(res, 200, { ok: true, notification: notif });
      return;
    }

    /* DELETE /api/admin/notifications/:id — delete a sent notification entirely,
       including every user's delivered copy. Data is removed, not just hidden. */
    if (req.method === "DELETE" && seg.length === 2 && seg[0] === "notifications") {
      const nid = seg[1] || "";
      if (!/^n_[A-Za-z0-9_-]{1,40}$/.test(nid)) throw new HttpError(400, "Invalid notification ID.");
      const deleted = await st.deleteNotification(nid);
      if (!deleted) throw new HttpError(404, "Notification not found.");
      await st.logAudit({
        adminId,
        adminEmail: admin.user.email,
        action: "DELETE_NOTIFICATION",
        notificationId: nid,
        details: `title="${deleted.title.slice(0, 60)}"`,
      });
      sendJson(res, 200, { ok: true, message: "Notification deleted." });
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found." });
  } catch (e) {
    if (e instanceof HttpError) {
      sendJson(res, e.status, { ok: false, error: e.message });
      return;
    }
    sendJson(res, 500, { ok: false, error: "Internal server error." });
  }
}

/* ================= user API ================= */

export async function handleNotifyApi(
  dataDir: string | undefined,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const st = getAuthStore(dataDir);
  const sub = url.pathname.slice("/api/notifications".length);
  const seg = sub.split("/").filter(Boolean);

  try {
    const auth = await requireUser(st, req);
    const userId = auth.user.id;

    /* GET /api/notifications?unreadOnly=1&limit= */
    if (req.method === "GET" && seg.length === 0) {
      const unreadOnly = url.searchParams.get("unreadOnly") === "1";
      const limit = Math.min(100, Math.max(1, parseInt(str(url.searchParams.get("limit")), 10) || 50));
      sendJson(res, 200, {
        ok: true,
        items: await st.getUserNotifications(userId, { unreadOnly, limit }),
      });
      return;
    }

    /* GET /api/notifications/unread-count */
    if (req.method === "GET" && seg.length === 1 && seg[0] === "unread-count") {
      sendJson(res, 200, { ok: true, count: await st.getUnreadCount(userId) });
      return;
    }

    /* PATCH /api/notifications/read-all */
    if ((req.method === "PATCH" || req.method === "POST") && seg.length === 1 && seg[0] === "read-all") {
      const n = await st.markAllNotificationsRead(userId);
      sendJson(res, 200, { ok: true, marked: n });
      return;
    }

    /* PATCH /api/notifications/:id/read */
    if ((req.method === "PATCH" || req.method === "POST") && seg.length === 2 && seg[1] === "read") {
      const nid = seg[0] || "";
      if (!/^n_[A-Za-z0-9_-]{1,40}$/.test(nid)) throw new HttpError(400, "Invalid notification ID.");
      const ok = await st.markNotificationRead(userId, nid);
      if (!ok) throw new HttpError(404, "Notification not found.");
      sendJson(res, 200, { ok: true });
      return;
    }

    /* DELETE /api/notifications/:id — delete the user's own copy.
       Data is removed from storage, not just hidden. Scoped to the caller:
       the composite key makes another user's copy unreachable (404). */
    if (req.method === "DELETE" && seg.length === 1) {
      const nid = seg[0] || "";
      if (!/^n_[A-Za-z0-9_-]{1,40}$/.test(nid)) throw new HttpError(400, "Invalid notification ID.");
      const ok = await st.deleteUserNotification(userId, nid);
      if (!ok) throw new HttpError(404, "Notification not found.");
      sendJson(res, 200, { ok: true, message: "Notification deleted." });
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found." });
  } catch (e) {
    if (e instanceof HttpError) {
      sendJson(res, e.status, { ok: false, error: e.message });
      return;
    }
    sendJson(res, 500, { ok: false, error: "Internal server error." });
  }
}
