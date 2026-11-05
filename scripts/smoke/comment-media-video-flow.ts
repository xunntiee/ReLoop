import { readFileSync } from "node:fs";
import { limitCommentMedia } from "../../apps/server/src/modules/crawl/collectors/threads-web";

const rawMedia = [
  { type: "image", remote_url: "https://cdn.example.test/comment-1.jpg", order: 1 },
  { type: "image", remote_url: "https://cdn.example.test/comment-2.jpg", order: 2 },
  { type: "image", remote_url: "https://cdn.example.test/comment-3.jpg", order: 3 },
];

if (limitCommentMedia(rawMedia).length !== 3) {
  throw new Error("A three-image comment must keep all three media assets.");
}
if (limitCommentMedia(rawMedia, 2).length !== 2) {
  throw new Error("An explicit per-comment media limit must still be respected.");
}
if (limitCommentMedia(rawMedia, 0).length !== 0) {
  throw new Error("A zero per-comment media limit must disable comment assets.");
}

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const collector = read("../../apps/server/src/modules/crawl/collectors/threads-web.ts");
const cache = read("../../apps/server/src/modules/crawl/collectors/threads-cache.ts");
const serverVideo = read("../../apps/server/src/modules/video/service.ts");
const draftActions = read("../../apps/web/src/features/video-workflow/video-draft-actions.tsx");
const card = read("../../apps/web/src/features/video-workflow/video-post-list-card-v2.tsx");
const preview = read("../../apps/web/src/features/video-workflow/video-preview-stage.tsx");
const renderer = read("../../apps/server/src/modules/video/video-renderer.ts");

if (
  !collector.includes("return output.slice(0, 6);") ||
  !collector.includes("limitCommentMedia(comment.media, this.config.maxMediaPerComment)") ||
  !cache.includes("THREADS_EXTRACTION_VERSION = 52")
) {
  throw new Error("Comment crawl must capture the carousel and invalidate the old one-media cache.");
}

if (
  !draftActions.includes("tts_text: comment.tts_text ?? \"\",") ||
  !serverVideo.includes("explicitNarrationText: comment.tts_text") ||
  !card.includes("onCommentTtsTextChange")
) {
  throw new Error("Comment TTS text must reach the voice draft and the editor.");
}

if (
  !preview.includes("slideshowSources") ||
  !preview.includes("slideshowTimeSeconds={sceneElapsedSeconds}") ||
  !renderer.includes("mediaInputIndices.length > 1 && asset.media.paths?.length")
) {
  throw new Error("Multiple comment images must be displayed sequentially in preview and export.");
}

console.log("smoke:comment-media-video-flow ok");
