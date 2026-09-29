/**
 * Chat-workspace tests: attachments (text/image/zip, traversal rejection,
 * caps), the file-artifact convention, the providers response shape, and
 * Hermes model selectability through OpenRouter.
 */
import { describe, it, expect } from "vitest";
import {
  processAttachments,
  applyAttachmentsToMessages,
  AttachmentError,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
} from "../src/server/chat-attachments";
import {
  extractArtifacts,
  sanitizeArtifactPath,
  ARTIFACT_SYSTEM_NUDGE,
} from "../src/server/chat-artifacts";
import { listCatalog, defaultModelsFor, getCatalogEntry } from "../src/providers/catalog";
import { providerFromRequestKey } from "../src/server/byok";

// @ts-expect-error — plain-JS helper, no types
import { createStoredZip } from "../src/web/app/zip.js";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** Build a raw stored-method zip with ARBITRARY entry names (no sanitizing),
 *  for traversal tests. NeutronZip sanitizes, so this hand-rolls headers. */
function rawZip(entries: Array<{ name: string; data: string }>): string {
  const parts: Buffer[] = [];
  let offset = 0;
  const central: Buffer[] = [];
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = Buffer.from(e.data, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(0, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    parts.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...parts, centralBuf, eocd]).toString("base64");
}

describe("chat attachments", () => {
  it("returns empty parts for no attachments", () => {
    expect(processAttachments(undefined)).toEqual({ visionParts: [], contextBlocks: [], notes: [] });
    expect(processAttachments([])).toEqual({ visionParts: [], contextBlocks: [], notes: [] });
  });

  it("inlines text files as context with filename headers", () => {
    const out = processAttachments([
      { name: "notes.txt", mime: "text/plain", kind: "text", data: b64("hello world") },
    ]);
    expect(out.visionParts).toEqual([]);
    expect(out.contextBlocks).toHaveLength(1);
    expect(out.contextBlocks[0]).toContain("[file: notes.txt]");
    expect(out.contextBlocks[0]).toContain("hello world");
  });

  it("builds OpenAI vision parts for images", () => {
    const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const out = processAttachments([
      { name: "photo.png", mime: "image/png", kind: "image", data: tinyPng },
    ]);
    expect(out.visionParts).toHaveLength(1);
    expect(out.visionParts[0]!.type).toBe("image_url");
    expect(out.visionParts[0]!.image_url.url.startsWith("data:image/png;base64,")).toBe(true);
    expect(out.contextBlocks).toEqual([]);
  });

  it("extracts zips: text inlined, binaries listed", async () => {
    const zipBlob = createStoredZip([
      { name: "src/app.js", data: "console.log('hi');" },
      { name: "bin/blob.bin", data: "\x00\x01\x02\x03binary" },
    ]);
    const zipB64 = Buffer.from(await zipBlob.arrayBuffer()).toString("base64");
    const out = processAttachments([
      { name: "src.zip", mime: "application/zip", kind: "zip", data: zipB64 },
    ]);
    expect(out.contextBlocks).toHaveLength(1);
    expect(out.contextBlocks[0]).toContain("[file: src.zip/src/app.js]");
    expect(out.contextBlocks[0]).toContain("console.log('hi');");
    expect(out.notes.join("\n")).toContain("bin/blob.bin");
  });

  it("rejects zip-slip traversal entries", () => {
    const evil = rawZip([{ name: "../evil.txt", data: "pwned" }]);
    expect(() =>
      processAttachments([{ name: "evil.zip", mime: "application/zip", kind: "zip", data: evil }]),
    ).toThrow(AttachmentError);
    const abs = rawZip([{ name: "/tmp/evil.txt", data: "pwned" }]);
    expect(() =>
      processAttachments([{ name: "evil.zip", mime: "application/zip", kind: "zip", data: abs }]),
    ).toThrow(AttachmentError);
  });

  it("rejects binary non-image, non-zip files", () => {
    const bin = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]).toString("base64");
    expect(() =>
      processAttachments([{ name: "blob.bin", mime: "application/octet-stream", kind: "text", data: bin }]),
    ).toThrow(/not a text file/);
  });

  it("enforces the file-count cap", () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => ({
      name: `f${i}.txt`, mime: "text/plain", kind: "text", data: b64("x"),
    }));
    expect(() => processAttachments(many)).toThrow(/Too many attachments/);
  });

  it("enforces the per-file size cap", () => {
    const big = Buffer.alloc(MAX_FILE_BYTES + 1, "a").toString("base64");
    expect(() =>
      processAttachments([{ name: "big.txt", mime: "text/plain", kind: "text", data: big }]),
    ).toThrow(/per-file limit/);
  });

  it("never echoes file contents in errors", () => {
    const secret = "SUPER-SECRET-CONTENT-12345";
    const big = Buffer.from(secret.repeat(4000), "utf8").toString("base64"); // > 100KB
    try {
      processAttachments([{ name: "s.txt", mime: "text/plain", kind: "text", data: big }]);
      expect.unreachable();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(secret);
      expect(String((e as Error).message)).toContain("s.txt");
    }
  });
});

describe("applyAttachmentsToMessages", () => {
  const msgs = [
    { role: "user" as const, content: "what is this?" },
  ];

  it("prepends text context to the last user message", () => {
    const { messages, notes } = applyAttachmentsToMessages(msgs, [
      { name: "a.txt", mime: "text/plain", kind: "text", data: b64("file-body") },
    ]);
    expect(typeof messages[0]!.content).toBe("string");
    expect(messages[0]!.content as string).toContain("[file: a.txt]");
    expect(messages[0]!.content as string).toContain("file-body");
    expect(messages[0]!.content as string).toContain("what is this?");
    expect(notes.length).toBeGreaterThan(0);
    // input not mutated
    expect(msgs[0]!.content).toBe("what is this?");
  });

  it("turns the message into content parts when images are attached", () => {
    const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const { messages } = applyAttachmentsToMessages(msgs, [
      { name: "p.png", mime: "image/png", kind: "image", data: tinyPng },
      { name: "a.txt", mime: "text/plain", kind: "text", data: b64("ctx") },
    ]);
    const content = messages[0]!.content as unknown as Array<{ type: string; text?: string }>;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]!.type).toBe("text");
    expect(content[0]!.text).toContain("[file: a.txt]");
    expect(content[1]!.type).toBe("image_url");
  });

  it("leaves messages untouched when there is nothing to attach", () => {
    const { messages } = applyAttachmentsToMessages(msgs, undefined);
    expect(messages).toEqual(msgs);
  });
});

describe("file artifacts", () => {
  it("parses fenced blocks and strips them from the text", () => {
    const reply =
      "Here is your file:\n```neutron-file path=\"src/app.js\"\nconsole.log(1);\n```\nDone!";
    const { text, artifacts, notes } = extractArtifacts(reply);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.path).toBe("src/app.js");
    expect(artifacts[0]!.content).toBe("console.log(1);");
    expect(artifacts[0]!.size).toBeGreaterThan(0);
    expect(text).toContain("Here is your file:");
    expect(text).toContain("Done!");
    expect(text).not.toContain("neutron-file");
    expect(notes).toEqual([]);
  });

  it("parses multiple blocks", () => {
    const reply =
      '```neutron-file path="a.txt"\nAAA\n```\n```neutron-file path="sub/b.txt"\nBBB\n```';
    const { artifacts } = extractArtifacts(reply);
    expect(artifacts.map((a) => a.path)).toEqual(["a.txt", "sub/b.txt"]);
  });

  it("leaves text without blocks untouched", () => {
    const t = "Just a normal reply with ```js code ``` fences.";
    expect(extractArtifacts(t)).toEqual({ text: t, artifacts: [], notes: [] });
  });

  it("rejects unsafe paths but keeps the block visible", () => {
    for (const bad of ["../evil.js", "/abs/path.js", "C:/win/path.js"]) {
      const reply = `x\n\`\`\`neutron-file path="${bad}"\nEVIL\n\`\`\`\ny`;
      const { text, artifacts, notes } = extractArtifacts(reply);
      expect(artifacts).toEqual([]);
      expect(text).toContain("EVIL"); // never silently eaten
      expect(notes.join(" ")).toMatch(/unsafe path/);
    }
  });

  it("sanitizeArtifactPath normalizes safely", () => {
    expect(sanitizeArtifactPath("a//b/./c.js")).toBe("a/b/c.js");
    expect(sanitizeArtifactPath("  spaced/name.txt  ")).toBe("spaced/name.txt");
    expect(sanitizeArtifactPath("../x")).toBeNull();
    expect(sanitizeArtifactPath("")).toBeNull();
  });

  it("caps the artifact count", () => {
    const reply = Array.from({ length: 25 }, (_, i) =>
      `\`\`\`neutron-file path="f${i}.txt"\n${i}\n\`\`\``).join("\n");
    const { artifacts, notes } = extractArtifacts(reply);
    expect(artifacts).toHaveLength(20);
    expect(notes.join(" ")).toMatch(/over the 20-file cap/);
  });

  it("the system nudge documents the convention honestly", () => {
    expect(ARTIFACT_SYSTEM_NUDGE).toContain("```neutron-file");
    expect(ARTIFACT_SYSTEM_NUDGE).toMatch(/download/i);
    expect(ARTIFACT_SYSTEM_NUDGE).toMatch(/cannot write/);
  });
});

describe("providers response shape (Provider Details panel)", () => {
  it("every catalog entry exposes a base URL field (empty only for 'custom')", () => {
    for (const e of listCatalog()) {
      expect(typeof e.baseUrl).toBe("string");
      if (e.id === "custom") {
        expect(e.baseUrl).toBe(""); // user supplies their own endpoint
      } else {
        expect(e.baseUrl).toMatch(/^https?:\/\//);
      }
    }
  });

  it("the vercel providers route includes baseUrl per provider", async () => {
    const mod = await import("../api-src/providers");
    const res = {
      statusCode: 0, payload: null as unknown,
      status(c: number) { this.statusCode = c; return this; },
      json(b: unknown) { this.payload = b; },
    };
    await mod.default({ method: "GET" }, res);
    expect(res.statusCode).toBe(200);
    const providers = (res.payload as { providers: Array<{ id: string; baseUrl: string; defaultModels: string[] }> }).providers;
    expect(providers.length).toBeGreaterThan(0);
    for (const p of providers) {
      expect(typeof p.baseUrl).toBe("string");
      if (p.baseUrl) expect(p.baseUrl).toMatch(/^https?:\/\//);
      expect(Array.isArray(p.defaultModels)).toBe(true);
    }
    expect(providers.find((p) => p.id === "nvidia")?.baseUrl).toContain("nvidia.com");
  });
});

describe("Hermes models via OpenRouter", () => {
  const HERMES = [
    "nousresearch/hermes-4-405b",
    "nousresearch/hermes-3-llama-3.1-405b",
    "nousresearch/hermes-3-llama-3.1-70b",
  ];

  it("the catalog lists Hermes models under openrouter", () => {
    const models = defaultModelsFor("openrouter");
    for (const h of HERMES) expect(models).toContain(h);
  });

  it("a BYOK key + openrouter choice builds a request-scoped provider (the Hermes path)", () => {
    const p = providerFromRequestKey("sk-or-v1-test-key-1234567890", "openrouter");
    expect(p).toBeDefined();
    expect(p?.id).toBe("openrouter");
    expect(p?.baseUrl).toContain("openrouter.ai");
  });

  it("Hermes model ids are accepted as the chat model override", () => {
    // The model is a free-form string passed straight through to the
    // provider; the catalog entry must simply resolve.
    expect(getCatalogEntry("openrouter")?.baseUrl).toBeTruthy();
  });
});

describe("NeutronZip round-trip", () => {
  it("a zip written by the frontend reader parses in the server reader", async () => {
    const zipBlob = createStoredZip([
      { name: "hello.txt", data: "hello zip" },
      { name: "nested/dir/code.js", data: "export const x = 1;" },
    ]);
    const zipB64 = Buffer.from(await zipBlob.arrayBuffer()).toString("base64");
    const out = processAttachments([
      { name: "bundle.zip", mime: "application/zip", kind: "zip", data: zipB64 },
    ]);
    expect(out.contextBlocks.join("\n")).toContain("hello zip");
    expect(out.contextBlocks.join("\n")).toContain("export const x = 1;");
    expect(out.notes.join("\n")).toContain("bundle.zip: 2 file(s)");
  });
});

describe("attachment-only sends (no text)", () => {
  it("synthesizes a user turn when messages are empty but attachments exist", () => {
    const { messages } = applyAttachmentsToMessages([], [
      { name: "a.txt", mime: "text/plain", kind: "text", data: b64("hello") },
    ]);
    expect(messages.length).toBe(1);
    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.content as string).toContain("[file: a.txt]");
    expect(messages[0]!.content as string).toContain("hello");
  });

  it("never includes UI placeholder text in the merged content", () => {
    // The client used to send "(sent with attachments)" as literal content.
    const { messages } = applyAttachmentsToMessages(
      [{ role: "user" as const, content: "" }],
      [{ name: "a.txt", mime: "text/plain", kind: "text", data: b64("x") }],
    );
    const c = messages[messages.length - 1]!.content as string;
    expect(c).not.toContain("(sent with attachments)");
  });
});
