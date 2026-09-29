/**
 * Chat attachments for POST /api/chat — shared by the Node server and the
 * Vercel serverless route (both import this module; esbuild bundles it).
 *
 * Wire format (inside the JSON body; base64 keeps it WebView-simple):
 *
 *   "attachments": [
 *     { "name": "photo.png", "mime": "image/png",       "kind": "image", "data": "<base64>" },
 *     { "name": "notes.txt",  "mime": "text/plain",      "kind": "text",  "data": "<base64>" },
 *     { "name": "src.zip",    "mime": "application/zip", "kind": "zip",   "data": "<base64>" }
 *   ]
 *
 * `kind` is advisory — the server classifies authoritatively from the mime
 * type and file name. Limits (the server is the authority): at most 5
 * files, 100 KB decoded per file, 512 KB total.
 *
 * Processing:
 * - images → OpenAI-compatible vision parts (`image_url` with a data: URL)
 *   appended to the user message. Every catalog provider is
 *   openai-compatible and the adapter serializes messages verbatim, so the
 *   parts reach the provider as native vision content; a provider that
 *   rejects vision input fails with its own honest error, surfaced as-is.
 * - text/code → decoded as UTF-8 and inlined as context with filename
 *   headers. Non-text binaries are rejected with an honest message.
 * - zips → extracted into a fresh /tmp directory (the only writable
 *   location on serverless), text files inlined as context, binaries
 *   listed by name/size only. Zip-slip entries (`..`, absolute paths)
 *   are rejected outright. The temp dir is always removed afterwards.
 *
 * ZIP parsing is hand-rolled (stored + deflated via node:zlib) so no new
 * dependency is needed. Encrypted, zip64, and data-descriptor entries are
 * rejected with clear messages rather than guessed at.
 *
 * Secrets: file contents are NEVER written to logs and never echoed in
 * error messages beyond file names and sizes.
 */

import { inflateRawSync } from "node:zlib";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { ChatMessage } from "../types";

export const MAX_ATTACHMENTS = 5;
export const MAX_FILE_BYTES = 100 * 1024;
export const MAX_TOTAL_BYTES = 512 * 1024;
/** Per text file inlined from a zip. */
export const MAX_ZIP_TEXT_FILE_BYTES = 50 * 1024;
/** Max text files inlined from one zip; the rest are listed by name only. */
export const MAX_ZIP_TEXT_FILES = 20;
/** Max entries scanned in one zip. */
const MAX_ZIP_ENTRIES = 200;

export interface IncomingAttachment {
  name: string;
  mime: string;
  kind: string;
  data: string;
}

export interface VisionPart {
  type: "image_url";
  image_url: { url: string };
}

export interface ProcessedAttachments {
  visionParts: VisionPart[];
  contextBlocks: string[];
  /** Human-readable notes (names/sizes only, never contents). */
  notes: string[];
}

export class AttachmentError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "AttachmentError";
  }
}

function fail(msg: string): never {
  throw new AttachmentError(msg);
}

/** The client-declared kind is advisory; classify from mime + extension. */
type ClassifiedKind = "image" | "zip" | "text";
function classify(name: string, mime: string): ClassifiedKind {
  const m = (mime || "").toLowerCase();
  const n = (name || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/zip" || m === "application/x-zip-compressed" || n.endsWith(".zip")) return "zip";
  return "text";
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb",
  "java", "kt", "swift", "c", "h", "cpp", "hpp", "cc", "go", "rs", "php",
  "html", "htm", "css", "scss", "json", "yaml", "yml", "toml", "ini", "cfg",
  "conf", "xml", "csv", "tsv", "sh", "bash", "zsh", "sql", "log", "diff",
  "patch", "vue", "svelte",
]);

/** No NUL bytes in the sniffed window and plausibly valid UTF-8. */
function isUtf8Text(buf: Buffer): boolean {
  const win = buf.subarray(0, 8192);
  for (let i = 0; i < win.length; i++) {
    if (win[i] === 0) return false;
  }
  const s = buf.toString("utf8");
  return !s.includes("�");
}

function looksLikeText(name: string, buf: Buffer): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  if (ext && TEXT_EXTENSIONS.has(ext)) return isUtf8Text(buf);
  // Unknown or missing extension: trust the bytes, not the name.
  return isUtf8Text(buf);
}

/* ------------------------------------------------------------------ */
/* Minimal ZIP reader: stored + deflated via node:zlib. No new deps.    */
/* ------------------------------------------------------------------ */

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
}

function readZipEntries(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let off = 0;
  while (off + 30 <= buf.length && entries.length < MAX_ZIP_ENTRIES) {
    if (buf.readUInt32LE(off) !== 0x04034b50) break; // local file header
    const flags = buf.readUInt16LE(off + 6);
    const method = buf.readUInt16LE(off + 8);
    const compressedSize = buf.readUInt32LE(off + 18);
    const uncompressedSize = buf.readUInt32LE(off + 22);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const nameStart = off + 30;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > buf.length) break;
    const name = buf.subarray(nameStart, nameEnd).toString("utf8");
    const dataOffset = nameEnd + extraLen;
    if (dataOffset > buf.length) break;
    // With a data descriptor (bit 3) the sizes in the header are zero and
    // the true sizes follow the data — reject rather than guess.
    if (flags & 0x08) {
      fail(`Zip entry "${name.slice(0, 80)}" uses a data descriptor, which is not supported.`);
    }
    if (dataOffset + compressedSize > buf.length) break;
    entries.push({ name, flags, method, compressedSize, uncompressedSize, dataOffset });
    off = dataOffset + compressedSize;
  }
  return entries;
}

/**
 * Validate a zip entry name. Returns the safe relative path, or null for
 * directory entries (skipped). Throws AttachmentError on zip-slip attempts.
 */
function safeEntryName(raw: string): string | null {
  if (!raw || raw.endsWith("/")) return null;
  const norm = raw.replace(/\\/g, "/");
  if (norm.startsWith("/") || /^[A-Za-z]:\//.test(norm)) {
    fail(`Zip entry "${raw.slice(0, 80)}" has an absolute path and was rejected.`);
  }
  const parts = norm.split("/").filter((p) => p !== "");
  if (parts.some((p) => p === "..")) {
    fail(`Zip entry "${raw.slice(0, 80)}" tries to escape the archive and was rejected.`);
  }
  if (parts.length === 0) return null;
  return parts.join("/");
}

function extractZipToTmp(zipBuf: Buffer): { dir: string; files: string[] } {
  const entries = readZipEntries(zipBuf);
  const dir = mkdtempSync(join(tmpdir(), "neutron-chat-"));
  const files: string[] = [];
  try {
    for (const e of entries) {
      const safe = safeEntryName(e.name);
      if (safe === null) continue; // directory entry
      const short = safe.slice(0, 80);
      if (e.flags & 0x01) fail(`Zip entry "${short}" is encrypted, which is not supported.`);
      if (e.uncompressedSize === 0xffffffff || e.compressedSize === 0xffffffff) {
        fail(`Zip entry "${short}" uses zip64, which is not supported.`);
      }
      if (e.uncompressedSize > MAX_FILE_BYTES) {
        fail(`Zip entry "${short}" is larger than ${MAX_FILE_BYTES / 1024} KB after extraction.`);
      }
      let data = zipBuf.subarray(e.dataOffset, e.dataOffset + e.compressedSize);
      if (e.method === 8) {
        data = inflateRawSync(data);
      } else if (e.method !== 0) {
        fail(`Zip entry "${short}" uses an unsupported compression method.`);
      }
      const dest = join(dir, ...safe.split("/"));
      if (!dest.startsWith(dir + sep)) {
        fail(`Zip entry "${short}" escapes the extraction directory.`);
      }
      mkdirSync(join(dir, ...safe.split("/").slice(0, -1)), { recursive: true });
      writeFileSync(dest, data);
      files.push(safe);
    }
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return { dir, files };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Validate + process raw attachments into vision parts and context text. */
export function processAttachments(raw: unknown): ProcessedAttachments {
  const notes: string[] = [];
  const empty: ProcessedAttachments = { visionParts: [], contextBlocks: [], notes };
  if (raw === undefined || raw === null) return empty;
  if (!Array.isArray(raw)) fail("attachments must be an array.");
  if (raw.length === 0) return empty;
  if (raw.length > MAX_ATTACHMENTS) {
    fail(`Too many attachments (${raw.length}); the maximum is ${MAX_ATTACHMENTS}.`);
  }

  const items: IncomingAttachment[] = raw.map((a, i) => {
    if (!a || typeof a !== "object") fail(`attachments[${i}] must be an object.`);
    const o = a as Record<string, unknown>;
    return {
      name: typeof o.name === "string" && o.name ? o.name.slice(0, 120) : `file-${i + 1}`,
      mime: typeof o.mime === "string" ? o.mime.slice(0, 120) : "application/octet-stream",
      kind: typeof o.kind === "string" ? o.kind : "",
      data: typeof o.data === "string" ? o.data : "",
    };
  });

  let totalBytes = 0;
  const visionParts: VisionPart[] = [];
  const contextBlocks: string[] = [];

  for (const item of items) {
    if (!item.data) fail(`Attachment "${item.name}" has no data.`);
    let buf: Buffer;
    try {
      buf = Buffer.from(item.data, "base64");
    } catch {
      fail(`Attachment "${item.name}" is not valid base64.`);
    }
    // Round-trip check: garbage base64 can decode to empty/short buffers.
    if (buf.length === 0) fail(`Attachment "${item.name}" is empty.`);
    if (buf.length > MAX_FILE_BYTES) {
      fail(
        `Attachment "${item.name}" is ${Math.round(buf.length / 1024)} KB; ` +
        `the per-file limit is ${MAX_FILE_BYTES / 1024} KB.`,
      );
    }
    totalBytes += buf.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      fail(`Attachments total ${Math.round(totalBytes / 1024)} KB; the limit is ${MAX_TOTAL_BYTES / 1024} KB.`);
    }

    const kind = classify(item.name, item.mime);
    if (kind === "image") {
      const mime = item.mime.toLowerCase().startsWith("image/") ? item.mime : "image/png";
      visionParts.push({
        type: "image_url",
        image_url: { url: `data:${mime};base64,${buf.toString("base64")}` },
      });
      notes.push(`image ${item.name} (${Math.round(buf.length / 1024)} KB)`);
    } else if (kind === "zip") {
      const { dir, files } = extractZipToTmp(buf);
      try {
        notes.push(`zip ${item.name}: ${files.length} file(s)`);
        let inlined = 0;
        for (const f of files) {
          const full = join(dir, ...f.split("/"));
          if (!statSync(full).isFile()) continue;
          const content = readFileSync(full);
          if (content.length > MAX_ZIP_TEXT_FILE_BYTES || !looksLikeText(f, content)) {
            notes.push(`  listed, not inlined: ${f} (${Math.round(content.length / 1024)} KB)`);
            continue;
          }
          if (inlined >= MAX_ZIP_TEXT_FILES) {
            notes.push(`  listed, over per-zip inline cap: ${f}`);
            continue;
          }
          contextBlocks.push(`[file: ${item.name}/${f}]\n${content.toString("utf8")}`);
          inlined++;
        }
        if (inlined === 0 && files.length > 0) {
          notes.push(`  (no text files could be inlined from ${item.name})`);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } else {
      if (!looksLikeText(item.name, buf)) {
        fail(`Attachment "${item.name}" is not a text file, image, or zip — binary files are not accepted.`);
      }
      contextBlocks.push(`[file: ${item.name}]\n${buf.toString("utf8")}`);
      notes.push(`text ${item.name} (${Math.round(buf.length / 1024)} KB)`);
    }
  }

  return { visionParts, contextBlocks, notes };
}

/**
 * Merge processed attachments into the outgoing messages. The LAST user
 * message carries the payload: text/zip contents are prepended as context
 * and images become OpenAI-style content parts on that message.
 *
 * The returned messages keep the ChatMessage shape; when images are
 * present the last user message's `content` is a content-part array at
 * runtime (the openai-compatible adapter serializes messages verbatim, so
 * the parts reach the provider as native vision content). The ChatMessage
 * type itself stays string-only to avoid churning every consumer.
 */
export function applyAttachmentsToMessages(
  messages: ChatMessage[],
  raw: unknown,
): { messages: ChatMessage[]; notes: string[] } {
  const { visionParts, contextBlocks, notes } = processAttachments(raw);
  const out = messages.map((m) => ({ ...m }));
  if (!visionParts.length && !contextBlocks.length) return { messages: out, notes };

  let idx = out.length - 1;
  while (idx >= 0 && out[idx]!.role !== "user") idx--;
  if (idx < 0) {
    // No user message (the route rejects this case separately); attach to
    // a synthetic trailing user turn so nothing is silently dropped.
    out.push({ role: "user", content: "" });
    idx = out.length - 1;
  }
  const target = out[idx]!;
  const baseText = target.content;
  const prefix = contextBlocks.length
    ? "[attached files — use the following as context]\n" + contextBlocks.join("\n\n") + "\n\n"
    : "";
  if (visionParts.length) {
    const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    const text = prefix + baseText;
    if (text) parts.push({ type: "text", text });
    for (const v of visionParts) parts.push(v);
    (target as { content: unknown }).content = parts;
  } else {
    target.content = prefix + baseText;
  }
  return { messages: out, notes };
}
