import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/test/run-test.ts", "src/test/suite.ts"],
  format: ["cjs"],
  outDir: "dist/test",
  outExtension: () => ({ js: ".cjs" }),
  clean: false,
  dts: false,
  platform: "node",
  external: ["vscode"],
});
