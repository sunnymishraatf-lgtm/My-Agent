import type { ChatRequest, ChatResponse, Model } from "../types";

export interface LLMProvider {
  readonly name: string;

  models(): Promise<Model[]>;

  chat(request: ChatRequest): Promise<ChatResponse>;

  stream(request: ChatRequest): AsyncIterable<ChatStreamChunk>;

  healthCheck(): Promise<{ ok: boolean; latencyMs: number }>;
}

export interface ChatStreamChunk {
  delta: string;
  done: boolean;
}

export interface BaseProviderOptions {
  id: string;
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

export function normalizeBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, "");
  return url;
}

export function openAIModelsFromEndpoint(baseUrl: string, apiKey?: string, timeoutMs = 10_000): string[] {
  return [];
}