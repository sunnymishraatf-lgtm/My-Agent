import { Box, Text } from "ink";

export function NeutronLogo() {
  return (
    <Box flexDirection="column" alignItems="center">
      <Text color="cyanBright" bold>
        NEUTRON
      </Text>
      <Text dimColor>Autonomous Software Maintenance Intelligence</Text>
    </Box>
  );
}

/** A tiny inline mark used in compact headers. */
export function NeutronGlyph() {
  return <Text color="cyanBright">▣</Text>;
}
