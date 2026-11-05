import { readFileSync } from "node:fs";

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const app = read("../../apps/server/src/app.ts");
const index = read("../../apps/server/src/index.ts");
const crawlService = read("../../apps/server/src/modules/crawl/service.ts");
const sessionService = read("../../apps/server/src/modules/crawl/session.ts");
const videoService = read("../../apps/server/src/modules/video/service.ts");
const portableBuild = read("../build-portable.ps1");

const requiredChecks: [boolean, string][] = [
  [
    app.includes('app.post("/api/system/shutdown"'),
    "Server must expose the authenticated shutdown endpoint.",
  ],
  [
    app.includes("timingSafeEqual"),
    "Shutdown tokens must use constant-time comparison.",
  ],
  [
    index.includes('process.once("SIGTERM"') &&
      index.includes('process.once("SIGINT"'),
    "Server must handle process shutdown signals.",
  ],
  [
    crawlService.includes("async shutdown(") &&
      crawlService.includes("this.activeItem.controller.abort()"),
    "Crawl service must cancel and drain active work.",
  ],
  [
    sessionService.includes("async shutdown(") &&
      sessionService.includes("activeBrowserClosers"),
    "Threads session service must close active browsers.",
  ],
  [
    videoService.includes("async shutdown(") &&
      videoService.includes("stopVideoRuntimeProcesses"),
    "Video service must stop active renderer processes.",
  ],
  [
    portableBuild.includes('"Local\\ToolBase-Launcher"'),
    "OPEN and STOP must coordinate through one fixed lifecycle mutex.",
  ],
  [
    portableBuild.includes("$managedProcess -and -not $serverHealthy"),
    "Launcher must reject a port change while the previous server is alive.",
  ],
  [
    portableBuild.includes("Show-LauncherError") &&
      portableBuild.includes("System.Windows.Forms.MessageBox"),
    "Hidden launcher failures must be shown to the user.",
  ],
  [
    portableBuild.includes("Assert-PortableBundleNotRunning"),
    "Build must fail early when the previous portable is still running.",
  ],
  [
    portableBuild.includes("requiredArchiveEntries") &&
      portableBuild.includes("forbiddenBrowserEntry"),
    "Build must validate required payload and reject bundled browser files.",
  ],
  [
    portableBuild.includes("New-PortableZipArchive") &&
      portableBuild.includes("System.IO.Compression.ZipFile"),
    "Build must create ZIPs without relying on the stalled Windows tar path.",
  ],
];

for (const [ok, message] of requiredChecks) {
  if (!ok) {
    throw new Error(message);
  }
}

console.log("smoke:portable-lifecycle ok");
