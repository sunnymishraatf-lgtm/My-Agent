import { describe, it, expect, vi } from "vitest";
import { Writable, PassThrough } from "node:stream";
import { render } from "ink";
import { App } from "../src/tui/App";
import type { ChatRuntime } from "../src/tui/runtime";

function captureStdout(): { stream: NodeJS.WriteStream; output: () => string } {
  const chunks: string[] = [];
  const writable = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  const stream = writable as unknown as NodeJS.WriteStream;
  (stream as unknown as { columns: number }).columns = 100;
  (stream as unknown as { rows: number }).rows = 30;
  (stream as unknown as { isTTY: boolean }).isTTY = true;
  return { stream, output: () => chunks.join("") };
}

function fakeStdin(): { stream: NodeJS.ReadStream; send: (text: string) => void } {
  const stream = new PassThrough();
  const withTty = stream as unknown as {
    isTTY: boolean;
    setRawMode: (mode: boolean) => unknown;
    ref: () => unknown;
    unref: () => unknown;
  };
  withTty.isTTY = true;
  withTty.setRawMode = () => stream;
  withTty.ref = () => stream;
  withTty.unref = () => stream;
  return {
    stream: stream as unknown as NodeJS.ReadStream,
    send: (text: string) => stream.write(text),
  };
}

function makeRuntime(): ChatRuntime {
  const noop = vi.fn();
  const provider = {
    id: "test-provider",
    label: "Test Provider",
    description: "test",
    baseUrl: "https://example.com/v1",
    apiType: "openai-compatible",
    models: [{ id: "test-model", name: "test-model", provider: "test-provider", providerLabel: "Test Provider", free: true }],
    modelCount: 1,
    configured: true,
    enabled: true,
    hasKey: true,
    local: false,
    status: "connected" as const,
    docsUrl: "",
  };
  const runtime = {
    onAction: undefined,
    getActiveAgent: () => ({ name: "build" }),
    getCurrentSession: () => ({ id: "test-session", model: "test-model", provider: "test-provider" }),
    getRoot: () => process.cwd(),
    getVersion: () => "0.0.0-test",
    getBranch: async () => "main",
    getAgents: () => [
      { name: "build", mode: "primary", description: "" },
      { name: "plan", mode: "primary", description: "" },
    ],
    getAllModels: () => [{ id: "test-model", name: "test-model", provider: "test-provider", providerLabel: "Test Provider", free: true }],
    getProviders: () => [provider],
    getProviderDetail: () => "Provider: Test Provider\nModels: 1",
    getModelsForProviderAsModels: () => provider.models,
    getActiveProviderId: () => "test-provider",
    getActiveModel: () => "test-model",
    listSessions: () => [],
    loadSession: () => true,
    switchAgent: async () => true,
    switchModel: async () => {},
    switchProvider: async () => {},
    refreshProvider: async () => true,
    refreshAllProviders: async () => {},
    configureProvider: () => true,
    ensureModels: async () => {},
    send: async () => {},
    resolveApproval: noop,
    destroy: noop,
  };
  return runtime as unknown as ChatRuntime;
}

async function mountApp(
  runtime: ChatRuntime = makeRuntime(),
): Promise<{ output: () => string; send: (t: string) => void; unmount: () => void; runtime: ChatRuntime }> {
  const { stream, output } = captureStdout();
  const stdin = fakeStdin();
  const instance = render(<App runtime={runtime} startOpts={{}} />, {
    stdout: stream,
    stdin: stdin.stream,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  await new Promise((r) => setTimeout(r, 80));
  return { output, send: stdin.send, unmount: () => instance.unmount(), runtime };
}

describe("tui", () => {
  it("renders the startup screen and then the chat view", async () => {
    const { output, unmount } = await mountApp();
    const frame = output();
    expect(frame).toContain("NEUTRON");
    expect(frame).toContain("Autonomous Software Maintenance Intelligence");
    expect(frame).toContain("Ask anything...");
    expect(frame).not.toContain("undefined");
    unmount();
  });

  it("shows the command menu when typing a slash", async () => {
    const { output, send, unmount } = await mountApp();
    send("/mo");
    await new Promise((r) => setTimeout(r, 80));
    const frame = output();
    expect(frame).toContain("/models");
    expect(frame).toContain("Switch model");
    expect(frame).not.toContain("/agents");
    unmount();
  });

  it("opens the command palette with ctrl+p", async () => {
    const { output, send, unmount } = await mountApp();
    send("\x10");
    await new Promise((r) => setTimeout(r, 80));
    const frame = output();
    expect(frame).toContain("Commands");
    expect(frame).toContain("Switch agent");
    expect(frame).toContain("Run tests");
    unmount();
  });

  it("opens the agent picker with tab", async () => {
    const { output, send, unmount } = await mountApp();
    send("\t");
    await new Promise((r) => setTimeout(r, 80));
    const frame = output();
    expect(frame).toContain("Agents");
    expect(frame).toContain("build");
    unmount();
  });

  it("renders a streaming turn with tool output and file changes", async () => {
    const runtime = makeRuntime();
    const { output, send, unmount } = await mountApp(runtime);
    const emit = (runtime as unknown as { onAction?: (action: unknown) => void }).onAction;

    send("build a login page");
    await new Promise((r) => setTimeout(r, 40));
    send("\r");
    await new Promise((r) => setTimeout(r, 80));
    expect(output()).toContain("build a login page");

    emit?.({ type: "appendDelta", text: "I'll inspect " });
    emit?.({ type: "appendDelta", text: "the project." });
    await new Promise((r) => setTimeout(r, 60));
    expect(output()).toContain("I'll inspect the project.");

    emit?.({ type: "finishAssistant", text: "I'll inspect the project." });
    emit?.({ type: "addToolCall", call: { id: "tc-1", kind: "tool", name: "read", args: { path: "src/App.tsx" }, status: "running" } });
    await new Promise((r) => setTimeout(r, 60));
    let frame = output();
    expect(frame).toContain("read");
    expect(frame).toContain("src/App.tsx");

    emit?.({ type: "updateToolCall", id: "tc-1", patch: { status: "ok", output: "file contents" } });
    emit?.({ type: "addFileChange", change: { path: "src/App.tsx", kind: "modified", added: 10, removed: 2 } });
    await new Promise((r) => setTimeout(r, 60));
    frame = output();
    expect(frame).toContain("Changed files");
    expect(frame).toContain("src/App.tsx");
    unmount();
  });

  it("opens the provider selector via /providers", async () => {
    const { output, send, unmount } = await mountApp();
    send("/providers");
    await new Promise((r) => setTimeout(r, 60));
    send("\r");
    await new Promise((r) => setTimeout(r, 80));
    const frame = output();
    expect(frame).toContain("Providers");
    expect(frame).toContain("Test Provider");
    expect(frame).toContain("1 model(s)");
    unmount();
  });

  it("opens the global model picker with ctrl+l and filters", async () => {
    const { output, send, unmount } = await mountApp();
    send("\x0c");
    await new Promise((r) => setTimeout(r, 80));
    let frame = output();
    expect(frame).toContain("Select Model");
    expect(frame).toContain("test-model");

    send("zzz");
    await new Promise((r) => setTimeout(r, 80));
    frame = output();
    expect(frame).toContain("No models found");
    unmount();
  });
});
