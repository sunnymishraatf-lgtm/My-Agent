import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry, createDefaultTools, resolveInWorkspace, TodoStore, createTodoTools } from "../src/tools";
import { isBlockedAddress } from "../src/tools/extras";
import { shellQuote, loadCustomTools } from "../src/tools/custom";
import { isWithinWorkspace } from "../src/files/workspace";
import { permissionFor, type AgentConfig } from "../src/chat/agent-config";
import { SessionStore, assertValidSessionId } from "../src/chat/session";
import { SnapshotStore } from "../src/chat/snapshots";
import type { ToolContext } from "../src/tools";

let root: string;
let registry: ToolRegistry;
let ctx: ToolContext;
let lastCommand = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-hardening-"));
  lastCommand = "";
  registry = new ToolRegistry(createDefaultTools());
  ctx = {
    root,
    run: async (command: string) => {
      lastCommand = command;
      return { status: "ok", stdout: "ok", stderr: "", exitCode: 0, durationMs: 1, timedOut: false };
    },
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("edit tool on large files", () => {
  it("preserves content beyond 1MB when editing", async () => {
    // 1.2MB file: the edit tool must not truncate it to the 1MB read cap.
    const big = `line-0\n${"x".repeat(600_000)}\nline-mid needle\n${"y".repeat(600_000)}\nline-end\n`;
    expect(big.length).toBeGreaterThan(1_000_000);
    writeFileSync(join(root, "big.txt"), big, "utf8");

    const res = await registry.execute(
      "edit",
      { path: "big.txt", oldString: "line-mid needle", newString: "line-mid REPLACED" },
      ctx,
    );
    expect(res.ok).toBe(true);
    const after = readFileSync(join(root, "big.txt"), "utf8");
    expect(after.length).toBe(big.length - "line-mid needle".length + "line-mid REPLACED".length);
    expect(after).toContain("line-mid REPLACED");
    expect(after.endsWith("line-end\n")).toBe(true);
    expect(after).toContain("y".repeat(600_000));
  });
});

describe("symlink-aware workspace containment", () => {
  it("blocks reads through a symlink that escapes the workspace", async () => {
    const outside = mkdtempSync(join(tmpdir(), "neutron-outside-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "top secret", "utf8");
      symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));
      const res = await registry.execute("read", { path: "link.txt" }, ctx);
      expect(res.ok).toBe(false);
      expect(res.output).toMatch(/outside the workspace/i);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("allows symlinks that stay inside the workspace", () => {
    writeFileSync(join(root, "real.txt"), "hello", "utf8");
    symlinkSync(join(root, "real.txt"), join(root, "alias.txt"));
    expect(isWithinWorkspace(root, join(root, "alias.txt"))).toBe(true);
    const { ok } = resolveInWorkspace(root, "alias.txt");
    expect(ok).toBe(true);
  });

  it("blocks a symlinked directory that points outside", () => {
    const outside = mkdtempSync(join(tmpdir(), "neutron-outside-"));
    try {
      symlinkSync(outside, join(root, "evildir"));
      expect(isWithinWorkspace(root, join(root, "evildir", "x.txt"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("custom tool quoting and required params", () => {
  it("shell-quotes interpolated values", () => {
    expect(shellQuote("simple")).toBe("simple");
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("$(rm -rf /)")).toBe("'$(rm -rf /)'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote("a`b`c")).toBe("'a`b`c'");
  });

  it("rejects execution when a required parameter is missing", async () => {
    const toolDir = join(root, ".neutron", "tool");
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(
      join(toolDir, "greet.json"),
      JSON.stringify({
        command: "echo {{name}}",
        parameters: { name: { type: "string", required: true } },
      }),
      "utf8",
    );
    const tools = loadCustomTools(root);
    const greet = tools.find((t) => t.name === "greet");
    expect(greet).toBeDefined();
    const res = await greet!.execute({}, ctx);
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/missing required parameter/i);
    expect(lastCommand).toBe("");
  });

  it("quotes values in the generated command", async () => {
    const toolDir = join(root, ".neutron", "tool");
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(
      join(toolDir, "echoit.json"),
      JSON.stringify({ command: "echo {{msg}}", parameters: { msg: { type: "string" } } }),
      "utf8",
    );
    const tools = loadCustomTools(root);
    const echoit = tools.find((t) => t.name === "echoit");
    const res = await echoit!.execute({ msg: "hello; rm -rf /" }, ctx);
    expect(res.ok).toBe(true);
    expect(lastCommand).toBe("echo 'hello; rm -rf /'");
  });
});

describe("todo payload validation", () => {
  it("rejects non-array payloads", () => {
    const store = new TodoStore();
    expect(() => store.write({ nope: true })).toThrow(/must be an array/i);
    expect(() => store.write("nope")).toThrow(/must be an array/i);
  });

  it("rejects entries without content", () => {
    const store = new TodoStore();
    expect(() => store.write([{ status: "pending" }])).toThrow(/content/i);
    expect(() => store.write([42])).toThrow();
    expect(() => store.write([{ content: "   " }])).toThrow(/content/i);
  });

  it("todowrite tool fails cleanly on malformed payloads", async () => {
    const store = new TodoStore();
    const [todowrite] = createTodoTools(store);
    const res = await todowrite!.execute({ todos: JSON.stringify([{ nope: 1 }]) }, ctx);
    expect(res.ok).toBe(false);
  });

  it("accepts well-formed payloads", () => {
    const store = new TodoStore();
    const items = store.write([{ content: "do things", status: "in_progress", priority: "high" }]);
    expect(items).toHaveLength(1);
    expect(items[0]!.content).toBe("do things");
    expect(items[0]!.status).toBe("in_progress");
  });
});

describe("webfetch SSRF defenses", () => {
  it("blocks loopback, private and link-local addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "::", "fc00::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "not-an-ip"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.0.1", "172.32.0.1", "192.167.1.1", "2606:4700:4700::1111"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });
});

describe("session/snapshot id validation", () => {
  it("rejects path-traversal ids", () => {
    for (const bad of ["../evil", "..\\evil", "/etc/passwd", "", "a/b", ".", "..", "x".repeat(200)]) {
      expect(() => assertValidSessionId(bad), bad).toThrow(/invalid session id/i);
    }
  });

  it("session store refuses to load/save traversal ids", () => {
    const store = new SessionStore(root);
    expect(() => store.load("../evil")).toThrow(/invalid session id/i);
    expect(() =>
      store.save({ id: "../../evil", title: "t", createdAt: "", updatedAt: "", messages: [] }),
    ).toThrow(/invalid session id/i);
    // The traversal must not have created a file outside the sessions dir.
    expect(existsSync(join(root, "evil.json"))).toBe(false);
  });

  it("snapshot store refuses traversal ids", () => {
    const store = new SnapshotStore(root);
    expect(() => store.list("../../evil")).toThrow(/invalid snapshot id/i);
    expect(() => store.push("../evil", { ts: "", files: {} })).toThrow(/invalid snapshot id/i);
  });

  it("accepts ids produced by the store itself", () => {
    const store = new SessionStore(root);
    const s = store.create("hello");
    expect(() => assertValidSessionId(s.id)).not.toThrow();
    store.save(s);
    expect(store.load(s.id)?.title).toBe("hello");
  });
});

describe("permission glob matching", () => {
  function agentWith(patterns: Record<string, "allow" | "deny">): AgentConfig {
    return {
      name: "test",
      mode: "primary",
      description: "test agent",
      permissions: { "*": { action: "allow", patterns } },
    } as AgentConfig;
  }

  it("does not fail open on prefix matches", () => {
    // Pattern "read" must not match "read-secret": previously the unanchored
    // prefix alternative made this match and could grant unintended access.
    const agent = agentWith({ read: "deny" });
    expect(permissionFor(agent, "bash", "read")).toBe("deny");
    expect(permissionFor(agent, "bash", "read-secret")).toBe("allow");
    expect(permissionFor(agent, "bash", "read secret file")).toBe("allow");
  });

  it("still honors wildcard patterns", () => {
    const agent = agentWith({ "read *": "deny" });
    expect(permissionFor(agent, "bash", "read secret")).toBe("deny");
    expect(permissionFor(agent, "bash", "write secret")).toBe("allow");
  });
});
