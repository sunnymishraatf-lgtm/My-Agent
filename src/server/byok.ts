/**
 * Bring-your-own-key (BYOK) support for the NEUTRON web/API surface.
 *
 * A client (the /app Settings view, the APK) may supply its own provider
 * API key per request via the `x-api-key` header (or the `apiKey` JSON body
 * field as a fallback), plus an optional provider choice via the
 * `x-provider` header (or the `provider` JSON body field). The key and the
 * provider id are used to build a request-scoped provider configuration
 * and are NEVER persisted: never written to disk, never stored on any
 * long-lived object (DemoManager, ApiSystem, sessions), and never echoed
 * in responses. The key is registered with `registerSecrets` so any
 * accidental inclusion in logs or error text is redacted.
 */
import type { IncomingMessage } from "node:http";
import { loadConfig, registerSecrets, type ProviderResolved, type ResolvedConfig } from "../config";
import { getCatalogEntry } from "../providers/catalog";

/** The request header that carries a BYOK key. */
export const API_KEY_HEADER = "x-api-key";

/** The request header that carries a BYOK provider choice. */
export const PROVIDER_HEADER = "x-provider";

/** Provider id used when the client does not choose one. */
export const DEFAULT_BYOK_PROVIDER = "agentrouter";

/**
 * Build a provider entry from an explicit request key and an optional
 * provider id. Mirrors `resolveEnvProvider` in providers/catalog.ts, but
 * the key comes from the request instead of the environment. Returns
 * undefined for empty/garbage keys, unknown provider ids fall back to the
 * default provider, and providers without a base URL (e.g. `custom`)
 * return undefined.
 */
export function providerFromRequestKey(key: string, providerId?: string): ProviderResolved | undefined {
  const k = (key ?? "").trim();
  if (k.length < 8 || /\s/.test(k)) return undefined;
  const wanted = (providerId ?? "").trim().toLowerCase();
  const entry = (wanted ? getCatalogEntry(wanted) : undefined) ?? getCatalogEntry(DEFAULT_BYOK_PROVIDER);
  if (!entry?.baseUrl) return undefined;
  return {
    id: entry.id,
    baseUrl: entry.baseUrl,
    apiKey: k,
    models: [],
    enabled: true,
  };
}

/**
 * Extract a request API key: the `x-api-key` header wins, then the `apiKey`
 * JSON body field. Returns undefined when neither is present.
 */
export function extractRequestKey(req: IncomingMessage, body?: unknown): string | undefined {
  const h = req.headers[API_KEY_HEADER];
  const hv = Array.isArray(h) ? h[0] : h;
  if (typeof hv === "string" && hv.trim()) return hv.trim();
  if (body && typeof body === "object") {
    const b = (body as Record<string, unknown>).apiKey;
    if (typeof b === "string" && b.trim()) return b.trim();
  }
  return undefined;
}

/** Header-only variant for the Vercel serverless routes (see api-src/_lib.ts). */
export function extractRequestKeyFromHeaders(
  headers?: Record<string, string | string[] | undefined>,
): string | undefined {
  if (!headers) return undefined;
  const h = headers[API_KEY_HEADER] ?? headers["X-Api-Key"] ?? headers["X-API-KEY"];
  const v = Array.isArray(h) ? h[0] : h;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * Extract a request provider choice: the `x-provider` header wins, then the
 * `provider` JSON body field. Returns the trimmed, lowercased id, or
 * undefined when not supplied. Unknown ids are NOT rejected here —
 * `providerFromRequestKey` falls back to the default provider for them.
 */
export function extractRequestProvider(req: IncomingMessage, body?: unknown): string | undefined {
  const h = req.headers[PROVIDER_HEADER];
  const hv = Array.isArray(h) ? h[0] : h;
  if (typeof hv === "string" && hv.trim()) return hv.trim().toLowerCase();
  if (body && typeof body === "object") {
    const b = (body as Record<string, unknown>).provider;
    if (typeof b === "string" && b.trim()) return b.trim().toLowerCase();
  }
  return undefined;
}

/** Header-only variant for the Vercel serverless routes (see api-src/_lib.ts). */
export function extractRequestProviderFromHeaders(
  headers?: Record<string, string | string[] | undefined>,
): string | undefined {
  if (!headers) return undefined;
  const h = headers[PROVIDER_HEADER] ?? headers["X-Provider"] ?? headers["X-PROVIDER"];
  const v = Array.isArray(h) ? h[0] : h;
  return typeof v === "string" && v.trim() ? v.trim().toLowerCase() : undefined;
}

/**
 * Build the config for exactly one request. A valid request key produces a
 * single-provider config scoped to this call (for the requested provider,
 * defaulting to agentrouter); otherwise the server's normal configuration
 * (env/config file) is used, unchanged.
 */
export function configForRequest(apiKey?: string, providerId?: string): ResolvedConfig {
  const provider = apiKey ? providerFromRequestKey(apiKey, providerId) : undefined;
  if (provider?.apiKey) {
    registerSecrets([provider.apiKey]);
    return loadConfig({ providers: [provider] });
  }
  return loadConfig();
}
