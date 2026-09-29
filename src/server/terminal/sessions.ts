/**
 * Terminal sessions — non-interactive command execution for the Terminal view
 * and Test Lab (Node server only).
 *
 * Honest model: there is no PTY here (no node-pty native dependency), so
 * full-screen TUIs (vim, htop, …) cannot work and the UI says so. Each
 * submitted line is parsed with the agent sandbox's splitArgv (no shell,
 * blocklist, cwd containment) and spawned as one process; while a process
 * runs, input lines are written to its stdin. Stdout/stderr stream into a
 * per-session ring buffer that clients poll.
 *
 * Sessions die with the server or after 30 minutes of inactivity.
 */

import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import {
  looksDangerous,
  resolveSafePath,
  splitArgv,
  ToolError,
} from "../agent/tools";
import { listWorkspaceRepos } from "../demo";

export interface TermLine {
  seq: number;
  stream: "cmd" | "out" | "err" | "sys";
  text: string;
}

export interface SessionSummary {
  id: string;
  repo: string;
  label: string;
  cwd: string;
  running: boolean;
  createdAt: number;
  lastActiveAt: number;
}

interface RunningProc {
  child: ChildProcess;
  cmd: string;
  startedAt: number;
  timer: NodeJS.Timeout;
  pendingOut: string;
  pendingErr: string;
  timedOut: boolean;
}

interface Session {
  id: string;
  repo: string;
  root: string;
  cwdRel: string;
  label: string;
  createdAt: number;
  lastActiveAt: number;
  lines: TermLine[];
  nextSeq: number;
  current: RunningProc | null;
  lastExit: { code: number | null; timedOut: boolean; cmd: string } | null;
  history: string[];
}

export const TERMINAL_MAX_SESSIONS = 20;
export const TERMINAL_LINE_CAP = 2000;
export const TERMINAL_LINE_LEN_CAP = 4000;
export const TERMINAL_INPUT_CAP = 100_000;
const DEFAULT_CMD_TIMEOUT_MS = 120_000;
const DEFAULT_IDLE_MS = 30 * 60_000;

export class TerminalHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "TerminalHttpError";
    this.status = status;
  }
}

function newId(): string {
  return randomBytes(12).toString("hex");
}

function pushLine(s: Session, stream: TermLine["stream"], text: string): void {
  const t = text.length > TERMINAL_LINE_LEN_CAP
    ? text.slice(0, TERMINAL_LINE_LEN_CAP) + "… [line truncated]"
    : text;
  s.lines.push({ seq: s.nextSeq++, stream, text: t });
  while (s.lines.length > TERMINAL_LINE_CAP) s.lines.shift();
}

export class TerminalSessionManager {
  private sessions = new Map<string, Session>();
  constructor(
    private workspace: string,
    private cmdTimeoutMs = DEFAULT_CMD_TIMEOUT_MS,
    private idleMs = DEFAULT_IDLE_MS,
  ) {}

  /** Exposed for tests: the workspace this manager is bound to. */
  get root(): string {
    return this.workspace;
  }

  private knownRepo(name: string): boolean {
    return listWorkspaceRepos(this.workspace).some((r) => r.name === name);
  }

  create(repo: string, label?: string): SessionSummary {
    this.sweep();
    if (typeof repo !== "string" || !repo.trim()) {
      throw new TerminalHttpError(400, "A workspace repository is required.");
    }
    if (!this.knownRepo(repo)) {
      throw new TerminalHttpError(400, `Unknown repository "${repo}". Pick one from the workspace list.`);
    }
    if (this.sessions.size >= TERMINAL_MAX_SESSIONS) {
      throw new TerminalHttpError(429, `Too many terminal sessions (${TERMINAL_MAX_SESSIONS}). Close one first.`);
    }
    const now = Date.now();
    const s: Session = {
      id: newId(),
      repo,
      root: join(this.workspace, repo),
      cwdRel: ".",
      label: typeof label === "string" && label.trim() ? label.trim().slice(0, 60) : repo,
      createdAt: now,
      lastActiveAt: now,
      lines: [],
      nextSeq: 1,
      current: null,
      lastExit: null,
      history: [],
    };
    this.sessions.set(s.id, s);
    pushLine(s, "sys", `Terminal session started in ${repo}. Non-interactive shell: no pipes, no redirects, no full-screen TUIs (vim/htop won't work).`);
    return this.summarize(s);
  }

  list(): SessionSummary[] {
    this.sweep();
    return [...this.sessions.values()].map((s) => this.summarize(s));
  }

  private get(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new TerminalHttpError(404, "Terminal session not found.");
    return s;
  }

  private summarize(s: Session): SessionSummary {
    return {
      id: s.id,
      repo: s.repo,
      label: s.label,
      cwd: s.cwdRel,
      running: s.current !== null,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
    };
  }

  /**
   * Feed a line of input. When a process is running it goes to that
   * process's stdin; otherwise it is treated as a command line to execute.
   */
  input(id: string, data: unknown): { started: boolean } {
    const s = this.get(id);
    if (typeof data !== "string") throw new TerminalHttpError(400, "Input must be a string.");
    if (data.length > TERMINAL_INPUT_CAP) throw new TerminalHttpError(413, "Input too large.");
    s.lastActiveAt = Date.now();
    const line = data.replace(/\r?\n$/, "");
    if (s.current) {
      try {
        s.current.child.stdin?.write(data.endsWith("\n") ? data : data + "\n");
      } catch {
        throw new TerminalHttpError(409, "The running process is not accepting input.");
      }
      return { started: false };
    }
    if (!line.trim()) return { started: false };
    // Builtin: cd (everything else goes through the sandbox).
    const cdMatch = line.match(/^\s*cd(?:\s+(.*))?\s*$/);
    if (cdMatch) {
      this.builtinCd(s, (cdMatch[1] ?? "").trim());
      return { started: false };
    }
    if (/^\s*(exit|logout)\s*$/.test(line)) {
      pushLine(s, "sys", "Use the tab's × button to close this session.");
      return { started: false };
    }
    let argv: string[];
    try {
      argv = splitArgv(line);
      const blocked = looksDangerous(argv);
      if (blocked) throw new ToolError("COMMAND_BLOCKED", blocked);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushLine(s, "sys", `Not run: ${msg}`);
      return { started: false };
    }
    s.history.push(line);
    if (s.history.length > 200) s.history.shift();
    this.spawnCommand(s, line, argv);
    return { started: true };
  }

  private builtinCd(s: Session, arg: string): void {
    pushLine(s, "cmd", "$ cd" + (arg ? " " + arg : ""));
    let target: string;
    try {
      // Strip quotes the way a user would expect `cd "my dir"` to work.
      const unquoted = arg.replace(/^(['"])(.*)\1$/, "$2");
      target = resolveSafePath(s.root, arg ? join(s.cwdRel, unquoted) : ".");
      const st = statSync(target);
      if (!st.isDirectory()) throw new Error("not a directory");
    } catch {
      pushLine(s, "err", `cd: no such directory (stays inside the repository): ${arg || "."}`);
      return;
    }
    const rootAbs = s.root;
    s.cwdRel = target === rootAbs ? "." : target.slice(rootAbs.length + 1);
    pushLine(s, "sys", `cwd → ${s.cwdRel}`);
  }

  private spawnCommand(s: Session, cmd: string, argv: string[]): void {
    pushLine(s, "cmd", "$ " + cmd);
    let child: ChildProcess;
    try {
      child = spawn(argv[0] as string, argv.slice(1), {
        cwd: join(s.root, s.cwdRel),
        shell: false,
        windowsHide: true,
        env: { ...process.env, TERM: "dumb" },
      });
    } catch (e) {
      pushLine(s, "err", `Failed to start: ${e instanceof Error ? e.message : String(e)}`);
      s.lastExit = { code: null, timedOut: false, cmd };
      return;
    }
    const proc: RunningProc = {
      child,
      cmd,
      startedAt: Date.now(),
      timer: setTimeout(() => {
        proc.timedOut = true;
        try { child.kill("SIGKILL"); } catch { /* already dead */ }
      }, this.cmdTimeoutMs),
      pendingOut: "",
      pendingErr: "",
      timedOut: false,
    };
    s.current = proc;
    const feed = (stream: "out" | "err", chunk: Buffer) => {
      const key = stream === "out" ? "pendingOut" : "pendingErr";
      proc[key] += chunk.toString("utf8");
      const parts = proc[key].split("\n");
      proc[key] = parts.pop() ?? "";
      for (const p of parts) pushLine(s, stream, p.replace(/\r$/, ""));
    };
    child.stdout?.on("data", (d: Buffer) => feed("out", d));
    child.stderr?.on("data", (d: Buffer) => feed("err", d));
    child.on("error", (e: Error) => {
      clearTimeout(proc.timer);
      if (proc.pendingOut) pushLine(s, "out", proc.pendingOut.replace(/\r$/, ""));
      if (proc.pendingErr) pushLine(s, "err", proc.pendingErr.replace(/\r$/, ""));
      pushLine(s, "err", `Spawn error: ${e.message}`);
      s.current = null;
      s.lastExit = { code: null, timedOut: false, cmd };
    });
    child.on("close", (code: number | null) => {
      clearTimeout(proc.timer);
      if (s.current !== proc) return; // killed via kill()
      if (proc.pendingOut) pushLine(s, "out", proc.pendingOut.replace(/\r$/, ""));
      if (proc.pendingErr) pushLine(s, "err", proc.pendingErr.replace(/\r$/, ""));
      const timedOut = proc.timedOut;
      if (timedOut) pushLine(s, "sys", `Killed after ${Math.round(this.cmdTimeoutMs / 1000)}s timeout.`);
      else pushLine(s, "sys", `Exit code ${code ?? "?"}.`);
      s.current = null;
      s.lastExit = { code, timedOut, cmd };
    });
  }

  output(id: string, since: unknown): {
    lines: TermLine[]; nextSeq: number; running: boolean;
    exitCode: number | null; timedOut: boolean;
  } {
    const s = this.get(id);
    s.lastActiveAt = Date.now();
    const n = typeof since === "number" && since >= 0 ? Math.floor(since) : 0;
    return {
      lines: s.lines.filter((l) => l.seq > n),
      nextSeq: s.nextSeq,
      running: s.current !== null,
      exitCode: s.current ? null : (s.lastExit?.code ?? null),
      timedOut: s.current ? false : (s.lastExit?.timedOut ?? false),
    };
  }

  /** Full buffered text (capped) — used by Test Lab result parsing. */
  fullText(id: string, cap = 200_000): string {
    const s = this.get(id);
    const text = s.lines.map((l) => l.text).join("\n");
    return text.length > cap ? text.slice(-cap) : text;
  }

  lastExit(id: string): { code: number | null; timedOut: boolean; cmd: string } | null {
    return this.get(id).lastExit;
  }

  isRunning(id: string): boolean {
    return this.get(id).current !== null;
  }

  kill(id: string): { killed: boolean } {
    const s = this.get(id);
    s.lastActiveAt = Date.now();
    const proc = s.current;
    if (!proc) return { killed: false };
    clearTimeout(proc.timer);
    try { proc.child.kill("SIGKILL"); } catch { /* already dead */ }
    if (proc.pendingOut) pushLine(s, "out", proc.pendingOut.replace(/\r$/, ""));
    if (proc.pendingErr) pushLine(s, "err", proc.pendingErr.replace(/\r$/, ""));
    pushLine(s, "sys", "Process killed.");
    s.current = null;
    s.lastExit = { code: null, timedOut: false, cmd: proc.cmd };
    return { killed: true };
  }

  remove(id: string): void {
    const s = this.get(id);
    try { this.kill(id); } catch { /* already gone */ }
    this.sessions.delete(s.id);
  }

  history(id: string): string[] {
    return [...this.get(id).history];
  }

  /** Drop sessions idle longer than the idle budget. Called lazily. */
  sweep(now = Date.now()): number {
    let dropped = 0;
    for (const s of this.sessions.values()) {
      if (now - s.lastActiveAt > this.idleMs) {
        try { this.kill(s.id); } catch { /* ignore */ }
        this.sessions.delete(s.id);
        dropped++;
      }
    }
    return dropped;
  }
}
