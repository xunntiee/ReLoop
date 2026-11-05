import { existsSync, readFileSync } from "node:fs";
import type { BrowserContext } from "playwright";

type StorageState = {
  cookies?: Array<Record<string, unknown>>;
  origins?: Array<{
    origin?: string;
    localStorage?: Array<{ name?: string; value?: string }>;
  }>;
};

export function createAuthApplicator(
  authStatePath: string,
): (context: BrowserContext) => Promise<void> {
  const applied = new WeakSet<BrowserContext>();
  const state = readStorageState(authStatePath);
  return async (context: BrowserContext) => {
    if (!state || applied.has(context)) return;
    applied.add(context);
    const cookies = Array.isArray(state.cookies) ? state.cookies : [];
    if (cookies.length > 0) {
      await context.addCookies(
        cookies as unknown as Parameters<BrowserContext["addCookies"]>[0],
      );
    }

    const origins = Array.isArray(state.origins)
      ? state.origins
          .filter((origin) => origin.origin && Array.isArray(origin.localStorage))
          .map((origin) => ({
            origin: origin.origin,
            localStorage:
              origin.localStorage?.map((item) => ({
                name: String(item.name ?? ""),
                value: String(item.value ?? ""),
              })) ?? [],
          }))
      : [];
    if (origins.length > 0) {
      await context.addInitScript(
        (payload: {
          origins: Array<{
            origin?: string;
            localStorage: Array<{ name: string; value: string }>;
          }>;
        }) => {
          try {
            const match = payload.origins.find(
              (item) => item.origin === location.origin,
            );
            if (!match) return;
            for (const item of match.localStorage) {
              if (item.name) localStorage.setItem(item.name, item.value);
            }
          } catch {
            return;
          }
        },
        { origins },
      );
    }
  };
}

function readStorageState(authStatePath: string): StorageState | null {
  if (!authStatePath || !existsSync(authStatePath)) return null;
  try {
    const state = JSON.parse(readFileSync(authStatePath, "utf8")) as unknown;
    return isRecord(state) ? (state as StorageState) : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
