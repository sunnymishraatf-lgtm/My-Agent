import { Box, Text } from "ink";
import type { TuiModel } from "./types";
import {
  boxChars,
  formatContextLength,
  glyphs,
  padEnd,
  panelFooter,
  panelHeader,
  priceTag,
  truncate,
} from "./utils";

export interface ModelScreenProps {
  title: string;
  models: TuiModel[];
  selected: number;
  search: string;
  width: number;
  height: number;
  showProvider: boolean;
  loading?: boolean;
  footer?: string;
}

function capabilityLine(model: TuiModel | undefined): string {
  if (!model) return "No model selected";
  const parts: string[] = [];
  parts.push(`Context: ${formatContextLength(model.contextWindow)}`);
  parts.push(`Tools: ${model.tools === undefined ? "unknown" : model.tools ? "yes" : "no"}`);
  parts.push(`Vision: ${model.vision === undefined ? "unknown" : model.vision ? "yes" : "no"}`);
  if (model.reasoning !== undefined) parts.push(`Reasoning: ${model.reasoning ? "yes" : "no"}`);
  return parts.join(" · ");
}

export function ModelScreen({
  title,
  models,
  selected,
  search,
  width,
  height,
  showProvider,
  loading,
  footer,
}: ModelScreenProps) {
  const outer = Math.max(40, Math.min(width - 2, 82));
  const inner = outer - 2;
  const maxRows = Math.max(5, Math.min(models.length || 1, height - 9));
  const windowStart = Math.max(0, Math.min(selected - Math.floor(maxRows / 2), models.length - maxRows));
  const view = models.slice(Math.max(0, windowStart), Math.max(0, windowStart) + maxRows);
  const current = models[selected];

  return (
    <Box flexDirection="column" alignItems="center" width="100%">
      <Box flexDirection="column" width={outer}>
        <Text color="cyan" bold>
          {panelHeader(title, outer)}
        </Text>
        <Text>
          {boxChars.v}
          <Text> </Text>
          <Text color="cyanBright">Search: </Text>
          <Text>{search}</Text>
          <Text dimColor>{search ? "" : "type to filter models"}</Text>
          <Text>{boxChars.v}</Text>
        </Text>
        <Text>{boxChars.v}{padEnd("", inner)}{boxChars.v}</Text>
        {loading ? (
          <Text>
            {boxChars.v}
            <Text color="yellow">{padEnd("  Fetching models...", inner)}</Text>
            {boxChars.v}
          </Text>
        ) : view.length === 0 ? (
          <Text>
            {boxChars.v}
            <Text dimColor>{padEnd("  No models found. Press R to refresh or configure manually.", inner)}</Text>
            {boxChars.v}
          </Text>
        ) : (
          view.map((model, index) => {
            const absolute = Math.max(0, windowStart) + index;
            const isSelected = absolute === selected;
            const tag = priceTag(model);
            const nameWidth = showProvider ? Math.max(18, inner - 34) : Math.max(20, inner - 14);
            const providerWidth = showProvider ? 16 : 0;
            const content = `${padEnd(truncate(model.id, nameWidth), nameWidth)}${
              showProvider ? padEnd(truncate(model.providerLabel, providerWidth), providerWidth) : ""
            }${padEnd(tag, 8)}`;
            const contentWidth = inner - 2;
            return (
              <Text key={`${model.provider}:${model.id}`}>
                <Text>{boxChars.v}</Text>
                <Text color={isSelected ? "green" : undefined}>{isSelected ? `${glyphs.arrow} ` : "  "}</Text>
                <Text backgroundColor={isSelected ? "blue" : undefined} color={isSelected ? "white" : undefined}>
                  {padEnd(truncate(content, contentWidth), contentWidth)}
                </Text>
                <Text>{boxChars.v}</Text>
              </Text>
            );
          })
        )}
        <Text>{boxChars.v}{padEnd("", inner)}{boxChars.v}</Text>
        <Text>
          {boxChars.v}
          <Text> </Text>
          <Text dimColor>{truncate(capabilityLine(current), inner - 1)}</Text>
          <Text>{boxChars.v}</Text>
        </Text>
        <Text>
          {boxChars.v}
          <Text> </Text>
          <Text dimColor>
            {truncate(
              footer ?? (showProvider ? "↑↓ navigate · Enter select · type to search · Esc back" : "↑↓ navigate · Enter select · Esc back"),
              inner - 1,
            )}
          </Text>
          <Text>{boxChars.v}</Text>
        </Text>
        <Text color="cyan">{panelFooter(outer)}</Text>
      </Box>
    </Box>
  );
}
