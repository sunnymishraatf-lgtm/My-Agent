import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { TuiProvider } from "./types";
import { borderStyle } from "./utils";

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

  useInput((input, key) => {
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
    if (key.leftArrow) return setCursor((c) => Math.max(0, c - 1));
    if (key.rightArrow) return setCursor((c) => Math.min(value.length, c + 1));
    if (key.backspace || key.delete) {
      if (cursor <= 0) return;
      const next = value.slice(0, cursor - 1) + value.slice(cursor);
      setters[field](next);
      setCursor(cursor - 1);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      const next = value.slice(0, cursor) + input + value.slice(cursor);
      setters[field](next);
      setCursor(cursor + input.length);
    }
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
