import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  deps: {
    alwaysBundle: [/@tool-base\/.*/],
  },
  entry: "./src/index.ts",
  format: "esm",
  outDir: "./dist",
});
