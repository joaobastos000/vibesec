import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/extension.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  platform: "node",
  external: ["vscode"],
  noExternal: ["@vibeguard/core"],
});
