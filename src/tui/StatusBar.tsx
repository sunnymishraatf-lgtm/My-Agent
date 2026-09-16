import { Box, Text } from "ink";
import { compactPath, glyphs, isFreeModel, prettyProvider, truncate } from "./utils";

export interface BottomBarProps {
  cwd: string;
  branch: string;
  isRepo: boolean;
  version: string;
}

export function BottomBar({ cwd, branch, isRepo, version }: BottomBarProps) {
  const path = compactPath(cwd);
  const location = isRepo && branch ? `${path}:${branch}` : path;
  return (
    <Box width="100%" paddingX={1} justifyContent="space-between">
      <Text color="cyan">{truncate(location, 60)}</Text>
      <Text dimColor>{truncate(version, 20)}</Text>
    </Box>
  );
}

export function TipBar({ tip }: { tip: string }) {
  return (
    <Box width="100%" justifyContent="center">
      <Text>
        <Text color="yellow">{glyphs.bullet}</Text>
        <Text dimColor> Tip  {tip}</Text>
      </Text>
    </Box>
  );
}

export function HelpHint() {
  return (
    <Box width="100%" justifyContent="center">
      <Text dimColor>
        tab agents   ctrl+p commands
      </Text>
    </Box>
  );
}

export interface ModelLineProps {
  agentName: string;
  model: string;
  provider: string;
}

export function ModelLine({ agentName, model, provider }: ModelLineProps) {
  const free = isFreeModel(model, provider);
  const label = agentName.charAt(0).toUpperCase() + agentName.slice(1);
  return (
    <Box width="100%" justifyContent="center">
      <Text>
        <Text color="green" bold>
          {label}
        </Text>
        <Text color="gray"> {glyphs.dot} </Text>
        <Text color="white">{model}</Text>
        {free ? <Text color="green"> (FREE)</Text> : null}
        <Text color="gray"> {glyphs.dot} </Text>
        <Text color="blueBright">{prettyProvider(provider)}</Text>
      </Text>
    </Box>
  );
}
