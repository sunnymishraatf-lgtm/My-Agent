import { loadConfig, registerSecrets, redact } from "../config";
import { createRegistryProvider } from "../providers/registry";
import { summarizeError } from "../providers/errors";
import { loadDotEnvFiles } from "../env";

export interface ModelsCommandOptions {
  provider?: string;
  json?: boolean;
}

export async function modelsCommand(opts: ModelsCommandOptions): Promise<void> {
  loadDotEnvFiles();
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
    console.log("No LLM provider configured.");
    console.log("Set e.g. AGENTROUTER_API_KEY in your environment or a .env file, then run `neutron doctor`.");
    process.exitCode = 1;
    return;
  }

  const result: Record<string, { models: string[]; error?: string }> = {};
  for (const p of providers) {
    // Prefer explicitly configured models: they are the ones the user can
    // actually use, and they avoid a network round-trip.
    if (p.models.length > 0) {
      result[p.id] = { models: [...p.models] };
      continue;
    }
    // Use the adapter matching the provider's API flavor (anthropic/google
    // need their own auth + endpoints, not the OpenAI shape).
    const provider = createRegistryProvider(p);
    try {
      const models = await provider.models();
      result[p.id] = { models: models.map((m) => m.id) };
    } catch (err) {
      result[p.id] = { models: [], error: redact(summarizeError(err)) };
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
