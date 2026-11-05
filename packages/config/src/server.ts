import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PORTAL_LICENSE_VERIFY_URL,
  type ToolConfig,
  toolConfigSchema,
} from "./schema";

export interface LoadedToolConfig {
  config: ToolConfig;
  configPath: string;
  exists: boolean;
  userSettingsPath: string;

}

export interface UserToolSettings {
  crawl?: {
    authStatePath?: string;
  };
  license?: {
    key?: string;
    sessionToken?: string;
    verifyUrls?: string[];
    verifyUrl?: string;
  };
  video?: {
    ausynclabApiKey?: string;
    fptAiApiKey?: string;
    googleCloudApiKey?: string;
    openAiApiKey?: string;
    thumbnailIntros?: Partial<
      Record<"automatic" | "advanced", Record<string, unknown> | null>
    >;
    vivibeApiKey?: string;
  };
}

export function normalizeVerifyUrl(input: string): string {
  let url = input.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
    parsed.pathname = path && path !== "/" ? path : "/api/v1/license/verify";
    if (!parsed.pathname.includes("/api/")) {
      parsed.pathname = `${parsed.pathname}/api/v1/license/verify`.replace(
        /\/{2,}/g,
        "/",
      );
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    url = url.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
    if (!url.includes("/api/")) {
      url = `${url}/api/v1/license/verify`;
    }
    return url;
  }
}

export function normalizeVerifyUrls(input: string | string[]): string[] {
  const values = Array.isArray(input) ? input : input.split(/[\r\n,]+/);
  return Array.from(
    new Set(
      values
        .map((value) => normalizeVerifyUrl(String(value ?? "")))
        .filter(Boolean),
    ),
  );
}

export function extractVerifyDomain(url: string): string {
  if (!url) return "";
  try {
    const fullUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const parsed = new URL(fullUrl);
    if (parsed.pathname === "/api/v1/license/verify" || parsed.pathname === "/" || parsed.pathname === "") {
      return parsed.host;
    }
    return url;
  } catch {
    return url;
  }
}

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

const USER_DATA_DIR_NAME = "ToolBase";

export const getDefaultConfigPath = (): string =>
  resolve(packageRoot, "config.json");

export const getExampleConfigPath = (): string =>
  resolve(packageRoot, "config.example.json");

export const resolveConfigPath = (): string => {
  if (process.env.SERVER_CONFIG_PATH) {
    return resolve(process.env.SERVER_CONFIG_PATH);
  }

  const defaultConfigPath = getDefaultConfigPath();
  return existsSync(defaultConfigPath)
    ? defaultConfigPath
    : getExampleConfigPath();
};

export const loadToolConfig = (): LoadedToolConfig => {
  const configPath = resolveConfigPath();
  const rawConfig = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  const baseConfig = toolConfigSchema.parse(rawConfig);
  const userSettingsPath = resolveUserSettingsPath();
  const userSettings = readUserToolSettings(userSettingsPath);

  return {
    config: applyUserSettings(baseConfig, userSettings),
    configPath,
    exists: existsSync(configPath),
    userSettingsPath,
  };
};

export const updateToolConfig = (
  updater: (config: ToolConfig) => ToolConfig
): LoadedToolConfig => {
  const loaded = loadToolConfig();
  const writablePath = getWritableConfigPath(loaded.configPath);
  const nextConfig = toolConfigSchema.parse(updater(loaded.config));

  writeFileSync(writablePath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");

  return {
    config: nextConfig,
    configPath: writablePath,
    exists: true,
    userSettingsPath: loaded.userSettingsPath,
  };
};

export const loadUserToolSettings = (): {
  path: string;
  settings: UserToolSettings;
} => {
  const path = resolveUserSettingsPath();
  return {
    path,
    settings: readUserToolSettings(path),
  };
};

export const updateUserToolSettings = (
  updater: (settings: UserToolSettings) => UserToolSettings
): {
  path: string;
  settings: UserToolSettings;
} => {
  const path = resolveUserSettingsPath();
  const current = readUserToolSettings(path);
  const next = sanitizeUserToolSettings(updater(current));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return {
    path,
    settings: next,
  };
};

export const getUserDataRoot = (): string => {
  const explicitRoot = process.env.TOOL_USER_DATA_ROOT?.trim();
  if (explicitRoot) {
    return resolve(explicitRoot);
  }
  const envRoot =
    process.env.APPDATA?.trim() ||
    process.env.LOCALAPPDATA?.trim() ||
    process.env.USERPROFILE?.trim();
  if (envRoot) {
    return resolve(envRoot, USER_DATA_DIR_NAME);
  }
  return resolve(packageRoot, ".local", USER_DATA_DIR_NAME);
};

export const getDefaultRuntimeAuthStatePath = (): string =>
  resolve(getUserDataRoot(), "storage", "auth", "default", "threads.storage_state.json");

export const resolveUserSettingsPath = (): string => {
  const preferredPath = resolve(getUserDataRoot(), "settings", "user-settings.json");
  const preferredSettings = readUserToolSettings(preferredPath);
  if (preferredSettings.license?.key?.trim()) {
    return preferredPath;
  }

  const roots = [
    process.env.LOCALAPPDATA?.trim(),
    process.env.APPDATA?.trim(),
    process.env.USERPROFILE?.trim(),
  ].filter(Boolean) as string[];
  for (const root of Array.from(new Set(roots))) {
    const candidate = resolve(root, USER_DATA_DIR_NAME, "settings", "user-settings.json");
    if (candidate === preferredPath || !existsSync(candidate)) continue;
    const settings = readUserToolSettings(candidate);
    if (settings.license?.key?.trim()) {
      return candidate;
    }
  }
  return preferredPath;
};

function getWritableConfigPath(currentPath: string): string {
  const defaultConfigPath = getDefaultConfigPath();
  const exampleConfigPath = getExampleConfigPath();
  const resolvedCurrentPath = resolve(currentPath);

  if (resolvedCurrentPath === resolve(exampleConfigPath)) {
    return defaultConfigPath;
  }

  return resolvedCurrentPath;
}

function readUserToolSettings(path: string): UserToolSettings {
  if (!existsSync(path)) return {};
  try {
    const payload = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return sanitizeUserToolSettings(isRecord(payload) ? (payload as UserToolSettings) : {});
  } catch {
    return {};
  }
}

function applyUserSettings(config: ToolConfig, userSettings: UserToolSettings): ToolConfig {
  const authStatePath = String(userSettings.crawl?.authStatePath ?? "").trim();

  return toolConfigSchema.parse({
    ...config,
    crawl: {
      ...config.crawl,
      authStatePath: authStatePath || config.crawl.authStatePath,
    },
    license: {
      ...config.license,
      verifyUrls: [PORTAL_LICENSE_VERIFY_URL],
      verifyUrl: PORTAL_LICENSE_VERIFY_URL,
    },
    video: {
      ...config.video,
      ausynclabApiKey:
        userSettings.video?.ausynclabApiKey !== undefined
          ? String(userSettings.video.ausynclabApiKey ?? "").trim()
          : config.video.ausynclabApiKey,
      fptAiApiKey:
        userSettings.video?.fptAiApiKey !== undefined
          ? String(userSettings.video.fptAiApiKey ?? "").trim()
          : config.video.fptAiApiKey,
      googleCloudApiKey:
        userSettings.video?.googleCloudApiKey !== undefined
          ? String(userSettings.video.googleCloudApiKey ?? "").trim()
          : config.video.googleCloudApiKey,
      openAiApiKey:
        userSettings.video?.openAiApiKey !== undefined
          ? String(userSettings.video.openAiApiKey ?? "").trim()
          : config.video.openAiApiKey,
      vivibeApiKey:
        userSettings.video?.vivibeApiKey !== undefined
          ? String(userSettings.video.vivibeApiKey ?? "").trim()
          : config.video.vivibeApiKey,
    },
  });
}

function sanitizeUserToolSettings(value: UserToolSettings): UserToolSettings {
  const next: UserToolSettings = {};
  if (value.crawl && "authStatePath" in value.crawl) {
    next.crawl = {
      authStatePath: String(value.crawl.authStatePath ?? "").trim(),
    };
  }

  if (value.license) {
    next.license = {};
    if ("key" in value.license) {
      next.license.key = String(value.license.key ?? "").trim();
    }
    if ("sessionToken" in value.license) {
      next.license.sessionToken = String(value.license.sessionToken ?? "").trim();
    }
    if ("verifyUrls" in value.license) {
      next.license.verifyUrls = normalizeVerifyUrls(
        Array.isArray(value.license.verifyUrls)
          ? value.license.verifyUrls
          : [],
      );
    }
    if ("verifyUrl" in value.license) {
      const rawUrl = String(value.license.verifyUrl ?? "").trim();
      const normalizedUrl = rawUrl ? normalizeVerifyUrl(rawUrl) : "";
      next.license.verifyUrl = normalizedUrl;
      if (!next.license.verifyUrls?.length && normalizedUrl) {
        next.license.verifyUrls = [normalizedUrl];
      }
    }
  }

  if (value.video) {
    const video: NonNullable<UserToolSettings["video"]> = {};
    if ("ausynclabApiKey" in value.video) {
      video.ausynclabApiKey = String(value.video.ausynclabApiKey ?? "").trim();
    }
    if ("fptAiApiKey" in value.video) {
      video.fptAiApiKey = String(value.video.fptAiApiKey ?? "").trim();
    }
    if ("googleCloudApiKey" in value.video) {
      video.googleCloudApiKey = String(value.video.googleCloudApiKey ?? "").trim();
    }
    if ("openAiApiKey" in value.video) {
      video.openAiApiKey = String(value.video.openAiApiKey ?? "").trim();
    }
    if ("thumbnailIntros" in value.video && isRecord(value.video.thumbnailIntros)) {
      const thumbnailIntros: NonNullable<
        NonNullable<UserToolSettings["video"]>["thumbnailIntros"]
      > = {};
      for (const mode of ["automatic", "advanced"] as const) {
        const thumbnailIntro = value.video.thumbnailIntros[mode];
        if (thumbnailIntro === null) {
          thumbnailIntros[mode] = null;
        } else if (isRecord(thumbnailIntro)) {
          thumbnailIntros[mode] = thumbnailIntro;
        }
      }
      if (Object.keys(thumbnailIntros).length > 0) {
        video.thumbnailIntros = thumbnailIntros;
      }
    }
    if ("vivibeApiKey" in value.video) {
      video.vivibeApiKey = String(value.video.vivibeApiKey ?? "").trim();
    }
    if (Object.keys(video).length > 0) {
      next.video = video;
    }
  }

  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
