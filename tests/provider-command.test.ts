import { describe, it, expect } from "vitest";
import { ProviderRegistry, createRegistryProvider } from "../src/providers/registry";
import { AnthropicProvider, GoogleProvider } from "../src/providers/adapters";
import { OpenAICompatibleProvider } from "../src/providers/openai";
import type { ConfigProvider } from "../src/config";

function provider(overrides: Partial<ConfigProvider> & { id: string; baseUrl: string }): ConfigProvider {
  return { models: [], enabled: true, ...overrides };
}

describe("ProviderRegistry provider dispatch", () => {
  it("creates an Anthropic provider for apiType 'anthropic'", () => {
    const registry = new ProviderRegistry();
    registry.configure([provider({ id: "a", baseUrl: "https://api.anthropic.com", apiType: "anthropic" })]);
    expect(registry.get("a")).toBeInstanceOf(AnthropicProvider);
  });

  it("creates a Google provider for apiType 'google'", () => {
    const registry = new ProviderRegistry();
    registry.configure([
      provider({ id: "g", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiType: "google" }),
    ]);
    expect(registry.get("g")).toBeInstanceOf(GoogleProvider);
  });

  it("creates an OpenAI-compatible provider for apiType 'openai'", () => {
    const registry = new ProviderRegistry();
    registry.configure([provider({ id: "o", baseUrl: "https://api.openai.com/v1", apiType: "openai" })]);
    expect(registry.get("o")).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it("defaults custom base URLs without an apiType to OpenAI-compatible", () => {
    const registry = new ProviderRegistry();
    registry.configure([provider({ id: "my-gw", baseUrl: "https://gw.example.com/v1" })]);
    expect(registry.get("my-gw")).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it("infers the adapter from the catalog when apiType is omitted", () => {
    // 'anthropic' is a built-in catalog entry with apiType 'anthropic'.
    const registry = new ProviderRegistry();
    registry.configure([provider({ id: "anthropic", baseUrl: "https://api.anthropic.com" })]);
    expect(registry.get("anthropic")).toBeInstanceOf(AnthropicProvider);
  });

  it("infers the adapter from well-known base URLs when apiType is omitted", () => {
    expect(
      createRegistryProvider(provider({ id: "my-gw", baseUrl: "https://api.anthropic.com" })),
    ).toBeInstanceOf(AnthropicProvider);
    expect(
      createRegistryProvider(provider({ id: "my-gw", baseUrl: "https://generativelanguage.googleapis.com/v1beta" })),
    ).toBeInstanceOf(GoogleProvider);
  });

  it("skips disabled providers", () => {
    const registry = new ProviderRegistry();
    registry.configure([provider({ id: "off", baseUrl: "https://x.example/v1", enabled: false })]);
    expect(registry.has("off")).toBe(false);
  });
});
