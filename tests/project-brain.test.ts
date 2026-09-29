/**
 * Project brain tests: pure project-store helpers in src/web/app/ui-utils.js.
 * No DOM — only testable logic: CRUD, memory sections, sanitize caps,
 * secret guard (incl. adversarial variants), auto-detect from fixtures,
 * context-block building, and link management.
 */
import { describe, it, expect } from "vitest";
import ui from "../src/web/app/ui-utils.js";

const NOW = new Date(2026, 8, 29, 12, 0, 0).getTime();

function mkStore(): { version: number; items: Record<string, any> } {
  return { version: ui.PROJECT_STORE_VERSION, items: {} };
}
function mkProject(name = "My App") {
  const p = ui.newProject("p1", name, NOW);
  return p;
}

describe("project CRUD", () => {
  it("creates a project with empty memory", () => {
    const p = mkProject();
    expect(p.id).toBe("p1");
    expect(p.name).toBe("My App");
    expect(p.createdAt).toBe(NOW);
    expect(p.memory.architecture).toBe("");
    expect(p.memory.languages).toEqual([]);
    expect(p.linkedConversationIds).toEqual([]);
  });

  it("renames with trim, rejects empty", () => {
    const s = mkStore();
    s.items.p1 = mkProject();
    expect(ui.projectRename(s, "p1", "  Renamed  ")).toBe(true);
    expect(s.items.p1.name).toBe("Renamed");
    expect(ui.projectRename(s, "p1", "   ")).toBe(false);
    expect(s.items.p1.name).toBe("Renamed");
    expect(ui.projectRename(s, "nope", "X")).toBe(false);
  });

  it("deletes and touches", () => {
    const s = mkStore();
    s.items.p1 = mkProject();
    expect(ui.projectTouch(s, "p1", NOW + 5)).toBe(true);
    expect(s.items.p1.updatedAt).toBe(NOW + 5);
    expect(ui.projectDelete(s, "p1")).toBe(true);
    expect(ui.projectGet(s, "p1")).toBeNull();
    expect(ui.projectDelete(s, "p1")).toBe(false);
  });

  it("mostRecentProjectId picks the newest", () => {
    const s = mkStore();
    const a = ui.newProject("a", "A", NOW);
    const b = ui.newProject("b", "B", NOW + 100);
    s.items.a = a; s.items.b = b;
    expect(ui.mostRecentProjectId(s)).toBe("b");
    expect(ui.mostRecentProjectId(mkStore())).toBeNull();
  });
});

describe("memory sections", () => {
  it("sets free-text sections, rejects unknown", () => {
    const p = mkProject();
    expect(ui.projectMemorySetText(p, "architecture", "Next.js + Postgres")).toBe(true);
    expect(p.memory.architecture).toBe("Next.js + Postgres");
    expect(ui.projectMemorySetText(p, "languages", "x")).toBe(false);
    expect(ui.projectMemorySetText(p, "nope", "x")).toBe(false);
  });

  it("adds/removes/updates list entries", () => {
    const p = mkProject();
    const i = ui.projectMemoryAdd(p, "conventions", "  Use TypeScript. ");
    expect(i).toBe(0);
    expect(p.memory.conventions).toEqual(["Use TypeScript."]);
    expect(ui.projectMemoryAdd(p, "conventions", "   ")).toBe(-1);
    expect(ui.projectMemoryUpdate(p, "conventions", 0, "Use TS strict.")).toBe(true);
    expect(p.memory.conventions[0]).toBe("Use TS strict.");
    expect(ui.projectMemoryUpdate(p, "conventions", 0, "  ")).toBe(false);
    expect(ui.projectMemoryRemove(p, "conventions", 0)).toBe(true);
    expect(p.memory.conventions).toEqual([]);
    expect(ui.projectMemoryRemove(p, "conventions", 9)).toBe(false);
  });

  it("manages dependencies as objects", () => {
    const p = mkProject();
    const i = ui.projectMemoryAdd(p, "dependencies", { name: "react", version: "^18.0.0", note: "UI" });
    expect(i).toBe(0);
    expect(p.memory.dependencies[0]).toEqual({ name: "react", version: "^18.0.0", note: "UI" });
    expect(ui.projectMemoryAdd(p, "dependencies", { name: "  " })).toBe(-1);
    expect(ui.projectMemoryUpdate(p, "dependencies", 0, { version: "^18.2.0" })).toBe(true);
    expect(p.memory.dependencies[0]!.version).toBe("^18.2.0");
    expect(p.memory.dependencies[0]!.name).toBe("react");
  });

  it("links/unlinks conversations and repos without duplicates", () => {
    const p = mkProject();
    expect(ui.linkConversation(p, "c1")).toBe(true);
    expect(ui.linkConversation(p, "c1")).toBe(true);
    expect(p.linkedConversationIds).toEqual(["c1"]);
    expect(ui.unlinkConversation(p, "c1")).toBe(true);
    expect(ui.unlinkConversation(p, "c1")).toBe(false);
    expect(ui.linkRepo(p, "demo")).toBe(true);
    expect(ui.linkRepo(p, "demo")).toBe(true);
    expect(p.linkedRepoNames).toEqual(["demo"]);
    expect(ui.unlinkRepo(p, "demo")).toBe(true);
  });
});

describe("sanitizeProject", () => {
  it("caps sizes and drops garbage", () => {
    const p = mkProject("x".repeat(500));
    p.description = "d".repeat(5000);
    p.memory.architecture = "a".repeat(5000);
    p.memory.conventions = ["ok", "", "c".repeat(2000)];
    p.memory.dependencies = [{ name: "x", version: "1", note: "n" }, null, { name: "" }] as any;
    p.linkedConversationIds = ["c1", ""];
    const clean = ui.sanitizeProject(p)!;
    expect(clean.name.length).toBe(120);
    expect(clean.description.length).toBe(2000);
    expect(clean.memory.architecture.length).toBe(2000);
    expect(clean.memory.conventions).toEqual(["ok", "c".repeat(1000)]);
    expect(clean.memory.dependencies.length).toBe(1);
    expect(clean.linkedConversationIds).toEqual(["c1"]);
  });

  it("rejects non-objects and round-trips data", () => {
    expect(ui.sanitizeProject(null)).toBeNull();
    expect(ui.sanitizeProject({})).toBeNull();
    const p = mkProject("Keep me");
    ui.projectMemorySetText(p, "framework", "Vite");
    ui.projectMemoryAdd(p, "decisions", "OAuth via Google");
    const clean = ui.sanitizeProject(p)!;
    expect(clean.name).toBe("Keep me");
    expect(clean.memory.framework).toBe("Vite");
    expect(clean.memory.decisions).toEqual(["OAuth via Google"]);
  });
});

describe("secret guard", () => {
  it("detects common secret patterns", () => {
    expect(ui.looksLikeSecret("sk-abcdefghijklmnopqrstuv")).toBe("API key (sk-…)");
    expect(ui.looksLikeSecret("token=ghp_abcdefghijklmnopqrstuvwx")).toBeTruthy();
    expect(ui.looksLikeSecret("xoxb-123456789012-abcdefghij")).toBe("Slack token (xox…)");
    expect(ui.looksLikeSecret("AKIAIOSFODNN7EXAMPLE")).toBe("AWS access key (AKIA…)");
    expect(ui.looksLikeSecret("-----BEGIN RSA PRIVATE KEY-----\n...")).toBe("Private key block");
    expect(ui.looksLikeSecret("api_key = \"hunter2supersecret!!\"")).toBe("Secret-like assignment");
    expect(ui.looksLikeSecret("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9")).toBeTruthy();
    expect(ui.looksLikeSecret("sk-ant-abcdefghijklmnopqrst")).toBe("Anthropic API key (sk-ant-…)");
  });

  it("does not flag ordinary text (no false positives)", () => {
    expect(ui.looksLikeSecret("Use TypeScript strict mode.")).toBeNull();
    expect(ui.looksLikeSecret("Add Google OAuth token support")).toBeNull();
    expect(ui.looksLikeSecret("my password is hunter2")).toBeNull(); // too short / no assignment
    expect(ui.looksLikeSecret("the secret sauce of this recipe")).toBeNull();
    expect(ui.looksLikeSecret("")).toBeNull();
    expect(ui.looksLikeSecret(null)).toBeNull();
  });

  it("catches adversarial variants", () => {
    expect(ui.looksLikeSecret("API_KEY=hunter2supersecret!!")).toBeTruthy(); // uppercase
    expect(ui.looksLikeSecret("client-secret: abcdef1234567890")).toBeTruthy(); // hyphenated
    expect(ui.looksLikeSecret("password='correct horse battery staple'")).toBeTruthy(); // quotes + spaces fail? value has spaces
  });

  it("scans a whole project and reports locations without values", () => {
    const p = mkProject();
    ui.projectMemorySetText(p, "docs", "deploy key: sk-abcdefghijklmnopqrstuv");
    ui.projectMemoryAdd(p, "knownBugs", "fine");
    ui.projectMemoryAdd(p, "knownBugs", "token ghp_abcdefghijklmnopqrstuvwx leaked");
    const findings = ui.scanProjectSecrets(p);
    expect(findings.length).toBe(2);
    expect(findings[0]).toEqual({ section: "docs", index: null, pattern: "API key (sk-…)" });
    expect(findings[1]!.section).toBe("knownBugs");
    expect(findings[1]!.index).toBe(1);
    // never leaks the value itself
    expect(JSON.stringify(findings)).not.toContain("sk-abcdefghijklmnopqrstuv");
  });
});

describe("detectProjectStack", () => {
  const reactPkg = JSON.stringify({
    dependencies: { react: "^18.2.0", "react-dom": "^18.2.0", express: "^4.18.0" },
    devDependencies: { vite: "^5.0.0" },
  });
  const reactFiles = [
    "package.json", "vite.config.ts", "tsconfig.json", "README.md",
    "src/main.tsx", "src/App.tsx", "src/api.ts", "src/styles.css",
  ];

  it("detects Vite + React + TypeScript from real data", () => {
    const d = ui.detectProjectStack(reactFiles, reactPkg);
    expect(d.framework).toEqual({ name: "Vite", confidence: "medium" });
    expect(d.languages[0]!.lang).toBe("TypeScript");
    expect(d.languages[0]!.files).toBe(4);
    expect(d.importantFiles).toContain("package.json");
    expect(d.importantFiles).toContain("README.md");
    expect(d.importantFiles).toContain("src/App.tsx");
    const names = d.dependencies.map((x) => x.name);
    expect(names).toContain("react");
    expect(names).toContain("vite");
  });

  it("prefers Next.js over React when next is present", () => {
    const pkg = JSON.stringify({ dependencies: { next: "14.0.0", react: "^18.0.0" } });
    const d = ui.detectProjectStack(["package.json", "next.config.js", "app/page.tsx"], pkg);
    expect(d.framework!.name).toBe("Next.js");
    expect(d.framework!.confidence).toBe("high");
  });

  it("detects Django via requirements content, Python fallback otherwise", () => {
    const files = ["requirements.txt", "manage.py", "app/views.py"];
    const withDjango = ui.detectProjectStack(files, null, { "requirements.txt": "Django==4.2\npsycopg2" });
    expect(withDjango.framework!.name).toBe("Django");
    const plain = ui.detectProjectStack(files, null);
    expect(plain.framework).toEqual({ name: "Python", confidence: "low" });
    expect(plain.languages[0]!.lang).toBe("Python");
  });

  it("detects Go and Rust from manifest files", () => {
    expect(ui.detectProjectStack(["go.mod", "main.go"], null).framework!.name).toBe("Go");
    expect(ui.detectProjectStack(["Cargo.toml", "src/main.rs"], null).framework!.name).toBe("Rust");
  });

  it("is honest with unknown input", () => {
    const d = ui.detectProjectStack(["notes.txt", "data.bin"], null);
    expect(d.framework).toBeNull();
    expect(d.dependencies).toEqual([]);
    const empty = ui.detectProjectStack([], "not json{{{");
    expect(empty.framework).toBeNull();
    expect(empty.languages).toEqual([]);
  });

  it("skips docs/data extensions in the language census", () => {
    const d = ui.detectProjectStack(["README.md", "a.md", "b.md", "x.py"], null);
    expect(d.languages).toEqual([{ lang: "Python", files: 1, pct: 100 }]);
  });
});

describe("buildProjectContextBlock", () => {
  it("includes only non-empty sections", () => {
    const p = mkProject("Shop");
    ui.projectMemorySetText(p, "architecture", "Next.js + Postgres");
    ui.projectMemorySetText(p, "database", "");
    ui.projectMemoryAdd(p, "conventions", "Use TypeScript.");
    ui.projectMemoryAdd(p, "knownBugs", "Webhook retries missing.");
    const block = ui.buildProjectContextBlock(p);
    expect(block).toContain('PROJECT MEMORY — "Shop"');
    expect(block).toContain("Architecture: Next.js + Postgres");
    expect(block).toContain("Conventions:\n- Use TypeScript.");
    expect(block).toContain("Known bugs:\n- Webhook retries missing.");
    expect(block).not.toContain("Database:");
    expect(block).not.toContain("Decisions:");
  });

  it("caps length with a truncation marker", () => {
    const p = mkProject("Big");
    ui.projectMemorySetText(p, "architecture", "x".repeat(9000));
    const block = ui.buildProjectContextBlock(p, 500);
    expect(block.length).toBeLessThanOrEqual(500);
    expect(block).toContain("…[truncated]");
  });

  it("handles empty projects and null", () => {
    expect(ui.buildProjectContextBlock(mkProject("Empty"))).toContain('"Empty"');
    expect(ui.buildProjectContextBlock(null)).toBe("");
  });
});

describe("conversation project-link persistence", () => {
  it("sanitizeConversation keeps projectId and projectContextOn", () => {
    const c = {
      id: "c1", title: "t", renamed: false, createdAt: 1, updatedAt: 2,
      pinned: false, archived: false, provider: "", model: "", messages: [],
      projectId: "p9", projectContextOn: false,
    };
    const clean = ui.sanitizeConversation(c)!;
    expect(clean.projectId).toBe("p9");
    expect(clean.projectContextOn).toBe(false);
    const dflt = ui.sanitizeConversation({ ...c, projectId: undefined, projectContextOn: undefined })!;
    expect(dflt.projectId).toBe("");
    expect(dflt.projectContextOn).toBe(true);
  });
});
