import { readGlobalProviders } from "../config";
import { OpenAICompatibleProvider } from "../providers/openai";

export interface ChatProbe {
  ok: boolean;
  model?: string;
  reply?: string;
  error?: string;
}

export interface DoctorReport {
  node: { version: string; ok: boolean };
  npm: { version: string; ok: boolean };
  git: { installed: boolean; ok: boolean };
  config: { path: string; ok: boolean };
  providers: Array<{
    id: string;
    baseUrl: string;
    apiKey: boolean;
    health: "ok" | "offline" | "no-key" | "unconfigured";
    latencyMs?: number;
    modelCount?: number;
    sampleModels?: string[];
    chat?: ChatProbe;
    error?: string;
  }>;
  platform: string;
}

export async function runDoctor(opts?: { chat?: boolean }): Promise<DoctorReport> {
  const { execSync } = await import("node:child_process");
  const { existsSync } = await import("node:fs");
  const { globalConfigPath } = await import("../config");

  let nodeVersion = "";
  let npmVersion = "";
  let gitOk = false;

  try {
    nodeVersion = execSync("node --version", { encoding: "utf8" }).toString().trim();
  } catch {}
  try {
    npmVersion = execSync("npm --version", { encoding: "utf8" }).toString().trim();
  } catch {}
  try {
    execSync("git --version", { encoding: "utf8" });
    gitOk = true;
  } catch {}

  const cfgFile = globalConfigPath();
  const cfgOk = existsSync(cfgFile);

  const providers: DoctorReport["providers"] = [];
  for (const p of readGlobalProviders()) {
    if (!p.baseUrl) {
      providers.push({ id: p.id, baseUrl: "", apiKey: !!p.apiKey, health: "unconfigured" });
      continue;
    }
    if (!p.apiKey && !/127\.0\.0\.1|localhost/i.test(p.baseUrl)) {
      providers.push({ id: p.id, baseUrl: p.baseUrl, apiKey: false, health: "no-key" });
      continue;
    }
    const provider = new OpenAICompatibleProvider({
      id: p.id,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      timeoutMs: 15_000,
    });
    const entry: DoctorReport["providers"][number] = { id: p.id, baseUrl: p.baseUrl, apiKey: !!p.apiKey, health: "offline" };
    let discovered: string[] = [];
    try {
      const health = await provider.healthCheck();
      entry.health = health.ok ? "ok" : "offline";
      entry.latencyMs = health.latencyMs;
    } catch (err) {
      entry.health = "offline";
      entry.error = err instanceof Error ? err.message : String(err);
    }
    if (entry.health === "ok") {
      try {
        const models = await provider.models();
        discovered = models.map((m) => m.id);
        entry.modelCount = models.length;
        entry.sampleModels = discovered.slice(0, 5);
        if (models.length === 0) {
          entry.error = "reachable, but no models listed by /models";
        }
      } catch (err) {
        entry.error = err instanceof Error ? err.message : String(err);
      }
    }
    if (p.models.length > 0) {
      entry.sampleModels = p.models.slice(0, 5);
      entry.modelCount = p.models.length;
    }

    if (opts?.chat) {
      const modelId = p.models[0] ?? discovered[0];
      if (!modelId) {
        entry.chat = { ok: false, error: "no model available to test (add --models or ensure /models works)" };
      } else {
        try {
          const res = await provider.chat({
            model: modelId,
            messages: [{ role: "user", content: "Reply with the single word: ok" }],
            maxTokens: 8,
          });
          entry.chat = { ok: true, model: modelId, reply: res.text.trim().slice(0, 60) };
        } catch (err) {
          entry.chat = { ok: false, model: modelId, error: err instanceof Error ? err.message : String(err) };
        }
      }
    }
    providers.push(entry);
  }

  return {
    node: { version: nodeVersion, ok: /v\d+/.test(nodeVersion) && Number(nodeVersion.slice(1).split(".")[0]) >= 20 },
    npm: { version: npmVersion, ok: !!npmVersion },
    git: { installed: gitOk, ok: gitOk },
    config: { path: cfgFile, ok: cfgOk },
    providers,
    platform: process.platform,
  };
}

export function formatDoctor(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push("SUNNY DOCTOR");
  lines.push("");
  lines.push(`Platform: ${report.platform}`);
  lines.push(`Node: ${report.node.ok ? "OK" : "MISSING"} ${report.node.version || "not found"}${report.node.ok ? "" : " (need Node 20+)"}`);
  lines.push(`NPM: ${report.npm.ok ? "OK" : "MISSING"} ${report.npm.version || "not found"}`);
  lines.push(`Git: ${report.git.ok ? "OK" : "MISSING"} ${report.git.installed ? "found" : "not found"}`);
  lines.push(`Config: ${report.config.ok ? "OK" : "MISSING"} ${report.config.path}`);
  if (report.providers.length === 0) {
    lines.push("");
    lines.push("No providers configured. Run `sunny config` to add one,");
    lines.push("or set OPENAI_BASE_URL/OPENAI_API_KEY (or LLM_BASE_URL/LLM_API_KEY) environment variables.");
  } else {
    lines.push("");
    lines.push("Providers:");
    for (const p of report.providers) {
      const latency = p.latencyMs !== undefined ? `, ${p.latencyMs}ms` : "";
      lines.push(`  ${p.id}: ${p.apiKey ? "key set" : "no key"} -> ${p.health}${latency} (${p.baseUrl})`);
      if (p.modelCount !== undefined && p.modelCount > 0) {
        lines.push(`    models: ${p.modelCount} available${p.sampleModels ? ` [${p.sampleModels.join(", ")}${p.modelCount > p.sampleModels.length ? ", ..." : ""}]` : ""}`);
      }
      if (p.chat) {
        if (p.chat.ok) {
          lines.push(`    chat: OK (${p.chat.model}) -> "${p.chat.reply ?? ""}"`);
        } else {
          lines.push(`    chat: FAILED${p.chat.model ? ` (${p.chat.model})` : ""} — ${(p.chat.error ?? "unknown").slice(0, 160)}`);
        }
      }
      if (p.error) {
        lines.push(`    note: ${p.error.slice(0, 160)}`);
      }
    }
  }
  if (!report.node.ok) {
    lines.push("");
    lines.push("Node 20+ is required. Install via https://nodejs.org");
  }
  return lines.join("\n");
}
