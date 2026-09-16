import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli-entry.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node20",
  platform: "node",
  bundle: true,
  external: ["ink", "react", "react/jsx-runtime"],
  outDir: "dist",
});