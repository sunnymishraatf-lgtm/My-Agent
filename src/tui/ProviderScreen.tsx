import { Box, Text } from "ink";
import type { TuiProvider } from "./types";
import {
  boxChars,
  displayWidth,
  glyphs,
  padEnd,
  panelFooter,
  panelHeader,
  providerStatusColor,
  providerStatusGlyph,
  truncate,
  UNICODE,
} from "./utils";

export interface ProviderScreenProps {
  providers: TuiProvider[];
  selected: number;
  activeId: string;
  width: number;
  height: number;
  detail?: string;
  search?: string;
}

function statusLabel(provider: TuiProvider): string {
  switch (provider.status) {
    case "connected":
      return provider.hasKey ? "connected" : "connected";
    case "unconfigured":
      return "not configured";
    case "checking":
      return "checking...";
    case "error":
      return "error";
    case "local":
      return "local";
    default:
      return "";
  }
}

export function ProviderScreen({ providers, selected, activeId, width, height, detail, search }: ProviderScreenProps) {
  const outer = Math.max(40, Math.min(width - 2, 78));
  const inner = outer - 2;
  const showUrl = inner >= 64;
  const showStatus = inner >= 52;
  const maxRows = Math.max(5, Math.min(providers.length, height - (detail ? 11 : 8)));
  const filtered = search
    ? providers.filter(
        (p) =>
          p.label.toLowerCase().includes(search.toLowerCase()) ||
          p.id.toLowerCase().includes(search.toLowerCase()),
      )
    : providers;
  const total = filtered.length;
  const windowStart = Math.max(0, Math.min(selected - Math.floor(maxRows / 2), total - maxRows));
  const view = filtered.slice(Math.max(0, windowStart), Math.max(0, windowStart) + maxRows);

  return (
    <Box flexDirection="column" alignItems="center" width="100%">
      <Box flexDirection="column" width={outer}>
        <Text color="cyan" bold>
          {panelHeader("Providers", outer)}
        </Text>
        <Text>
          {boxChars.v}
          <Text> </Text>
          <Text dimColor>{truncate(search ? `Search: ${search}` : "Select a provider", inner - 1)}</Text>
          {padEnd("", Math.max(0, inner - displayWidth(search ? `Search: ${search}` : "Select a provider") - 1))}
          <Text>{boxChars.v}</Text>
        </Text>
        <Text>{boxChars.v}{padEnd("", inner)}{boxChars.v}</Text>
        {view.map((provider, index) => {
          const absolute = Math.max(0, windowStart) + index;
          const isSelected = absolute === selected;
          const isActive = provider.id === activeId;
          const glyph = providerStatusGlyph(provider.status);
          const count = `${provider.modelCount} model(s)`;
          const marker = isSelected ? `${glyphs.arrow} ` : "  ";
          const activeTag = isActive ? (UNICODE ? " ◀ active" : " <- active") : "";
          const nameWidth = Math.max(10, Math.min(22, inner - 24));
          const countWidth = 12;
          const urlWidth = showUrl ? Math.max(0, inner - nameWidth - countWidth - 6 - displayWidth(activeTag)) : 0;
          const line = `${marker}${glyph} ${padEnd(truncate(provider.label, nameWidth), nameWidth)}${padEnd(count, countWidth)}${
            showUrl ? padEnd(truncate(provider.baseUrl.replace(/^https?:\/\//, ""), urlWidth), urlWidth) : ""
          }${isActive ? activeTag : ""}`;
          return (
            <Text key={provider.id}>
              <Text>{boxChars.v}</Text>
              <Text
                color={isSelected ? "white" : providerStatusColor(provider.status)}
                backgroundColor={isSelected ? "blue" : undefined}
              >
                {padEnd(truncate(line, inner), inner)}
              </Text>
              <Text>{boxChars.v}</Text>
            </Text>
          );
        })}
        {total === 0 ? (
          <Text>
            {boxChars.v}
            <Text dimColor>{padEnd("  No providers match your search.", inner)}</Text>
            {boxChars.v}
          </Text>
        ) : null}
        <Text>{boxChars.v}{padEnd("", inner)}{boxChars.v}</Text>
        <Text>
          {boxChars.v}
          <Text> </Text>
          <Text dimColor>
            {truncate(
              showStatus
                ? `↑↓ navigate · Enter select · C configure · R refresh · Esc back`
                : `↑↓ · Enter · C · R · Esc`,
              inner - 1,
            )}
          </Text>
          <Text>{boxChars.v}</Text>
        </Text>
        <Text color="cyan">{panelFooter(outer)}</Text>
      </Box>
      {detail ? (
        <Box marginTop={1} flexDirection="column" width={outer}>
          <Text color="cyan" bold>
            {panelHeader("Provider detail", outer)}
          </Text>
          {detail.split("\n").map((line, i) => (
            <Text key={i}>
              {boxChars.v}
              <Text dimColor> {padEnd(truncate(line, inner - 2), inner - 1)}</Text>
              {boxChars.v}
            </Text>
          ))}
          <Text color="cyan">{panelFooter(outer)}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
