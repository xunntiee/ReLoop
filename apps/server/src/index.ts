import { serve } from "@hono/node-server";
import { loadToolConfig } from "@tool-base/config/server";
import { createServerRuntime } from "./app";

const loaded = loadToolConfig();
let requestShutdown: () => Promise<void> = () => Promise.resolve();
const runtime = createServerRuntime({
  config: loaded.config,
  configExists: loaded.exists,
  configPath: loaded.configPath,
  onShutdownRequested: () => requestShutdown(),
  userSettingsPath: loaded.userSettingsPath,
  webDistPath: process.env.WEB_DIST_PATH,
});

const server = serve(
  {
    fetch: runtime.app.fetch,
    hostname: "127.0.0.1",
    port: loaded.config.server.port,
  },
  (info) => {
    console.log(`Tool Base server is running on http://127.0.0.1:${info.port}`);
    console.log(`Config loaded from ${loaded.configPath}`);
    console.log(`User settings loaded from ${loaded.userSettingsPath}`);
  }
);
const connectionServer = server as typeof server & {
  closeAllConnections?: () => void;
  closeIdleConnections?: () => void;
};

let shutdownPromise: Promise<void> | null = null;
requestShutdown = (): Promise<void> => {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    console.log("[shutdown] Stopping server and active jobs...");
    const closePromise = new Promise<void>((resolvePromise) => {
      server.close(() => resolvePromise());
    });
    await runtime.shutdown();
    connectionServer.closeIdleConnections?.();

    const closedCleanly = await Promise.race([
      closePromise.then(() => true),
      new Promise<boolean>((resolvePromise) => {
        setTimeout(() => resolvePromise(false), 5000);
      }),
    ]);
    if (!closedCleanly) {
      connectionServer.closeAllConnections?.();
    }
    console.log("[shutdown] Server stopped.");
    process.exit(0);
  })();

  return shutdownPromise;
};

process.once("SIGINT", () => {
  requestShutdown().catch((error) => {
    console.error("[shutdown] SIGINT cleanup failed:", error);
  });
});
process.once("SIGTERM", () => {
  requestShutdown().catch((error) => {
    console.error("[shutdown] SIGTERM cleanup failed:", error);
  });
});
