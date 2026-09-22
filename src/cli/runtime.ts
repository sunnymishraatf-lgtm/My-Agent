import { loadConfig, registerSecrets, type ResolvedConfig } from "../config";
import { ApiSystem } from "../api/api-manager";
import type { Logger } from "../logger";
import { createLogger } from "../logger";
import { createAgentRegistry } from "../agents/registry";
import type { Agent } from "../agents/agent";
import { StateStore } from "../store";
import { Orchestrator } from "../orchestrator/orchestrator";

export interface Runtime {
  config: ResolvedConfig;
  api: ApiSystem;
  agents: Agent[];
  store: StateStore;
  orchestrator: Orchestrator;
  logger: Logger;
  logDir: string;
}

export function buildRuntime(root: string, opts?: {
  config?: ResolvedConfig;
  logger?: Logger;
  autoApprove?: boolean;
  logsDir?: string;
}): Runtime {
  const config = opts?.config ?? loadConfig();
  registerSecrets(
    config.providers.map((p) => p.apiKey).filter((k): k is string => !!k),
  );

  const store = new StateStore(root);
  store.ensure();

  const logDir = opts?.logsDir ?? store.getDir() + "/logs";
  const logger = opts?.logger ?? createLogger(logDir, "manager");

  const api = new ApiSystem({ config, logger: createLogger(logDir, "api") });
  const agents = createAgentRegistry();
  const orchestrator = new Orchestrator({
    root,
    agents,
    config: {
      maxConcurrentRequests: config.api.maxConcurrentRequests,
      maxIterations: config.completion.maxIterations,
      autoApprove: opts?.autoApprove,
    },
    api,
    log: (msg) => logger.info(msg),
    store,
  });

  return { config, api, agents, store, orchestrator, logger, logDir };
}