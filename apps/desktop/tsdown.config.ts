import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  deps: {
    neverBundle: [/^electron$/],
  },
  entry: ["./src/main.ts"],
  format: "esm",
  outDir: "./dist",
});
