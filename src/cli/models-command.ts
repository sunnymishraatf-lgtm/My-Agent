import { loadConfig, registerSecrets } from "../config";
import { OpenAICompatibleProvider } from "../providers/openai";

export interface ModelsCommandOptions {
  provider?: string;
  json?: boolean;
}

export async function modelsCommand(opts: ModelsCommandOptions): Promise<void> {
  const config = loadConfig();
  registerSecrets(config.providers.map((p) => p.apiKey).filter((k): k is string => !!k));

  let providers = config.providers.filter((p) => p.enabled);
  if (opts.provider) {
    providers = providers.filter((p) => p.id === opts.provider);
    if (providers.length === 0) {
      console.log(`No enabled provider with id "${opts.provider}".`);
      process.exitCode = 1;
      return;
    }
  }

  if (providers.length === 0) {
    console.log("No LLM provider configured. Run `sunny config` to add one.");
    process.exitCode = 1;
    return;
  }

  const result: Record<string, { models: string[]; error?: string }> = {};
  for (const p of providers) {
    if (p.models.length > 0) {
      result[p.id] = { models: [...p.models] };
      continue;
    }
    const provider = new OpenAICompatibleProvider({
      id: p.id,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      timeoutMs: 15_000,
    });
    try {
      const models = await provider.models();
      result[p.id] = { models: models.map((m) => m.id) };
    } catch (err) {
      result[p.id] = { models: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (const [id, entry] of Object.entries(result)) {
    console.log(`\n${id} (${entry.models.length} models)`);
    if (entry.error) {
      console.log(`  error: ${entry.error}`);
      continue;
    }
    if (entry.models.length === 0) {
      console.log("  (no models reported)");
      continue;
    }
    for (const model of entry.models) console.log(`  ${model}`);
  }
}
