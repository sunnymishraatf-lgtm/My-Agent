/**
 * AI file artifacts for POST /api/chat — shared by the Node server and the
 * Vercel serverless route (both import this module; esbuild bundles it).
 *
 * Convention (taught to the model via a short system nudge in the chat
 * routes): the assistant emits fenced blocks —
 *
 *   ```neutron-file path="relative/path.ext"
 *   <file content>
 *   ```
 *
 * extractArtifacts() pulls those blocks out of the reply text and returns
 * them as structured artifacts plus the display text with the blocks
 * removed. The frontend renders them as download cards ("Download all as
 * .zip" included).
 *
 * Honest limits: artifacts are generated for DOWNLOAD. The app cannot
 * write to the phone's folders and cannot execute code on the serverless
 * backend — the UI copy says exactly that.
 *
 * Safety: paths must be relative and may not contain `..` segments;
 * malformed blocks are left in the display text (never silently eaten).
 */

export interface FileArtifact {
  path: string;
  content: string;
  /** UTF-8 byte size. */
  size: number;
}

export interface ArtifactParseResult {
  /** Reply text with well-formed artifact blocks removed. */
  text: string;
  artifacts: FileArtifact[];
  /** Human-readable notes about skipped blocks (names only). */
  notes: string[];
}

export const MAX_ARTIFACTS = 20;
export const MAX_ARTIFACT_BYTES = 200 * 1024;

const BLOCK_RE = /```neutron-file[ \t]+path="([^"\r\n]{1,200})"[^\r\n]*\r?\n([\s\S]*?)```/g;

/** Clean a user-supplied artifact path. Null = reject the block. */
export function sanitizeArtifactPath(raw: string): string | null {
  const p = raw.trim().replace(/\\/g, "/");
  if (!p || p.length > 200) return null;
  if (p.startsWith("/") || /^[A-Za-z]:\//.test(p)) return null;
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.length === 0 || parts.some((s) => s === "..")) return null;
  return parts.join("/");
}

export function extractArtifacts(replyText: string): ArtifactParseResult {
  const artifacts: FileArtifact[] = [];
  const notes: string[] = [];
  if (!replyText || !replyText.includes("```neutron-file")) {
    return { text: replyText, artifacts, notes };
  }
  const text = replyText.replace(BLOCK_RE, (_m, rawPath: string, content: string) => {
    const path = sanitizeArtifactPath(String(rawPath ?? ""));
    if (!path) {
      notes.push(`skipped artifact with unsafe path "${String(rawPath ?? "").slice(0, 60)}"`);
      return _m; // leave malformed blocks visible — never silently eat text
    }
    const body = content.replace(/\r\n/g, "\n").replace(/\n$/, "");
    const size = Buffer.byteLength(body, "utf8");
    if (artifacts.length >= MAX_ARTIFACTS) {
      notes.push(`skipped "${path}": over the ${MAX_ARTIFACTS}-file cap`);
      return _m;
    }
    if (size > MAX_ARTIFACT_BYTES) {
      notes.push(`skipped "${path}": ${Math.round(size / 1024)} KB over the ${MAX_ARTIFACT_BYTES / 1024} KB cap`);
      return _m;
    }
    artifacts.push({ path, content: body, size });
    return "";
  });
  // Collapse the blank lines left behind by removed blocks.
  const cleaned = text.replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleaned, artifacts, notes };
}

/**
 * Short system nudge teaching the model the artifact convention. The chat
 * routes prepend this to every /api/chat call.
 */
export const ARTIFACT_SYSTEM_NUDGE =
  "You can deliver file artifacts with fenced blocks like:\n" +
  '```neutron-file path="relative/path.ext"\n<file content here>\n```\n' +
  "Use this when the user asks for code, configs, or documents. " +
  "Artifacts are offered as downloads; you cannot write to the user's " +
  "device or execute code on the server.\n" +
  "The app has a Skills section (sidebar) with 124 expert playbooks from " +
  "the Hermes Agent project (code review, debugging, testing, devops, " +
  "research, …). When a task matches a playbook topic, mention the Skills " +
  "section by name so the user can read it — you cannot read skill files yourself.";
