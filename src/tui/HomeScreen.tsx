import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { borderStyle } from "./utils";
import { ModelLine } from "./StatusBar";
import { NeutronLogo } from "./NeutronLogo";

export interface HomeScreenProps {
  width: number;
  menu?: ReactNode;
  input: ReactNode;
  agentName: string;
  model: string;
  provider: string;
}

export function HomeScreen({ width, menu, input, agentName, model, provider }: HomeScreenProps) {
  const panelWidth = Math.max(40, Math.min(width - 4, 76));
  return (
    <Box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center" width="100%">
      <NeutronLogo />
      <Box marginTop={1} flexDirection="column" alignItems="center">
        {menu}
      </Box>
      <Box
        marginTop={1}
        borderStyle={borderStyle}
        borderColor="blue"
        paddingX={2}
        paddingY={1}
        width={panelWidth}
        minHeight={3}
      >
        {input}
      </Box>
      <Box marginTop={1}>
        <ModelLine agentName={agentName} model={model} provider={provider} />
      </Box>
    </Box>
  );
}
