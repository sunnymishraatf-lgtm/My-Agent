import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { TuiProvider } from "./types";
import { borderStyle } from "./utils";
import { backspaceAt, classifyRaw, deleteAt, editKind, insertAt, parseToken, sanitizePaste, splitRawKeys, useRawKeys, wordLeft, wordRight, type EditKind } from "./keys";

export interface ProviderConfigValues {
  baseUrl: string;
  apiKey?: string;
  models?: string[];
}

export interface ProviderConfigPanelProps {
  provider: TuiProvider;
  width: number;
  onSave: (values: ProviderConfigValues) => void;
  onCancel: () => void;
}

type Field = "baseUrl" | "apiKey" | "models";

const FIELD_ORDER: Field[] = ["baseUrl", "apiKey", "models"];

/** Mask an API key so it is never shown in full. */
function maskKey(value: string, hasSavedKey: boolean): string {
  if (value) return "*".repeat(Math.max(4, Math.min(value.length, 24)));
  return hasSavedKey ? "(saved - leave blank to keep)" : "(not set)";
}

export function ProviderConfigPanel({ provider, width, onSave, onCancel }: ProviderConfigPanelProps) {
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState(provider.models.map((m) => m.id).join(","));
  const [fieldIndex, setFieldIndex] = useState(0);
  const [cursor, setCursor] = useState(baseUrl.length);

  const field = FIELD_ORDER[fieldIndex] ?? "baseUrl";
  const values: Record<Field, string> = { baseUrl, apiKey, models };
  const setters: Record<Field, (v: string) => void> = {
    baseUrl: setBaseUrl,
    apiKey: setApiKey,
    models: setModels,
  };
  const value = values[field];

  const focus = (index: number) => {
    const next = (index + FIELD_ORDER.length) % FIELD_ORDER.length;
    setFieldIndex(next);
    const target = FIELD_ORDER[next]!;
    setCursor(values[target].length);
  };

  const rawKeys = useRawKeys();

  const handleKey = (
    input: string,
    key: {
      upArrow?: boolean;
      downArrow?: boolean;
      leftArrow?: boolean;
      rightArrow?: boolean;
      return?: boolean;
      escape?: boolean;
      tab?: boolean;
      ctrl?: boolean;
      meta?: boolean;
    },
    kind: EditKind,
  ): void => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      onSave({
        baseUrl: baseUrl.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        models: models
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean),
      });
      return;
    }
    if (key.tab || key.downArrow) return focus(fieldIndex + 1);
    if (key.upArrow) return focus(fieldIndex - 1);
    if (kind === "home") return setCursor(0);
    if (kind === "end") return setCursor(value.length);
    if (kind === "wordLeft") return setCursor(wordLeft(value, cursor));
    if (kind === "wordRight") return setCursor(wordRight(value, cursor));
    if (key.leftArrow) return setCursor((c) => Math.max(0, c - 1));
    if (key.rightArrow) return setCursor((c) => Math.min(value.length, c + 1));
    if (kind === "backspace" || kind === "delete") {
      const r = kind === "backspace" ? backspaceAt(value, cursor) : deleteAt(value, cursor);
      setters[field](r.text);
      setCursor(r.cursor);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      // Single-line fields: pasted newlines are dropped rather than submitted.
      const text = sanitizePaste(input).replace(/\n/g, "");
      if (!text) return;
      const r = insertAt(value, cursor, text);
      setters[field](r.text);
      setCursor(r.cursor);
    }
  };

  /**
   * Handle several keystrokes that arrived in one stdin chunk (key repeat,
   * fast typing, mobile keyboard). React state updates are async, so the
   * field text and cursor are threaded through locals for the duration of
   * the chunk; otherwise rapid keystrokes would each read the same stale
   * value and clobber each other.
   */
  const handleKeyChunk = (tokens: string[]): void => {
    const vals: Record<Field, string> = { baseUrl, apiKey, models };
    let cur = cursor;
    let fIdx = fieldIndex;
    let detached = false;
    const commit = () => {
      if (detached) return;
      setBaseUrl(vals.baseUrl);
      setApiKey(vals.apiKey);
      setModels(vals.models);
      setCursor(cur);
      setFieldIndex(fIdx);
    };
    for (const token of tokens) {
      const parsed = parseToken(token);
      const kind = classifyRaw(token);
      const activeField = FIELD_ORDER[fIdx] ?? "baseUrl";
      if (!detached) {
        if (kind === "backspace") {
          const r = backspaceAt(vals[activeField], cur);
          vals[activeField] = r.text;
          cur = r.cursor;
          continue;
        }
        if (kind === "delete") {
          const r = deleteAt(vals[activeField], cur);
          vals[activeField] = r.text;
          cur = r.cursor;
          continue;
        }
        if (kind === "home") {
          cur = 0;
          continue;
        }
        if (kind === "end") {
          cur = vals[activeField].length;
          continue;
        }
        if (kind === "wordLeft") {
          cur = wordLeft(vals[activeField], cur);
          continue;
        }
        if (kind === "wordRight") {
          cur = wordRight(vals[activeField], cur);
          continue;
        }
        if (parsed.key.leftArrow) {
          cur = Math.max(0, cur - 1);
          continue;
        }
        if (parsed.key.rightArrow) {
          cur = Math.min(vals[activeField].length, cur + 1);
          continue;
        }
        if (parsed.key.return && !parsed.key.shift) {
          commit();
          detached = true;
          onSave({
            baseUrl: vals.baseUrl.trim(),
            ...(vals.apiKey.trim() ? { apiKey: vals.apiKey.trim() } : {}),
            models: vals.models
              .split(",")
              .map((m) => m.trim())
              .filter(Boolean),
          });
          continue;
        }
        if (parsed.input && !parsed.key.ctrl && !parsed.key.meta) {
          // Single-line fields: pasted newlines are dropped rather than submitted.
          const clean = sanitizePaste(parsed.input).replace(/\n/g, "");
          if (clean) {
            const r = insertAt(vals[activeField], cur, clean);
            vals[activeField] = r.text;
            cur = r.cursor;
          }
          continue;
        }
      }
      // Control key: commit the draft and delegate.
      commit();
      detached = true;
      handleKey(parsed.input, parsed.key, kind);
    }
    commit();
  };

  useInput((input, key) => {
    const raw = rawKeys.current;
    const tokens = splitRawKeys(raw);
    if (tokens.length > 1) {
      handleKeyChunk(tokens);
      return;
    }
    handleKey(input, key, editKind(key, raw));
  });

  const panelWidth = Math.max(40, Math.min(width - 4, 66));
  const row = (name: Field, label: string, display: string) => {
    const active = field === name;
    const marker = active ? ">" : " ";
    return (
      <Box key={name} flexDirection="column" marginBottom={1}>
        <Text color={active ? "cyanBright" : undefined} bold={active}>
          {label}
        </Text>
        <Text>
          <Text color="cyan">{marker} </Text>
          <Text backgroundColor={active ? "blue" : undefined} color={active ? "white" : undefined}>
            {display}
            {active ? " " : ""}
          </Text>
        </Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" alignItems="center" width="100%">
      <Box flexDirection="column" borderStyle={borderStyle} borderColor="yellow" paddingX={2} paddingY={1} width={panelWidth}>
        <Box marginBottom={1}>
          <Text bold color="yellowBright">
            Connect {provider.label}
          </Text>
        </Box>
        {row("baseUrl", "API Base URL", baseUrl)}
        {row("apiKey", "API Key", field === "apiKey" ? (apiKey ? "*".repeat(Math.max(4, apiKey.length)) : "") : maskKey(apiKey, provider.hasKey))}
        {row("models", "Model IDs (optional, comma separated)", models)}
        <Text dimColor>
          {field === "apiKey" ? "Typing is masked. The saved key is never displayed." : "Tab/↑↓ switch fields"}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>[Enter] Save    [Esc] Cancel</Text>
        </Box>
      </Box>
    </Box>
  );
}
