/**
 * /api/auth/* and /api/connections/* — NEUTRON accounts.
 *
 * Login options: guest (instant), email+password, Google (needs
 * GOOGLE_CLIENT_ID on the server). Unique usernames, public profiles,
 * and a connections (friend request) system.
 *
 * Auth: Bearer <session token>. Rate-limited per IP for creation
 * endpoints. All errors are JSON { ok:false, error }.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { AuthStore, validUsername, safeUser } from "./store";
import { hashPassword, verifyPassword, verifyGoogleIdToken } from "./crypto";

let store: AuthStore | null = null;

export function getAuthStore(dataDir?: string): AuthStore {
  if (!store) store = new AuthStore(dataDir || join(process.cwd(), ".neutron-data"));
  return store;
}

/** Test hook. */
export function setAuthStore(s: AuthStore | null): void {
  store = s;
}

class AuthHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    // Allow the web UI (served from Vercel) to call auth cross-origin.
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(c as Buffer);
    if (chunks.reduce((n, b) => n + b.length, 0) > 100_000) {
      throw new AuthHttpError(413, "Request body too large.");
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object") return v as Record<string, unknown>;
    throw new Error("not an object");
  } catch {
    throw new AuthHttpError(400, "Invalid JSON body.");
  }
}

/* Simple per-IP rate limiter for account-creation endpoints. */
const hits = new Map<string, { n: number; reset: number }>();
function rateLimited(ip: string, max = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset <= now) {
    hits.set(ip, { n: 1, reset: now + windowMs });
    return false;
  }
  h.n++;
  return h.n > max;
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

function suggestUsername(base: string): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 18) || "user";
  return clean;
}

export async function handleAuthApi(
  dataDir: string | undefined,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const st = getAuthStore(dataDir);
  const path = url.pathname;
  const sub = path.slice("/api/auth".length);
  const seg = sub.split("/").filter(Boolean);
  const ip = req.socket.remoteAddress ?? "unknown";

  try {
    /* GET /api/auth/status — is auth available? (persistent? google configured?) */
    if (req.method === "GET" && seg.length === 1 && seg[0] === "status") {
      const googleClientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
      sendJson(res, 200, {
        ok: true,
        persistent: st.persistent,
        google: !!googleClientId,
        googleClientId: googleClientId || undefined,
      });
      return;
    }

    /* GET /api/auth/check-username?u=xxx */
    if (req.method === "GET" && seg.length === 1 && seg[0] === "check-username") {
      const u = (url.searchParams.get("u") || "").trim();
      if (!validUsername(u)) { sendJson(res, 200, { ok: true, available: false, reason: "invalid" }); return; }
      sendJson(res, 200, { ok: true, available: !(await st.usernameTaken(u)) });
      return;
    }

    /* GET /api/auth/profile?u=xxx — public profile */
    if (req.method === "GET" && seg.length === 1 && seg[0] === "profile") {
      const u = (url.searchParams.get("u") || "").trim();
      const p = await st.publicProfile(u);
      if (!p) { sendJson(res, 404, { ok: false, error: "User not found." }); return; }
      sendJson(res, 200, { ok: true, profile: p });
      return;
    }

    /* POST /api/auth/guest { username?, displayName? } */
    if (req.method === "POST" && seg.length === 1 && seg[0] === "guest") {
      if (rateLimited(ip)) { sendJson(res, 429, { ok: false, error: "Too many requests. Slow down." }); return; }
      const body = await readJsonBody(req);
      let username = suggestUsername(str(body.username) || `guest${Math.floor(Math.random() * 9000 + 1000)}`);
      if (!validUsername(username)) username = `guest${Math.floor(Math.random() * 9000 + 1000)}`;
      if (await st.usernameTaken(username)) {
        username = `${username.slice(0, 18)}${Math.floor(Math.random() * 900 + 100)}`.slice(0, 24);
      }
      const user = await st.createUser({
        username,
        displayName: str(body.displayName).slice(0, 40) || username,
        provider: "guest",
      });
      const session = await st.createSession(user.id);
      sendJson(res, 200, { ok: true, user: safeUser(user), token: session.token });
      return;
    }

    /* POST /api/auth/register { email, password, username, displayName? } */
    if (req.method === "POST" && seg.length === 1 && seg[0] === "register") {
      if (rateLimited(ip)) { sendJson(res, 429, { ok: false, error: "Too many requests. Slow down." }); return; }
      const body = await readJsonBody(req);
      const email = str(body.email).trim().toLowerCase();
      const password = str(body.password);
      const username = str(body.username).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthHttpError(400, "Invalid email.");
      if (password.length < 8) throw new AuthHttpError(400, "Password must be at least 8 characters.");
      if (!validUsername(username)) throw new AuthHttpError(400, "Username: 3-24 chars, letters/numbers/_/.");
      if (await st.findByEmail(email)) throw new AuthHttpError(409, "Email already registered.");
      const user = await st.createUser({
        username,
        displayName: str(body.displayName).slice(0, 40) || username,
        provider: "email",
        email,
        passwordHash: await hashPassword(password),
      }).catch((e: Error) => {
        throw new AuthHttpError(e.message.includes("username") ? 409 : 400, e.message);
      });
      const session = await st.createSession(user.id);
      sendJson(res, 200, { ok: true, user: safeUser(user), token: session.token });
      return;
    }

    /* POST /api/auth/login { login, password } — login is email or username */
    if (req.method === "POST" && seg.length === 1 && seg[0] === "login") {
      if (rateLimited(ip, 30)) { sendJson(res, 429, { ok: false, error: "Too many requests. Slow down." }); return; }
      const body = await readJsonBody(req);
      const login = str(body.login).trim().toLowerCase();
      const password = str(body.password);
      const user = login.includes("@") ? await st.findByEmail(login) : await st.findByUsername(login);
      if (!user || user.provider !== "email" || !user.passwordHash) {
        throw new AuthHttpError(401, "Invalid credentials.");
      }
      if (!(await verifyPassword(password, user.passwordHash))) {
        throw new AuthHttpError(401, "Invalid credentials.");
      }
      const session = await st.createSession(user.id);
      sendJson(res, 200, { ok: true, user: safeUser(user), token: session.token });
      return;
    }

    /* POST /api/auth/google { idToken, username? } */
    if (req.method === "POST" && seg.length === 1 && seg[0] === "google") {
      if (rateLimited(ip)) { sendJson(res, 429, { ok: false, error: "Too many requests. Slow down." }); return; }
      const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
      if (!clientId) {
        sendJson(res, 503, { ok: false, error: "Google login isn't configured on this server yet." });
        return;
      }
      const body = await readJsonBody(req);
      const idToken = str(body.idToken);
      if (!idToken) throw new AuthHttpError(400, "Missing idToken.");
      let profile;
      try {
        profile = await verifyGoogleIdToken(idToken, clientId);
      } catch {
        throw new AuthHttpError(401, "Invalid Google token.");
      }
      let user = await st.findByGoogleSub(profile.sub);
      if (!user) {
        // First Google login: pick a username (explicit or from name/email).
        let username = str(body.username).trim() || suggestUsername(
          (profile.name || "").split(" ")[0] || (profile.email || "").split("@")[0] || "user",
        );
        if (!validUsername(username) || (await st.usernameTaken(username))) {
          username = `user${Math.floor(Math.random() * 90000 + 10000)}`;
        }
        try {
          user = await st.createUser({
            username,
            displayName: (profile.name || username).slice(0, 40),
            provider: "google",
            email: profile.email?.toLowerCase(),
            googleSub: profile.sub,
            avatarUrl: profile.picture,
          });
        } catch (e: any) {
          const msg = e?.message || "";
          if (msg.includes("email")) {
            throw new AuthHttpError(409, "This Google email is already registered — log in with email + password instead.");
          }
          throw new AuthHttpError(409, msg || "Could not create account.");
        }
      }
      const session = await st.createSession(user.id);
      sendJson(res, 200, { ok: true, user: safeUser(user), token: session.token });
      return;
    }

    /* Authenticated routes below. */
    const token = bearer(req);
    const auth = token ? await st.getSession(token) : null;
    if (!auth) { sendJson(res, 401, { ok: false, error: "Not logged in." }); return; }

    /* GET /api/auth/search?q=xxx — find users by username (authenticated) */
    if (req.method === "GET" && seg.length === 1 && seg[0] === "search") {
      const q = (url.searchParams.get("q") || "").trim();
      const results = await st.searchUsers(q, auth.user.id);
      sendJson(res, 200, { ok: true, users: results });
      return;
    }

    /* GET /api/auth/me */
    if (req.method === "GET" && seg.length === 1 && seg[0] === "me") {
      sendJson(res, 200, { ok: true, user: safeUser(auth.user), persistent: st.persistent });
      return;
    }

    /* POST /api/auth/logout */
    if (req.method === "POST" && seg.length === 1 && seg[0] === "logout") {
      if (token) await st.deleteSession(token);
      sendJson(res, 200, { ok: true });
      return;
    }

    /* PATCH /api/auth/me { displayName?, username?, avatarUrl? } */
    if ((req.method === "PATCH" || req.method === "POST") && seg.length === 2 && seg[0] === "me" && seg[1] === "update") {
      const body = await readJsonBody(req);
      const patch: Record<string, string> = {};
      if (body.displayName !== undefined) patch.displayName = str(body.displayName).slice(0, 40);
      if (body.avatarUrl !== undefined) patch.avatarUrl = str(body.avatarUrl).slice(0, 500);
      if (body.username !== undefined) {
        const u = str(body.username).trim();
        if (!validUsername(u)) throw new AuthHttpError(400, "Username: 3-24 chars, letters/numbers/_/.");
        patch.username = u;
      }
      try {
        const updated = await st.updateUser(auth.user.id, patch);
        sendJson(res, 200, { ok: true, user: safeUser(updated!) });
      } catch (e: any) {
        throw new AuthHttpError(409, e?.message || "Update failed.");
      }
      return;
    }

    /* GET /api/connections */
    if (path === "/api/connections" && req.method === "GET") {
      const list = await st.listConnections(auth.user.id);
      sendJson(res, 200, {
        ok: true,
        connections: list.map(({ connection, peer }) => ({
          id: connection.id,
          status: connection.status,
          createdAt: connection.createdAt,
          peer: { username: peer.username, displayName: peer.displayName, avatarUrl: peer.avatarUrl, provider: peer.provider },
        })),
      });
      return;
    }

    /* GET /api/connections/requests (incoming) */
    if (path === "/api/connections/requests" && req.method === "GET") {
      const list = await st.listRequests(auth.user.id);
      sendJson(res, 200, {
        ok: true,
        requests: list.map(({ connection, peer }) => ({
          id: connection.id,
          createdAt: connection.createdAt,
          from: { username: peer.username, displayName: peer.displayName, avatarUrl: peer.avatarUrl },
        })),
      });
      return;
    }

    /* POST /api/connections/request { username } */
    if (path === "/api/connections/request" && req.method === "POST") {
      const body = await readJsonBody(req);
      const username = str(body.username).trim();
      if (!validUsername(username)) throw new AuthHttpError(400, "Invalid username.");
      try {
        const c = await st.requestConnection(auth.user.id, username);
        sendJson(res, 200, { ok: true, requestId: c.id });
      } catch (e: any) {
        throw new AuthHttpError(400, e?.message || "Request failed.");
      }
      return;
    }

    /* POST /api/connections/respond { id, accept } */
    if (path === "/api/connections/respond" && req.method === "POST") {
      const body = await readJsonBody(req);
      try {
        const c = await st.respondToRequest(auth.user.id, str(body.id), body.accept === true);
        sendJson(res, 200, { ok: true, status: c.status });
      } catch (e: any) {
        throw new AuthHttpError(400, e?.message || "Failed.");
      }
      return;
    }

    /* POST /api/connections/remove { id } */
    if (path === "/api/connections/remove" && req.method === "POST") {
      const body = await readJsonBody(req);
      try {
        await st.removeConnection(auth.user.id, str(body.id));
        sendJson(res, 200, { ok: true });
      } catch (e: any) {
        throw new AuthHttpError(400, e?.message || "Failed.");
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: `Not found: ${req.method} ${path}` });
  } catch (e) {
    if (e instanceof AuthHttpError) {
      sendJson(res, e.status, { ok: false, error: e.message });
      return;
    }
    console.error("[auth]", e);
    sendJson(res, 500, { ok: false, error: "Internal error." });
  }
}
