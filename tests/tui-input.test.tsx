import { describe, it, expect, vi } from "vitest";
import { Writable, PassThrough } from "node:stream";
import { render } from "ink";
import { App } from "../src/tui/App";
import type { ChatRuntime } from "../src/tui/runtime";
import { classifyRaw, editKind, insertAt, backspaceAt, deleteAt, wordLeft, wordRight, sanitizePaste, splitRawKeys, parseToken } from "../src/tui/keys";

// Real terminal byte sequences.
const BACKSPACE = "\x7f"; // what the Backspace key sends on Windows Terminal, macOS and Linux terminals
const BACKSPACE_LEGACY = "\b"; // some legacy consoles
const DELETE = "\x1b[3~"; // forward Delete key
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const HOME = "\x1b[H";
const END = "\x1b[F";
const CTRL_LEFT = "\x1b[1;5D";
const ENTER = "\r";

function terminal() {
  const chunks: string[] = [];
  const out = new Writable({
    write(chunk, _e, cb) {
      chunks.push(String(chunk));
      cb();
    },
  }) as unknown as NodeJS.WriteStream & { columns: number; rows: number; isTTY: boolean };
  out.columns = 100;
  out.rows = 30;
  out.isTTY = true;
  const input = new PassThrough() as unknown as NodeJS.ReadStream & {
    isTTY: boolean;
    setRawMode: (m: boolean) => unknown;
    ref: () => unknown;
    unref: () => unknown;
  };
  input.isTTY = true;
  input.setRawMode = () => input;
  input.ref = () => input;
  input.unref = () => input;
  return { out, input, output: () => chunks.join("") };
}

function makeRuntime(sent: string[]): ChatRuntime {
  const noop = vi.fn();
  const provider = {
    id: "p", label: "P", description: "", baseUrl: "https://example.com/v1", apiType: "openai-compatible",
    models: [{ id: "m", name: "m", provider: "p", providerLabel: "P", free: true }],
    modelCount: 1, configured: true, enabled: true, hasKey: true, local: false, status: "connected" as const, docsUrl: "",
  };
  return {
    onAction: undefined,
    getActiveAgent: () => ({ name: "build" }),
    getCurrentSession: () => ({ id: "s", model: "m", provider: "p" }),
    getRoot: () => process.cwd(),
    getVersion: () => "0.0.0-test",
    getBranch: async () => "main",
    getAgents: () => [{ name: "build", mode: "primary", description: "" }],
    getAllModels: () => provider.models,
    getProviders: () => [provider],
    getProviderDetail: () => "",
    getModelsForProviderAsModels: () => provider.models,
    getActiveProviderId: () => "p",
    getActiveModel: () => "m",
    listSessions: () => [],
    loadSession: () => true,
    switchAgent: async () => true,
    switchModel: async () => {},
    switchProvider: async () => {},
    refreshProvider: async () => true,
    refreshAllProviders: async () => {},
    configureProvider: () => true,
    ensureModels: async () => {},
    send: async (text: string) => {
      sent.push(text);
    },
    resolveApproval: noop,
    destroy: noop,
  } as unknown as ChatRuntime;
}

const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms));

/** Mount the real <App/>, then feed it keystrokes one at a time exactly like a terminal would. */
async function session() {
  const sent: string[] = [];
  const t = terminal();
  const instance = render(<App runtime={makeRuntime(sent)} startOpts={{}} />, {
    stdout: t.out,
    stdin: t.input,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  await tick(80);
  return {
    sent,
    async keys(...seq: string[]) {
      for (const k of seq) {
        t.input.write(k);
        await tick();
      }
    },
    /** Submit and return exactly what the app would have sent to the model. */
    async submit(): Promise<string | undefined> {
      const before = sent.length;
      t.input.write(ENTER);
      await tick(60);
      return sent.length > before ? sent[sent.length - 1] : undefined;
    },
    unmount: () => instance.unmount(),
  };
}

describe("key classification (raw bytes)", () => {
  it("treats 0x7f and 0x08 as Backspace and ESC[3~ as Delete", () => {
    expect(classifyRaw(BACKSPACE)).toBe("backspace");
    expect(classifyRaw(BACKSPACE_LEGACY)).toBe("backspace");
    expect(classifyRaw(DELETE)).toBe("delete");
    expect(classifyRaw("\x1b[3;5~")).toBe("delete");
    expect(classifyRaw(HOME)).toBe("home");
    expect(classifyRaw("\x1bOH")).toBe("home");
    expect(classifyRaw(END)).toBe("end");
    expect(classifyRaw(CTRL_LEFT)).toBe("wordLeft");
    expect(classifyRaw("a")).toBeNull();
  });

  it("falls back to Backspace when Ink reports `delete` without a recognised raw sequence", () => {
    expect(editKind({ delete: true }, "")).toBe("backspace");
    expect(editKind({ backspace: true }, "")).toBe("backspace");
    expect(editKind({}, "")).toBeNull();
  });
});

describe("pure editing helpers", () => {
  it("backspace removes the char before the cursor; delete removes the char at the cursor", () => {
    expect(backspaceAt("ABCDE", 5)).toEqual({ text: "ABCD", cursor: 4 });
    expect(deleteAt("ABCDE", 2)).toEqual({ text: "ABDE", cursor: 2 });
    expect(backspaceAt("ABC", 0)).toEqual({ text: "ABC", cursor: 0 });
    expect(deleteAt("ABC", 3)).toEqual({ text: "ABC", cursor: 3 });
  });

  it("inserts at the cursor without moving it to the end", () => {
    const r = insertAt("Hello World", 6, "Beautiful ");
    expect(r.text).toBe("Hello Beautiful World");
    expect(r.cursor).toBe(16);
  });

  it("moves by word and sanitises pasted text", () => {
    expect(wordLeft("foo bar baz", 11)).toBe(8);
    expect(wordRight("foo bar baz", 0)).toBe(3);
    expect(sanitizePaste("a\r\nb\x00c\x1b[201~")).toBe("a\nbc");
  });
});

describe("TUI input box (real <App/>, real key bytes)", () => {
  it("Backspace at end of line removes the last character, one at a time, down to empty", async () => {
    const s = await session();
    await s.keys("h", "e", "l", "l", "o");
    await s.keys(BACKSPACE);
    // hell -> hel -> he -> h -> (empty)
    expect(await s.submit()).toBe("hell");
    await s.keys("h", "e", "l", "l", "o", BACKSPACE, BACKSPACE, BACKSPACE);
    expect(await s.submit()).toBe("he");
    await s.keys("h", "e", "l", "l", "o", BACKSPACE, BACKSPACE, BACKSPACE, BACKSPACE);
    expect(await s.submit()).toBe("h");
    await s.keys("h", "e", "l", "l", "o", BACKSPACE, BACKSPACE, BACKSPACE, BACKSPACE, BACKSPACE);
    expect(await s.submit()).toBeUndefined(); // empty -> nothing sent
    await s.keys(BACKSPACE, BACKSPACE); // Backspace on empty input must be a harmless no-op
    await s.keys("o", "k");
    expect(await s.submit()).toBe("ok");
    s.unmount();
  });

  it("legacy \\b Backspace behaves the same", async () => {
    const s = await session();
    await s.keys("a", "b", "c", BACKSPACE_LEGACY);
    expect(await s.submit()).toBe("ab");
    s.unmount();
  });

  it("Backspace in the middle removes the char before the cursor and keeps the cursor there", async () => {
    const s = await session();
    await s.keys("A", "B", "C", "D", "E", LEFT, LEFT); // AB C|DE  -> cursor after C
    await s.keys(BACKSPACE); // removes C
    await s.keys("X"); // typed at the cursor, not at the end
    expect(await s.submit()).toBe("ABXDE");
    s.unmount();
  });

  it("Delete removes the char AT the cursor (not before it) and does nothing at end of line", async () => {
    const s = await session();
    await s.keys("A", "B", "C", "D", "E", LEFT, LEFT, LEFT); // AB|CDE
    await s.keys(DELETE);
    expect(await s.submit()).toBe("ABDE");
    await s.keys("a", "b", "c", DELETE, DELETE); // at end: no-op
    expect(await s.submit()).toBe("abc");
    s.unmount();
  });

  it("inserting in the middle keeps the cursor where the user put it", async () => {
    const s = await session();
    await s.keys(..."Hello World".split(""));
    await s.keys(LEFT, LEFT, LEFT, LEFT, LEFT); // Hello |World
    await s.keys(..."Beautiful ".split(""));
    expect(await s.submit()).toBe("Hello Beautiful World");
    s.unmount();
  });

  it("a multi-character paste in the middle lands at the cursor", async () => {
    const s = await session();
    await s.keys("H", "e", "l", "l", "o", LEFT, LEFT);
    await s.keys("p-a-s-t-e");
    expect(await s.submit()).toBe("Help-a-s-t-elo");
    s.unmount();
  });

  it("Home and End move to the line boundaries", async () => {
    const s = await session();
    await s.keys("a", "b", "c", HOME, "X", END, "Y");
    expect(await s.submit()).toBe("XabcY");
    s.unmount();
  });

  it("Ctrl+Left jumps a word", async () => {
    const s = await session();
    await s.keys(..."foo bar".split(""));
    await s.keys(CTRL_LEFT, "X");
    expect(await s.submit()).toBe("foo Xbar");
    s.unmount();
  });

  it("does not disturb the text while the agent streams updates", async () => {
    const sent: string[] = [];
    const runtime = makeRuntime(sent);
    const t = terminal();
    const inst = render(<App runtime={runtime} startOpts={{}} />, { stdout: t.out, stdin: t.input, exitOnCtrlC: false, patchConsole: false });
    await tick(80);
    const emit = (runtime as unknown as { onAction?: (a: unknown) => void }).onAction;
    for (const k of ["A", "B", "C"]) {
      t.input.write(k);
      await tick();
      emit?.({ type: "appendDelta", text: "streaming " }); // external state churn between keystrokes
      await tick();
    }
    t.input.write(LEFT);
    await tick();
    emit?.({ type: "appendDelta", text: "more " });
    await tick();
    t.input.write(BACKSPACE);
    await tick();
    t.input.write(ENTER);
    await tick(60);
    // A B C, Left, Backspace => "AC": streaming updates between keystrokes did not reset or reorder the text.
    expect(sent).toEqual(["AC"]);
    inst.unmount();
  });
});

describe("coalesced keystrokes in one stdin chunk", () => {
  // Terminals can deliver several keystrokes in a single stdin chunk: key
  // repeat (holding Backspace), fast typing, laggy links, mobile keyboards.
  // Ink parses the whole chunk as one keypress and drops everything after the
  // first key, so the TUI must split the chunk and handle each key in order.

  it("applies every Backspace when several arrive in one chunk (key repeat)", async () => {
    const s = await session();
    await s.keys("hello" + BACKSPACE + BACKSPACE); // a single chunk
    expect(await s.submit()).toBe("hel");
    s.unmount();
  });

  it("keeps fast typing that arrives as one chunk", async () => {
    const s = await session();
    await s.keys("hello"); // one chunk, not typed key-by-key
    expect(await s.submit()).toBe("hello");
    s.unmount();
  });

  it("handles mixed text and Backspace in one chunk", async () => {
    const s = await session();
    await s.keys("ab" + BACKSPACE + "c");
    expect(await s.submit()).toBe("ac");
    s.unmount();
  });

  it("handles coalesced arrow keys before editing", async () => {
    const s = await session();
    await s.keys("abc");
    await s.keys(LEFT + LEFT); // two Left presses in one chunk
    await s.keys("X");
    expect(await s.submit()).toBe("aXbc");
    s.unmount();
  });

  it("handles Backspace and arrows interleaved in one chunk", async () => {
    const s = await session();
    await s.keys("abcde" + LEFT + LEFT + BACKSPACE + BACKSPACE);
    expect(await s.submit()).toBe("ade");
    s.unmount();
  });

  it("submits text typed together with Enter in one chunk", async () => {
    const s = await session();
    await s.keys("hi" + ENTER); // typed "hi" and hit Enter within one chunk
    await tick(60);
    expect(s.sent[s.sent.length - 1]).toBe("hi");
    s.unmount();
  });

  it("keeps working after a coalesced chunk (state stays consistent)", async () => {
    const s = await session();
    await s.keys("hello" + BACKSPACE + BACKSPACE);
    await s.keys(BACKSPACE); // single keystroke afterwards still works
    await s.keys("p");
    expect(await s.submit()).toBe("hep");
    s.unmount();
  });
});

describe("splitRawKeys / parseToken", () => {
  it("splits coalesced keystrokes into individual tokens", () => {
    expect(splitRawKeys("\x7f\x7f")).toEqual(["\x7f", "\x7f"]);
    expect(splitRawKeys("a\x7f")).toEqual(["a", "\x7f"]);
    expect(splitRawKeys("\x1b[D\x1b[D")).toEqual(["\x1b[D", "\x1b[D"]);
    expect(splitRawKeys("hi\r")).toEqual(["h", "i", "\r"]);
    expect(splitRawKeys("\x1b[200~hi\x1b[201~")).toEqual(["\x1b[200~", "h", "i", "\x1b[201~"]);
    expect(splitRawKeys("\x1b[1;5D\x7f")).toEqual(["\x1b[1;5D", "\x7f"]);
  });

  it("parses single tokens the way Ink would for one keypress", () => {
    expect(parseToken("\x7f").key.backspace).toBe(true);
    expect(parseToken("\b").key.backspace).toBe(true);
    expect(parseToken("\x1b[3~").key.delete).toBe(true);
    expect(parseToken("\x1b[D").key.leftArrow).toBe(true);
    expect(parseToken("\x1bOD").key.leftArrow).toBe(true);
    expect(parseToken("\r").key.return).toBe(true);
    expect(parseToken("\t").key.tab).toBe(true);
    expect(parseToken("\x1b").key.escape).toBe(true);
    expect(parseToken("a")).toEqual({ input: "a", key: {} });
    const ctrlC = parseToken("\x03");
    expect(ctrlC.key.ctrl).toBe(true);
    expect(ctrlC.input).toBe("c");
    // Pasted newlines stay newlines (Ink reports LF as "enter", not "return").
    expect(parseToken("\n").input).toBe("\n");
    expect(parseToken("\n").key.return).toBeUndefined();
    // Unknown escape sequences never become text.
    expect(parseToken("\x1b[K").input).toBe("");
    // Bracketed-paste markers carry no text.
    expect(parseToken("\x1b[200~").input).toBe("");
  });
});
