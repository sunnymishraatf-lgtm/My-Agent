import { Box, Text } from "ink";
import { UNICODE } from "./utils";

// The sun core is deliberately drawn with basic punctuation so it renders the
// same on CMD, Termux and every Unicode terminal. Colour provides the glow.
const ART = [
  "      \\   |   /      ",
  "       .-------.      ",
  "   --- (  (o)  ) ---  ",
  "       '-------'      ",
  "      /   |   \\      ",
];

/**
 * The Sunny brand mark: a compact sun / sunrise symbol (never the word
 * "SUNNY"), safe for 80-column terminals with an ASCII fallback.
 */
export function SunLogo() {
  return (
    <Box flexDirection="column" alignItems="center">
      {ART.map((line, i) => (
        <Text key={i} color={i === 2 ? "yellowBright" : "yellow"} bold={i === 2}>
          {line}
        </Text>
      ))}
      <Text color="yellowBright" bold>
        SUN
      </Text>
      <Text dimColor>AI SOFTWARE TEAM</Text>
    </Box>
  );
}

/** A tiny inline sun used in compact headers. */
export function SunGlyph() {
  return <Text color="yellowBright">{UNICODE ? "☀" : "(o)"}</Text>;
}
