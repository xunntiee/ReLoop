import { readFileSync } from "node:fs";

const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
const browserLaunch = readFileSync(
  new URL("../../apps/server/src/modules/crawl/browser-launch.ts", import.meta.url),
  "utf8",
);
const portableBuild = readFileSync(
  new URL("../build-portable.ps1", import.meta.url),
  "utf8",
);
const configServer = readFileSync(
  new URL("../../packages/config/src/server.ts", import.meta.url),
  "utf8",
);
const portableMacStart = readFileSync(
  new URL("../portable-mac/start-local-web.sh", import.meta.url),
  "utf8",
);

if (!browserLaunch.includes('const DEFAULT_BROWSER_CHANNELS = ["chrome", "msedge"];')) {
  throw new Error("Runtime browser channel priority list changed unexpectedly.");
}

if (browserLaunch.includes("options.headless !== false")) {
  throw new Error("Headless runtime should not bypass desktop browser channels.");
}

if (browserLaunch.includes("bundled Chromium")) {
  throw new Error("Runtime must not fall back to bundled Chromium.");
}

if (!browserLaunch.includes("Không tìm thấy Google Chrome hoặc Microsoft Edge")) {
  throw new Error("Runtime must explain the system browser requirement.");
}

if (
  portableBuild.includes("playwright install chromium") ||
  portableBuild.includes("PLAYWRIGHT_BROWSERS_PATH")
) {
  throw new Error("Portable build must not install, copy, or configure bundled Playwright browsers.");
}

if (/Copy-Item[\s\S]{0,200}ms-playwright/i.test(portableBuild)) {
  throw new Error("Portable build must not copy the Playwright browser cache.");
}

if (!configServer.includes("TOOL_USER_DATA_ROOT")) {
  throw new Error("Config loader must support an explicit portable user-data root.");
}

if (!portableBuild.includes("$env:TOOL_USER_DATA_ROOT = $UserDataRoot")) {
  throw new Error("Windows portable launcher must pass TOOL_USER_DATA_ROOT.");
}

if (!portableMacStart.includes('TOOL_USER_DATA_ROOT="${USER_DATA_ROOT}"')) {
  throw new Error("macOS portable launcher must pass TOOL_USER_DATA_ROOT.");
}

if (!portableBuild.includes('browserPriority = @("chrome", "msedge")')) {
  throw new Error("Portable manifest must document Chrome then Edge priority.");
}

if (!readme.includes("Threads login prefers Google Chrome")) {
  throw new Error("README is not aligned with login browser preference behavior.");
}

if (!readme.includes("Headless crawl prefers Google Chrome")) {
  throw new Error("README is not aligned with headless crawl browser behavior.");
}

if (!readme.includes("does not bundle Chromium")) {
  throw new Error("README must document the portable system browser requirement.");
}

console.log("smoke:browser-priority-docs ok");
