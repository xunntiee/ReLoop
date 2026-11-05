const POST_URL_RE =
  /https?:\/\/(?:[a-z0-9-]+\.)?threads\.(?:com|net)\/@(?<username>[^/\s"'<>]+)\/post\/(?<postId>[A-Za-z0-9_-]+)/gi;
const POST_URL_SINGLE_RE =
  /https?:\/\/(?:[a-z0-9-]+\.)?threads\.(?:com|net)\/@(?<username>[^/\s"'<>]+)\/post\/(?<postId>[A-Za-z0-9_-]+)/i;
const RELATIVE_POST_URL_RE =
  /\/@(?<username>[^/\s"'<>]+)\/post\/(?<postId>[A-Za-z0-9_-]+)/gi;
const SHARE_URL_RE =
  /https?:\/\/(?:[a-z0-9-]+\.)?threads\.(?:com|net)\/share\/(?<shareId>[A-Za-z0-9_-]+)\/?/gi;
const RELATIVE_SHARE_URL_RE =
  /\/share\/(?<shareId>[A-Za-z0-9_-]+)\/?/gi;

export type NormalizedThreadsTarget =
  | { kind: "post"; url: string }
  | { kind: "profile"; url: string }
  | { kind: "search"; url: string }
  | { kind: "unsupported"; url: string };

export function extractPostUrls(values: Iterable<string>, baseUrl: string): string[] {
  const urls: string[] = [];
  for (const value of values) {
    const decoded = decodeHtmlEntities(String(value));
    for (const match of decoded.matchAll(POST_URL_RE)) {
      urls.push(normalizePostUrl(match[0], baseUrl));
    }
    for (const match of decoded.matchAll(RELATIVE_POST_URL_RE)) {
      urls.push(normalizePostUrl(new URL(match[0], baseUrl).href, baseUrl));
    }
    for (const match of decoded.matchAll(SHARE_URL_RE)) {
      urls.push(normalizeShareUrl(match[0], baseUrl));
    }
    for (const match of decoded.matchAll(RELATIVE_SHARE_URL_RE)) {
      urls.push(normalizeShareUrl(new URL(match[0], baseUrl).href, baseUrl));
    }
  }
  const seen = new Set<string>();
  const output: string[] = [];
  for (const url of urls.map((value) => String(value || "").trim()).filter(Boolean)) {
    const key = cacheKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(url);
  }
  return output;
}

/**
 * Expand normal seed inputs and Threads embed HTML into crawlable targets.
 * An embed contains the same permalink more than once (data attribute + href),
 * so keep the first normalized occurrence only.
 */
export function expandSeedTargetUrls(values: Iterable<string>, baseUrl: string): string[] {
  const expanded: string[] = [];
  for (const value of values) {
    const raw = String(value || "").trim();
    if (!raw) continue;

    // Keep a standalone permalink's query string for browser navigation.
    // Threads share links may carry a signed `xmt` query that is useful while
    // resolving the target. The query is still removed by cacheKey() when
    // deduplicating or storing the canonical post URL.
    const directTarget = normalizeThreadsUrl(raw, baseUrl);
    if (directTarget.kind === "post" && !/[<>]/.test(raw)) {
      expanded.push(normalizeThreadsNavigationUrl(raw, baseUrl));
      continue;
    }

    const embeddedPostUrls = extractPostUrls([raw], baseUrl);
    if (embeddedPostUrls.length > 0) {
      expanded.push(...embeddedPostUrls);
    } else {
      expanded.push(raw);
    }
  }

  const seen = new Set<string>();
  return expanded.filter((value) => {
    const key = cacheKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Normalize a Threads target for browser navigation while retaining its
 * query string. Canonical cache/output URLs continue to use normalizeThreadsUrl
 * and cacheKey, so signed query parameters never create duplicate records.
 */
export function normalizeThreadsNavigationUrl(value: string, baseUrl: string): string {
  const normalized = normalizeThreadsUrl(value, baseUrl);
  if (normalized.kind !== "post") return normalized.url;

  try {
    const source = new URL(String(value || "").trim(), baseUrl || "https://www.threads.com");
    const target = new URL(normalized.url);
    target.search = source.search;
    return target.toString();
  } catch {
    return normalized.url;
  }
}

export function uniqueCandidates<T extends { url: string }>(values: T[]): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const value of values) {
    const cleaned = cacheKey(value.url);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    output.push({ ...value, url: cleaned });
  }
  return output;
}

export function cacheKey(url: string): string {
  return url.split("?")[0]?.split("#")[0]?.replace(/\/$/, "").trim() ?? "";
}

export function normalizeThreadsUrl(
  value: string,
  baseUrl: string,
): NormalizedThreadsTarget {
  const raw = String(value || "").trim();
  if (!raw) {
    return { kind: "unsupported", url: "" };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw, baseUrl || "https://www.threads.com");
  } catch {
    return { kind: "unsupported", url: cacheKey(raw) };
  }

  const base = new URL(baseUrl || "https://www.threads.com");
  const hostname = parsed.hostname.toLowerCase();
  const baseHostname = base.hostname.toLowerCase();
  const isThreadsHost =
    hostname === baseHostname ||
    hostname === "threads.com" ||
    hostname.endsWith(".threads.com") ||
    hostname === "threads.net" ||
    hostname.endsWith(".threads.net");
  if (!isThreadsHost) {
    return { kind: "unsupported", url: cacheKey(parsed.toString()) };
  }
  parsed.protocol = base.protocol;
  parsed.host = base.host;

  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";

  if (/^\/search(?:\/|$)/i.test(pathname)) {
    return { kind: "search", url: parsed.toString() };
  }

  if (/^\/@[^/]+\/post\/[A-Za-z0-9_-]+$/i.test(pathname)) {
    return { kind: "post", url: normalizePostUrl(parsed.toString(), baseUrl) };
  }

  if (/^\/share\/[A-Za-z0-9_-]+$/i.test(pathname)) {
    return { kind: "post", url: normalizeShareUrl(parsed.toString(), baseUrl) };
  }

  if (/^\/t\/[A-Za-z0-9_-]+$/i.test(pathname)) {
    return { kind: "post", url: cacheKey(parsed.toString()) };
  }

  if (/^\/@[^/]+$/i.test(pathname)) {
    return { kind: "profile", url: `${base.protocol}//${base.host}${pathname}` };
  }

  return { kind: "unsupported", url: cacheKey(parsed.toString()) };
}

export function normalizePostUrl(url: string, baseUrl: string): string {
  const match = matchPostUrl(cacheKey(url));
  if (!match) return cacheKey(url);
  const base = new URL(baseUrl || "https://www.threads.com");
  return `${base.protocol}//${base.host}/@${match.username}/post/${match.postId}`;
}

export function normalizeShareUrl(url: string, baseUrl: string): string {
  const match = matchShareUrl(cacheKey(url));
  if (!match) return cacheKey(url);
  const base = new URL(baseUrl || "https://www.threads.com");
  return `${base.protocol}//${base.host}/share/${match.shareId}/`;
}

export function postUrlVariants(url: string, baseUrl: string): string[] {
  const normalized = normalizePostUrl(url, baseUrl);
  const match = matchPostUrl(normalized);
  if (!match) return [normalized];
  const base = new URL(baseUrl || "https://www.threads.com");
  const hosts = [base.host, "www.threads.com", "www.threads.net"];
  return [...new Set(hosts.map((host) => `https://${host}/@${match.username}/post/${match.postId}`))];
}

export function matchPostUrl(
  url: string,
): { username: string; postId: string } | null {
  const match = POST_URL_SINGLE_RE.exec(url);
  const username = match?.groups?.username;
  const postId = match?.groups?.postId;
  return username && postId ? { username, postId } : null;
}

export function matchShareUrl(
  url: string,
): { shareId: string } | null {
  const match = /https?:\/\/(?:[a-z0-9-]+\.)?threads\.(?:com|net)\/share\/(?<shareId>[A-Za-z0-9_-]+)\/?/i.exec(
    url
  );
  const shareId = match?.groups?.shareId;
  return shareId ? { shareId } : null;
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}
