import { type PlaywrightCrawler } from "crawlee";
import type { Page } from "playwright";

export function attachCrawlerAbort(
  signal: AbortSignal | undefined,
  crawler: PlaywrightCrawler,
): () => void {
  if (!signal) return () => undefined;
  const onAbort = () => {
    void crawler.autoscaledPool?.abort().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

export async function waitForDelay(
  page: Page,
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAbortRequested(signal);
  if (!signal) {
    await page.waitForTimeout(milliseconds);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      const error = new Error("Crawl run was cancelled.");
      error.name = "CrawlCancelledError";
      reject(error);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    page
      .waitForTimeout(milliseconds)
      .then(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      })
      .catch((error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      });
  });
}

export function isAbortRequested(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export function throwIfAbortRequested(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("Crawl run was cancelled.");
    error.name = "CrawlCancelledError";
    throw error;
  }
}
