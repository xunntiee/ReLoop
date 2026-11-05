import {
  isAnimatedWebpBuffer,
  resolveExportMediaLayout,
  resolveMediaRevealScaleFilter,
  resolveMidrollInsertionSeconds,
  resolvePostVideoPlaybackDurationMs,
  resolveSceneVisualText,
  resolveVideoCardAspectRatio,
} from "../../apps/server/src/modules/video/video-renderer";
import { resolvePostVideoDurationWithinTotalMs } from "../../apps/server/src/modules/video/service";
import { resolvePreviewPostVideoDurationWithinTotalMs } from "../../apps/web/src/features/video-workflow/video-preview-stage";
import type { VideoDraftDocument } from "../../apps/server/src/modules/video/types";

const staticWebp = Buffer.from("RIFF0000WEBPVP8 static-image-data", "ascii");
if (isAnimatedWebpBuffer(staticWebp)) {
  throw new Error("Expected a static WebP file to remain embedded in the card.");
}

const animatedWebp = Buffer.from(
  "RIFF0000WEBPVP8Xanimated-ANIM-data-ANMF-frame",
  "ascii",
);
if (!isAnimatedWebpBuffer(animatedWebp)) {
  throw new Error("Expected an animated WebP file to use the animated media layer.");
}

const layout = resolveExportMediaLayout({
  cardWidth: 1080,
  mediaHeight: 674,
  mediaWidth: 822,
  mediaX: 129,
  mediaY: 337,
});
const expected = {
  cardWidth: 900,
  height: 562,
  radius: 23,
  width: 686,
  x: 108,
  y: 281,
};
if (JSON.stringify(layout) !== JSON.stringify(expected)) {
  throw new Error(
    `Expected exported media to follow the scaled card layout: ${JSON.stringify(layout)}`,
  );
}

const postVideoLayout = resolveExportMediaLayout({
  cardWidth: 1080,
  mediaHeight: 462,
  mediaWidth: 822,
  mediaX: 129,
  mediaY: 337,
  targetCardWidth: 1080,
});
const expectedPostVideoLayout = {
  cardWidth: 1080,
  height: 462,
  radius: 28,
  width: 822,
  x: 129,
  y: 337,
};
if (JSON.stringify(postVideoLayout) !== JSON.stringify(expectedPostVideoLayout)) {
  throw new Error(
    `Expected post video to retain the preview card width: ${JSON.stringify(postVideoLayout)}`,
  );
}

if (resolveVideoCardAspectRatio(9 / 16) !== 0.9) {
  throw new Error("Expected portrait source video to use the taller card media frame.");
}
if (resolveVideoCardAspectRatio(16 / 9) !== 1.22) {
  throw new Error("Expected landscape source video to retain the standard card media frame.");
}

if (!resolveMediaRevealScaleFilter("video").includes("crop=1080:1920")) {
  throw new Error("Expected original videos to fill the media-reveal frame.");
}
if (!resolveMediaRevealScaleFilter("image").includes("pad=1080:1920")) {
  throw new Error("Expected original images to retain their full frame.");
}

if (
  resolvePostVideoPlaybackDurationMs({
    captionDurationMs: 2_000,
    sourceDurationMs: 87_000,
    totalDurationMs: 5_000,
  }) !== 3_000
) {
  throw new Error("Expected the source video to use the caption's remaining time budget.");
}
if (
  resolvePostVideoPlaybackDurationMs({ sourceDurationMs: 87_000 }) !== 87_000
) {
  throw new Error("Expected an unset duration to keep the full original video.");
}
if (
  resolvePostVideoDurationWithinTotalMs({
    captionDurationMs: 2_000,
    sourceVideoDurationMs: 87_000,
    totalDurationMs: 10_000,
  }) !== 8_000
) {
  throw new Error("Expected the draft timeline to split a custom total across caption and video.");
}
if (
  resolvePreviewPostVideoDurationWithinTotalMs({
    captionDurationMs: 2_000,
    sourceDurationMs: 87_000,
    totalDurationMs: 10_000,
  }) !== 8_000
) {
  throw new Error("Expected preview to match the caption and video total duration.");
}

const midrollDraft = {
  scenes: [
    {
      kind: "post",
      timeline: { end_ms: 5_000, start_ms: 0 },
    },
    {
      kind: "comment",
      timeline: { end_ms: 12_000, start_ms: 5_000 },
    },
    {
      kind: "comment",
      timeline: { end_ms: 20_000, start_ms: 12_000 },
    },
    {
      kind: "comment",
      timeline: { end_ms: 28_000, start_ms: 20_000 },
    },
    {
      kind: "comment",
      timeline: { end_ms: 36_000, start_ms: 28_000 },
    },
  ],
  video_plan: { duration_target_seconds: 36 },
} as VideoDraftDocument;
const insertionSeconds = resolveMidrollInsertionSeconds(midrollDraft);
if (insertionSeconds !== 20) {
  throw new Error(
    `Expected midroll after half of the comments at 20s, received ${insertionSeconds}.`,
  );
}

const oneCommentDraft = {
  ...midrollDraft,
  scenes: midrollDraft.scenes.slice(0, 2),
  video_plan: { duration_target_seconds: 12 },
} as VideoDraftDocument;
if (resolveMidrollInsertionSeconds(oneCommentDraft) !== 5) {
  throw new Error(
    "Expected midroll to use the post/comment boundary when there is only one comment.",
  );
}

if (
  resolveSceneVisualText({
    isDialogueScene: false,
    postText: "Caption của bài gốc",
    sceneKind: "post_video",
    sceneText: "",
  }) !== "Caption của bài gốc"
) {
  throw new Error("Expected post-video cards to retain the post caption.");
}

console.log("smoke:video-render-media ok");
