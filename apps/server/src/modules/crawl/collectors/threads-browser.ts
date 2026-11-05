import type { Page } from "playwright";
import {
  extractActivityMetricRows,
  lines,
} from "./threads-parsing.js";
import {
  cacheKey,
  extractPostUrls,
} from "./threads-url.js";
import {
  throwIfAbortRequested,
  waitForDelay,
} from "./threads-runtime.js";

export type ThreadsListingSource = "home_feed" | "profile" | "search" | "trend_search";

export interface ThreadsListingCandidate {
  matchedQuery: string;
  source: ThreadsListingSource;
  url: string;
  windowEndDate?: string;
  windowStartDate?: string;
}

export interface ThreadsListingUserData {
  matchedQuery: string;
  source: ThreadsListingSource;
  windowEndDate?: string;
  windowStartDate?: string;
}

export async function goto(
  page: Page,
  url: string,
  timeoutMs: number,
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const effectiveTimeoutMs = Math.max(timeoutMs, 20_000);
  const deadlineAt = Date.now() + Math.min(Math.max(effectiveTimeoutMs + 15_000, 30_000), 75_000);
  const attempts: Array<{ timeout: number; waitUntil: "domcontentloaded" | "commit" }> = [
    { waitUntil: "domcontentloaded", timeout: effectiveTimeoutMs },
    {
      waitUntil: "commit",
      timeout: Math.min(effectiveTimeoutMs, 15_000),
    },
    {
      waitUntil: "commit",
      timeout: Math.min(Math.max(Math.floor(effectiveTimeoutMs * 0.4), 10_000), 20_000),
    },
  ];
  let lastError: unknown;

  for (let index = 0; index < attempts.length; index += 1) {
    throwIfAbortRequested(signal);
    const attempt = attempts[index];
    if (!attempt) continue;
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) break;
    try {
      await page.goto(url, {
        waitUntil: attempt.waitUntil,
        timeout: Math.max(1_000, Math.min(attempt.timeout, remainingMs)),
      });
      await waitForDelay(page, delayMs, signal);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableGotoError(error) || index === attempts.length - 1) {
        break;
      }
      await waitForDelay(page, Math.min(1200, Math.max(350, delayMs)), signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Khong mo duoc trang: ${url}`);
}

export async function scroll(
  page: Page,
  rounds: number,
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  for (let index = 0; index < Math.max(0, rounds); index += 1) {
    throwIfAbortRequested(signal);
    await page.mouse.wheel(0, 1800);
    await waitForDelay(page, delayMs, signal);
  }
}

export async function collectListingCandidates(
  page: Page,
  userData: ThreadsListingUserData,
  baseUrl: string,
  rounds: number,
  delayMs: number,
  signal?: AbortSignal,
): Promise<ThreadsListingCandidate[]> {
  const collected = new Map<string, ThreadsListingCandidate>();
  const totalRounds = Math.max(0, rounds);
  const absorbUrls = (urls: string[]): void => {
    for (const url of urls) {
      const cleaned = cacheKey(url);
      if (!cleaned || collected.has(cleaned)) continue;
      collected.set(cleaned, {
        matchedQuery: userData.matchedQuery,
        source: userData.source,
        url: cleaned,
        windowEndDate: userData.windowEndDate,
        windowStartDate: userData.windowStartDate,
      });
    }
  };
  const snapshot = async (): Promise<void> => {
    throwIfAbortRequested(signal);
    const hrefs = await evaluateHrefs(page, delayMs, signal);
    absorbUrls(extractPostUrls(hrefs, baseUrl));
  };

  if (userData.source === "home_feed") {
    await waitForListingPostLinks(page, Math.max(8_000, delayMs * 8), signal);
  }
  await snapshot();

  for (let index = 0; index < totalRounds; index += 1) {
    throwIfAbortRequested(signal);
    const innerHeight = await page
      .evaluate(() => window.innerHeight || document.documentElement?.clientHeight || 900)
      .catch(() => 900);
    const wheelDistance =
      userData.source === "home_feed"
        ? Math.max(2200, Math.floor(innerHeight * 2.2))
        : Math.max(1800, Math.floor(innerHeight * 1.6));
    await page.mouse.wheel(0, wheelDistance).catch(() => undefined);
    await waitForDelay(page, delayMs, signal);
    if (index === 0 || index % 2 === 1) {
      await dismissOverlays(page);
    }
    await snapshot();
  }

  if (collected.size === 0) {
    await waitForListingPostLinks(page, Math.max(6_000, delayMs * 6), signal);
    await snapshot();
  }

  if (collected.size === 0) {
    absorbUrls(extractPostUrls([await pageContent(page, delayMs, signal)], baseUrl));
  }

  return [...collected.values()];
}

export async function dismissOverlays(page: Page): Promise<void> {
  const overlayLabel = /(?:Allow all cookies|Decline optional cookies|Not now|Continue without logging in|Continue)/i;
  for (let pass = 0; pass < 3; pass += 1) {
    const control = page
      .locator("button, [role='button'], a")
      .filter({ hasText: overlayLabel })
      .first();
    if (!(await control.isVisible().catch(() => false))) break;
    const clicked = await control
      .click({ timeout: 600 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) break;
    await page.waitForTimeout(200);
  }
}

export async function extractActivityMetrics(
  page: Page,
  delayMs: number,
  signal?: AbortSignal,
): Promise<{ debug: Record<string, unknown>; metrics: Record<string, number>; rawTexts: string[]; source: string }> {
  const debug: Record<string, unknown> = {};
  await waitForActivityButton(page);
  await waitForDelay(page, Math.max(1200, delayMs), signal).catch(() => undefined);
  debug.before_click = await activityButtonDebug(page);
  const clicked = await openActivityModal(page, debug);
  if (!clicked) return { debug, metrics: {}, rawTexts: [], source: "" };

  await waitForDelay(page, delayMs, signal);
  try {
    const titleHandle = await findActivityTitleHandle(page);
    debug.title_handle_found = Boolean(titleHandle);
    let payload: { bodyText: string; labelTexts: string[] } | null = null;
    if (titleHandle) {
      try {
        payload = await titleHandle.evaluate<{ bodyText: string; labelTexts: string[] }>(`(node) => {
          const fold = (value) => String(value || "")
            .normalize("NFD")
            .replace(/[\\u0300-\\u036f]/g, "")
            .replace(/\\u0111/g, "d")
            .replace(/\\u0110/g, "D")
            .toLowerCase();
          const titleMarkers = ["post activity", "activity for post", "hoạt động đối với bài viết", "hoat dong doi voi bai viet"];
          const metricMarkers = ["views", "likes", "reposts", "quotes", "shares"];
          let current = node;
          let best = node.ownerDocument.body;
          for (let depth = 0; depth < 12 && current; depth += 1) {
            const text = current.innerText || "";
            const folded = fold(text);
            const hasTitle = titleMarkers.some((marker) => folded.includes(fold(marker)));
            const hasMetrics = metricMarkers.some((marker) => folded.includes(marker));
            if (text.length > 40 && text.length < 20000 && hasTitle && hasMetrics) {
              best = current;
            }
            current = current.parentElement;
          }
          return {
            bodyText: best.innerText || "",
            labelTexts: Array.from(best.querySelectorAll("[aria-label], [title], button, [role='button']"))
              .slice(0, 260)
              .map((node) => [
                node.getAttribute("aria-label") || "",
                node.getAttribute("title") || "",
                node.textContent || ""
              ].join(" ").replace(/\\s+/g, " ").trim())
              .filter(Boolean)
          };
        }`);
        debug.title_handle_used = true;
      } catch (error) {
        debug.title_handle_error = error instanceof Error ? error.message : String(error);
      }
    }
    if (!payload) {
      payload = await page.evaluate<{ bodyText: string; labelTexts: string[] }>(`(() => {
          const titleMarkers = ["post activity", "activity for post", "hoạt động đối với bài viết", "hoat dong doi voi bai viet"];
          const fold = (value) => String(value || "")
            .normalize("NFD")
            .replace(/[\\u0300-\\u036f]/g, "")
            .replace(/\\u0111/g, "d")
            .replace(/\\u0110/g, "D")
            .toLowerCase();
          const roots = Array.from(document.querySelectorAll("[role='dialog'], [aria-modal='true'], div"));
          const modal = roots
            .map((node) => ({ node, text: node.innerText || "" }))
            .filter((item) => {
              const text = fold(item.text);
              return item.text.length > 40 && titleMarkers.some((marker) => text.includes(marker));
            })
            .sort((a, b) => a.text.length - b.text.length)[0]?.node || document.body;
          return {
            bodyText: modal.innerText || "",
            labelTexts: Array.from(modal.querySelectorAll("[aria-label], [title], button, [role='button']"))
              .slice(0, 260)
              .map((node) => [
                node.getAttribute("aria-label") || "",
                node.getAttribute("title") || "",
                node.textContent || ""
              ].join(" ").replace(/\\s+/g, " ").trim())
              .filter(Boolean)
          };
        })()`);
    }
    const modalBodyText = extractModalBodyText(payload.bodyText);
    const rawTexts = [...lines(modalBodyText), ...payload.labelTexts];
    const metrics = extractActivityMetricRows(modalBodyText, payload.labelTexts);
    return {
      debug,
      metrics,
      rawTexts,
      source: Object.keys(metrics).length > 0 ? "activity_modal" : "",
    };
  } finally {
    await page.keyboard.press("Escape").catch(() => undefined);
    await waitForDelay(page, 250, signal).catch(() => undefined);
  }
}

export async function ensureTopCommentsSort(
  page: Page,
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const topLabel = /^(?:Top|Hàng đầu|Hang dau)\s*$/i;
  const sortLabel = /^(?:Sort|Sắp xếp|Sap xep)\s*$/i;
  const controls = "button, [role='button']";
  const alreadyTop = await page
    .locator(controls)
    .filter({ hasText: topLabel })
    .first()
    .isVisible()
    .catch(() => false);
  if (alreadyTop) return;

  const sortControl = page.locator(controls).filter({ hasText: sortLabel }).first();
  if (!(await sortControl.isVisible().catch(() => false))) return;
  if (!(await sortControl.click({ timeout: 1200 }).then(() => true).catch(() => false))) return;

  await waitForDelay(page, 250, signal);
  const topControl = page.locator(controls).filter({ hasText: topLabel }).last();
  const selected = await topControl
    .click({ timeout: 1200 })
    .then(() => true)
    .catch(() => false);
  if (selected) {
    await waitForDelay(page, delayMs, signal);
  } else {
    await page.keyboard.press("Escape").catch(() => undefined);
  }
}

export async function clickFirstText(page: Page, labels: string[]): Promise<boolean> {
  for (const label of labels) {
    try {
      await page.getByText(label, { exact: false }).first().click({ timeout: 1200 });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

function extractModalBodyText(bodyText: string): string {
  const index = bodyText.search(
    /Post activity|Activity for post|Hoạt động đối với bài viết|Hoat dong doi voi bai viet/i,
  );
  if (index < 0) return bodyText;
  return bodyText.slice(index);
}

async function waitForActivityButton(page: Page): Promise<void> {
  try {
    await page.waitForFunction(
      `() => {
        const fold = (value) =>
          String(value || "")
            .normalize("NFD")
            .replace(/[\\u0300-\\u036f]/g, "")
            .replace(/\\u0111/g, "d")
            .replace(/\\u0110/g, "D")
            .toLowerCase();
        const text = fold(document.body?.innerText || "");
        return text.includes("view activity") || text.includes("xem hoat dong");
      }`,
      undefined,
      { timeout: 5000 },
    );
  } catch {
    return;
  }
}

async function findActivityTitleHandle(page: Page) {
  const titlePattern = /Post activity|Activity for post|Hoạt động đối với bài viết|Hoat dong doi voi bai viet/i;
  try {
    return await page.getByText(titlePattern).first().elementHandle();
  } catch {
    return null;
  }
}

async function activityButtonDebug(page: Page): Promise<Record<string, unknown>> {
  try {
    return await page.evaluate(() => {
      const bodyText = document.body?.innerText || "";
      const roleButtons = Array.from(document.querySelectorAll("[role='button'], button"))
        .map((node) => (node as HTMLElement).innerText || node.textContent || "")
        .filter((text) => /View activity|Xem hoạt động/i.test(text));
      const broad = Array.from(document.querySelectorAll("button, [role='button'], a, div, span"))
        .map((node) => (node as HTMLElement).innerText || node.textContent || "")
        .filter((text) => /View activity|Xem hoạt động/i.test(text));
      return {
        broad_count: broad.length,
        body_has_post_activity: /Post activity|Activity for post/i.test(bodyText),
        body_has_view_activity: /View activity|Xem hoạt động/i.test(bodyText),
        role_button_count: roleButtons.length,
        role_button_samples: roleButtons.slice(0, 4),
      };
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function openActivityModal(
  page: Page,
  debug: Record<string, unknown>,
): Promise<boolean> {
  const labels = ["View activity", "Xem hoạt động", "Xem hoat dong"];
  for (const label of labels) {
    try {
      const locator = page.locator("[role='button'], button").filter({ hasText: label });
      debug[`role_count_${label}`] = await locator.count().catch(() => -1);
      await locator.last().click({ force: true, timeout: 3000 });
      const found = await waitForActivityModal(page);
      debug[`role_modal_${label}`] = found;
      if (found) {
        debug.click_path = `role:${label}`;
        return true;
      }
    } catch (error) {
      debug[`role_error_${label}`] = error instanceof Error ? error.message : String(error);
      continue;
    }
  }

  if (await clickActivityButton(page, labels)) {
    const found = await waitForActivityModal(page);
    debug.evaluate_modal = found;
    if (found) {
      debug.click_path = "evaluate";
      return true;
    }
  }

  if (await clickFirstText(page, labels)) {
    const found = await waitForActivityModal(page);
    debug.text_modal = found;
    if (found) {
      debug.click_path = "text";
      return true;
    }
  }

  try {
    const clicked = await page.evaluate(
      `(activityLabels) => {
        const fold = (value) =>
          String(value || "")
            .normalize("NFD")
            .replace(/[\\u0300-\\u036f]/g, "")
            .replace(/\\u0111/g, "d")
            .replace(/\\u0110/g, "D")
            .toLowerCase();
        const labels = activityLabels.map(fold);
        const nodes = Array.from(document.querySelectorAll("button, [role='button'], a, div, span"));
        for (const node of nodes) {
          const text = fold((node.innerText || node.textContent || ""));
          if (!labels.some((label) => text.includes(label))) continue;
          const target = node.closest("button, [role='button'], a") || node;
          target.click();
          return true;
        }
        return false;
      }`,
      labels,
    );
    const found = clicked ? await waitForActivityModal(page) : false;
    debug.dom_scan_modal = found;
    if (found) debug.click_path = "dom_scan";
    return found;
  } catch (error) {
    debug.dom_scan_error = error instanceof Error ? error.message : String(error);
    return false;
  }
}

async function clickActivityButton(page: Page, labels: string[]): Promise<boolean> {
  try {
    return await page.evaluate(
      `(activityLabels) => {
        const fold = (value) =>
          String(value || "")
            .normalize("NFD")
            .replace(/[\\u0300-\\u036f]/g, "")
            .replace(/\\u0111/g, "d")
            .replace(/\\u0110/g, "D")
            .toLowerCase();
        const labels = activityLabels.map(fold);
        const nodes = Array.from(document.querySelectorAll("button, [role='button'], a, div, span"));
        const candidates = nodes
          .map((node) => {
            const element = node;
            const text = fold(element.innerText || element.textContent || "");
            const matchedLabel = labels.find((label) => text === label || text.includes(label));
            if (!matchedLabel) return null;
            const rect = element.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (rect.width <= 0 || rect.height <= 0 || area <= 0) return null;
            const target = element.closest("button, [role='button'], a") || element;
            return {
              area,
              exact: text === matchedLabel,
              target,
              y: rect.y,
            };
          })
          .filter(Boolean)
          .sort((a, b) => Number(b.exact) - Number(a.exact) || a.area - b.area || a.y - b.y);
        const target = candidates[0]?.target;
        if (!target) return false;
        target.click();
        return true;
      }`,
      labels,
    );
  } catch {
    return false;
  }
}

async function waitForActivityModal(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction(
      `() => {
        const fold = (value) =>
          String(value || "")
            .normalize("NFD")
            .replace(/[\\u0300-\\u036f]/g, "")
            .replace(/\\u0111/g, "d")
            .replace(/\\u0110/g, "D")
            .toLowerCase();
        const text = document.body?.innerText || "";
        const folded = fold(text);
        return (
          /Post activity|Activity for post/i.test(text) ||
          folded.includes("hoat dong doi voi bai viet")
        );
      }`,
      undefined,
      { timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
}

async function evaluateHrefs(
  page: Page,
  delayMs: number,
  signal?: AbortSignal,
): Promise<string[]> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]"))
          .map((anchor) => (anchor as HTMLAnchorElement).href)
          .filter(Boolean),
      );
    } catch {
      await waitForDelay(page, delayMs, signal);
    }
  }
  return [];
}

async function pageContent(
  page: Page,
  delayMs: number,
  signal?: AbortSignal,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.content();
    } catch {
      await waitForDelay(page, delayMs, signal);
    }
  }
  return "";
}

async function waitForListingPostLinks(
  page: Page,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() < deadline) {
    throwIfAbortRequested(signal);
    const hasPostLink = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll("a[href]")).some((anchor) => {
          const href = (anchor as HTMLAnchorElement).href || "";
          return /\/@[A-Za-z0-9._]+\/post\//.test(href) || /\/post\//.test(href);
        }),
      )
      .catch(() => false);
    if (hasPostLink) return;
    await waitForDelay(page, 300, signal);
  }
}
function isRetryableGotoError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /ERR_NETWORK_CHANGED|ERR_CONNECTION|Timeout|Navigation timeout|Target page, context or browser has been closed/i.test(
    message,
  );
}
