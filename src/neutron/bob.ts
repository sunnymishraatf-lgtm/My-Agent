import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BobActivity, BobSession, UpdateableBobSession } from "./model";

export interface BobAdapterOptions {
  root: string;
  maxSamples?: number;
}

const ACTIVITY_FILES = ["activity.json", "activity.ndjson"];
const SESSION_EXT = [".json", ".ndjson"];

export function collectBobActivity(root: string, maxSamples = 8): BobActivity {
  const base = join(root, ".agent", "bob");
  const missing: string[] = [];
  const sessions: UpdateableBobSession[] = [];
  const samples: string[] = [];

  const activity = readActivityFile(base);
  if (activity) {
    missing.push(activity.missingPath ?? "");
  } else {
    missing.push(".agent/bob/activity.json or activity.ndjson");
  }

  sessions.push(...collectSessions(base));

  const safeLoose = join(root, ".agent", "bobsessions");
  if (existsSync(safeLoose)) {
    sessions.push(...collectSessions(safeLoose));
  }

  samples.push(...collectSampleTexts(base));
  // Only report what is genuinely absent - never imply evidence exists (or is missing) when it is not.
  if (sessions.length === 0) missing.push("Bob session files (.agent/bob/sessions/*.json|ndjson)");
  if (samples.length === 0) missing.push("Bob session summaries (.agent/bob/summary.md)");

  const filesAnalyzed = sumCounts([activity?.filesAnalyzed, sessions.reduce((a, s) => a + (s.filesTouched?.length ?? 0), 0)]);
  const filesModified = sumCounts([activity?.filesModified]);
  const testsAssisted = sumCounts([activity?.testsAssisted]);
  const taskCount = sumCounts([activity?.taskCount]);
  const reviewCount = sumCounts([activity?.reviewTaskCount]);
  const hasActivity = !!(activity || sessions.length > 0);

  const filteredMissing = missing.filter((m) => m !== "");

  return {
    hasActivity,
    source: activity ? activity.fileName : sessions.length > 0 ? ".agent/bob/sessions" : "none",
    repositoryContext: hasActivity,
    sessionCount: sessions.length,
    taskCount,
    filesAnalyzed,
    filesModified,
    testsAssisted,
    reviewTaskCount: reviewCount,
    sessions,
    samples: samples.slice(0, maxSamples),
    missing: filteredMissing,
  };
}

function sumCounts(values: Array<number | undefined>): number {
  let total = 0;
  for (const v of values) if (typeof v === "number" && isFinite(v)) total += v;
  return total;
}

interface ParsedActivity {
  fileName: string;
  filesAnalyzed?: number;
  filesModified?: number;
  testsAssisted?: number;
  taskCount?: number;
  reviewTaskCount?: number;
  missingPath?: string;
}

function readActivityFile(base: string): ParsedActivity | undefined {
  for (const name of ACTIVITY_FILES) {
    const p = join(base, name);
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, "utf8");
      if (name.endsWith(".ndjson")) {
        const obj = raw.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>).reduce<Record<string, unknown>>((acc, o) => ({ ...acc, ...o }), {});
        return { ...pickNumbers(obj), fileName: name };
      }
      return { ...pickNumbers(JSON.parse(raw) as Record<string, unknown>), fileName: name };
    } catch {
      continue;
    }
  }
  return undefined;
}

function pickNumbers(obj: Record<string, unknown>): Omit<ParsedActivity, "fileName"> {
  const n = (k: string): number | undefined => (typeof obj[k] === "number" ? (obj[k] as number) : undefined);
  return {
    filesAnalyzed: n("filesAnalyzed") ?? n("files_analyzed"),
    filesModified: n("filesModified") ?? n("files_modified"),
    testsAssisted: n("testsAssisted") ?? n("tests_assisted"),
    taskCount: n("taskCount") ?? n("tasks") ?? n("task_count"),
    reviewTaskCount: n("reviewTaskCount") ?? n("reviewCount") ?? n("review_tasks"),
    missingPath: "",
  };
}

function collectSessions(base: string): UpdateableBobSession[] {
  const dir = join(base, "sessions");
  if (!existsSync(dir)) return [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && (e.name.endsWith(".json") || e.name.endsWith(".ndjson")))
      .map((e) => {
        const p = join(dir, e.name);
        try {
          const raw = readFileSync(p, "utf8");
          if (e.name.endsWith(".ndjson")) {
            const lines = raw.split(/\r?\n/).filter(Boolean);
            const msgCount = lines.filter((l) => l.includes('"role"')).length;
            return {
              id: e.name,
              title: e.name.replace(/\.ndjson$/, ""),
              eventCount: lines.length,
              messageCount: msgCount,
              createdAt: createdAtFromLines(lines),
              filesTouched: filesFromLines(lines),
            };
          }
          const obj = JSON.parse(raw) as Record<string, unknown>;
          const id = (typeof obj.id === "string" ? obj.id : e.name) ?? e.name;
          const messages = Array.isArray(obj.messages) ? (obj.messages as Array<Record<string, unknown>>) : [];
          const filesTouched = Array.isArray(obj.files) ? (obj.files as string[]) : [];
          return {
            id,
            title: typeof obj.title === "string" ? obj.title : undefined,
            createdAt: typeof obj.createdAt === "string" ? obj.createdAt : undefined,
            eventCount: 0,
            messageCount: messages.length,
            filesTouched,
          };
        } catch {
          return { id: e.name, eventCount: 0, messageCount: 0, filesTouched: [] };
        }
      })
      .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
      .slice(0, 200);
  } catch {
    return [];
  }
}

function createdAtFromLines(lines: string[]): string | undefined {
  for (const l of lines) {
    try {
      const o = JSON.parse(l) as Record<string, unknown>;
      if (typeof o.createdAt === "string") return o.createdAt;
      if (typeof o.ts === "number") return new Date(o.ts).toISOString();
      if (typeof o.timestamp === "number") return new Date(o.timestamp).toISOString();
    } catch {
      continue;
    }
  }
  return undefined;
}

function filesFromLines(lines: string[]): string[] {
  const files: string[] = [];
  for (const l of lines) {
    try {
      const o = JSON.parse(l) as Record<string, unknown>;
      if (Array.isArray(o.files)) for (const f of o.files) if (typeof f === "string") files.push(f);
    } catch {
      continue;
    }
  }
  return [...new Set(files)].slice(0, 50);
}

function collectSampleTexts(base: string): string[] {
  const out: string[] = [];
  for (const name of ["summary.md", "sessions-summary.md", "report.md"]) {
    const p = join(base, name);
    if (!existsSync(p)) continue;
    try {
      const s = statSync(p);
      if (s.size > 200_000) continue;
      const text = readFileSync(p, "utf8").trim().slice(0, 600);
      if (text) out.push(`# ${name}\n${text}`);
    } catch {
      continue;
    }
  }
  return out;
}

export function normalizeBobSession(s: UpdateableBobSession): BobSession {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    eventCount: s.eventCount ?? 0,
    messageCount: s.messageCount ?? 0,
    filesTouched: s.filesTouched ?? [],
    summary: s.summary,
  };
}