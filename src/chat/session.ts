import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ChatMessage } from "../types";

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model?: string;
  provider?: string;
  messages: ChatMessage[];
}

export interface ChatSessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Session ids become file names; reject anything that could traverse directories. */
export function assertValidSessionId(id: string): void {
  if (!isValidSessionId(id)) {
    throw new Error(`Invalid session id: ${String(id).slice(0, 64)}`);
  }
}

export function isValidSessionId(id: unknown): id is string {
  return typeof id === "string" && SESSION_ID_PATTERN.test(id);
}

export class SessionStore {
  private dir: string;

  constructor(root: string) {
    this.dir = join(root, ".agent", "sessions");
  }

  ensure(): void {
    mkdirSync(this.dir, { recursive: true });
  }

  private path(id: string): string {
    assertValidSessionId(id);
    return join(this.dir, `${id}.json`);
  }

  create(title?: string, opts?: { model?: string; provider?: string }): ChatSession {
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: randomUUID(),
      title: title?.trim() || "Untitled session",
      createdAt: now,
      updatedAt: now,
      messages: [],
      ...(opts?.model ? { model: opts.model } : {}),
      ...(opts?.provider ? { provider: opts.provider } : {}),
    };
    return session;
  }

  save(session: ChatSession): void {
    this.ensure();
    session.updatedAt = new Date().toISOString();
    writeFileSync(this.path(session.id), JSON.stringify(session, null, 2), "utf8");
  }

  load(id: string): ChatSession | undefined {
    const p = this.path(id);
    if (!existsSync(p)) return undefined;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as ChatSession;
    } catch {
      return undefined;
    }
  }

  list(): ChatSessionMeta[] {
    this.ensure();
    const out: ChatSessionMeta[] = [];
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith(".json")) continue;
      const id = file.slice(0, -5);
      if (!isValidSessionId(id)) continue; // ignore foreign/malicious files
      const session = this.load(id);
      if (!session) continue;
      out.push({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
      });
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  latest(): ChatSession | undefined {
    const first = this.list()[0];
    return first ? this.load(first.id) : undefined;
  }

  search(query: string): ChatSessionMeta[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return this.list();
    const out: ChatSessionMeta[] = [];
    for (const meta of this.list()) {
      if (meta.title.toLowerCase().includes(needle)) {
        out.push(meta);
        continue;
      }
      const session = this.load(meta.id);
      if (session?.messages.some((m) => m.content.toLowerCase().includes(needle))) out.push(meta);
    }
    return out;
  }

  fork(id: string, opts?: { title?: string; atMessage?: number }): ChatSession | undefined {
    const source = this.load(id);
    if (!source) return undefined;
    const now = new Date().toISOString();
    const at = opts?.atMessage;
    const messages =
      typeof at === "number" && at >= 0 ? source.messages.slice(0, at) : [...source.messages];
    const forked: ChatSession = {
      id: randomUUID(),
      title: opts?.title?.trim() || `${source.title} (fork)`,
      createdAt: now,
      updatedAt: now,
      messages,
      ...(source.model ? { model: source.model } : {}),
      ...(source.provider ? { provider: source.provider } : {}),
    };
    this.save(forked);
    return forked;
  }

  rename(id: string, title: string): boolean {
    const session = this.load(id);
    if (!session) return false;
    session.title = title.trim() || session.title;
    this.save(session);
    return true;
  }

  /** Delete all but the most recent `keep` sessions. Returns the number removed. */
  prune(keep: number): number {
    const sessions = this.list();
    const doomed = sessions.slice(Math.max(0, keep));
    let removed = 0;
    for (const session of doomed) if (this.remove(session.id)) removed++;
    return removed;
  }

  remove(id: string): boolean {
    const p = this.path(id);
    if (!existsSync(p)) return false;
    try {
      rmSync(p);
      return true;
    } catch {
      return false;
    }
  }
}
