import { extname } from "node:path";
import type { MediaAsset } from "../types.js";

export function normalizeRawMedia(value: unknown): MediaAsset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: MediaAsset[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const type = item.type === "video" ? "video" : "image";
    const remoteUrl = normalizeRemoteAssetUrl(
      String(item.remote_url ?? item.remoteUrl ?? "").trim(),
      type,
    );
    const assetPath = String(item.asset_path ?? item.assetPath ?? "").trim();
    const durationSeconds = metricNumber(
      item.duration_seconds ?? item.durationSeconds,
    );
    if (!remoteUrl && !assetPath) continue;
    if (type === "image" && isLikelyProfileAvatarUrl(remoteUrl)) continue;
    const key = mediaAssetIdentityKey(remoteUrl, assetPath);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      ...(durationSeconds > 0 ? { duration_seconds: durationSeconds } : {}),
      asset_path: assetPath,
      height: metricNumber(item.height),
      order: metricNumber(item.order) || output.length + 1,
      remote_url: remoteUrl,
      type,
      width: metricNumber(item.width),
    });
  }
  if (!output.some((item) => item.type === "video")) {
    return output;
  }

  const withoutVideoPosters = output.filter(
    (item) =>
      item.type !== "image" ||
      !isLikelyVideoPosterUrl(item.remote_url),
  );
  if (withoutVideoPosters.length === output.length) {
    return output;
  }
  return withoutVideoPosters.map((item, index) => ({
    ...item,
    order: index + 1,
  }));
}

export function normalizePostMedia(value: unknown): MediaAsset[] {
  const media = normalizeRawMedia(value);
  if (!media.some((item) => item.type === "video")) return media;

  return media
    .filter((item) => !isLikelyVideoStatusIcon(item))
    .map((item, index) => ({
      ...item,
      order: index + 1,
    }));
}

function isLikelyVideoStatusIcon(item: MediaAsset): boolean {
  if (item.type !== "image" || item.width > 320 || item.height > 320) return false;
  try {
    const url = new URL(item.remote_url);
    return (
      /(?:^|\.)giphy\.com$/i.test(url.hostname) &&
      /\/media\//i.test(url.pathname) &&
      /\.gif(?:$|[?#])/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function isLikelyProfileAvatarUrl(remoteUrl: string): boolean {
  const value = String(remoteUrl || "").trim();
  if (!value) return false;
  const profileMarker = /(?:profile_pic|anonymous_profile_pic)/i;
  try {
    const url = new URL(value);
    const pathAndSearch = `${url.pathname}${url.search}`;
    if (
      profileMarker.test(decodeURIComponent(pathAndSearch)) ||
      /\/t51\.(?:2885|82787|89012)-19\//i.test(url.pathname)
    ) {
      return true;
    }
    const encodedMetadata = String(url.searchParams.get("efg") || "").trim();
    if (!encodedMetadata) return false;
    const normalizedBase64 = encodedMetadata
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(encodedMetadata.length / 4) * 4, "=");
    return profileMarker.test(
      Buffer.from(normalizedBase64, "base64").toString("utf8"),
    );
  } catch {
    return profileMarker.test(value) || /\/t51\.89012-19\//i.test(value);
  }
}

export function mediaAssetIdentityKey(
  remoteUrl: string,
  assetPath = "",
): string {
  const value = String(remoteUrl || "").trim();
  if (!value) return String(assetPath || "").trim();
  try {
    const url = new URL(value);
    const cacheKey = String(url.searchParams.get("ig_cache_key") || "").trim();
    return `${url.hostname.toLowerCase()}${url.pathname}${cacheKey ? `?ig_cache_key=${cacheKey}` : ""}`;
  } catch {
    return value;
  }
}

export function isLikelyVideoPosterUrl(remoteUrl: string): boolean {
  const value = String(remoteUrl || "").trim();
  if (!value) return false;
  const markerPattern =
    /(?:video[_-](?:default[_-])?(?:cover|poster)(?:[_-]frame)?|video[_-]first[_-]frame(?:[_-](?:thumbnail|poster|cover))?|cover[_-]frame[_-]for[_-]video|(?:^|[._-])video(?:[._-]|$))/i;
  try {
    const url = new URL(value);
    if (markerPattern.test(decodeURIComponent(`${url.pathname}${url.search}`))) {
      return true;
    }
    const encodedMetadata = String(url.searchParams.get("efg") || "").trim();
    if (!encodedMetadata) return false;
    const normalizedBase64 = encodedMetadata
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(encodedMetadata.length / 4) * 4, "=");
    return markerPattern.test(
      Buffer.from(normalizedBase64, "base64").toString("utf8"),
    );
  } catch {
    return markerPattern.test(value);
  }
}

export function normalizeRemoteAssetUrl(
  remoteUrl: string,
  type: "image" | "video" = "image",
): string {
  const value = String(remoteUrl || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (type === "image") {
      if (shouldPreserveExactImageUrl(url)) {
        return url.toString();
      }
      const stp = String(url.searchParams.get("stp") || "").trim();
      if (stp) {
        const normalizedStp = stp
          .split("_")
          .map((part) => part.trim())
          .filter(Boolean)
          .filter((part) => !/^[sp]\d+x\d+$/i.test(part))
          .filter((part) => !/^sh\d+(?:\.\d+)?$/i.test(part))
          .join("_");
        if (normalizedStp) {
          url.searchParams.set("stp", normalizedStp);
        } else {
          url.searchParams.delete("stp");
        }
      }
      url.searchParams.delete("width");
      url.searchParams.delete("height");
    }
    return url.toString();
  } catch {
    return value;
  }
}

function shouldPreserveExactImageUrl(url: URL): boolean {
  const loweredPath = url.pathname.toLowerCase();
  const loweredSearch = url.search.toLowerCase();
  return (
    loweredPath.includes("/t51.2885-19/") ||
    loweredPath.includes("/t51.82787-19/") ||
    loweredPath.includes("profile_pic") ||
    loweredPath.includes("anonymous_profile_pic") ||
    loweredSearch.includes("profile_pic") ||
    loweredSearch.includes("anonymous_profile_pic")
  );
}

export function detectAssetDimensions(
  input: Uint8Array,
  contentType = "",
  remoteUrl = "",
): { height: number; width: number } | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 10) return null;
  const loweredType = String(contentType || "").toLowerCase();
  const loweredUrl = String(remoteUrl || "").toLowerCase();

  if (loweredType.includes("image/png") || loweredUrl.includes(".png")) {
    return readPngDimensions(bytes);
  }
  if (loweredType.includes("image/avif") || loweredUrl.includes(".avif")) {
    return readAvifDimensions(bytes);
  }
  if (
    loweredType.includes("image/jpeg") ||
    loweredType.includes("image/jpg") ||
    loweredUrl.includes(".jpg") ||
    loweredUrl.includes(".jpeg")
  ) {
    return readJpegDimensions(bytes);
  }
  if (loweredType.includes("image/webp") || loweredUrl.includes(".webp")) {
    return readWebpDimensions(bytes);
  }
  if (loweredType.includes("image/gif") || loweredUrl.includes(".gif")) {
    return readGifDimensions(bytes);
  }
  return null;
}

export function assetJsonPath(prefix: string, segments: string[]): string {
  return [prefix.replace(/\\/g, "/").replace(/\/+$/, ""), ...segments]
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/");
}

export function extensionForAsset(remoteUrl: string, contentType: string): string {
  const fromType = extensionFromContentType(contentType);
  if (fromType) return fromType;
  try {
    const extension = extname(new URL(remoteUrl).pathname).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".mp4", ".webm"].includes(extension)) {
      return extension;
    }
  } catch {
    return ".jpg";
  }
  return ".jpg";
}

export function safePathSegment(value: string): string {
  return (
    String(value || "")
      .replace(/[^a-zA-Z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "asset"
  );
}

function extensionFromContentType(contentType: string): string {
  const lowered = contentType.toLowerCase();
  if (lowered.includes("image/png")) return ".png";
  if (lowered.includes("image/avif")) return ".avif";
  if (lowered.includes("image/webp")) return ".webp";
  if (lowered.includes("image/gif")) return ".gif";
  if (lowered.includes("video/mp4")) return ".mp4";
  if (lowered.includes("video/webm")) return ".webm";
  if (lowered.includes("image/jpeg") || lowered.includes("image/jpg")) return ".jpg";
  return "";
}

function metricNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readPngDimensions(bytes: Uint8Array): { height: number; width: number } | null {
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return null;
  }
  return {
    width: readUint32BE(bytes, 16),
    height: readUint32BE(bytes, 20),
  };
}

function readGifDimensions(bytes: Uint8Array): { height: number; width: number } | null {
  const header = String.fromCharCode(...bytes.slice(0, 6));
  if (header !== "GIF87a" && header !== "GIF89a") return null;
  return {
    width: readUint16LE(bytes, 6),
    height: readUint16LE(bytes, 8),
  };
}

function readJpegDimensions(bytes: Uint8Array): { height: number; width: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd9 || marker === 0xda) break;
    const segmentLength = readUint16BE(bytes, offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: readUint16BE(bytes, offset + 5),
        width: readUint16BE(bytes, offset + 7),
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function readWebpDimensions(bytes: Uint8Array): { height: number; width: number } | null {
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (riff !== "RIFF" || webp !== "WEBP") return null;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + readUint24LE(bytes, 24),
      height: 1 + readUint24LE(bytes, 27),
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25) {
    const b0 = bytes[21] ?? 0;
    const b1 = bytes[22] ?? 0;
    const b2 = bytes[23] ?? 0;
    const b3 = bytes[24] ?? 0;
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    return {
      width: readUint16LE(bytes, 26) & 0x3fff,
      height: readUint16LE(bytes, 28) & 0x3fff,
    };
  }
  return null;
}

function readAvifDimensions(bytes: Uint8Array): { height: number; width: number } | null {
  // AVIF stores the image dimensions in the `ispe` box. The box can be
  // nested, so scan the byte stream instead of assuming a fixed offset.
  const marker = [0x69, 0x73, 0x70, 0x65]; // "ispe"
  for (let offset = 4; offset + 16 <= bytes.length; offset += 1) {
    if (
      bytes[offset] !== marker[0] ||
      bytes[offset + 1] !== marker[1] ||
      bytes[offset + 2] !== marker[2] ||
      bytes[offset + 3] !== marker[3]
    ) {
      continue;
    }
    return {
      height: readUint32BE(bytes, offset + 12),
      width: readUint32BE(bytes, offset + 8),
    };
  }
  return null;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16)
  );
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
