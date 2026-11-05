import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ToolConfig } from "@tool-base/config/schema";
import type { BrowserContext, Page } from "playwright";
import { request } from "playwright";
import {
  type BrowserLaunchOptions,
  ensureChromiumLaunchHealthy,
  getChromiumLaunchHealth,
} from "./browser-launch.js";

export interface ThreadsSessionServiceOptions {
  config: ToolConfig;
  configPath: string;
}

export interface ThreadsSessionStatus {
  accessState: "unknown" | "ready" | "login_prompt" | "onboarding";
  accountDisplayName: string;
  accountLabel: string;
  accountUpdatedAt: string;
  accountUserId: string;
  accountUsername: string;
  authStatePath: string;
  cookieCount: number;
  exists: boolean;
  hasAuthCookie: boolean;
  lastError: string;
  lastModifiedAt: string;
  networkState: "unknown" | "reachable" | "unreachable";
  profileId: string;
  status: "missing" | "needs_login" | "network_error" | "ready";
}

type StorageStateCookie = {
  domain?: string;
  name?: string;
  value?: string;
};

type StorageStatePayload = {
  cookies?: StorageStateCookie[];
};

type SessionMetadata = {
  accessState?: "unknown" | "ready" | "login_prompt" | "onboarding";
  displayName?: string;
  lastError?: string;
  networkState?: "unknown" | "reachable" | "unreachable";
  searchReady?: boolean;
  source?: string;
  updatedAt?: string;
  userId?: string;
  username?: string;
};

const DEFAULT_PROFILE_ID = "default";
const AUTH_COOKIE_NAMES = new Set(["sessionid", "ds_user_id"]);
const THREADS_SEARCH_INPUT_SELECTOR = [
  'input[type="search"]',
  'input[aria-label*="search" i]',
  'input[placeholder*="search" i]',
  'input[aria-label*="tìm kiếm" i]',
  'input[placeholder*="tìm kiếm" i]',
].join(", ");

export class ThreadsSessionService {
  private readonly activeBrowserClosers = new Set<() => Promise<void>>();
  private readonly configBaseDir: string;
  private shuttingDown = false;

  constructor(private readonly options: ThreadsSessionServiceOptions) {
    this.configBaseDir = dirname(options.configPath);
  }

  getStatus(): ThreadsSessionStatus {
    const authStatePath = this.resolveAuthStatePath();
    const storageState = readStorageState(authStatePath);
    const cookies = Array.isArray(storageState?.cookies) ? storageState.cookies : [];
    const exists = existsSync(authStatePath);
    const hasAuthCookie = hasThreadsAuthCookie(cookies);
    const lastModifiedAt = exists ? statSync(authStatePath).mtime.toISOString() : "";
    const metadata = exists ? readSessionMetadata(this.resolveMetadataPath(authStatePath)) : null;
    const accountUserId = metadata?.userId || findCookieValue(cookies, "ds_user_id");
    const accountUsername = normalizeUsername(metadata?.username ?? "");
    const accountDisplayName = normalizeDisplayName(metadata?.displayName ?? "", accountUsername);
    const accessState = normalizeAccessState(metadata?.accessState);
    const lastError = String(metadata?.lastError ?? "").trim();
    const networkState = normalizeNetworkState(metadata?.networkState);
    const searchReady = metadata?.searchReady === true;
    const status = !exists
      ? "missing"
      : networkState === "unreachable"
        ? "network_error"
        : hasAuthCookie && searchReady
          ? "ready"
          : "needs_login";

    return {
      accessState,
      accountDisplayName,
      accountLabel: accountUsername
        ? `@${accountUsername}`
        : accountUserId
          ? `ID ${accountUserId}`
          : "",
      accountUpdatedAt: String(metadata?.updatedAt ?? ""),
      accountUserId,
      accountUsername,
      authStatePath,
      cookieCount: cookies.length,
      exists,
      hasAuthCookie,
      lastError,
      lastModifiedAt,
      networkState,
      profileId: DEFAULT_PROFILE_ID,
      status,
    };
  }

  async getBrowserHealth(mode: "crawl" | "login" = "crawl") {
    this.assertRunning();
    const { chromium } = await import("playwright");
    const crawlConfig = this.options.config.crawl;
    return getChromiumLaunchHealth(chromium, {
      headless: mode !== "login",
      channel: crawlConfig.browserChannel,
      executablePath: crawlConfig.executablePath
        ? this.resolveToolPath(crawlConfig.executablePath)
        : "",
    });
  }

  async login(timeoutMs = 300_000): Promise<ThreadsSessionStatus> {
    this.assertRunning();
    const { chromium } = await import("playwright");
    const crawlConfig = this.options.config.crawl;
    const authStatePath = this.resolveAuthStatePath();
    const previousStatus = this.getStatus();
    const hadAuthStateBeforeLogin = previousStatus.exists;
    const preservePreviousSessionOnAbort =
      previousStatus.status === "ready" &&
      previousStatus.hasAuthCookie &&
      previousStatus.accessState === "ready";
    const launchOptions = await ensureChromiumLaunchHealthy(chromium, {
      headless: false,
      channel: crawlConfig.browserChannel,
      executablePath: crawlConfig.executablePath
        ? this.resolveToolPath(crawlConfig.executablePath)
        : "",
    });

    mkdirSync(dirname(authStatePath), { recursive: true });
    const loginContext = await this.createLoginContext(
      chromium,
      launchOptions,
      authStatePath
    );
    const { context } = loginContext;
    const closeLoginContext = async () => {
      await loginContext.close().catch(() => undefined);
    };
    this.activeBrowserClosers.add(closeLoginContext);

    try {
      console.info("[threads-login] Starting login flow");
      const initialCookies = await context.cookies().catch(() => []);
      const hasStoredAuthCookie = hasThreadsAuthCookie(initialCookies);
      let page =
        context.pages().filter((candidate) => !candidate.isClosed()).at(-1) ??
        await context.newPage();
      let loginInterrupted = false;
      const baseUrl = crawlConfig.baseUrl.replace(/\/$/, "");
      const entryPath = hasStoredAuthCookie ? "/search" : "/login";

      await page.goto(`${baseUrl}${entryPath}`, {
        timeout: Math.max(30_000, Math.min(timeoutMs, 90_000)),
        waitUntil: "domcontentloaded",
      }).catch(() => undefined);
      await page.waitForTimeout(1_500).catch(() => undefined);

      const deadline = Date.now() + Math.max(30_000, timeoutMs);
      while (Date.now() < deadline && loginContext.isConnected()) {
        const activePages = context.pages().filter((candidate) => !candidate.isClosed());
        if (activePages.length === 0) {
          loginInterrupted = true;
          break;
        }
        if (page.isClosed() || !activePages.includes(page)) {
          page = activePages[activePages.length - 1]!;
          console.info("[threads-login] Switched active page", {
            pages: activePages.length,
            url: page.url(),
          });
        }

        const cookies = await context.cookies().catch(() => []);
        const hasAuth = hasThreadsAuthCookie(cookies);
        const access = await readCurrentThreadsAccess(page);
        const currentUrl = page.url();
        if (access.state === "ready" && (hasAuth || hasStoredAuthCookie)) {
          if (currentUrl.includes("/search")) {
            break;
          }

          await page.goto(`${baseUrl}/search`, {
            timeout: 30_000,
            waitUntil: "domcontentloaded",
          }).catch(() => undefined);
          await page.waitForTimeout(1_500).catch(() => undefined);
          const searchAccess = await readCurrentThreadsAccess(page);
          if (searchAccess.state === "ready") {
            break;
          }
        }

        const shouldPromoteToSearch =
          hasAuth &&
          !currentUrl.includes("/search") &&
          !currentUrl.includes("/challenge");
        if (shouldPromoteToSearch) {
          await page.goto(`${baseUrl}/search`, {
            timeout: 30_000,
            waitUntil: "domcontentloaded",
          }).catch(() => undefined);
          await page.waitForTimeout(1_500).catch(() => undefined);
          const searchAccess = await readCurrentThreadsAccess(page);
          if (searchAccess.state === "ready") break;
        }

        await page.waitForTimeout(1_000).catch(() => undefined);
      }

      const cookies = await context.cookies().catch(() => []);
      const hasAuthCookie = hasThreadsAuthCookie(cookies);
      const finalPage = page.isClosed()
        ? context.pages().filter((candidate) => !candidate.isClosed()).at(-1) ?? null
        : page;
      const nextMetadata = finalPage
        ? await this.readMetadataFromBrowser(finalPage, context, authStatePath)
        : null;

      if (hasAuthCookie) {
        await context.storageState({ path: authStatePath });
        if (nextMetadata) {
          this.writeSessionMetadata(authStatePath, nextMetadata);
        }
      } else if (!preservePreviousSessionOnAbort || loginInterrupted) {
        this.clearSessionFiles(authStatePath);
      }

      console.info("[threads-login] Login flow finished", {
        cookieNames: summarizeCookieNames(cookies),
        finalUrl: finalPage?.url() ?? "",
        hadAuthStateBeforeLogin,
        hasAuthCookie,
        hasStoredAuthCookie,
        loginInterrupted,
        preservePreviousSessionOnAbort,
      });
    } finally {
      this.activeBrowserClosers.delete(closeLoginContext);
      await closeLoginContext();
    }

    if (existsSync(authStatePath)) {
      await this.refreshStoredSessionStatus(authStatePath, 4).catch((error) => {
        console.warn("[threads-login] Failed to refresh stored session status", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    const status = this.getStatus();
    if (status.status !== "ready") {
      console.warn("[threads-login] Session is still not ready after login", {
        accessState: status.accessState,
        authStatePath: status.authStatePath,
        cookieCount: status.cookieCount,
        exists: status.exists,
        hasAuthCookie: status.hasAuthCookie,
        status: status.status,
      });
    }

    return status;
  }

  async test(): Promise<ThreadsSessionStatus> {
    this.assertRunning();
    const authStatePath = this.resolveAuthStatePath();
    if (!existsSync(authStatePath)) return this.getStatus();

    await this.refreshStoredSessionStatus(authStatePath, 1);
    return this.getStatus();
  }

  logout(): ThreadsSessionStatus {
    const authStatePath = this.resolveAuthStatePath();
    this.clearSessionFiles(authStatePath);
    return this.getStatus();
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    const closers = [...this.activeBrowserClosers];
    this.activeBrowserClosers.clear();
    await Promise.allSettled(closers.map((closeBrowser) => closeBrowser()));
  }

  private resolveAuthStatePath(): string {
    return this.resolveToolPath(this.options.config.crawl.authStatePath);
  }

  private resolveMetadataPath(authStatePath: string): string {
    return join(dirname(authStatePath), "threads.session_meta.json");
  }

  private assertRunning(): void {
    if (this.shuttingDown) {
      throw new Error("Tool đang dừng. Không thể mở thêm trình duyệt.");
    }
  }

  private resolveLoginProfilePath(authStatePath: string): string {
    return join(dirname(authStatePath), "threads-browser-profile");
  }

  private async createLoginContext(
    chromium: typeof import("playwright").chromium,
    launchOptions: BrowserLaunchOptions,
    authStatePath: string
  ): Promise<{
    close: () => Promise<void>;
    context: BrowserContext;
    isConnected: () => boolean;
  }> {
    const userDataDir = this.resolveLoginProfilePath(authStatePath);
    mkdirSync(userDataDir, { recursive: true });

    const context = await chromium.launchPersistentContext(userDataDir, {
      ...withLoginBrowserArgs(launchOptions),
      viewport: { height: 900, width: 1365 },
    });

    await hydrateContextCookiesFromStorageState(context, authStatePath);

    return {
      close: () => context.close(),
      context,
      isConnected: () => context.browser()?.isConnected() ?? true,
    };
  }

  private clearSessionFiles(authStatePath: string): void {
    if (existsSync(authStatePath)) {
      unlinkSync(authStatePath);
    }
    const metadataPath = this.resolveMetadataPath(authStatePath);
    if (existsSync(metadataPath)) {
      unlinkSync(metadataPath);
    }
  }

  private resolveToolPath(value: string): string {
    return isAbsolute(value) ? value : resolve(this.configBaseDir, value);
  }

  private async refreshStoredSessionStatus(authStatePath: string, attempts: number): Promise<void> {
    const { chromium } = await import("playwright");
    const crawlConfig = this.options.config.crawl;
    const launchOptions = await ensureChromiumLaunchHealthy(chromium, {
      headless: true,
      channel: crawlConfig.browserChannel,
      executablePath: crawlConfig.executablePath
        ? this.resolveToolPath(crawlConfig.executablePath)
        : "",
    });

    for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
      this.assertRunning();
      const browser = await chromium.launch(launchOptions);
      const closeBrowser = async () => {
        await browser.close().catch(() => undefined);
      };
      this.activeBrowserClosers.add(closeBrowser);
      const context = await browser.newContext({ storageState: authStatePath });

      try {
        const page = await context.newPage();
        await this.updateMetadataFromBrowser(page, context, authStatePath);
      } finally {
        this.activeBrowserClosers.delete(closeBrowser);
        await closeBrowser();
      }

      const status = this.getStatus();
      console.info("[threads-login] Refreshed stored session", {
        accessState: status.accessState,
        attempt,
        cookieCount: status.cookieCount,
        hasAuthCookie: status.hasAuthCookie,
        status: status.status,
      });
      if (status.status === "ready" || !status.hasAuthCookie) {
        return;
      }

      await wait(1_500);
    }
  }

  private async updateMetadataFromBrowser(
    page: Page,
    context: BrowserContext,
    authStatePath: string
  ): Promise<void> {
    const metadata = await this.readMetadataFromBrowser(page, context, authStatePath);
    this.writeSessionMetadata(authStatePath, metadata);
  }

  private async readMetadataFromBrowser(
    page: Page,
    context: BrowserContext,
    authStatePath: string
  ): Promise<SessionMetadata> {
    return extractSessionMetadata(
      page,
      context,
      this.options.config.crawl.baseUrl,
      authStatePath
    );
  }

  private writeSessionMetadata(authStatePath: string, metadata: SessionMetadata): void {
    const current = readSessionMetadata(this.resolveMetadataPath(authStatePath)) ?? {};
    const next: SessionMetadata = {
      ...current,
      ...metadata,
      updatedAt: new Date().toISOString(),
    };
    mkdirSync(dirname(authStatePath), { recursive: true });
    writeFileSync(this.resolveMetadataPath(authStatePath), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }
}

function withLoginBrowserArgs(launchOptions: BrowserLaunchOptions): BrowserLaunchOptions {
  const existingArgs = Array.isArray(launchOptions.args) ? launchOptions.args : [];
  const args = uniqueStrings([
    ...existingArgs,
    "--disable-blink-features=AutomationControlled",
    "--no-default-browser-check",
    "--no-first-run",
  ]);
  return {
    ...launchOptions,
    args,
  };
}

async function hydrateContextCookiesFromStorageState(
  context: BrowserContext,
  authStatePath: string
): Promise<void> {
  const storageState = readStorageState(authStatePath);
  const cookies = Array.isArray(storageState?.cookies) ? storageState.cookies : [];
  if (cookies.length === 0) return;

  await context.addCookies(
    cookies as Parameters<BrowserContext["addCookies"]>[0]
  ).catch((error) => {
    console.warn("[threads-login] Failed to hydrate persistent login context", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function summarizeCookieNames(cookies: StorageStateCookie[]): string[] {
  return uniqueStrings(
    cookies
      .map((cookie) => {
        const name = String(cookie.name ?? "").trim();
        const domain = String(cookie.domain ?? "").trim();
        if (!name) return "";
        return domain ? `${domain}:${name}` : name;
      })
      .filter(Boolean)
  ).slice(0, 24);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function readStorageState(authStatePath: string): StorageStatePayload | null {
  if (!existsSync(authStatePath)) return null;
  try {
    const payload = JSON.parse(readFileSync(authStatePath, "utf8")) as unknown;
    return isRecord(payload) ? (payload as StorageStatePayload) : null;
  } catch {
    return null;
  }
}

function hasThreadsAuthCookie(cookies: StorageStateCookie[]): boolean {
  return cookies.some((cookie) => {
    const name = String(cookie.name ?? "").toLowerCase();
    const value = String(cookie.value ?? "");
    if (!AUTH_COOKIE_NAMES.has(name) || !value) return false;
    const domain = String(cookie.domain ?? "").toLowerCase();
    return domain.includes("threads") || domain.includes("instagram");
  });
}

async function extractSessionMetadata(
  page: Page,
  context: BrowserContext,
  baseUrl: string,
  authStatePath: string
): Promise<SessionMetadata> {
  const cookies = await context.cookies().catch(() => []);
  const userId = findCookieValue(cookies, "ds_user_id");
  const apiMetadata = userId
    ? await fetchInstagramUserMetadata(authStatePath, userId).catch(() => null)
    : null;

  const access = await inspectThreadsAccess(page, baseUrl);

  const account = await page.evaluate<{
    displayName: string;
    username: string;
  }>(() => {
    const fold = (value: string) =>
      String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\u0111/g, "d")
        .replace(/\u0110/g, "D")
        .toLowerCase();
    const profileWords = ["profile", "trang ca nhan", "ho so", "ca nhan"];
    const accountText = [
      document.body?.innerText || "",
      ...Array.from(document.querySelectorAll("button, [role='button'], a"))
      .map((node) =>
        [
          node.getAttribute("aria-label") || "",
          node.getAttribute("title") || "",
          node.textContent || "",
        ].join(" ").replace(/\s+/g, " ").trim()
      ),
    ]
      .find((text) => /continue with instagram\s+[\w.]+/i.test(text));
    const accountMatch = /continue with instagram\s+(?<username>[\w.]+)/i.exec(accountText || "");
    if (accountMatch?.groups?.username) {
      return {
        displayName: "",
        username: accountMatch.groups.username,
      };
    }

    const candidates = Array.from(document.querySelectorAll("a[href]"))
      .map((node) => {
        const anchor = node as HTMLAnchorElement;
        const href = anchor.href || anchor.getAttribute("href") || "";
        const match = /\/@([^/?#]+)\/?$/.exec(href);
        if (!match?.[1]) return null;
        const username = decodeURIComponent(match[1]).replace(/^@/, "");
        if (!username || username.toLowerCase() === "threads") return null;
        const rect = anchor.getBoundingClientRect();
        const label = [
          anchor.getAttribute("aria-label") || "",
          anchor.getAttribute("title") || "",
          anchor.innerText || "",
          anchor.textContent || "",
        ].join(" ").replace(/\s+/g, " ").trim();
        const folded = fold(label);
        return {
          displayName: label.replace(`@${username}`, "").replace(username, "").trim(),
          isLeftNav: rect.left < 360 && rect.width > 0 && rect.height > 0,
          isProfileLabel: profileWords.some((word) => folded.includes(word)),
          username,
          y: rect.y,
        };
      })
      .filter(Boolean)
      .sort((a, b) =>
        Number(b?.isProfileLabel) - Number(a?.isProfileLabel) ||
        Number(b?.isLeftNav) - Number(a?.isLeftNav) ||
        (a?.y ?? 0) - (b?.y ?? 0)
      );

    const best = candidates[0];
    return {
      displayName: best?.displayName || "",
      username: best?.username || "",
    };
  }).catch(() => ({ displayName: "", username: "" }));

  return {
    accessState: access.state,
    displayName: normalizeDisplayName(apiMetadata?.displayName ?? account.displayName, apiMetadata?.username ?? account.username),
    lastError: String(access.lastError ?? "").trim(),
    networkState: access.networkState,
    searchReady: access.state === "ready",
    source: apiMetadata?.username || apiMetadata?.displayName
      ? "instagram_api"
      : account.username
        ? "threads_dom"
        : "cookie",
    userId,
    username: normalizeUsername(apiMetadata?.username ?? account.username),
  };
}

async function inspectThreadsAccess(
  page: Page,
  baseUrl: string
): Promise<{
  lastError?: string;
  networkState: "unknown" | "reachable" | "unreachable";
  state: "unknown" | "ready" | "login_prompt" | "onboarding";
}> {
  await page.setViewportSize({ width: 1365, height: 900 }).catch(() => undefined);
  let gotoError = "";
  try {
    await page.goto(`${baseUrl.replace(/\/$/, "")}/search`, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });
  } catch (error) {
    gotoError = normalizeErrorMessage(error);
  }
  await page
    .waitForFunction(
      () =>
        Boolean(
          document.querySelector(
            [
              'input[type="search"]',
              'input[aria-label*="search" i]',
              'input[placeholder*="search" i]',
              'input[aria-label*="tìm kiếm" i]',
              'input[placeholder*="tìm kiếm" i]',
            ].join(", ")
          )
        ) ||
        /continue with instagram|log in or sign up for threads|log in with your instagram account|dang nhap hoac dang ky threads|dang nhap voi tai khoan instagram|forgot password|password/i.test(
          document.body?.innerText || ""
        ) ||
        /for you|new thread|activity/i.test(document.body?.innerText || ""),
      undefined,
      { timeout: 6_000 }
    )
    .catch(() => undefined);
  await page.waitForTimeout(1_000).catch(() => undefined);

  const current = await readCurrentThreadsAccess(page);
  if (current.networkState === "unreachable") {
    return current;
  }
  if (gotoError && isNetworkErrorMessage(gotoError)) {
    return {
      ...current,
      lastError: gotoError,
      networkState: "unreachable",
      state: current.state === "ready" ? "ready" : "unknown",
    };
  }
  if (gotoError && !current.lastError) {
    return {
      ...current,
      lastError: gotoError,
    };
  }
  return current;
}

async function readCurrentThreadsAccess(
  page: Page
): Promise<{
  lastError?: string;
  networkState: "unknown" | "reachable" | "unreachable";
  state: "unknown" | "ready" | "login_prompt" | "onboarding";
}> {
  await page.setViewportSize({ width: 1365, height: 900 }).catch(() => undefined);

  const snapshot = await page
    .evaluate((searchSelector) => ({
      hasSearchInput: Boolean(document.querySelector(searchSelector)),
      text: (document.body?.innerText || "").slice(0, 4000),
      title: document.title || "",
      url: location.href,
    }), THREADS_SEARCH_INPUT_SELECTOR)
    .catch(() => ({
      hasSearchInput: false,
      text: "",
      title: "",
      url: "",
    }));

  const folded = fold(`${snapshot.title}\n${snapshot.text}`);
  const hasSearchShell =
    foldIncludesAll(folded, ["for you", "search", "activity"]) ||
    foldIncludesAll(folded, ["danh cho ban", "tim kiem", "hoat dong"]) ||
    (snapshot.url.includes("/search") &&
      (folded.includes("tim kiem") || folded.includes("search")) &&
      (folded.includes("hoat dong") || folded.includes("activity")));
  const unreachable =
    snapshot.url.startsWith("chrome-error://") ||
    folded.includes("this site cant be reached") ||
    folded.includes("this site can't be reached") ||
    folded.includes("khong the truy cap trang web nay") ||
    folded.includes("khong the ket noi den internet") ||
    folded.includes("internet disconnected") ||
    folded.includes("dns_probe_finished");
  if (unreachable) {
    return {
      lastError: "Threads is unreachable from this machine right now.",
      networkState: "unreachable",
      state: "unknown",
    };
  }
  if (snapshot.url.includes("/onboarding")) {
    return { networkState: "reachable", state: "onboarding" };
  }
  if (snapshot.url.includes("/login")) {
    return { networkState: "reachable", state: "login_prompt" };
  }
  if (
    folded.includes("dang nhap hoac dang ky threads") ||
    folded.includes("log in or sign up for threads") ||
    folded.includes("continue with instagram") ||
    folded.includes("log in with your instagram account") ||
    folded.includes("dang nhap voi tai khoan instagram") ||
    (folded.includes("forgot password") && folded.includes("password"))
  ) {
    return { networkState: "reachable", state: "login_prompt" };
  }
  if (snapshot.hasSearchInput || (snapshot.url.includes("/search") && hasSearchShell)) {
    return { networkState: "reachable", state: "ready" };
  }
  return {
    networkState: snapshot.url ? "reachable" : "unknown",
    state: "unknown",
  };
}

async function fetchInstagramUserMetadata(
  authStatePath: string,
  userId: string
): Promise<{ displayName: string; username: string } | null> {
  const storageState = existsSync(authStatePath) ? authStatePath : undefined;
  const api = await request.newContext({
    extraHTTPHeaders: {
      "User-Agent": "Mozilla/5.0",
      "X-IG-App-ID": "936619743392459",
    },
    storageState,
  });
  try {
    const response = await api.get(`https://www.instagram.com/api/v1/users/${userId}/info/`, {
      timeout: 15_000,
    });
    if (!response.ok()) return null;
    const payload = (await response.json()) as unknown;
    if (!isRecord(payload) || !isRecord(payload.user)) return null;
    return {
      displayName: String(payload.user.full_name ?? "").trim(),
      username: String(payload.user.username ?? "").trim(),
    };
  } finally {
    await api.dispose().catch(() => undefined);
  }
}

function readSessionMetadata(metadataPath: string): SessionMetadata | null {
  if (!existsSync(metadataPath)) return null;
  try {
    const payload = JSON.parse(readFileSync(metadataPath, "utf8")) as unknown;
    return isRecord(payload) ? (payload as SessionMetadata) : null;
  } catch {
    return null;
  }
}

function findCookieValue(cookies: StorageStateCookie[], name: string): string {
  const cookie = cookies.find((item) => String(item.name ?? "").toLowerCase() === name.toLowerCase());
  return String(cookie?.value ?? "").trim();
}

function normalizeUsername(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9_.]/g, "")
    .slice(0, 64);
}

function normalizeDisplayName(value: string, username = ""): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  const foldedText = fold(text);
  const collapsedText = collapseLooseText(text);
  const foldedUsername = fold(normalizeUsername(username));
  const genericLabels = ["profile", "trang ca nhan", "ho so", "ca nhan"];

  if (foldedUsername && (foldedText === foldedUsername || foldedText === `@${foldedUsername}`)) {
    return "";
  }

  if (genericLabels.some((label) => foldedText === fold(label))) {
    return "";
  }

  if (
    genericLabels.some((label) => {
      const collapsedLabel = collapseLooseText(label);
      return (
        collapsedText.length >= collapsedLabel.length * 2 &&
        new RegExp(`^(?:${escapeRegExp(collapsedLabel)})+$`, "i").test(collapsedText)
      );
    })
  ) {
    return "";
  }

  const tokens = text.split(/\s+/).map((token) => fold(token)).filter(Boolean);
  if (
    tokens.length > 1 &&
    tokens.every((token) => token === tokens[0]) &&
    genericLabels.some((label) => tokens[0] === fold(label))
  ) {
    return "";
  }

  return text.slice(0, 120);
}

function normalizeAccessState(value: unknown): "unknown" | "ready" | "login_prompt" | "onboarding" {
  return value === "ready" || value === "login_prompt" || value === "onboarding" ? value : "unknown";
}

function normalizeNetworkState(value: unknown): "unknown" | "reachable" | "unreachable" {
  return value === "reachable" || value === "unreachable" ? value : "unknown";
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "").trim();
}

function isNetworkErrorMessage(message: string): boolean {
  const folded = fold(String(message ?? ""));
  return (
    folded.includes("net::err") ||
    folded.includes("timed out") ||
    folded.includes("timeout") ||
    folded.includes("name not resolved") ||
    folded.includes("internet disconnected") ||
    folded.includes("unable to connect") ||
    folded.includes("connection refused") ||
    folded.includes("dns")
  );
}

function fold(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase();
}

function collapseLooseText(value: string): string {
  return fold(value).replace(/[^a-z0-9]/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function foldIncludesAll(value: string, parts: string[]): boolean {
  return parts.every((part) => value.includes(fold(part)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
