import {
  fetchAssetBytes,
  fetchBrowserLocalAssetBytes,
  isDefinitiveAssetDownloadFailure,
} from "../../apps/server/src/modules/crawl/collectors/threads-web";
import {
  isLikelyVideoPosterUrl,
  normalizePostMedia,
} from "../../apps/server/src/modules/crawl/collectors/threads-media";

if (!isDefinitiveAssetDownloadFailure("playwright:403 | fetch:403")) {
  throw new Error(
    "Expected a signed CDN 403 to be removed from crawled media."
  );
}

if (isDefinitiveAssetDownloadFailure("fetch:This operation was aborted")) {
  throw new Error(
    "Expected transient asset download failures to remain retryable."
  );
}

const fakePage = {
  evaluate: async () => ({
    base64: Buffer.from("video-bytes").toString("base64"),
    contentType: "video/mp4",
  }),
} as never;
const browserLocalAsset = await fetchBrowserLocalAssetBytes(
  fakePage,
  "blob:https://www.threads.com/video"
);
if (
  !browserLocalAsset ||
  "error" in browserLocalAsset ||
  Buffer.from(browserLocalAsset.bytes).toString() !== "video-bytes"
) {
  throw new Error(
    "Expected browser-local asset bytes to be decoded from the page context."
  );
}

const fetchedBlobAsset = await fetchAssetBytes(
  fakePage,
  "blob:https://www.threads.com/video",
  1000
);
if (
  !fetchedBlobAsset ||
  "error" in fetchedBlobAsset ||
  fetchedBlobAsset.contentType !== "video/mp4"
) {
  throw new Error(
    "Expected blob media to use the browser-local asset fetch path."
  );
}

const postMedia = normalizePostMedia([
  {
    height: 200,
    order: 1,
    remote_url: "https://media3.giphy.com/media/example/200.gif",
    type: "image",
    width: 200,
  },
  {
    height: 540,
    order: 2,
    remote_url: "blob:https://www.threads.com/video",
    type: "video",
    width: 725,
  },
]);
if (postMedia.length !== 1 || postMedia[0]?.type !== "video") {
  throw new Error("Expected a status Giphy icon to be excluded when a post has video media.");
}

const gifOnlyPost = normalizePostMedia([
  {
    height: 200,
    order: 1,
    remote_url: "https://media3.giphy.com/media/example/200.gif",
    type: "image",
    width: 200,
  },
]);
if (gifOnlyPost.length !== 1 || gifOnlyPost[0]?.type !== "image") {
  throw new Error("Expected a GIF-only post to retain its media.");
}

if (!isLikelyVideoPosterUrl("https://cdn.example.com/video_first_frame_thumbnail.jpg")) {
  throw new Error("Expected Threads video_first_frame_thumbnail posters to be detected.");
}

console.log("smoke:asset-download-failures ok");
