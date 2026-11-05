import {
  detectAssetDimensions,
  isLikelyVideoPosterUrl,
  normalizeRawMedia,
  normalizeRemoteAssetUrl,
} from "../../apps/server/src/modules/crawl/collectors/threads-media";

const resizedUrl =
  "https://instagram.examplecdn.net/v/t51.82787-15/sample.jpg?stp=cp6_dst-jpg_e35_p320x320_sh2.08_tt6&width=320&height=320";
const normalizedUrl = normalizeRemoteAssetUrl(resizedUrl);
const avatarUrl =
  "https://instagram.examplecdn.net/v/t51.82787-19/avatar.jpg?stp=dst-jpg_s150x150_tt6&oh=demo&oe=demo";
const normalizedAvatarUrl = normalizeRemoteAssetUrl(avatarUrl);
const profileMetadata = Buffer.from(
  JSON.stringify({ vencode_tag: "profile_pic.ww.C3" }),
).toString("base64");
const disguisedProfileAvatarUrl =
  `https://instagram.examplecdn.net/v/t51.89012-19/avatar.jpg?efg=${encodeURIComponent(profileMetadata)}`;

if (normalizedUrl.includes("p320x320") || normalizedUrl.includes("sh2.08")) {
  throw new Error("Expected image URL normalization to remove resize-only stp tokens.");
}

if (normalizedUrl.includes("width=320") || normalizedUrl.includes("height=320")) {
  throw new Error("Expected image URL normalization to remove explicit width/height query params.");
}

const media = normalizeRawMedia([
  {
    asset_path: "",
    height: 0,
    order: 1,
    remote_url: resizedUrl,
    type: "image",
    width: 0,
  },
]);

if (!media[0]?.remote_url || media[0].remote_url !== normalizedUrl) {
  throw new Error("Expected normalizeRawMedia to persist the normalized remote URL.");
}

const videoPosterMetadata = Buffer.from(
  JSON.stringify({
    vencode_tag: "FEED.xpids.640.sdr.video_default_cover_frame.C3",
  }),
).toString("base64");
const videoPosterUrl =
  `https://instagram.examplecdn.net/video-cover.jpg?efg=${encodeURIComponent(videoPosterMetadata)}`;
const modernVideoPosterMetadata = Buffer.from(
  JSON.stringify({ vencode_tag: "FEED.xpids.720.sdr.video.C3" }),
).toString("base64");
const modernVideoPosterUrl =
  `https://instagram.examplecdn.net/media.jpg?efg=${encodeURIComponent(modernVideoPosterMetadata)}`;
const videoUrl = "https://instagram.examplecdn.net/video.mp4";
if (!isLikelyVideoPosterUrl(modernVideoPosterUrl)) {
  throw new Error("Expected modern video-poster metadata to trigger video hydration.");
}
const videoOnlyMedia = normalizeRawMedia([
  {
    height: 360,
    order: 1,
    remote_url: videoPosterUrl,
    type: "image",
    width: 640,
  },
  {
    height: 720,
    order: 2,
    remote_url: videoUrl,
    type: "video",
    width: 1276,
  },
]);
if (
  videoOnlyMedia.length !== 1 ||
  videoOnlyMedia[0]?.type !== "video" ||
  videoOnlyMedia[0]?.order !== 1
) {
  throw new Error("Expected a video cover frame to be removed when its video is present.");
}

const realMixedCarousel = normalizeRawMedia([
  {
    height: 720,
    order: 1,
    remote_url: "https://instagram.examplecdn.net/real-photo.jpg",
    type: "image",
    width: 1276,
  },
  {
    height: 720,
    order: 2,
    remote_url: videoUrl,
    type: "video",
    width: 1276,
  },
]);
if (
  realMixedCarousel.length !== 2 ||
  realMixedCarousel[0]?.type !== "image" ||
  realMixedCarousel[1]?.type !== "video"
) {
  throw new Error("Expected a real mixed image/video carousel to preserve source order.");
}

const duplicateSignedCarouselImages = normalizeRawMedia([
  {
    height: 816,
    order: 1,
    remote_url:
      "https://instagram.examplecdn.net/v/t51.82787-15/same-photo.jpg?ig_cache_key=asset-1&_nc_gid=session-a&oh=signature-a",
    type: "image",
    width: 598,
  },
  {
    height: 816,
    order: 2,
    remote_url:
      "https://instagram.examplecdn.net/v/t51.82787-15/same-photo.jpg?ig_cache_key=asset-1&_nc_gid=session-b&oh=signature-b",
    type: "image",
    width: 598,
  },
]);
if (duplicateSignedCarouselImages.length !== 1) {
  throw new Error("Expected signed URLs for the same carousel image to be deduplicated.");
}

if (normalizedAvatarUrl !== avatarUrl) {
  throw new Error("Expected avatar/profile image URLs to preserve exact query params.");
}

const avatarOnlyMedia = normalizeRawMedia([
  {
    height: 206,
    order: 1,
    remote_url: disguisedProfileAvatarUrl,
    type: "image",
    width: 206,
  },
]);
if (avatarOnlyMedia.length !== 0) {
  throw new Error("Expected profile avatars to be excluded from crawled media.");
}

const png1x1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x04, 0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c,
  0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41,
  0x54, 0x78, 0xda, 0x63, 0xfc, 0xff, 0x1f, 0x00,
  0x03, 0x03, 0x02, 0x00, 0xef, 0xef, 0x59, 0x3d,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

const dimensions = detectAssetDimensions(png1x1, "image/png", normalizedUrl);
if (!dimensions || dimensions.width !== 1 || dimensions.height !== 1) {
  throw new Error("Expected PNG dimension detection to return 1x1.");
}

console.log("smoke:media-quality ok");
