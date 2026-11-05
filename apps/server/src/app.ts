import { serveStatic } from "@hono/node-server/serve-static";
import { type ToolConfig, toPublicToolConfig } from "@tool-base/config/schema";
import {
  getUserDataRoot,
  loadToolConfig,
  loadUserToolSettings,
  normalizeVerifyUrls,
  updateUserToolSettings,
} from "@tool-base/config/server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createCrawlRoutes } from "./modules/crawl/routes.js";
import { CrawlRunService } from "./modules/crawl/service.js";
import { ThreadsSessionService } from "./modules/crawl/session.js";
import {
    clearLicenseCache,
    maskLicenseKey,
    verifyLicense,
} from "./modules/license/odoo-license.js";
import { createVideoRoutes } from "./modules/video/routes.js";
import { VideoDraftService } from "./modules/video/service.js";

export interface ServerAppOptions {
  config: ToolConfig;
  configExists: boolean;
  configPath: string;
  onShutdownRequested?: () => Promise<void> | void;
  userSettingsPath?: string;
  webDistPath?: string;
}

export interface ServerRuntime {
  app: Hono;
  isShuttingDown: () => boolean;
  shutdown: () => Promise<void>;
}

export const createServerApp = (options: ServerAppOptions): Hono =>
  createServerRuntime(options).app;

export const createServerRuntime = (
  options: ServerAppOptions,
): ServerRuntime => {
  const app = new Hono();
  let currentConfig = options.config;
  let currentConfigPath = options.configPath;
  let currentConfigExists = options.configExists;
  let currentUserSettingsPath =
    options.userSettingsPath ?? loadUserToolSettings().path;
  const crawlService = new CrawlRunService({
    config: currentConfig,
    configPath: currentConfigPath,
  });
  const sessionService = new ThreadsSessionService({
    config: currentConfig,
    configPath: currentConfigPath,
  });
  const videoService = new VideoDraftService({
    config: currentConfig,
    configPath: currentConfigPath,
  });
  let shutdownPromise: Promise<void> | null = null;
  let shutdownRequested = false;

  const shutdown = (): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    shutdownRequested = true;
    shutdownPromise = Promise.allSettled([
      crawlService.shutdown(),
      sessionService.shutdown(),
      videoService.shutdown(),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          console.error("[shutdown] Service cleanup failed:", result.reason);
        }
      }
    });
    return shutdownPromise;
  };

  // Media previews can generate many requests for one screen. Logging every
  // image/video request adds synchronous console/file I/O in the local and
  // portable launchers, so keep the request logger on API traffic only.
  app.use("/api/*", logger());

  app.use("*", async (c, next) => {
    const path = c.req.path;
    if (!path.startsWith("/api/") || isLicenseExemptApiPath(path)) {
      await next();
      return;
    }

    refreshRuntimeConfig();

    const settings = loadUserToolSettings().settings;
    const licenseKey = String(settings.license?.key ?? "").trim();
    const status = await verifyLicense(currentConfig, licenseKey);
    if (status.valid && status.allowed) {
      await next();
      return;
    }

    return c.json(
      {
        error: status.message,
        license: status,
      },
      403,
    );
  });

  const refreshRuntimeConfig = () => {
    const loaded = loadToolConfig();
    currentConfig = loaded.config;
    currentConfigPath = loaded.configPath;
    currentConfigExists = loaded.exists;
    currentUserSettingsPath = loaded.userSettingsPath;
    syncConfigObject(options.config, loaded.config);
  };

  app.use("*", async (c, next) => {
    const path = c.req.path;
    if (!path.startsWith("/api/") || isSetupExemptApiPath(path)) {
      await next();
      return;
    }

    const session = sessionService.getStatus();
    const threadsReady = session.status === "ready";
    const voiceApiConfigured = hasConfiguredVoiceApi(currentConfig);

    if (threadsReady && voiceApiConfigured) {
      await next();
      return;
    }

    const missing = [
      !threadsReady ? "Đăng nhập Threads" : "",
      !voiceApiConfigured ? "ít nhất một Voice API key" : "",
    ].filter(Boolean);

    return c.json(
      {
        error: `Cần hoàn tất ${missing.join(" và ")} trước khi sử dụng tool.`,
        prerequisites: {
          threadsReady,
          voiceApiConfigured,
        },
      },
      428,
    );
  });

  app.get("/", (c) => c.text("Tool Base API"));
  app.get("/api/health", (c) =>
    c.json({
      service: "tool-base",
      status: shutdownRequested ? "stopping" : "ok",
    }),
  );
  app.get("/api/system/update/status", (c) => {
    const update = resolvePortableUpdateContext();
    if (!update) {
      return c.json({
        available: false,
        currentVersion: "dev",
        message: "Cập nhật ZIP chỉ khả dụng trong bản portable.",
        portable: false,
      });
    }

    return c.json({
      available: true,
      currentVersion: update.version,
      message: "Có thể import file ZIP để cập nhật.",
      platform: update.platform,
      portable: true,
    });
  });
  app.post("/api/system/update/import", async (c) => {
    const update = resolvePortableUpdateContext();
    if (!update) {
      return c.json(
        { error: "Chức năng cập nhật ZIP chỉ khả dụng trong bản portable." },
        400,
      );
    }

    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json({ error: "Hãy chọn một file ZIP của Tool." }, 400);
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      return c.json({ error: "File cập nhật phải có định dạng .zip." }, 400);
    }
    if (file.size <= 0 || file.size > 1_500 * 1024 * 1024) {
      return c.json({ error: "Kích thước file ZIP không hợp lệ." }, 400);
    }

    const updateRoot = join(getUserDataRoot(), "updates");
    const updateId = `update-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const zipPath = join(updateRoot, `${updateId}.zip`);
    const updaterPath = join(
      updateRoot,
      process.platform === "win32" ? `${updateId}.ps1` : `${updateId}.sh`,
    );

    try {
      await mkdir(updateRoot, { recursive: true });
      await writeFile(zipPath, Buffer.from(await file.arrayBuffer()));
      await copyFile(update.scriptPath, updaterPath);

      const child =
        process.platform === "win32"
          ? spawn(
              "powershell.exe",
              [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                updaterPath,
                "-ZipPath",
                zipPath,
                "-BundlePath",
                update.bundlePath,
                "-Port",
                String(currentConfig.server.port),
              ],
              {
                cwd: updateRoot,
                detached: true,
                stdio: "ignore",
                windowsHide: true,
              },
            )
          : spawn(
              "/bin/bash",
              [updaterPath, zipPath, update.bundlePath, String(currentConfig.server.port)],
              { detached: true, stdio: "ignore" },
            );
      child.unref();

      setTimeout(() => {
        Promise.resolve(options.onShutdownRequested?.()).catch((error) => {
          console.error("[update] Shutdown before update failed:", error);
        });
      }, 250);

      return c.json(
        {
          currentVersion: update.version,
          message: "Đã nhận file ZIP. Tool sẽ tự đóng, cập nhật và mở lại.",
          ok: true,
        },
        202,
      );
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });
  app.post("/api/system/shutdown", (c) => {
    const expectedToken = String(process.env.TOOL_SHUTDOWN_TOKEN ?? "").trim();
    const suppliedToken = String(
      c.req.header("x-tool-shutdown-token") ?? "",
    ).trim();
    if (!isValidShutdownToken(suppliedToken, expectedToken)) {
      return c.json({ error: "Shutdown token không hợp lệ." }, 403);
    }

    if (!shutdownRequested) {
      shutdownRequested = true;
      setTimeout(() => {
        Promise.resolve(options.onShutdownRequested?.()).catch((error) => {
          console.error("[shutdown] Shutdown request failed:", error);
        });
      }, 25);
    }
    return c.json({ ok: true, status: "stopping" }, 202);
  });
  app.get("/api/config", async (c) => {
    refreshRuntimeConfig();
    return c.json(
      await buildConfigResponse(
        currentConfig,
        currentConfigExists,
        currentConfigPath,
        currentUserSettingsPath,
      ),
    );
  });
  app.patch("/api/config/license", async (c) => {
    refreshRuntimeConfig();
    const parsed = updateLicenseSchema.safeParse(await readJsonBody(c.req));
    if (!parsed.success) {
      return c.json(
        {
          error: "Payload cài đặt license không hợp lệ.",
          issues: parsed.error.issues,
        },
        400,
      );
    }

    if (
      parsed.data.licenseKey === undefined &&
      parsed.data.verifyUrl === undefined &&
      parsed.data.verifyUrls === undefined
    ) {
      return c.json({ error: "Không có thay đổi nào để lưu." }, 400);
    }

    try {
      const loadedSettings = loadUserToolSettings().settings;
      const currentLicenseKey = String(loadedSettings.license?.key ?? "").trim();
      const nextLicenseKey =
        parsed.data.licenseKey !== undefined
          ? parsed.data.licenseKey.trim()
          : currentLicenseKey;
      const nextVerifyUrls =
        parsed.data.verifyUrls !== undefined
          ? normalizeVerifyUrls(parsed.data.verifyUrls)
          : parsed.data.verifyUrl !== undefined
            ? normalizeVerifyUrls(parsed.data.verifyUrl)
            : undefined;
      const nextVerifyUrl = nextVerifyUrls?.[0];

      const candidateConfig = {
        ...currentConfig,
        license: {
          ...currentConfig.license,
          ...(nextVerifyUrl !== undefined
            ? { verifyUrl: nextVerifyUrl || currentConfig.license.verifyUrl }
            : {}),
          ...(nextVerifyUrls !== undefined
            ? { verifyUrls: nextVerifyUrls }
            : {}),
        },
      };

      let sessionToken = "";
      clearLicenseCache();

      if (nextLicenseKey) {
        const result = await verifyLicense(candidateConfig, nextLicenseKey, {
          bypassCache: true,
        });
        if (!result.valid || !result.allowed) {
          const statusCode = result.reason === "network_error" ? 503 : 400;
          return c.json(
            {
              error: result.message || "License key không hợp lệ.",
              license: {
                reason: result.reason,
                valid: result.valid && result.allowed,
              },
            },
            statusCode,
          );
        }
        sessionToken = result.sessionToken || "";
      }
      updateUserToolSettings((settings) => ({
        ...settings,
        license: {
          ...settings.license,
          key: nextLicenseKey,
          sessionToken: nextLicenseKey ? sessionToken : "",
          ...(nextVerifyUrl !== undefined ? { verifyUrl: nextVerifyUrl } : {}),
          ...(nextVerifyUrls !== undefined ? { verifyUrls: nextVerifyUrls } : {}),
        },
      }));
      clearLicenseCache();
      refreshRuntimeConfig();

      return c.json(
        await buildConfigResponse(
          currentConfig,
          currentConfigExists,
          currentConfigPath,
          currentUserSettingsPath,
        ),
      );
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }
  });
  app.patch("/api/config/credentials", async (c) => {
    refreshRuntimeConfig();
    const parsed = updateConfigCredentialsSchema.safeParse(
      await readJsonBody(c.req),
    );
    if (!parsed.success) {
      return c.json(
        {
          error: "Payload cài đặt API key không hợp lệ.",
          issues: parsed.error.issues,
        },
        400,
      );
    }

    const hasAnyUpdate =
      parsed.data.ausynclabApiKey !== undefined ||
      parsed.data.fptAiApiKey !== undefined ||
      parsed.data.googleCloudApiKey !== undefined ||
      parsed.data.openAiApiKey !== undefined ||
      parsed.data.vivibeApiKey !== undefined;
    if (!hasAnyUpdate) {
      return c.json({ error: "Không có thay đổi nào để lưu." }, 400);
    }

    try {
      updateUserToolSettings((settings) => ({
        ...settings,
        video: {
          ...settings.video,
          ...(parsed.data.ausynclabApiKey !== undefined
            ? { ausynclabApiKey: parsed.data.ausynclabApiKey.trim() }
            : {}),
          ...(parsed.data.fptAiApiKey !== undefined
            ? { fptAiApiKey: parsed.data.fptAiApiKey.trim() }
            : {}),
          ...(parsed.data.googleCloudApiKey !== undefined
            ? { googleCloudApiKey: parsed.data.googleCloudApiKey.trim() }
            : {}),
          ...(parsed.data.openAiApiKey !== undefined
            ? { openAiApiKey: parsed.data.openAiApiKey.trim() }
            : {}),
          ...(parsed.data.vivibeApiKey !== undefined
            ? { vivibeApiKey: parsed.data.vivibeApiKey.trim() }
            : {}),
        },
      }));
      refreshRuntimeConfig();

      return c.json(
        await buildConfigResponse(
          currentConfig,
          currentConfigExists,
          currentConfigPath,
          currentUserSettingsPath,
        ),
      );
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }
  });
  app.post("/api/config/credentials/test", async (c) => {
    const parsed = testCredentialSchema.safeParse(await readJsonBody(c.req));
    if (!parsed.success) {
      return c.json(
        {
          error: "Payload kiểm tra API key không hợp lệ.",
          issues: parsed.error.issues,
        },
        400,
      );
    }

    try {
      const testConfig = withCredentialOverrides(currentConfig, parsed.data);
      const result = await testCredentialConnection(
        testConfig,
        parsed.data.provider,
      );
      return c.json(result);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
          ok: false,
          provider: parsed.data.provider,
        },
        400,
      );
    }
  });
  app.get("/api/video/thumbnail-settings", (c) => {
    const parsedMode = videoThumbnailModeSchema.safeParse(c.req.query("mode"));
    if (!parsedMode.success) {
      return c.json({ error: "Chế độ thumbnail không hợp lệ." }, 400);
    }

    const thumbnailIntro =
      loadUserToolSettings().settings.video?.thumbnailIntros?.[parsedMode.data] ??
      null;
    return c.json({
      mode: parsedMode.data,
      thumbnailIntro,
    });
  });
  app.patch("/api/video/thumbnail-settings", async (c) => {
    const parsed = updateVideoThumbnailSettingsSchema.safeParse(
      await readJsonBody(c.req),
    );
    if (!parsed.success) {
      return c.json(
        {
          error: "Payload cài đặt thumbnail không hợp lệ.",
          issues: parsed.error.issues,
        },
        400,
      );
    }

    try {
      updateUserToolSettings((settings) => ({
        ...settings,
        video: {
          ...settings.video,
          thumbnailIntros: {
            ...settings.video?.thumbnailIntros,
            [parsed.data.mode]: parsed.data.thumbnailIntro,
          },
        },
      }));
      return c.json({
        mode: parsed.data.mode,
        thumbnailIntro: parsed.data.thumbnailIntro,
      });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }
  });
  app.get("/api/sample", (c) =>
    c.json({
      description: "Sample endpoint. Replace with tool-specific routes.",
      enabled: currentConfig.features.sampleApi,
      items: currentConfig.features.sampleApi
        ? [
            { id: "server", label: "Hono API shell" },
            { id: "web", label: "TanStack Router + Query shell" },
            { id: "config", label: "JSON config loader" },
          ]
        : [],
      serverName: currentConfig.server.name,
    }),
  );
  app.route(
    "/api/crawl",
    createCrawlRoutes({
      config: options.config,
      configPath: options.configPath,
      service: crawlService,
      sessionService,
    }),
  );
  app.route(
    "/api/video",
    createVideoRoutes({
      config: options.config,
      configPath: options.configPath,
      service: videoService,
    }),
  );

  mountMediaFiles(
    app,
    () => dirname(currentConfigPath),
    () => currentConfig,
  );
  mountWebApp(app, options.webDistPath ?? defaultWebDistPath);

  return {
    app,
    isShuttingDown: () => shutdownRequested,
    shutdown,
  };
};

const updateConfigCredentialsSchema = z
  .object({
    ausynclabApiKey: z.string().max(2_000).optional(),
    fptAiApiKey: z.string().max(2_000).optional(),
    googleCloudApiKey: z.string().max(2_000).optional(),
    openAiApiKey: z.string().max(2_000).optional(),
    vivibeApiKey: z.string().max(2_000).optional(),
  })
  .strict();

const videoThumbnailModeSchema = z.enum(["automatic", "advanced"]);
const updateVideoThumbnailSettingsSchema = z
  .object({
    mode: videoThumbnailModeSchema,
    thumbnailIntro: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();

const updateLicenseSchema = z
  .object({
    licenseKey: z.string().max(2_000).optional(),
    verifyUrls: z.array(z.string().max(2_000)).max(20).optional(),
    verifyUrl: z.string().max(2_000).optional(),
  })
  .strict();

const testCredentialSchema = z
  .object({
    ausynclabApiKey: z.string().max(2_000).optional(),
    fptAiApiKey: z.string().max(2_000).optional(),
    googleCloudApiKey: z.string().max(2_000).optional(),
    openAiApiKey: z.string().max(2_000).optional(),
    provider: z.enum(["ausynclab", "fpt", "google", "openai", "vivibe"]),
    vivibeApiKey: z.string().max(2_000).optional(),
  })
  .strict();

const defaultWebDistPath = fileURLToPath(
  new URL("../../web/dist", import.meta.url),
);
const appPathPrefixPattern = /^\/app/;
const mediaPathPrefixPattern = /^\/media\//;

const mountWebApp = (app: Hono, webDistPath: string): void => {
  if (!existsSync(webDistPath)) {
    return;
  }

  app.use(
    "/app/*",
    serveStatic({
      rewriteRequestPath: (path) =>
        path.replace(appPathPrefixPattern, "") || "/",
      root: webDistPath,
    }),
  );
  app.get(
    "/app",
    serveStatic({
      path: "index.html",
      root: webDistPath,
    }),
  );
  app.get(
    "/app/*",
    serveStatic({
      path: "index.html",
      root: webDistPath,
    }),
  );
};

const mountMediaFiles = (
  app: Hono,
  getBaseDir: () => string,
  getConfig: () => ToolConfig,
): void => {
  app.get("/media/*", (c) => {
    const rawMediaPath = c.req.path.replace(mediaPathPrefixPattern, "");
    const mediaPath = decodeMediaPath(rawMediaPath);
    if (!mediaPath || !isAllowedMediaExtension(mediaPath)) {
      return c.notFound();
    }

    const baseDir = resolve(getBaseDir());
    const filePath = resolve(baseDir, mediaPath);
    if (!isAllowedMediaFile(filePath, baseDir, getConfig())) {
      return c.notFound();
    }

    try {
      const info = statSync(filePath);
      if (!info.isFile()) {
        return c.notFound();
      }

      return streamLocalMediaFile(filePath, info.size, {
        contentType: contentTypeForMediaPath(filePath),
        downloadFilename:
          c.req.query("download") === "1" ? basename(filePath) : undefined,
        range: c.req.header("range"),
      });
    } catch {
      return c.notFound();
    }
  });
};

function decodeMediaPath(value: string): string {
  try {
    return decodeURIComponent(value).replace(/\\/g, "/").replace(/^\/+/, "");
  } catch {
    return "";
  }
}

function isAllowedMediaFile(
  filePath: string,
  baseDir: string,
  config: ToolConfig,
): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  const realFilePath = realpathSync(filePath);
  const allowedRoots = buildAllowedMediaRoots(baseDir, config)
    .filter((root) => existsSync(root))
    .map((root) => realpathSync(root));

  return allowedRoots.some((root) => isPathInside(realFilePath, root));
}

function buildAllowedMediaRoots(baseDir: string, config: ToolConfig): string[] {
  return uniquePaths([
    resolve(baseDir, config.crawl.assetDir),
    resolve(baseDir, config.video.audioDir),
    resolve(baseDir, config.video.rendersDir),
    resolve(baseDir, config.video.uploadsDir),
    resolve(baseDir, "data", "config"),
    resolve(baseDir, "exported_videos"),
  ]);
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of paths) {
    const normalized = resolve(path).toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(resolve(path));
  }
  return unique;
}

function isPathInside(filePath: string, rootPath: string): boolean {
  const rel = relative(rootPath, filePath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isAllowedMediaExtension(filePath: string): boolean {
  return allowedMediaExtensions.has(extname(filePath).toLowerCase());
}

const allowedMediaExtensions = new Set([
  ".aac",
  ".apng",
  ".avi",
  ".avif",
  ".bmp",
  ".flac",
  ".gif",
  ".jfif",
  ".jpg",
  ".jpeg",
  ".m4a",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".opus",
  ".png",
  ".wav",
  ".webm",
  ".webp",
]);

function contentTypeForMediaPath(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  const known: Record<string, string> = {
    ".aac": "audio/aac",
    ".apng": "image/apng",
    ".avi": "video/x-msvideo",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".flac": "audio/flac",
    ".gif": "image/gif",
    ".jfif": "image/jpeg",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".m4a": "audio/mp4",
    ".m4v": "video/mp4",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".png": "image/png",
    ".wav": "audio/wav",
    ".webm": "video/webm",
    ".webp": "image/webp",
  };
  return known[extension] ?? "application/octet-stream";
}

function streamLocalMediaFile(
  filePath: string,
  fileSize: number,
  options: {
    contentType: string;
    downloadFilename?: string;
    range?: string;
  },
): Response {
  const range = parseByteRange(options.range, fileSize);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400",
    "Content-Type": options.contentType,
  });
  if (options.downloadFilename) {
    headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(options.downloadFilename)}`,
    );
  }

  if (!range) {
    headers.set("Content-Length", String(fileSize));
    return new Response(nodeStreamBody(createReadStream(filePath)), {
      headers,
      status: 200,
    });
  }

  headers.set("Content-Length", String(range.end - range.start + 1));
  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${fileSize}`);
  return new Response(
    nodeStreamBody(
      createReadStream(filePath, { end: range.end, start: range.start }),
    ),
    {
      headers,
      status: 206,
    },
  );
}

function parseByteRange(
  rangeHeader: string | undefined,
  fileSize: number,
): { end: number; start: number } | null {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }

  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (!startText && !endText) {
    return null;
  }

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    const start = Math.max(0, fileSize - suffixLength);
    return {
      end: Math.max(0, fileSize - 1),
      start,
    };
  }

  const start = Number(startText);
  const explicitEnd = endText ? Number(endText) : fileSize - 1;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(explicitEnd) ||
    start < 0 ||
    explicitEnd < start ||
    start >= fileSize
  ) {
    return null;
  }

  return {
    end: Math.min(explicitEnd, Math.max(0, fileSize - 1)),
    start,
  };
}

function nodeStreamBody(
  stream: ReturnType<typeof createReadStream>,
): ReadableStream {
  return Readable.toWeb(stream) as ReadableStream;
}

async function readJsonBody(request: {
  json: () => Promise<unknown>;
}): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function syncConfigObject(target: ToolConfig, source: ToolConfig): void {
  for (const key of Object.keys(target)) {
    delete target[key as keyof ToolConfig];
  }
  Object.assign(target, structuredClone(source));
}

function withCredentialOverrides(
  config: ToolConfig,
  payload: z.infer<typeof testCredentialSchema>,
): ToolConfig {
  return {
    ...config,
    video: {
      ...config.video,
      ...(payload.ausynclabApiKey !== undefined
        ? { ausynclabApiKey: payload.ausynclabApiKey.trim() }
        : {}),
      ...(payload.fptAiApiKey !== undefined
        ? { fptAiApiKey: payload.fptAiApiKey.trim() }
        : {}),
      ...(payload.googleCloudApiKey !== undefined
        ? { googleCloudApiKey: payload.googleCloudApiKey.trim() }
        : {}),
      ...(payload.openAiApiKey !== undefined
        ? { openAiApiKey: payload.openAiApiKey.trim() }
        : {}),
      ...(payload.vivibeApiKey !== undefined
        ? { vivibeApiKey: payload.vivibeApiKey.trim() }
        : {}),
    },
  };
}

async function buildConfigResponse(
  config: ToolConfig,
  exists: boolean,
  configPath: string,
  userSettingsPath: string,
): Promise<{
  config: ReturnType<typeof toPublicToolConfig>;
  configPath: string;
  credentials: {
    ausynclabApiKeyConfigured: boolean;
    fptAiApiKeyConfigured: boolean;
    googleCloudApiKeyConfigured: boolean;
    openAiApiKeyConfigured: boolean;
    vivibeApiKeyConfigured: boolean;
  };
  exists: boolean;
  license: {
    checkedAt: string;
    configured: boolean;
    employeeName: string;
    expiresAt: string;
    keyPreview: string;
    message: string;
    reason: string;
    valid: boolean;
  };
  runtime: {
    threadsAuthStatePath: string;
    userDataRoot: string;
    userSettingsPath: string;
  };
}> {
  const userSettings = loadUserToolSettings().settings;
  const licenseKey = String(userSettings.license?.key ?? "").trim();
  const licenseStatus = await verifyLicense(config, licenseKey);

  return {
    config: toPublicToolConfig(config),
    configPath,
    credentials: {
      ausynclabApiKeyConfigured: config.video.ausynclabApiKey.trim().length > 0,
      fptAiApiKeyConfigured: config.video.fptAiApiKey.trim().length > 0,
      googleCloudApiKeyConfigured:
        config.video.googleCloudApiKey.trim().length > 0,
      openAiApiKeyConfigured: config.video.openAiApiKey.trim().length > 0,
      vivibeApiKeyConfigured: config.video.vivibeApiKey.trim().length > 0,
    },
    exists,
    license: {
      checkedAt: licenseStatus.checkedAt,
      configured: licenseKey.length > 0,
      employeeName: licenseStatus.employeeName,
      expiresAt: licenseStatus.expiresAt,
      keyPreview: licenseStatus.keyPreview || maskLicenseKey(licenseKey),
      message: licenseStatus.message,
      reason: licenseStatus.reason,
      valid: licenseStatus.valid && licenseStatus.allowed,
    },
    runtime: {
      threadsAuthStatePath: config.crawl.authStatePath,
      userDataRoot: getUserDataRoot(),
      userSettingsPath,
    },
  };
}

async function testCredentialConnection(
  config: ToolConfig,
  provider: "ausynclab" | "fpt" | "google" | "openai" | "vivibe",
): Promise<{
  message: string;
  ok: true;
  provider: "ausynclab" | "fpt" | "google" | "openai" | "vivibe";
}> {
  if (provider === "ausynclab") {
    // Currently fake testing until we add full provider
    return {
      message: "Đã lưu AuSyncLab API key trên máy này.",
      ok: true,
      provider,
    };
  }

  if (provider === "fpt") {
    const { FptAiTtsClient } = await import("./modules/video/fpt-ai-tts.js");
    const client = new FptAiTtsClient(config.video);
    await client.synthesize("Xin chao", {
      provider: "fpt_ai",
      languageCode: "vi-VN",
      pitch: 0,
      speakingRate: 1,
      ssmlGender: "FEMALE",
      voiceName: config.video.fptAiVoiceName || "banmai",
    });
    return {
      message: "Đã kết nối được FPT AI TTS trên máy này.",
      ok: true,
      provider,
    };
  }

  if (provider === "vivibe") {
    const { VivibeTtsClient } = await import("./modules/video/vivibe-tts.js");
    const client = new VivibeTtsClient(config.video);
    const voices = await client.listVoices();
    return {
      message:
        voices.length > 0
          ? `Da ket noi duoc ViVibe va tim thay ${voices.length} voice.`
          : "Đã kết nối được ViVibe",
      ok: true,
      provider,
    };
  }

  if (provider === "openai") {
    if (!config.video.openAiApiKey.trim()) {
      throw new Error("Chua co LLM API key tren may nay.");
    }

    const response = await fetch(
      `${config.video.openAiBaseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.video.openAiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.video.openAiModel,
          max_tokens: 32,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: "Reply with OK only.",
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      const normalizedBody = body.toLowerCase();
      if (
        response.status === 429 &&
        (normalizedBody.includes("quota") || normalizedBody.includes("billing"))
      ) {
        throw new Error(
          [
            "Gemini Text da luu key thanh cong nhung project/tai khoan Gemini dang het quota hoac chua bat billing.",
            `Model hien tai: ${config.video.openAiModel}.`,
            "Hay kiem tra billing va quota trong Google AI Studio/Google Cloud roi thu lai.",
          ].join(" "),
        );
      }
      throw new Error(
        `Khong ket noi duoc text model qua OpenAI-compatible API: ${response.status} ${body}`.slice(
          0,
          240,
        ),
      );
    }

    return {
      message: `Da ket noi duoc text model ${config.video.openAiModel} qua OpenAI-compatible API.`,
      ok: true,
      provider,
    };
  }

  const { GoogleCloudTtsClient } =
    await import("./modules/video/google-cloud-tts.js");
  const client = new GoogleCloudTtsClient(config.video);
  await client.synthesize("Xin chao", {
    provider: "google_cloud",
    languageCode: config.video.googleCloudLanguageCode,
    pitch: config.video.googleCloudPitch,
    speakingRate: config.video.googleCloudSpeakingRate,
    ssmlGender: config.video.googleCloudSsmlGender,
    voiceName: config.video.googleCloudVoiceName,
  });
  return {
    message: "Đã kết nối được Google Cloud TTS trên máy này.",
    ok: true,
    provider,
  };
}

function formatTextModelConnectionError(
  status: number,
  body: string,
  config: ToolConfig,
): string {
  const loweredBody = String(body ?? "").toLowerCase();
  const baseUrl = config.video.openAiBaseUrl;
  const isGemini = baseUrl.includes("generativelanguage.googleapis.com");

  if (
    status === 400 &&
    (loweredBody.includes("valid api key") ||
      loweredBody.includes("invalid_argument"))
  ) {
    return isGemini
      ? "Gemini API key không hợp lệ. Hãy dán key từ Google AI Studio dạng AIza..., không dùng OpenRouter/OpenAI key."
      : "LLM API key không hợp lệ với provider hiện tại. Kiểm tra lại key, base URL và model.";
  }

  if (status === 401 || status === 403) {
    return "Provider từ chối API key. Kiểm tra lại key, quyền truy cập model và base URL.";
  }

  if (
    status === 429 ||
    loweredBody.includes("quota") ||
    loweredBody.includes("rate limit")
  ) {
    return "Provider trả 429: hết quota hoặc rate limit. Kiểm tra billing/quota/API key.";
  }

  if (status >= 500) {
    return `Provider text model đang lỗi (${status}). Thử lại sau hoặc đổi model/provider.`;
  }

  return `Không kết nối được text model qua OpenAI-compatible API: HTTP ${status}. Kiểm tra model, base URL và API key.`;
}

function isLicenseExemptApiPath(path: string): boolean {
  return (
    path === "/api/health" ||
    path === "/api/system/shutdown" ||
    path === "/api/system/update/status" ||
    path === "/api/system/update/import" ||
    path === "/api/config" ||
    path === "/api/config/license"
  );
}

function isValidShutdownToken(
  suppliedToken: string,
  expectedToken: string,
): boolean {
  if (!(suppliedToken && expectedToken)) {
    return false;
  }
  const supplied = Buffer.from(suppliedToken, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function isSetupExemptApiPath(path: string): boolean {
  return (
    isLicenseExemptApiPath(path) ||
    path === "/api/config/credentials" ||
    path === "/api/config/credentials/test" ||
    path === "/api/crawl/browser/health" ||
    path === "/api/crawl/session" ||
    path === "/api/crawl/session/login" ||
    path === "/api/crawl/session/logout" ||
    path === "/api/crawl/session/test" ||
    path === "/api/video/abbreviations" ||
    path === "/api/video/abbreviations/import-url"
  );
}

function hasConfiguredVoiceApi(config: ToolConfig): boolean {
  return [
    config.video.ausynclabApiKey,
    config.video.fptAiApiKey,
    config.video.googleCloudApiKey,
    config.video.vivibeApiKey,
  ].some((value) => value.trim().length > 0);
}

interface PortableUpdateContext {
  bundlePath: string;
  platform: "windows" | "macos";
  scriptPath: string;
  version: string;
}

function resolvePortableUpdateContext(): PortableUpdateContext | null {
  const bundlePath = String(process.env.TOOL_BUNDLE_ROOT ?? "").trim();
  const scriptPath = String(process.env.TOOL_UPDATE_SCRIPT ?? "").trim();
  if (!bundlePath || !scriptPath || !existsSync(bundlePath) || !existsSync(scriptPath)) {
    return null;
  }

  const manifestPath = join(bundlePath, "_tool-runtime", "build-manifest.json");
  let version = "unknown";
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      releaseLabel?: string;
      version?: string;
    };
    version = String(manifest.version ?? manifest.releaseLabel ?? "unknown").trim() || "unknown";
  } catch {
    // A legacy portable package can still update; the updater validates the ZIP.
  }

  return {
    bundlePath,
    platform: process.platform === "win32" ? "windows" : "macos",
    scriptPath,
    version,
  };
}
