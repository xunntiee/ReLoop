import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import type { ToolConfig } from "@tool-base/config/schema";
import type { Page } from "playwright";
import { resolveChromiumLaunchOptions } from "../crawl/browser-launch.js";
import { probeDurationMs, probeVideoDurationMs } from "./audio-tools.js";
import {
  compactMediaProcessError,
  ensureFfmpegReady,
  findAvailableMediaBinary,
} from "./ffmpeg.js";
import {
  registerVideoRuntimeCleanup,
  trackVideoChildProcess,
} from "./runtime-processes.js";

import type {
  MemeTransitionConfig,
  VideoDraftComment,
  VideoDraftDocument,
  VideoDraftMediaAsset,
  VideoDraftPost,
  VideoDraftScene,
  VideoPromotionSlot,
  VideoRenderResult,
  VideoSpoilerRevealRegion,
  VideoThumbnailLayerId,
  VideoThumbnailLayerLayout,
  VideoThumbnailIntro,
} from "./types.js";

const WIDTH = 1080;
const HEIGHT = 1920;
const POST_ENTER_SECONDS = 0.32;
const COMMENT_ENTER_SECONDS = 0.42;
const CARD_EXIT_SECONDS = 0.3;
const POST_FADE_IN_SECONDS = 0.24;
const COMMENT_FADE_IN_SECONDS = 0.24;
const CARD_FADE_OUT_SECONDS = 0.24;
const POST_ENTER_SCALE = 0.975;
const COMMENT_ENTER_OFFSET_Y = 34;
const COMMENT_EXIT_OFFSET_Y = 12;
const CARD_WIDTH = 900;
const CARD_PADDING_X = 39;
const CARD_PADDING_Y = 39;
const CARD_MEDIA_ASPECT_RATIO = 1.22;
const MIN_VIDEO_CARD_ASPECT_RATIO = 0.9;
const CARD_MEDIA_BORDER_RADIUS = 28;
const DEFAULT_COMMENT_MEDIA_MAX_HEIGHT = 760;
const MAX_COMMENT_CARD_HEIGHT = 1380;
const MIN_COMMENT_MEDIA_HEIGHT = 300;
const DEFAULT_POST_MEDIA_MAX_HEIGHT = 980;
// The post card is composited on a 1080x1920 canvas with a top/bottom safe
// margin.  Keeping it below this limit guarantees that a tall source image
// is reduced before the card can be clipped by the TikTok frame.
const MAX_POST_CARD_HEIGHT = 1640;
const MIN_POST_MEDIA_HEIGHT = 360;
const PREVIEW_EXPORT_BOTTOM_PADDING = 80;
const PREVIEW_EXPORT_CARD_TOP_SHIFT = 90;
const PREVIEW_EXPORT_MEME_SIZE = 620;
const DEFAULT_NARRATION_GAIN = 1.9;
const NARRATION_LIMIT = 0.96;
const DEFAULT_BACKGROUND_MUSIC_VOLUME = 0.24;
const DEFAULT_MEME_TRANSITION_MS = 1200;
const MIN_MEME_TRANSITION_MS = 1000;
const MAX_MEME_TRANSITION_MS = 2700;
const MAX_POST_VIDEO_DURATION_MS = 120000;
const DISPLAY_METRIC_MIN_BUMP = 100;
const DISPLAY_METRIC_MAX_BUMP = 200;
const DISPLAY_LIKE_MIN_BUMP = 103;
const DEFAULT_VIDEO_COMMENT_ID = "__default_monback_comment__";
const DEFAULT_PROFILE_AVATAR_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns=%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 viewBox=%220 0 96 96%22%3E%3Crect width=%2296%22 height=%2296%22 rx=%2248%22 fill=%22%23e2e8f0%22%2F%3E%3Ccircle cx=%2248%22 cy=%2236%22 r=%2216%22 fill=%22%2394a3b8%22%2F%3E%3Cpath d=%22M20 80c4-16 15-24 28-24s24 8 28 24%22 fill=%22%2394a3b8%22%2F%3E%3C%2Fsvg%3E";

interface SceneRenderAsset {
  cardHeight: number;
  cardPath: string;
  cardPathInitial?: string;
  cardPathSpoilerStages?: string[];
  cardPathTextReveal?: string;
  cardWidth: number;
  cardY: number;
  hasMediaSpoiler?: boolean;
  media: SceneRenderMedia | null;
  mediaReveal?: SceneRenderMedia | null;
  postVideo?: SceneRenderMedia | null;
  memeOverlayPath?: string | null;
  trailingMemeOverlayPath?: string | null;
  sceneId: string;
  spoilerRevealSegments?: Array<{
    revealTimeSeconds: number;
  }>;
  spoilerRevealTimeSeconds?: number;
  spoilerMediaRevealTimeSeconds?: number;
}

interface SceneRenderMedia {
  fitMode: "contain" | "cover";
  height: number;
  inputIndex?: number;
  inputIndices?: number[];
  paths?: string[];
  path: string;
  playback: "animated" | "still" | "video";
  type: "image" | "video";
  width: number;
  x: number;
  y: number;
}

interface RenderContext {
  baseDir: string;
  config: ToolConfig["video"];
}

interface GeneratedSceneAssetsResult {
  sceneAssets: SceneRenderAsset[];
  thumbnailPath: string | null;
}

interface ThumbnailAnimationAsset {
  height: number;
  inputIndex?: number;
  layer: "brand";
  path: string;
  width: number;
  x: number;
  y: number;
}

interface MemeAudioOverlay {
  delayMs: number;
  durationSeconds: number;
  path: string;
}

interface PromotionRenderSegment {
  durationSeconds: number;
  fitMode: "contain" | "cover";
  path: string;
  slot: "midroll" | "outro";
  volume: number;
}

interface PromotionRenderPlan {
  insertionSeconds: number | null;
  segments: PromotionRenderSegment[];
}

function hashMetricSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function buildDisplayMetrics(
  seed: string,
  counts: { likes: number; replies: number; reposts: number; shares: number }
): { likes: number; replies: number; reposts: number; shares: number } {
  const usedBumps = new Set<number>();
  const usedFinals = new Set<number>();

  const resolveMetric = (
    key: string,
    baseValue: number,
    minBump: number,
    maxBump: number
  ): number => {
    const normalizedBase = Math.max(0, Math.floor(Number(baseValue) || 0));
    const range = maxBump - minBump + 1;
    const start = minBump + (hashMetricSeed(`${seed}:${key}`) % range);

    for (let offset = 0; offset < range; offset++) {
      const bump = minBump + ((start - minBump + offset) % range);
      const finalValue = normalizedBase + bump;
      if (usedBumps.has(bump) || usedFinals.has(finalValue)) {
        continue;
      }
      usedBumps.add(bump);
      usedFinals.add(finalValue);
      return finalValue;
    }

    const fallback = normalizedBase + start;
    usedFinals.add(fallback);
    return fallback;
  };

  const likeValue = resolveMetric(
    "likes",
    counts.likes,
    DISPLAY_LIKE_MIN_BUMP,
    DISPLAY_METRIC_MAX_BUMP
  );
  const likeBump =
    likeValue - Math.max(0, Math.floor(Number(counts.likes) || 0));
  const secondaryMaxBump = Math.max(DISPLAY_METRIC_MIN_BUMP, likeBump - 1);

  return {
    likes: likeValue,
    replies: resolveMetric(
      "replies",
      counts.replies,
      DISPLAY_METRIC_MIN_BUMP,
      secondaryMaxBump
    ),
    reposts: resolveMetric(
      "reposts",
      counts.reposts,
      DISPLAY_METRIC_MIN_BUMP,
      secondaryMaxBump
    ),
    shares: resolveMetric(
      "shares",
      counts.shares,
      DISPLAY_METRIC_MIN_BUMP,
      secondaryMaxBump
    ),
  };
}

export async function renderVideoDraft(
  draft: VideoDraftDocument,
  context: RenderContext
): Promise<VideoRenderResult> {
  assertVideoDraftAssets(draft, context.baseDir);

  if (
    draft.scenes.some(
      (scene) =>
        scene.kind !== "post_video" && scene.narration.status !== "ready"
    )
  ) {
    throw new Error(
      "Voice chưa sẵn sàng. Hãy bấm Tạo voice trước khi lưu video."
    );
  }

  const ffmpegPath = await ensureFfmpegReady(
    context.config.ffmpegPath,
    context.baseDir
  );

  const backgroundPath = resolve(context.baseDir, draft.uploaded_video!.serverPath!);

  const renderDir = resolve(
    context.baseDir,
    context.config.rendersDir,
    draft.draft_id
  );
  await mkdir(renderDir, { recursive: true });

  // Resolve post media before building the audio track. Remote media is
  // downloaded once here and the same local file is reused for both video and
  // original-audio streams.
  const { sceneAssets, thumbnailPath } = await generateSceneAssets({
    draft,
    renderDir,
    baseDir: context.baseDir,
  });
  await synchronizeRenderedPostVideoTimelines(draft, sceneAssets);
  const totalDurationSeconds = getDraftDurationSeconds(draft);
  const promotionPlan = await resolvePromotionRenderPlan({
    baseDir: context.baseDir,
    draft,
  });
  const narrationPath = await buildNarrationAudio({
    context,
    draft,
    ffmpegPath,
    renderDir,
  });
  const audioPath = await buildFinalAudioTrack({
    context,
    draft,
    ffmpegPath,
    narrationPath,
    renderDir,
    sceneAssets,
    totalDurationSeconds,
  });
  const outputPath = resolve(renderDir, `${draft.draft_id}.mp4`);
  const contentOutputPath =
    promotionPlan.segments.length > 0
      ? resolve(renderDir, `${draft.draft_id}-content.mp4`)
      : outputPath;

  const thumbnailAnimationAssets = thumbnailPath
    ? collectThumbnailAnimationAssets(draft, context.baseDir)
    : [];

  const ffmpegArgs = [
    "-y",
    "-i",
    backgroundPath,
    "-i",
    audioPath,
  ];

  let currentCardInputIndex = 2;
  for (const asset of sceneAssets) {
    if (asset.cardPathInitial) {
      (asset as any).initialInputIndex = currentCardInputIndex++;
      ffmpegArgs.push("-loop", "1", "-i", asset.cardPathInitial);
    }
    if (asset.cardPathSpoilerStages?.length) {
      (asset as any).spoilerStageInputIndices = [];
      for (const stagePath of asset.cardPathSpoilerStages) {
        (asset as any).spoilerStageInputIndices.push(currentCardInputIndex++);
        ffmpegArgs.push("-loop", "1", "-i", stagePath);
      }
    }
    if (asset.cardPathTextReveal) {
      (asset as any).textRevealInputIndex = currentCardInputIndex++;
      ffmpegArgs.push("-loop", "1", "-i", asset.cardPathTextReveal);
    }
    (asset as any).revealInputIndex = currentCardInputIndex++;
    ffmpegArgs.push("-loop", "1", "-i", asset.cardPath);
  }

  for (const asset of sceneAssets) {
    const mediaInputs = [asset.media, asset.mediaReveal, asset.postVideo].filter(
      (media, index, values): media is SceneRenderMedia =>
        Boolean(media) && values.indexOf(media) === index
    );
    for (const media of mediaInputs) {
      const mediaPaths = media.paths?.length ? media.paths : [media.path];
      media.inputIndices = mediaPaths.map((mediaPath) => {
        const inputIndex = ffmpegArgsInputIndex(ffmpegArgs);
        if (media.playback === "still") {
          ffmpegArgs.push("-loop", "1", "-i", mediaPath);
        } else {
          ffmpegArgs.push("-stream_loop", "-1", "-i", mediaPath);
        }
        return inputIndex;
      });
      media.inputIndex = media.inputIndices[0];
    }
  }

  let thumbnailInputIndex: number | null = null;
  if (thumbnailPath) {
    thumbnailInputIndex = ffmpegArgsInputIndex(ffmpegArgs);
    ffmpegArgs.push("-loop", "1", "-i", thumbnailPath);
  }

  for (const asset of thumbnailAnimationAssets) {
    asset.inputIndex = ffmpegArgsInputIndex(ffmpegArgs);
    ffmpegArgs.push("-stream_loop", "-1", "-i", asset.path);
  }

  const memeImageInputIndices = draft.scenes.map((scene) => {
    const sceneIndex = draft.scenes.findIndex(
      (candidate) => candidate.scene_id === scene.scene_id
    );
    const sceneAsset = sceneAssets[sceneIndex];
    if (!sceneAsset?.memeOverlayPath) {
      return null;
    }

    const inputIndex = ffmpegArgsInputIndex(ffmpegArgs);
    if (isLoopingMediaPath(sceneAsset.memeOverlayPath)) {
      ffmpegArgs.push("-stream_loop", "-1", "-i", sceneAsset.memeOverlayPath);
    } else {
      ffmpegArgs.push("-loop", "1", "-i", sceneAsset.memeOverlayPath);
    }
    return inputIndex;
  });

  const trailingMemeImageInputIndices = draft.scenes.map((scene) => {
    const sceneIndex = draft.scenes.findIndex(
      (candidate) => candidate.scene_id === scene.scene_id
    );
    const sceneAsset = sceneAssets[sceneIndex];
    if (!sceneAsset?.trailingMemeOverlayPath) {
      return null;
    }

    const inputIndex = ffmpegArgsInputIndex(ffmpegArgs);
    if (isLoopingMediaPath(sceneAsset.trailingMemeOverlayPath)) {
      ffmpegArgs.push(
        "-stream_loop",
        "-1",
        "-i",
        sceneAsset.trailingMemeOverlayPath
      );
    } else {
      ffmpegArgs.push("-loop", "1", "-i", sceneAsset.trailingMemeOverlayPath);
    }
    return inputIndex;
  });

  const filterPath = await buildFilterScript({
    draft,
    memeImageInputIndices,
    trailingMemeImageInputIndices,
    renderDir,
    sceneAssets,
    thumbnailInputIndex,
    thumbnailAnimationAssets,
    totalDurationSeconds,
  });

  ffmpegArgs.push(
    "-filter_threads",
    "1",
    "-filter_complex_threads",
    "1",
    "-filter_complex_script",
    filterPath,
    "-map",
    "[vout]",
    "-map",
    "1:a",
    "-t",
    totalDurationSeconds.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "faster",
    "-crf",
    "17",
    "-threads",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
    "-shortest",
    contentOutputPath
  );

  await runProcess(ffmpegPath, ffmpegArgs);

  if (promotionPlan.segments.length > 0) {
    await splicePromotionVideos({
      baseDir: context.baseDir,
      contentDurationSeconds: totalDurationSeconds,
      contentPath: contentOutputPath,
      ffmpegPath,
      outputPath,
      plan: promotionPlan,
    });
  }

  // Copy final MP4 to exported_videos folder in the workspace root
  const exportsDir = resolve(context.baseDir, "exported_videos");
  await mkdir(exportsDir, { recursive: true });
  const exportFilename = resolveExportFilename(draft, exportsDir);
  const exportPath = resolve(exportsDir, exportFilename);
  await copyFile(outputPath, exportPath);

  const info = await stat(exportPath);
  const publicPath = toUrlPath(relative(context.baseDir, exportPath));
  const promotionDurationSeconds = promotionPlan.segments.reduce(
    (total, segment) => total + segment.durationSeconds,
    0
  );
  return {
    durationSeconds: totalDurationSeconds + promotionDurationSeconds,
    filename: basename(exportPath),
    outputPath: publicPath,
    sizeBytes: info.size,
    url: `/media/${publicPath}`,
  };
}

/** Validate user-local assets before a render job is queued. */
export function assertVideoDraftAssets(
  draft: VideoDraftDocument,
  baseDir: string,
): void {
  if (!draft.uploaded_video?.serverPath) {
    throw new Error(
      "Chưa có video nền trên server. Hãy tải video lên trước khi lưu MP4.",
    );
  }

  const backgroundPath = resolve(baseDir, draft.uploaded_video.serverPath);
  if (!existsSync(backgroundPath)) {
    throw new Error(
      "Không tìm thấy file video nền trên máy này. Hãy chọn hoặc tải lại video nền.",
    );
  }

  const musicPath = draft.background_music?.serverPath
    ? resolve(baseDir, draft.background_music.serverPath)
    : null;
  if (musicPath && !existsSync(musicPath)) {
    throw new Error(
      "Không tìm thấy nhạc nền trên máy này. Hãy chọn lại hoặc tải lại nhạc nền.",
    );
  }

  const thumbnailPath = draft.thumbnail_intro?.image?.serverPath
    ? resolve(baseDir, draft.thumbnail_intro.image.serverPath)
    : null;
  if (thumbnailPath && !existsSync(thumbnailPath)) {
    throw new Error(
      "Không tìm thấy ảnh thumbnail trên máy này. Hãy tải lại ảnh thumbnail."
    );
  }
  const thumbnailBackgroundPath = draft.thumbnail_intro?.background?.serverPath
    ? resolve(baseDir, draft.thumbnail_intro.background.serverPath)
    : null;
  if (thumbnailBackgroundPath && !existsSync(thumbnailBackgroundPath)) {
    throw new Error(
      "Không tìm thấy ảnh background thumbnail. Hãy tải lại ảnh background."
    );
  }
  const brandImagePath = draft.thumbnail_intro?.brandImage?.serverPath
    ? resolve(baseDir, draft.thumbnail_intro.brandImage.serverPath)
    : null;
  if (brandImagePath && !existsSync(brandImagePath)) {
    throw new Error(
      "Không tìm thấy ảnh thương hiệu của thumbnail. Hãy tải lại ảnh."
    );
  }

  const watermarkPath = draft.thumbnail_intro?.watermark?.serverPath
    ? resolve(baseDir, draft.thumbnail_intro.watermark.serverPath)
    : null;
  if (watermarkPath && !existsSync(watermarkPath)) {
    throw new Error(
      "KhÃ´ng tÃ¬m tháº¥y áº£nh watermark cá»§a thumbnail. HÃ£y táº£i láº¡i áº£nh."
    );
  }

  const promotionSlots = [
    ["giữa video", draft.promotion?.midroll],
    ["cuối video", draft.promotion?.outro],
  ] as const;
  for (const [label, slot] of promotionSlots) {
    if (!slot?.enabled || !slot.video?.serverPath) continue;
    const promotionPath = resolve(baseDir, slot.video.serverPath);
    if (!existsSync(promotionPath)) {
      throw new Error(
        `Không tìm thấy video quảng bá ${label} trên máy này. Hãy tải lại video quảng bá.`,
      );
    }
  }
}

async function resolvePromotionRenderPlan({
  baseDir,
  draft,
}: {
  baseDir: string;
  draft: VideoDraftDocument;
}): Promise<PromotionRenderPlan> {
  const segments: PromotionRenderSegment[] = [];
  const insertionSeconds = resolveMidrollInsertionSeconds(draft);

  const midroll =
    insertionSeconds === null
      ? null
      : await resolvePromotionSegment(
          draft.promotion?.midroll,
          "midroll",
          baseDir
        );
  if (midroll) {
    segments.push(midroll);
  }

  const outro = await resolvePromotionSegment(
    draft.promotion?.outro,
    "outro",
    baseDir
  );
  if (outro) {
    segments.push(outro);
  }

  return {
    insertionSeconds: midroll ? insertionSeconds : null,
    segments,
  };
}

async function resolvePromotionSegment(
  slot: VideoPromotionSlot | null | undefined,
  slotName: "midroll" | "outro",
  baseDir: string
): Promise<PromotionRenderSegment | null> {
  if (!(slot?.enabled && slot.video?.serverPath)) {
    return null;
  }

  const path = resolve(baseDir, slot.video.serverPath);
  if (!existsSync(path)) {
    throw new Error(
      slotName === "midroll"
        ? "Không tìm thấy video quảng bá giữa video."
        : "Không tìm thấy video quảng bá cuối video."
    );
  }

  const configuredDuration = Number(slot.video.durationSeconds ?? 0);
  const probedDurationMs =
    configuredDuration > 0 ? null : await probeDurationMs(path);
  const durationSeconds =
    configuredDuration > 0
      ? configuredDuration
      : Math.max(0, Number(probedDurationMs ?? 0) / 1000);
  if (durationSeconds <= 0) {
    throw new Error(
      `Không đọc được thời lượng video quảng bá "${slot.video.name}".`
    );
  }

  return {
    durationSeconds,
    fitMode: slot.fitMode === "contain" ? "contain" : "cover",
    path,
    slot: slotName,
    volume: Math.min(1, Math.max(0, Number(slot.volume ?? 1))),
  };
}

export function resolveMidrollInsertionSeconds(
  draft: VideoDraftDocument
): number | null {
  const contentDurationMs = getDraftDurationSeconds(draft) * 1000;
  const targetMs = contentDurationMs / 2;
  const boundaries = draft.scenes
    .slice(0, -1)
    .map((scene) => scene.timeline?.end_ms ?? 0)
    .filter(
      (boundaryMs) => boundaryMs > 100 && boundaryMs < contentDurationMs - 100
    );
  if (boundaries.length === 0) {
    return null;
  }

  const boundaryMs = boundaries.reduce((closest, candidate) =>
    Math.abs(candidate - targetMs) < Math.abs(closest - targetMs)
      ? candidate
      : closest
  );
  return boundaryMs / 1000;
}

async function splicePromotionVideos({
  baseDir,
  contentDurationSeconds,
  contentPath,
  ffmpegPath,
  outputPath,
  plan,
}: {
  baseDir: string;
  contentDurationSeconds: number;
  contentPath: string;
  ffmpegPath: string;
  outputPath: string;
  plan: PromotionRenderPlan;
}): Promise<void> {
  const ffprobePath = await findAvailableMediaBinary("ffprobe", baseDir);
  if (!ffprobePath) {
    throw new Error("Không tìm thấy FFprobe để ghép video quảng bá.");
  }

  const args = ["-y", "-i", contentPath];
  const segmentInputs: Array<
    PromotionRenderSegment & { inputIndex: number; silentInputIndex?: number }
  > = [];
  let nextInputIndex = 1;
  for (const segment of plan.segments) {
    args.push("-i", segment.path);
    const inputIndex = nextInputIndex;
    nextInputIndex += 1;
    const hasAudio = await mediaHasAudio(ffprobePath, segment.path);
    let silentInputIndex: number | undefined;
    if (!hasAudio) {
      silentInputIndex = nextInputIndex;
      nextInputIndex += 1;
      args.push(
        "-f",
        "lavfi",
        "-t",
        segment.durationSeconds.toFixed(3),
        "-i",
        "anullsrc=r=44100:cl=stereo"
      );
    }
    segmentInputs.push({
      ...segment,
      inputIndex,
      silentInputIndex,
    });
  }

  const midroll = segmentInputs.find((segment) => segment.slot === "midroll");
  const outro = segmentInputs.find((segment) => segment.slot === "outro");
  const filters: string[] = [];
  const concatLabels: string[] = [];

  if (midroll && plan.insertionSeconds !== null) {
    const insertion = plan.insertionSeconds;
    filters.push(
      `[0:v]trim=start=0:end=${insertion.toFixed(3)},setpts=PTS-STARTPTS,fps=30,format=yuv420p,setsar=1[content_v_0]`,
      `[0:a]atrim=start=0:end=${insertion.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[content_a_0]`
    );
    concatLabels.push("[content_v_0][content_a_0]");
    appendPromotionSegmentFilters(filters, concatLabels, midroll, "midroll");
    filters.push(
      `[0:v]trim=start=${insertion.toFixed(3)}:end=${contentDurationSeconds.toFixed(3)},setpts=PTS-STARTPTS,fps=30,format=yuv420p,setsar=1[content_v_1]`,
      `[0:a]atrim=start=${insertion.toFixed(3)}:end=${contentDurationSeconds.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[content_a_1]`
    );
    concatLabels.push("[content_v_1][content_a_1]");
  } else {
    filters.push(
      `[0:v]trim=start=0:end=${contentDurationSeconds.toFixed(3)},setpts=PTS-STARTPTS,fps=30,format=yuv420p,setsar=1[content_v]`,
      `[0:a]atrim=start=0:end=${contentDurationSeconds.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[content_a]`
    );
    concatLabels.push("[content_v][content_a]");
  }

  if (outro) {
    appendPromotionSegmentFilters(filters, concatLabels, outro, "outro");
  }

  filters.push(
    `${concatLabels.join("")}concat=n=${concatLabels.length}:v=1:a=1[vout][aout]`
  );

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "faster",
    "-crf",
    "17",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath
  );
  await runProcess(ffmpegPath, args);
}

function appendPromotionSegmentFilters(
  filters: string[],
  concatLabels: string[],
  segment: PromotionRenderSegment & {
    inputIndex: number;
    silentInputIndex?: number;
  },
  label: string
): void {
  const duration = segment.durationSeconds;
  const fadeSeconds = Math.min(0.25, Math.max(0, duration / 4));
  const fadeOutStart = Math.max(0, duration - fadeSeconds);
  const videoFit =
    segment.fitMode === "contain"
      ? `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`
      : `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop=${WIDTH}:${HEIGHT}`;
  const videoFade =
    fadeSeconds > 0.01
      ? `,fade=t=in:st=0:d=${fadeSeconds.toFixed(3)},fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeSeconds.toFixed(3)}`
      : "";
  filters.push(
    `[${segment.inputIndex}:v]${videoFit},setsar=1,fps=30,format=yuv420p,trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS${videoFade}[${label}_v]`
  );

  const audioInputIndex = segment.silentInputIndex ?? segment.inputIndex;
  const audioFade =
    fadeSeconds > 0.01
      ? `,afade=t=in:st=0:d=${fadeSeconds.toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeSeconds.toFixed(3)}`
      : "";
  filters.push(
    `[${audioInputIndex}:a]atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${segment.volume.toFixed(3)}${audioFade}[${label}_a]`
  );
  concatLabels.push(`[${label}_v][${label}_a]`);
}

async function mediaHasAudio(
  ffprobePath: string,
  path: string
): Promise<boolean> {
  const output = await runProcess(ffprobePath, [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=index",
    "-of",
    "csv=p=0",
    path,
  ]);
  return Boolean(output.trim());
}

function resolveExportFilename(
  draft: VideoDraftDocument,
  exportsDir: string
): string {
  const topicBaseName = resolveTopicBaseName(draft);
  const nextSequence = resolveNextTopicSequence(exportsDir, topicBaseName);
  return `${topicBaseName}-${nextSequence}.mp4`;
}

function resolveTopicBaseName(draft: VideoDraftDocument): string {
  const sourceOutputPath = String(draft.source_output_path ?? "").trim();
  if (sourceOutputPath) {
    const sourceName = basename(sourceOutputPath, extname(sourceOutputPath));
    const normalized = slugifyTopicName(stripTopicMetadataSuffix(sourceName));
    if (normalized) {
      return normalized;
    }
  }

  const title = slugifyTopicName(String(draft.video_plan.title ?? "").trim());
  if (title) {
    return title;
  }

  const username = slugifyTopicName(draft.selected_posts[0]?.username ?? "");
  return username || "video-topic";
}

function resolveNextTopicSequence(
  exportsDir: string,
  topicBaseName: string
): number {
  let maxSequence = 0;

  for (const filename of readdirSync(exportsDir)) {
    const match = filename.match(/^(.+)-(\d+)\.mp4$/i);
    if (!match) {
      continue;
    }

    const [, existingTopic, existingSequenceText] = match;
    if (existingTopic !== topicBaseName) {
      continue;
    }

    const existingSequence = Number.parseInt(existingSequenceText ?? "", 10);
    if (Number.isFinite(existingSequence)) {
      maxSequence = Math.max(maxSequence, existingSequence);
    }
  }

  return maxSequence + 1;
}

function slugifyTopicName(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
}

function stripTopicMetadataSuffix(value: string): string {
  return String(value ?? "")
    .replace(/[-_\s]+p\d+[-_\s]+c\d+[-_\s]+\d{8,}$/i, "")
    .replace(/[-_\s]+\d{8,}$/i, "")
    .trim();
}

async function generateSceneAssets({
  draft,
  renderDir,
  baseDir,
}: {
  draft: VideoDraftDocument;
  renderDir: string;
  baseDir: string;
}): Promise<GeneratedSceneAssetsResult> {
  const isDark = draft.cardTheme === "dark";
  const { chromium } = await import("playwright");
  const launchOptions = await resolveChromiumLaunchOptions(chromium, {
    headless: true,
  });
  const browser = await chromium.launch(launchOptions);
  const unregisterBrowserCleanup = registerVideoRuntimeCleanup(() =>
    browser.close().catch(() => undefined)
  );
  const page = await browser.newPage();

  const sceneAssets: SceneRenderAsset[] = [];
  const thumbnailPath = draft.thumbnail_intro?.enabled
    ? await generateThumbnailAsset({ baseDir, draft, page, renderDir })
    : null;
  const remoteAvatarCache = new Map<string, Promise<string>>();
  const remoteMediaCache = new Map<string, Promise<string>>();

  const fetchRemoteAvatarAsDataUrl = (source: string): Promise<string> => {
    const normalizedSource = String(source ?? "").trim();
    if (!normalizedSource) {
      return Promise.resolve("");
    }

    const cached = remoteAvatarCache.get(normalizedSource);
    if (cached) {
      return cached;
    }

    const task = (async () => {
      let remoteUrl: URL;
      try {
        remoteUrl = new URL(normalizedSource);
      } catch {
        return "";
      }

      const attempts: Array<Record<string, string>> = [
        {
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0",
        },
        {
          Accept: "image/*,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0",
          Referer: `${remoteUrl.origin}/`,
        },
        {},
      ];

      for (const headers of attempts) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);
        try {
          const response = await fetch(remoteUrl, {
            headers,
            redirect: "follow",
            signal: controller.signal,
          });
          if (!response.ok) {
            continue;
          }

          const contentType = response.headers.get("content-type") || "";
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length === 0) {
            continue;
          }

          const mime = contentType.startsWith("image/")
            ? contentType.split(";")[0]!
            : `image/${extname(remoteUrl.pathname).replace(".", "").toLowerCase() || "jpeg"}`;
          return `data:${mime};base64,${bytes.toString("base64")}`;
        } catch {
        } finally {
          clearTimeout(timeout);
        }
      }

      return "";
    })();

    remoteAvatarCache.set(normalizedSource, task);
    return task;
  };

  const fetchRemoteMediaToLocalPath = (
    source: string,
    mediaType: "image" | "video"
  ): Promise<string> => {
    const normalizedSource = String(source ?? "").trim();
    if (!normalizedSource) {
      return Promise.resolve("");
    }

    const cacheKey = `${mediaType}:${normalizedSource}`;
    const cached = remoteMediaCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const task = (async () => {
      let remoteUrl: URL;
      try {
        remoteUrl = new URL(normalizedSource);
      } catch {
        return "";
      }

      const attempts: Array<Record<string, string>> = [
        {
          Accept:
            mediaType === "video"
              ? "video/*,*/*;q=0.8"
              : "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0",
        },
        {
          Accept:
            mediaType === "video" ? "video/*,*/*;q=0.8" : "image/*,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0",
          Referer: `${remoteUrl.origin}/`,
        },
        {},
      ];

      for (const headers of attempts) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);
        try {
          const response = await fetch(remoteUrl, {
            headers,
            redirect: "follow",
            signal: controller.signal,
          });
          if (!response.ok) {
            continue;
          }

          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length === 0) {
            continue;
          }

          const contentType = response.headers.get("content-type") || "";
          const extension = inferRemoteMediaExtension({
            contentType,
            mediaType,
            pathname: remoteUrl.pathname,
          });
          const filename = `remote-media-${createHash("sha256")
            .update(cacheKey)
            .digest("hex")
            .slice(0, 16)}.${extension}`;
          const outputPath = resolve(renderDir, filename);
          await writeFile(outputPath, bytes);
          return outputPath;
        } catch {
        } finally {
          clearTimeout(timeout);
        }
      }

      return "";
    })();

    remoteMediaCache.set(cacheKey, task);
    return task;
  };

  try {
    for (let i = 0; i < draft.scenes.length; i++) {
            const scene = draft.scenes[i]!;
      const post =
        draft.selected_posts.find((p) => p.post_id === scene.post_id) ??
        draft.selected_posts[0]!;
      const isDialogueScene = Boolean(scene.dialogue_speaker);
      const comment =
        (scene.kind === "comment" ||
          (scene.kind === "post_video" && Boolean(scene.comment_id))) &&
        !isDialogueScene
          ? post.top_comments.find((c) => c.comment_id === scene.comment_id)
          : undefined;
      const threadPageMembers = (scene.thread_page?.member_scene_ids ?? [])
        .map((sceneId) => draft.scenes.find((candidate) => candidate.scene_id === sceneId))
        .filter((candidate): candidate is VideoDraftScene => Boolean(candidate));
      const isThreadPage = threadPageMembers.length > 1;
      const mediaPreviews: Array<
        NonNullable<Awaited<ReturnType<typeof resolveRenderableMediaSource>>>
      > = [];
      const reserveCaptionVideoForDedicatedScene =
        (scene.kind === "post" || scene.kind === "comment") &&
        draft.scenes.some(
          (candidate) =>
            candidate.kind === "post_video" &&
            candidate.post_id === scene.post_id &&
            candidate.comment_id === scene.comment_id
        );
      const sceneMediaAssets =
        scene.kind === "post_video"
          ? (comment?.media ?? post.media ?? []).filter(
              (media) => media.type === "video"
            )
          : pickSceneMediaAssets({ comment, post }).filter(
              (media) =>
                !reserveCaptionVideoForDedicatedScene || media.type !== "video"
            );
      for (const mediaAsset of sceneMediaAssets) {
        const resolvedMedia = await resolveRenderableMediaSource({
          baseDir,
          comment,
          fetchRemoteMediaToLocalPath,
          media: mediaAsset,
        });
        if (resolvedMedia) {
          mediaPreviews.push(resolvedMedia);
        }
        if (resolvedMedia && resolvedMedia.type !== "image") {
          break;
        }
      }
      const mediaPreview = mediaPreviews[0] ?? null;
      if (scene.kind === "post_video" && mediaPreview?.type !== "video") {
        throw new Error(
          `Không tìm thấy file video gốc của bài viết "${post.post_id}" để phát.`
        );
      }
      let cardY = 250;

            const username = comment?.username || post.username || "threads";
      const displayName =
        comment?.display_name || post.display_name || "Threads";
      const seed = comment
        ? comment.comment_id || comment.text || ""
        : post.post_id || post.text || "";
      const baseMetrics =
        comment && !isDialogueScene
          ? {
              likes: comment?.like_count ?? 0,
              replies: comment?.reply_count ?? 0,
              reposts: comment?.repost_count ?? 0,
              shares: comment?.share_count ?? 0,
            }
          : {
              likes: post.like_count ?? 0,
              replies: post.reply_count ?? 0,
              reposts: post.repost_count ?? 0,
              shares: post.share_count ?? 0,
            };
      const metrics = buildDisplayMetrics(seed, {
        likes: baseMetrics.likes,
        replies: baseMetrics.replies,
        reposts: baseMetrics.reposts,
        shares: baseMetrics.shares,
      });
      const resolvedMetrics =
        comment && !isDialogueScene
          ? {
              ...metrics,
              likes: comment.video_like_count ?? metrics.likes,
              replies: comment.video_reply_count ?? metrics.replies,
              shares: comment.video_share_count ?? metrics.shares,
            }
          : metrics;
      const likeCount = resolvedMetrics.likes;
      const replyCount = resolvedMetrics.replies;
      const repostCount = resolvedMetrics.reposts;
      const shareCount = resolvedMetrics.shares;

      // Resolve avatar — Playwright renders HTML statically (no web server),
      // so /media/... URLs won't work. Must embed as base64 data URL.
      let avatarHtml = "";
      let avatarBase64 = "";

      // Strip query string (cache busters like ?v=...) before resolving as local path
      const rawAssetPath =
        (comment?.avatar_asset_path ?? "") || post.avatar_asset_path;
      const cleanAvatarAssetPath = (rawAssetPath.split("?")[0] ?? "").trim();
      const rawAvatarUrlFull = (
        (comment?.avatar_url ?? "") ||
        post.avatar_url
      ).trim();
      const cleanLocalAvatarUrl = (rawAvatarUrlFull.split("?")[0] ?? "").trim();

      // Helper: read a local file as base64 data URL
      const readLocalAvatar = (absPath: string): string => {
        if (!existsSync(absPath)) {
          return "";
        }
        try {
          const ext = extname(absPath).replace(".", "").toLowerCase() || "jpg";
          const mime = ext === "jpg" ? "jpeg" : ext;
          const data = readFileSync(absPath).toString("base64");
          return `data:image/${mime};base64,${data}`;
        } catch {
          return "";
        }
      };

      // Attempt 1: use avatar_asset_path (relative to baseDir)
      if (cleanAvatarAssetPath) {
        avatarBase64 = readLocalAvatar(resolve(baseDir, cleanAvatarAssetPath));
      }

      if (!avatarBase64 && cleanLocalAvatarUrl.startsWith("/media/")) {
        const mediaRelPath =
          cleanLocalAvatarUrl.slice("/media/".length).split("?")[0] ?? "";
        if (mediaRelPath) {
          avatarBase64 = readLocalAvatar(resolve(baseDir, mediaRelPath));
        }
      }

      if (!avatarBase64 && /^https?:\/\//i.test(rawAvatarUrlFull)) {
        avatarBase64 = await fetchRemoteAvatarAsDataUrl(rawAvatarUrlFull);
      }

      // Final avatar src: prefer base64, fall back to remote https:// URL only as a last resort.
      const avatarSrc =
        avatarBase64 ||
        (/^https?:\/\//i.test(rawAvatarUrlFull) ? rawAvatarUrlFull : "");
      if (avatarSrc) {
        avatarHtml = `<img src="${avatarSrc}" class="avatar-img" onerror="this.style.display='none'; document.getElementById('fallback-${i}').style.display='flex';" />
        <img id="fallback-${i}" class="avatar-img avatar-fallback" style="display:none;" src="${DEFAULT_PROFILE_AVATAR_DATA_URL}" alt="" />`;
      } else {
        avatarHtml = `<img class="avatar-img" src="${DEFAULT_PROFILE_AVATAR_DATA_URL}" alt="" />`;
      }

      // Keep metric icons/text slightly softer than the main body text.
      const metricAccentColor = isDark ? "#fb7185" : "#f43f5e";
      const metricNeutralColor = isDark ? "rgba(255,255,255,0.68)" : "#64748b";
      const metricsHtml = `
        <div class="metric-item accent">
          <span class="icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="${metricAccentColor}" stroke="${metricAccentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
          </span>
          <span class="metric-value ${metricValueSizeClass(formatCompact(likeCount))}">${formatCompact(likeCount)}</span>
        </div>
        <div class="metric-item">
          <span class="icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="${metricNeutralColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.656 17.008a9.993 9.993 0 1 0-3.59 3.615L22 22Z" stroke-linejoin="round"/></svg>
          </span>
          <span class="metric-value ${metricValueSizeClass(formatCompact(replyCount))}">${formatCompact(replyCount)}</span>
        </div>
        <div class="metric-item">
          <span class="icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="${metricNeutralColor}"><path d="M4.51617 6.9986C6.13179 4.58593 8.88099 2.99979 11.9995 2.99979C15.7267 2.99979 18.9259 5.26459 20.2927 8.49676C20.5079 9.00543 21.0946 9.24341 21.6033 9.0283C22.1119 8.81318 22.3499 8.22644 22.1348 7.71777C20.466 3.7716 16.5582 0.999786 11.9995 0.999786C8.27776 0.999786 4.9897 2.84823 2.99988 5.67416V2.9986C2.99988 2.44631 2.55216 1.9986 1.9988 1.9986C1.44759 1.9986 0.999878 2.44631 0.999878 2.9986V7.9986C0.999878 8.55088 1.44759 8.9986 1.9988 8.9986H6.9988C7.55216 8.9986 7.99988 8.55088 7.99988 7.9986C7.99988 7.44631 7.55216 6.9986 6.9988 6.9986H4.51617Z" /><path d="M2.39572 14.9713C2.90439 14.7562 3.49113 14.9942 3.70625 15.5029C5.07309 18.735 8.27228 20.9998 11.9995 20.9998C15.118 20.9998 17.8672 19.4137 19.4828 17.001H16.9991C16.4468 17.001 15.9991 16.5533 15.9991 16.001C15.9991 15.4487 16.4468 15.001 16.9991 15.001H21.9991C22.5514 15.001 22.9991 15.4487 22.9991 16.001V21.001C22.9991 21.5533 22.5514 22.001 21.9991 22.001C21.4468 22.001 20.9991 21.5533 20.9991 21.001V18.3255C19.0093 21.1514 15.7212 22.9998 11.9995 22.9998C7.44077 22.9998 3.53298 20.228 1.86419 16.2818C1.64908 15.7732 1.88705 15.1864 2.39572 14.9713Z" /></svg>
          </span>
          <span class="metric-value ${metricValueSizeClass(formatCompact(repostCount))}">${formatCompact(repostCount)}</span>
        </div>
        <div class="metric-item">
          <span class="icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="${metricNeutralColor}"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.2474 1.49853C4.18324 -0.187039 0.600262 2.64309 1.53038 6.01431L3.18181 12L1.53038 17.9857C0.600277 21.3569 4.18324 24.1871 7.2474 22.5015L20.8245 15.0329C23.2153 13.7177 23.2153 10.2823 20.8244 8.96712L7.2474 1.49853ZM3.45835 5.48239C2.99873 3.81649 4.76927 2.41796 6.28345 3.25089L19.8605 10.7195C20.0016 10.7971 20.123 10.8923 20.2247 11H4.98064L3.45835 5.48239ZM4.98064 13L3.45835 18.5176C2.99873 20.1835 4.76927 21.5821 6.28345 20.7491L19.8605 13.2805C20.0016 13.2029 20.123 13.1078 20.2247 13H4.98064Z" /></svg>
          </span>
          <span class="metric-value ${metricValueSizeClass(formatCompact(shareCount))}">${formatCompact(shareCount)}</span>
        </div>
      `;

      const moreIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${isDark ? "#94a3b8" : "#cbd5e1"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`;
      // Match exported card line breaks to the same structure users see in preview.
      // Keep the original post card visible while each dialogue line is read.
      // The dialogue scene still controls audio/timing, but must not replace
      // the post image with a blank/comment card.
      const visualText = resolveSceneVisualText({
        commentText: comment?.text,
        isDialogueScene,
        postText: post.text,
        sceneKind: scene.kind,
        sceneText: scene.text,
      });
      const escapedText = escapeHtml(formatStructuredCardText(visualText));
      const escapedUsername = escapeHtml(username);
      const escapedDisplayName = escapeHtml(displayName);
      const escapedRelativeTime = escapeHtml(
        formatRelativeTime(
          resolveSceneCreatedAt(comment?.created_at, post.created_at)
        )
      );
      const buildSceneHtml = (
        text: string,
        hideMedia: boolean,
        mediaMaxHeightPx?: number,
        revealConfig?: {
          isHidden: boolean;
          revealText: string;
          segments?: Array<{ isHidden: boolean; text: string }>;
          style?: "blur" | "hide";
        },
        blurMedia = false,
        mediaRevealPercent = 100,
        mediaRevealRegions: Array<{
          bbox: { height: number; width: number; x: number; y: number };
          image_height: number;
          image_width: number;
          text: string;
        }> = []
      ) => {
        const mediaStyle = [
          hideMedia ? "visibility: hidden;" : "",
          blurMedia ? "filter: blur(8px);" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const mediaClass =
          mediaPreview?.fitMode === "contain"
            ? "media-fit-contain"
            : "media-fit-cover";
        const videoMediaStyle = `${mediaStyle}${
          mediaStyle ? " " : ""
        }aspect-ratio:${resolveVideoCardAspectRatio(
          mediaPreview?.aspectRatio
        )} / 1;`;
        const latestRevealRegion = mediaRevealRegions.at(-1);
        const revealBottomPercent = latestRevealRegion
          ? Math.max(
              0,
              Math.min(
                100,
                ((latestRevealRegion.bbox.y + latestRevealRegion.bbox.height) /
                  Math.max(1, latestRevealRegion.image_height)) *
                  100 +
                  2
              )
            )
          : mediaRevealPercent;
        const mediaRevealOverlay =
          mediaPreview?.type === "image" &&
          mediaRevealPercent > 0 &&
          mediaRevealPercent < 100
            ? `<img src="${mediaPreview.src}" class="media-image ${mediaClass} media-reveal-overlay" style="clip-path: inset(0 0 ${100 - revealBottomPercent}% 0);" />`
            : "";
        const mediaHtml = mediaPreview
          ? mediaPreview.type === "image"
            ? `<div class="media-shell image-shell" id="scene-media-${i}" style="position: relative; ${buildImageShellStyle(mediaPreview, mediaMaxHeightPx)}"><img src="${mediaPreview.src}" class="media-image ${mediaClass}" style="${mediaStyle}" />${mediaRevealOverlay}</div>`
            : `<div class="media-shell video-shell" id="scene-media-${i}" style="${videoMediaStyle}"><div class="video-media-placeholder"><div class="video-play"></div></div></div>`
          : "";

        let contentHtml = "";
        if (revealConfig && revealConfig.revealText.trim()) {
          const initialNormal = (text ?? "").trim();
          const escapedInitial = escapeHtml(formatStructuredCardText(initialNormal));
          const revealSegments = revealConfig.segments?.length
            ? revealConfig.segments
            : [
                {
                  isHidden: revealConfig.isHidden,
                  text: revealConfig.revealText.trim(),
                },
              ];
          const escapedSegments = revealSegments
            .map((segment, index) => {
              let revealStyle = "visibility: visible; display: inline;";
              if (segment.isHidden) {
                if (revealConfig.style === "hide") {
                  revealStyle = "visibility: hidden; display: inline;";
                } else {
                  revealStyle = `filter: blur(7px); -webkit-filter: blur(7px); opacity: 0.92; color: ${isDark ? "#ffffff" : "#0f172a"}; background: ${isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.08)"}; -webkit-box-decoration-break: clone; box-decoration-break: clone; display: inline; user-select: none;`;
                }
              }
              const separator = index === 0 ? " " : "\n";
              return `${separator}<span style="${revealStyle}">${escapeHtml(
                formatStructuredCardText(segment.text)
              )}</span>`;
            })
            .join("");
          contentHtml = `${escapedInitial}${escapedSegments}`;
        } else {
          contentHtml = escapeHtml(formatStructuredCardText(text));
        }

        return `
      <!DOCTYPE html>
      <html>
      <head>
      <meta charset="utf-8">
      <style>
        body {
          margin: 0;
          padding: 0;
          background: transparent;
          font-family: "Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif;
          overflow: hidden;
        }
        .card-wrapper {
          display: inline-block;
          padding: 90px;
          background: transparent;
          box-sizing: border-box;
        }
        .card-container {
          width: ${CARD_WIDTH}px;
          background: ${isDark ? "rgba(18, 18, 18, 0.97)" : "rgba(255, 255, 255, 0.98)"};
          border-radius: 40px;
          padding: ${CARD_PADDING_Y}px ${CARD_PADDING_X}px;
          box-shadow: ${isDark ? "0 24px 52px rgba(0,0,0,0.5)" : "0 16px 34px rgba(15,23,42,0.10)"};
          box-sizing: border-box;
          color: ${isDark ? "#f1f5f9" : "#0f172a"};
          isolation: isolate;
          ${isDark ? "border: 1px solid rgba(255,255,255,0.08);" : ""}
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 24px;
        }
        .user-info {
          display: flex;
          align-items: center;
          gap: 20px;
        }
        .avatar-wrap {
          width: 96px;
          height: 96px;
          border-radius: 50%;
          overflow: hidden;
          background: ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)"};
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .avatar-fallback {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 32px;
          font-weight: 700;
          color: ${isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)"};
          background: ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"};
        }
        .names {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .username-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .username {
          font-size: 34px;
          font-weight: 700;
          color: ${isDark ? "#f8fafc" : "#0f172a"};
          line-height: 1.15;
          letter-spacing: -0.5px;
        }
        .time {
          font-size: 26px;
          font-weight: 400;
          color: ${isDark ? "#94a3b8" : "#64748b"};
          margin-left: 4px;
        }
        .display-name {
          font-size: 24px;
          font-weight: 500;
          color: ${isDark ? "#94a3b8" : "#64748b"};
          line-height: 1.2;
        }
        .more-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          padding-top: 4px;
        }
        .content {
          font-size: 38px;
          line-height: 1.4;
          font-weight: 450;
          color: ${isDark ? "#f1f5f9" : "#1e293b"};
          margin-bottom: ${mediaHtml ? "28px" : "32px"};
          word-break: break-word;
          white-space: pre-wrap;
          letter-spacing: -0.2px;
        }
        .media-shell {
          border-radius: 28px;
          overflow: hidden;
          margin-bottom: 32px;
          background: ${isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"};
          display: block;
        }
        .media-image {
          width: 100%;
          height: 100%;
          display: block;
        }
        .media-reveal-overlay {
          position: absolute;
          inset: 0;
        }
        .media-fit-cover {
          object-fit: cover;
        }
        .media-fit-contain {
          object-fit: contain;
          background: ${isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)"};
        }
        .video-media-placeholder {
          width: 100%;
          height: 100%;
          background: #000;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .metrics-row {
          display: flex;
          align-items: center;
          gap: 40px;
          padding-top: 8px;
        }
        .metric-item {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          color: ${isDark ? "rgba(255,255,255,0.68)" : "#64748b"};
          font-size: 26px;
          font-weight: 600;
          line-height: 1;
        }
        .metric-item .icon {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .metric-value {
          display: inline-block;
          min-width: 3ch;
          font-variant-numeric: tabular-nums;
        }
        .size-xxs {
          font-size: 20px;
          letter-spacing: -0.5px;
        }
        .size-xs {
          font-size: 22px;
          letter-spacing: -0.4px;
        }
        .size-sm {
          font-size: 24px;
          letter-spacing: -0.2px;
        }
        .size-md {
          font-size: 26px;
        }
        .size-lg {
          font-size: 27px;
        }
      </style>
      </head>
      <body>
        <div class="card-wrapper" id="card-wrapper">
          <div class="card-container">
            <div class="header">
              <div class="user-info">
                <div class="avatar-wrap">
                  ${avatarHtml}
                </div>
                <div class="names">
                  <div class="username-row">
                    <span class="username">${escapedUsername}</span>
                    ${escapedRelativeTime ? `<span class="time">${escapedRelativeTime}</span>` : ""}
                  </div>
                  ${escapedDisplayName ? `<span class="display-name">${escapedDisplayName}</span>` : ""}
                </div>
              </div>
              <div class="more-icon">
                ${moreIconSvg}
              </div>
            </div>
            <div class="content">${contentHtml}</div>
            ${mediaHtml}
            <div class="metrics-row">
              ${metricsHtml}
            </div>
          </div>
        </div>
      </body>
      </html>
        `;
      };

      const buildThreadPageHtml = () => {
        const activeThreadPageMemberIndex = threadPageMembers.findIndex(
          (member) => member.scene_id === scene.scene_id
        );
        const visibleThreadPageMembers = threadPageMembers.slice(
          0,
          Math.max(0, activeThreadPageMemberIndex) + 1
        );
        const cards = visibleThreadPageMembers
          .map((member) => {
            const memberComment = post.top_comments.find(
              (item) => item.comment_id === member.comment_id
            );
            if (!memberComment) {
              return "";
            }
            const avatarAssetPath = String(
              memberComment.avatar_asset_path ?? ""
            ).split("?")[0]?.trim();
            const avatarSrc =
              (avatarAssetPath
                ? readLocalAvatar(resolve(baseDir, avatarAssetPath))
                : "") ||
              memberComment.avatar_url ||
              DEFAULT_PROFILE_AVATAR_DATA_URL;
            const memberMetrics = buildDisplayMetrics(
              memberComment.comment_id || memberComment.text || member.scene_id,
              {
                likes: memberComment.like_count ?? 0,
                replies: memberComment.reply_count ?? 0,
                reposts: memberComment.repost_count ?? 0,
                shares: memberComment.share_count ?? 0,
              }
            );
            return `<article class="thread-card">
              <div class="thread-head"><div class="thread-avatar"><img src="${escapeHtml(avatarSrc)}" /></div><strong>@${escapeHtml(memberComment.username || "threads")}</strong><span>${escapeHtml(formatRelativeTime(resolveSceneCreatedAt(memberComment.created_at, post.created_at)))}</span></div>
              <div class="thread-body"><div class="thread-text">${escapeHtml(formatStructuredCardText(member.text))}</div>
              <div class="thread-metrics">&hearts; ${formatCompact(memberComment.video_like_count ?? memberMetrics.likes)} &nbsp; &#9711; ${formatCompact(memberComment.video_reply_count ?? memberMetrics.replies)} &nbsp; &#8635; ${formatCompact(memberMetrics.reposts)} &nbsp; &#9655; ${formatCompact(memberComment.video_share_count ?? memberMetrics.shares)}</div></div>
            </article>`;
          })
          .filter(Boolean)
          .join("");
        return `<!doctype html><html><head><meta charset="utf-8"><style>
          *{box-sizing:border-box} body{margin:0;background:transparent;font-family:"Helvetica Neue",Arial,sans-serif}
          #card-wrapper{width:${CARD_WIDTH}px;padding:42px 0;background:transparent}.thread-stack{display:grid;gap:26px}.thread-card{width:82%;margin:0 auto;padding:28px 32px;border-radius:22px;background:${isDark ? "rgba(2,6,23,.96)" : "rgba(255,255,255,.96)"};box-shadow:0 14px 30px rgba(0,0,0,.18);color:${isDark ? "#f8fafc" : "#1e293b"}}.thread-head{display:flex;align-items:center;gap:12px;font-size:28px}.thread-head span{color:${isDark ? "#94a3b8" : "#64748b"};font-size:23px;font-weight:400}.thread-avatar{width:42px;height:42px;border-radius:50%;overflow:hidden;background:${isDark ? "#475569" : "#cbd5e1"}}.thread-avatar img{display:block;width:100%;height:100%;object-fit:cover}.thread-text{margin-top:18px;white-space:pre-wrap;font-size:30px;line-height:1.32}.thread-metrics{margin-top:22px;color:${isDark ? "#cbd5e1" : "#64748b"};font-size:23px}
        </style></head><body><div id="card-wrapper"><div class="thread-stack">${cards}</div></div></body></html>`;
      };

      const renderSceneCard = async (
        text: string,
        hideMedia: boolean,
        mediaMaxHeightPx?: number,
        revealConfig?: {
          isHidden: boolean;
          revealText: string;
          segments?: Array<{ isHidden: boolean; text: string }>;
          style?: "blur" | "hide";
        },
        blurMedia = false,
        mediaRevealPercent = 100,
        mediaRevealRegions: Array<{
          bbox: { height: number; width: number; x: number; y: number };
          image_height: number;
          image_width: number;
          text: string;
        }> = []
      ) => {
        await page.setContent(
          buildSceneHtml(
            text,
            hideMedia,
            mediaMaxHeightPx,
            revealConfig,
            blurMedia,
            mediaRevealPercent,
            mediaRevealRegions
          )
        );
        await page.evaluate(async () => {
          await document.fonts.ready;
          const imgs = Array.from(document.querySelectorAll("img"));
          await Promise.all(
            imgs.map((img) => {
              if (img.complete) {
                return;
              }
              return new Promise((resolveImg) => {
                img.onload = resolveImg;
                img.onerror = resolveImg;
              });
            })
          );
        });
      };

      const renderThreadPage = async () => {
        await page.setContent(buildThreadPageHtml());
        await page.evaluate(async () => {
          await document.fonts.ready;
          const images = Array.from(document.querySelectorAll("img"));
          await Promise.all(
            images.map((image) =>
              image.complete
                ? undefined
                : new Promise((resolveImage) => {
                    image.onload = resolveImage;
                    image.onerror = resolveImage;
                  })
            )
          );
        });
      };

      const hasSpoiler = !!scene.spoiler;
      const textFull = hasSpoiler ? scene.spoiler!.text_full : visualText;
      const textInitial = hasSpoiler ? scene.spoiler!.text_initial : visualText;
      const textReveal =
        hasSpoiler && textFull.length > textInitial.length
          ? textFull.slice(textInitial.length)
          : "";
      const hasMediaSpoiler = hasSpoiler
        ? !!scene.spoiler!.has_media_spoiler
        : false;
      const spoilerStyle = scene.spoiler?.spoiler_style ?? scene.spoiler_style ?? "blur";
      const revealMediaOnly = Boolean(scene.spoiler?.reveal_media_only);
      const spoilerSegments = hasSpoiler
        ? scene.spoiler!.reveal_segments ?? []
        : [];
      const revealSegmentTexts = spoilerSegments.length
        ? spoilerSegments.map((segment) => segment.text)
        : textReveal
          ? [textReveal]
          : [];
      const revealRegions = splitSpoilerRevealRegions(
        scene.spoiler?.reveal_regions ?? [],
        revealSegmentTexts
      );

      const pngPath = resolve(renderDir, `card-${scene.scene_id}.png`);
      const pngPathInitial = resolve(
        renderDir,
        `card-${scene.scene_id}-initial.png`
      );

      let resolvedMediaHeight: number | undefined =
        scene.kind === "post" && mediaPreview?.type === "image"
          ? DEFAULT_POST_MEDIA_MAX_HEIGHT
          : undefined;
      const buildRevealConfig = (visibleCount: number) =>
        hasSpoiler && revealSegmentTexts.length && !revealMediaOnly
          ? {
              isHidden: visibleCount < revealSegmentTexts.length,
              revealText: revealSegmentTexts.join("\n"),
              segments: revealSegmentTexts.map((text, index) => ({
                isHidden: index >= visibleCount,
                text,
              })),
              style: spoilerStyle,
            }
          : undefined;
      const fullRevealConfig = buildRevealConfig(revealSegmentTexts.length);
      const hideMediaBeforeReveal =
        hasMediaSpoiler && spoilerStyle === "hide";
      const blurMediaBeforeReveal =
        hasMediaSpoiler && spoilerStyle !== "hide";

      // 1. Render the FULL card first to establish master dimensions and clamp media height if needed
      if (isThreadPage) {
        await renderThreadPage();
      } else {
        await renderSceneCard(
          textInitial,
          false,
          resolvedMediaHeight,
          fullRevealConfig
        );
      }
      let wrapperElement = await page.$("#card-wrapper");
      let wrapperBox = await wrapperElement?.boundingBox();
      let mediaBox =
        mediaPreview && mediaPreview.type === "image"
          ? await page.locator(`#scene-media-${i}`).boundingBox()
          : null;

      const maxCardHeight =
        scene.kind === "comment" && !isDialogueScene
          ? MAX_COMMENT_CARD_HEIGHT
          : scene.kind === "post"
            ? MAX_POST_CARD_HEIGHT
            : null;
      if (
        mediaPreview?.type === "image" &&
        wrapperBox &&
        mediaBox &&
        maxCardHeight !== null &&
        wrapperBox.height > maxCardHeight
      ) {
        const overflowHeight = wrapperBox.height - maxCardHeight;
        const nextMediaHeight = Math.max(
          scene.kind === "post"
            ? MIN_POST_MEDIA_HEIGHT
            : MIN_COMMENT_MEDIA_HEIGHT,
          Math.round(mediaBox.height - overflowHeight)
        );
        if (nextMediaHeight < mediaBox.height) {
          resolvedMediaHeight = nextMediaHeight;
          await renderSceneCard(
            textInitial,
            false,
            nextMediaHeight,
            fullRevealConfig
          );
          wrapperElement = await page.$("#card-wrapper");
          wrapperBox = await wrapperElement?.boundingBox();
          mediaBox = await page.locator(`#scene-media-${i}`).boundingBox();
        }
      }

      if (!wrapperElement || !wrapperBox) {
        throw new Error("Could not find card-wrapper element");
      }

      // Screenshot the reveal card
      await wrapperElement.screenshot({
        path: pngPath,
        omitBackground: true,
      });

      // 2. If spoiler is active, screenshot the initial card with identical dimensions and hidden/blurred reveal elements
      if (hasSpoiler) {
        const initialRevealConfig = buildRevealConfig(0);
        await renderSceneCard(
          textInitial,
          hideMediaBeforeReveal,
          resolvedMediaHeight,
          initialRevealConfig,
          blurMediaBeforeReveal,
          0,
          []
        );
        const wrapperElementInitial = await page.$("#card-wrapper");
        if (wrapperElementInitial) {
          await wrapperElementInitial.screenshot({
            path: pngPathInitial,
            omitBackground: true,
          });
        }
      }

      // 3. If both text reveal AND media spoiler are active, screenshot the intermediate card (reveal text visible, media hidden)
      let pngPathTextReveal: string | undefined = undefined;
      if (hasSpoiler && textReveal && hasMediaSpoiler) {
        pngPathTextReveal = resolve(
          renderDir,
          `card-${scene.scene_id}-textreveal.png`
        );
        await renderSceneCard(
          textInitial,
          hideMediaBeforeReveal,
          resolvedMediaHeight,
          fullRevealConfig,
          blurMediaBeforeReveal,
          0,
          []
        );
        const wrapperElementTextReveal = await page.$("#card-wrapper");
        if (wrapperElementTextReveal) {
          await wrapperElementTextReveal.screenshot({
            path: pngPathTextReveal,
            omitBackground: true,
          });
        }
      }

      const pngPathsSpoilerStages: string[] = [];
      if (hasSpoiler && spoilerSegments.length > 1) {
        for (let stageIndex = 0; stageIndex < spoilerSegments.length - 1; stageIndex += 1) {
          const stagePath = resolve(
            renderDir,
            `card-${scene.scene_id}-spoiler-${stageIndex}.png`
          );
          const mediaPercent = Math.max(
            0,
            Math.min(100, spoilerSegments[stageIndex]?.media_reveal_percent ?? 0)
          );
          await renderSceneCard(
            textInitial,
            hasMediaSpoiler && spoilerStyle === "hide" && mediaPercent < 100,
            resolvedMediaHeight,
            buildRevealConfig(stageIndex + 1),
            hasMediaSpoiler && spoilerStyle !== "hide" && mediaPercent < 100,
            mediaPercent,
            revealRegions.slice(0, stageIndex + 1)
          );
          const wrapperElementStage = await page.$("#card-wrapper");
          if (wrapperElementStage) {
            await wrapperElementStage.screenshot({
              path: stagePath,
              omitBackground: true,
            });
            pngPathsSpoilerStages.push(stagePath);
          }
        }
      }

      let media: SceneRenderMedia | null = null;
      const slideshowPaths =
        mediaPreviews.length > 1 &&
        mediaPreviews.every(
          (preview) => preview.type === "image" && Boolean(preview.path)
        )
          ? mediaPreviews.map((preview) => preview.path)
          : undefined;
      if (
        mediaPreview &&
        (mediaPreview.playback !== "still" ||
          Boolean(slideshowPaths && slideshowPaths.length > 1)) &&
        mediaPreview.path &&
        existsSync(mediaPreview.path)
      ) {
        const dynamicMediaBox =
          mediaPreview.type === "video"
            ? await page.locator(`#scene-media-${i}`).boundingBox()
            : mediaBox;
        const dynamicWrapperBox =
          wrapperBox ?? (await page.locator("#card-wrapper").boundingBox());
        if (dynamicMediaBox && dynamicWrapperBox) {
          media = {
            fitMode: mediaPreview.fitMode,
            height: Math.round(dynamicMediaBox.height),
            paths: slideshowPaths,
            path: mediaPreview.path,
            playback: mediaPreview.playback,
            type: mediaPreview.type,
            width: Math.round(dynamicMediaBox.width),
            x: Math.round(dynamicMediaBox.x - dynamicWrapperBox.x),
            y: Math.round(dynamicMediaBox.y - dynamicWrapperBox.y),
          };
        }
      }

      let cardWidth = CARD_WIDTH;
      let cardHeight = 500;
      if (wrapperElement) {
        if (wrapperBox) {
          cardWidth = Math.round(wrapperBox.width);
          cardHeight = Math.round(wrapperBox.height);
          cardY = Math.max(
            120,
            Math.round(
              (HEIGHT - PREVIEW_EXPORT_BOTTOM_PADDING - wrapperBox.height) / 2 -
                PREVIEW_EXPORT_CARD_TOP_SHIFT
            )
          );
        }
      } else {
        throw new Error("Could not find card-wrapper element");
      }

      const memeTransition =
        resolveSceneMemeTransition(scene, draft.scenes, i, draft) ?? null;
      const trailingMemeTransition = scene.trailing_meme_transition ?? null;
      let sceneMemeOverlayPath: string | null = null;
      let trailingMemeOverlayPath: string | null = null;
      if (
        memeTransition?.placement !== "media_reveal" &&
        memeTransition?.visualMode !== "sound_only" &&
        memeTransition?.image?.serverPath
      ) {
        sceneMemeOverlayPath = await generateMemeOverlayAsset({
          baseDir,
          memeServerPath: memeTransition.image.serverPath,
          page,
          renderDir,
          sceneId: scene.scene_id,
        });
      }
      if (
        trailingMemeTransition?.placement !== "media_reveal" &&
        trailingMemeTransition?.visualMode !== "sound_only" &&
        trailingMemeTransition?.image?.serverPath
      ) {
        trailingMemeOverlayPath = await generateMemeOverlayAsset({
          baseDir,
          memeServerPath: trailingMemeTransition.image.serverPath,
          page,
          renderDir,
          sceneId: `${scene.scene_id}-trailing`,
        });
      }
      const mediaReveal =
        trailingMemeTransition?.placement === "media_reveal" &&
        mediaPreview?.path &&
        existsSync(mediaPreview.path)
          ? media ?? {
              fitMode: "contain",
              height: HEIGHT,
              paths: slideshowPaths,
              path: mediaPreview.path,
              playback: mediaPreview.playback,
              type: mediaPreview.type,
              width: WIDTH,
              x: 0,
              y: 0,
            }
          : null;
      const postVideo =
        scene.kind === "post_video" && media?.path
          ? {
              ...media,
              inputIndex: undefined,
              inputIndices: undefined,
              paths: undefined,
              playback: "video" as const,
              type: "video" as const,
            }
          : null;

      sceneAssets.push({
        cardPath: pngPath,
        cardPathInitial: hasSpoiler ? pngPathInitial : undefined,
        cardPathSpoilerStages:
          pngPathsSpoilerStages.length > 0
            ? pngPathsSpoilerStages
            : undefined,
        cardPathTextReveal: pngPathTextReveal,
        hasMediaSpoiler,
        spoilerRevealTimeSeconds:
          hasSpoiler && scene.spoiler?.reveal_time_ms
            ? scene.spoiler.reveal_time_ms / 1000
            : undefined,
        spoilerMediaRevealTimeSeconds:
          hasSpoiler && scene.spoiler?.media_reveal_time_ms
            ? scene.spoiler.media_reveal_time_ms / 1000
            : undefined,
        spoilerRevealSegments:
          spoilerSegments.length > 1
            ? spoilerSegments.map((segment) => ({
                revealTimeSeconds: segment.reveal_time_ms / 1000,
              }))
            : undefined,
        cardWidth,
        cardHeight,
        cardY,
        media: scene.kind === "post_video" ? null : media,
        mediaReveal,
        memeOverlayPath: sceneMemeOverlayPath,
        trailingMemeOverlayPath,
        postVideo,
        sceneId: scene.scene_id,
      });
    }
  } finally {
    unregisterBrowserCleanup();
    await browser.close().catch(() => undefined);
  }

  return {
    sceneAssets,
    thumbnailPath,
  };
}

function resolveThumbnailRenderLayout(intro: VideoThumbnailIntro) {
  const defaultBrandWidth = Math.min(
    100,
    Math.max(
      30,
      [72, 78, 85].includes(Math.round(Number(intro.brandImageSizePercent) || 92))
        ? 92
        : Math.round(Number(intro.brandImageSizePercent) || 92)
    )
  );
  const defaults: Record<VideoThumbnailLayerId, VideoThumbnailLayerLayout> = {
    brand: { height: 24, width: defaultBrandWidth, x: 50, y: 70 },
    channel: { height: 8, width: 72, x: 50, y: 25 },
    title: { height: 28, width: 84, x: 50, y: 34 },
    watermark: { height: 19, width: 19, x: 88, y: 10 },
  };
  const minimums: Record<VideoThumbnailLayerId, { height: number; width: number }> = {
    brand: { height: 10, width: 20 },
    channel: { height: 6, width: 24 },
    title: { height: 16, width: 36 },
    watermark: { height: 8, width: 8 },
  };
  const layer = (id: VideoThumbnailLayerId) => {
    const minimum = minimums[id];
    const resolved = {
      ...defaults[id],
      ...intro.layout?.[id],
      height: Math.min(95, Math.max(minimum.height, Number(intro.layout?.[id]?.height) || defaults[id].height)),
      width: Math.min(95, Math.max(minimum.width, Number(intro.layout?.[id]?.width) || defaults[id].width)),
      x: Math.min(100, Math.max(0, Number(intro.layout?.[id]?.x) || defaults[id].x)),
      y: Math.min(100, Math.max(0, Number(intro.layout?.[id]?.y) || defaults[id].y)),
    };
    if (id === "watermark") {
      const size = Math.min(resolved.width, resolved.height);
      return { ...resolved, height: size * 0.5625, width: size };
    }
    return resolved;
  };
  const order = [
    ...(intro.layout?.layerOrder ?? []),
    ...(["title", "channel", "brand", "watermark"] as VideoThumbnailLayerId[]),
  ].filter((id, index, list) => list.indexOf(id) === index);
  return {
    brand: layer("brand"),
    channel: layer("channel"),
    order,
    title: layer("title"),
    watermark: layer("watermark"),
  };
}

function collectThumbnailAnimationAssets(
  draft: VideoDraftDocument,
  baseDir: string
): ThumbnailAnimationAsset[] {
  const intro = draft.thumbnail_intro;
  const brandImage = intro?.brandImage;
  if (
    !intro?.enabled ||
    !brandImage?.serverPath ||
    !isGifAsset(brandImage) ||
    intro.layout?.brand?.visible === false
  ) {
    return [];
  }

  const path = resolve(baseDir, brandImage.serverPath);
  if (!existsSync(path)) {
    return [];
  }

  const layout = resolveThumbnailRenderLayout(intro).brand;
  return [
    {
      height: layout.height,
      layer: "brand",
      path,
      width: layout.width,
      x: layout.x,
      y: layout.y,
    },
  ];
}

function isGifAsset(asset: {
  name?: string;
  serverPath?: string;
  type?: string;
}): boolean {
  return (
    isGifPath(asset.name) ||
    isGifPath(asset.serverPath) ||
    /image\/gif/i.test(String(asset.type ?? ""))
  );
}

function isGifPath(path: string | null | undefined): boolean {
  return /\.gif(?:$|[?#])/i.test(String(path ?? ""));
}

function isVideoPath(path: string | null | undefined): boolean {
  return /\.(?:mp4|m4v|webm|mov|avi|mkv)(?:$|[?#])/i.test(String(path ?? ""));
}

function isLoopingMediaPath(path: string | null | undefined): boolean {
  return isGifPath(path) || isVideoPath(path);
}

async function generateThumbnailAsset({
  baseDir,
  draft,
  page,
  renderDir,
}: {
  baseDir: string;
  draft: VideoDraftDocument;
  page: Page;
  renderDir: string;
}): Promise<string | null> {
  const intro = draft.thumbnail_intro;
  if (!intro?.enabled) {
    return null;
  }

  const layout = resolveThumbnailRenderLayout(intro);
  const backgroundPath = intro.background?.serverPath
    ? resolve(baseDir, intro.background.serverPath)
    : "";
  const backgroundUrl = backgroundPath && existsSync(backgroundPath)
    ? buildFileDataUrl(backgroundPath, "image")
    : "";
  const backgroundMarkup = backgroundUrl
    ? `<img class="thumbnail-background" src="${backgroundUrl}" alt="" style="object-fit:cover;object-position:${intro.backgroundPositionX ?? 50}% ${intro.backgroundPositionY ?? 50}%;transform:scale(${intro.backgroundZoom ?? 1})" />`
    : "";

  const imagePath = intro.image?.serverPath
    ? resolve(baseDir, intro.image.serverPath)
    : "";
  const imageUrl = imagePath && existsSync(imagePath)
    ? buildFileDataUrl(imagePath, "image")
    : "";
  const imageMarkup = imageUrl
    ? `<img class="thumb-image" src="${imageUrl}" alt="" />`
    : "";
  const brandPath = intro.brandImage?.serverPath
    ? resolve(baseDir, intro.brandImage.serverPath)
    : "";
  const brandUrl = brandPath && existsSync(brandPath)
    ? buildFileDataUrl(brandPath, "image")
    : "";
  const brandMarkup = brandUrl
    ? `<img class="brand-image" style="position:absolute;left:${layout.brand.x}%;top:${layout.brand.y}%;width:${layout.brand.width}%;height:${layout.brand.height}%;max-width:100%;max-height:100%;opacity:${layout.brand.visible === false ? 0 : 1};z-index:${10 + layout.order.indexOf("brand")};transform:translate(-50%,-50%) rotate(${layout.brand.rotation ?? 0}deg)" src="${brandUrl}" alt="" />`
    : "";
  const watermarkPath = intro.watermark?.serverPath
    ? resolve(baseDir, intro.watermark.serverPath)
    : "";
  const watermarkUrl = watermarkPath && existsSync(watermarkPath)
    ? buildFileDataUrl(watermarkPath, "image")
    : "";
  const watermarkLayer = layout.watermark;
  const watermarkMarkup = watermarkUrl
    ? `<img class="watermark" style="position:absolute;left:${watermarkLayer.x}%;top:${watermarkLayer.y}%;width:${watermarkLayer.width}%;height:${watermarkLayer.height}%;border-radius:50%;clip-path:circle(50% at 50% 50%);overflow:hidden;object-fit:cover;z-index:${10 + layout.order.indexOf("watermark")};opacity:${watermarkLayer.visible === false ? 0 : 1};transform:translate(-50%,-50%) rotate(${watermarkLayer.rotation ?? 0}deg)" src="${watermarkUrl}" alt="" />`
    : "";
  const fontFamily = resolveThumbnailFontFamily(intro.titleFont);
  const channelFontFamily = resolveThumbnailFontFamily(intro.channelFont ?? "geist");
  const channelFontSize = Math.min(
    72,
    Math.max(16, Math.round(Number(intro.channelFontSize) || 36))
  );
  const titleFontSize = Math.min(120, Math.max(28, intro.titleFontSize ?? 42));
  const titleLayer = layout.title;
  const channelLayer = layout.channel;
  const channelMarkup = intro.channelName
    ? `<div class="channel" style="position:absolute;left:${channelLayer.x}%;top:${channelLayer.y}%;width:${channelLayer.width}%;height:${channelLayer.height}%;display:flex;align-items:center;justify-content:center;opacity:${channelLayer.visible === false ? 0 : 1};z-index:${10 + layout.order.indexOf("channel")};transform:translate(-50%,-50%) rotate(${channelLayer.rotation ?? 0}deg)">${escapeHtml(intro.channelName)}</div>`
    : "";
  const titleColor = /^#[0-9a-f]{6}$/i.test(intro.titleColor ?? "")
    ? intro.titleColor
    : "#741b1b";
  const accentText = intro.mode === "automatic" ? "#166534" : "#9d174d";
  const channelColor = /^#[0-9a-f]{6}$/i.test(intro.channelColor ?? "")
    ? intro.channelColor
    : accentText;
  const html = `<!doctype html><html><head><style>
    *{box-sizing:border-box}html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;background:transparent;overflow:hidden}
    body{font-family:Arial,sans-serif}.canvas{position:relative;width:100%;height:100%;overflow:hidden}.thumbnail-background{position:absolute;inset:0;width:100%;height:100%;z-index:0}
    .card{position:absolute;left:${titleLayer.x}%;top:${titleLayer.y}%;width:${titleLayer.width}%;height:${titleLayer.height}%;padding:6%;border:0;color:${accentText};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;opacity:${titleLayer.visible === false ? 0 : 1};z-index:${10 + layout.order.indexOf("title")};transform:translate(-50%,-50%) rotate(${titleLayer.rotation ?? 0}deg)}
    .badge{align-self:flex-start;margin-bottom:26px;padding:12px 24px;border-radius:14px;background:#ff2354;color:#fff;font-size:34px;font-weight:800}.channel{margin-bottom:18px;color:${channelColor};font-size:${(channelFontSize * WIDTH) / 500}px;font-weight:700}.title{font-family:${fontFamily};font-size:${(titleFontSize * WIDTH) / 500}px;line-height:1.08;font-weight:900;color:${titleColor};white-space:pre-wrap;overflow-wrap:anywhere}.subtitle{margin-top:${WIDTH * 0.03}px;color:${accentText};font-size:${WIDTH * 0.045}px;line-height:1.2}.thumb-image{width:100%;max-height:${WIDTH * 0.45}px;margin-bottom:${WIDTH * 0.045}px;border-radius:${WIDTH * 0.03}px;object-fit:cover}.brand-image{position:relative;z-index:1;display:block;width:auto;max-width:100%;height:auto;margin:0 auto;object-fit:contain}
  .brand-image{object-fit:contain}
  .channel{font-family:${channelFontFamily};font-style:${intro.channelItalic ? "italic" : "normal"};font-weight:${intro.channelBold ? 700 : 500}}.title{font-style:${intro.titleItalic ? "italic" : "normal"};font-weight:${intro.titleBold === false ? 500 : 900}}
  </style></head><body><div class="canvas">
  ${backgroundMarkup}
  <div class="card">
    ${imageMarkup}
    <div class="title">${escapeHtml(intro.title)}</div>
    ${intro.subtitle ? `<div class="subtitle">${escapeHtml(intro.subtitle)}</div>` : ""}
  </div>
  ${channelMarkup}
  ${brandMarkup}
  ${watermarkMarkup}
</div></body></html>`;

  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  const outputPath = resolve(renderDir, "thumbnail-intro.png");
  await page.screenshot({ omitBackground: true, path: outputPath });
  if (originalViewport) {
    await page.setViewportSize(originalViewport);
  }
  return outputPath;
}

function resolveThumbnailFontFamily(
  font: VideoThumbnailIntro["titleFont"]
): string {
  switch (font) {
    case "beVietnam":
      return "'Be Vietnam Pro', Geist, Arial, sans-serif";
    case "georgia":
      return "Georgia, serif";
    case "geist":
      return "Geist, Arial, sans-serif";
    case "mono":
      return "Courier New, monospace";
    case "montserrat":
      return "Montserrat, Segoe UI, Arial, sans-serif";
    case "notoSans":
      return "'Noto Sans', Geist, Arial, sans-serif";
    case "oswald":
      return "Oswald, Arial Narrow, Arial, sans-serif";
    case "poppins":
      return "Poppins, Segoe UI, Arial, sans-serif";
    case "roboto":
      return "Roboto, Segoe UI, Arial, sans-serif";
    case "trebuchet":
      return "Trebuchet MS, sans-serif";
    case "verdana":
      return "Verdana, sans-serif";
    default:
      return "Poppins, Segoe UI, Arial, sans-serif";
  }
}

async function generateMemeOverlayAsset({
  baseDir,
  memeServerPath,
  page,
  renderDir,
  sceneId,
}: {
  baseDir: string;
  memeServerPath: string;
  page: Page;
  renderDir: string;
  sceneId: string;
}): Promise<string | null> {
  if (!memeServerPath) {
    return null;
  }

  const memePath = resolve(baseDir, memeServerPath);
  if (!existsSync(memePath)) {
    return null;
  }
  if (isLoopingMediaPath(memePath)) {
    return memePath;
  }
  const memeUrl = buildFileDataUrl(memePath, "image");

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body {
        margin: 0;
        padding: 0;
        background: transparent;
      }
      .meme-wrap {
        display: inline-flex;
        box-sizing: border-box;
      }
      .meme-image {
        width: 620px;
        height: 620px;
        display: block;
        object-fit: cover;
        border-radius: 28px;
      }
    </style>
  </head>
  <body>
    <div class="meme-wrap" id="meme-wrap">
      <img src="${escapeHtml(memeUrl)}" class="meme-image" />
    </div>
  </body>
  </html>
  `;

  const pngPath = resolve(renderDir, `meme-overlay-card-${sceneId}.png`);
  await page.setContent(html);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const image = document.querySelector("img");
    if (!(image instanceof HTMLImageElement) || image.complete) {
      return;
    }
    await new Promise((resolveImage) => {
      image.onload = resolveImage;
      image.onerror = resolveImage;
    });
  });

  const wrapper = await page.$("#meme-wrap");
  if (!wrapper) {
    return null;
  }

  await wrapper.screenshot({
    omitBackground: true,
    path: pngPath,
  });
  return pngPath;
}

function pickSceneMediaAssets({
  comment,
  post,
}: {
  comment?: VideoDraftComment;
  post: VideoDraftPost;
}): VideoDraftMediaAsset[] {
  return comment ? (comment.media ?? []) : (post.media ?? []);
}

export function resolveSceneVisualText(input: {
  commentText?: string;
  isDialogueScene: boolean;
  postText: string;
  sceneKind: "comment" | "post" | "post_video";
  sceneText: string;
}): string {
  if (input.isDialogueScene) return input.postText;
  if (input.sceneKind === "post_video") {
    return input.commentText ?? input.postText;
  }
  return input.sceneText;
}

async function resolveRenderableMediaSource({
  baseDir,
  comment,
  fetchRemoteMediaToLocalPath,
  media,
}: {
  baseDir: string;
  comment?: VideoDraftComment;
  fetchRemoteMediaToLocalPath: (
    source: string,
    mediaType: "image" | "video"
  ) => Promise<string>;
  media: VideoDraftMediaAsset | null;
}): Promise<{
  aspectRatio: number;
  fitMode: "contain" | "cover";
  path: string;
  playback: "animated" | "still" | "video";
  src: string;
  type: "image" | "video";
} | null> {
  if (!media) {
    return null;
  }

  let localPath = media.asset_path ? resolve(baseDir, media.asset_path) : "";
  let localExists = localPath ? existsSync(localPath) : false;
  const remoteUrl = String(media.remote_url ?? "").trim();

  if (!localExists && remoteUrl.startsWith("/media/")) {
    const mediaRelPath = remoteUrl.slice("/media/".length).split("?")[0] ?? "";
    if (mediaRelPath) {
      localPath = resolve(baseDir, mediaRelPath);
      localExists = existsSync(localPath);
    }
  }

  if (!localExists && /^https?:\/\//i.test(remoteUrl)) {
    const downloadedPath = await fetchRemoteMediaToLocalPath(
      remoteUrl,
      media.type
    );
    if (downloadedPath) {
      localPath = downloadedPath;
      localExists = existsSync(localPath);
    }
  }

  const src = localExists ? buildFileDataUrl(localPath, media.type) : remoteUrl;

  if (!src) {
    return null;
  }

  const aspectRatio = Math.max(
    0.1,
    (media.width || 1) / Math.max(1, media.height || 1)
  );
  return {
    aspectRatio,
    fitMode:
      media.type === "image" && mediaBelongsToDefaultComment(comment)
        ? "contain"
        : "cover",
    path: localPath,
    playback:
      media.type === "video"
        ? "video"
        : isAnimatedImagePath(localPath)
          ? "animated"
          : "still",
    src,
    type: media.type,
  };
}

function mediaBelongsToDefaultComment(comment?: VideoDraftComment): boolean {
  return comment?.comment_id === DEFAULT_VIDEO_COMMENT_ID;
}

function buildImageShellStyle(
  media: {
    aspectRatio: number;
    fitMode: "contain" | "cover";
  },
  maxHeightPx?: number
): string {
  const aspectRatio = Math.max(
    0.25,
    Math.min(4, media.aspectRatio || CARD_MEDIA_ASPECT_RATIO)
  );
  const constrainedWidth =
    typeof maxHeightPx === "number" && Number.isFinite(maxHeightPx)
      ? Math.max(1, Math.round(maxHeightPx * aspectRatio))
      : null;
  if (media.fitMode !== "contain") {
    return constrainedWidth
      ? [
          "width:100%",
          `height:min(${Math.round((CARD_WIDTH - CARD_PADDING_X * 2) / aspectRatio)}px, ${Math.round(maxHeightPx ?? 0)}px)`,
        ].join(";")
      : `aspect-ratio:${aspectRatio} / 1;`;
  }

  const maxWidthForTallImage = Math.round(
    Math.min(
      DEFAULT_COMMENT_MEDIA_MAX_HEIGHT,
      typeof maxHeightPx === "number" && Number.isFinite(maxHeightPx)
        ? maxHeightPx
        : DEFAULT_COMMENT_MEDIA_MAX_HEIGHT
    ) * aspectRatio
  );
  return [
    `aspect-ratio:${aspectRatio} / 1`,
    `width:min(100%, ${maxWidthForTallImage}px)`,
    "margin-left:auto",
    "margin-right:auto",
  ].join(";");
}

function isAnimatedImagePath(path: string): boolean {
  const extension = extname(String(path ?? ""))
    .replace(".", "")
    .toLowerCase();
  if (extension === "gif") {
    return true;
  }
  if (extension !== "webp" || !path || !existsSync(path)) {
    return false;
  }
  try {
    return isAnimatedWebpBuffer(readFileSync(path));
  } catch {
    return false;
  }
}

export function isAnimatedWebpBuffer(bytes: Uint8Array): boolean {
  const value = Buffer.from(bytes);
  return (
    value.includes(Buffer.from("ANIM")) || value.includes(Buffer.from("ANMF"))
  );
}

function inferRemoteMediaExtension({
  contentType,
  mediaType,
  pathname,
}: {
  contentType: string;
  mediaType: "image" | "video";
  pathname: string;
}): string {
  const normalizedContentType = String(contentType ?? "").toLowerCase();
  const fromPath = extname(String(pathname ?? ""))
    .replace(".", "")
    .toLowerCase();
  if (fromPath) {
    return fromPath === "jpeg" ? "jpg" : fromPath;
  }

  if (normalizedContentType.includes("png")) {
    return "png";
  }
  if (normalizedContentType.includes("webp")) {
    return "webp";
  }
  if (normalizedContentType.includes("gif")) {
    return "gif";
  }
  if (
    normalizedContentType.includes("jpeg") ||
    normalizedContentType.includes("jpg")
  ) {
    return "jpg";
  }
  if (normalizedContentType.includes("webm")) {
    return "webm";
  }
  if (normalizedContentType.includes("quicktime")) {
    return "mov";
  }
  if (normalizedContentType.includes("mp4")) {
    return "mp4";
  }
  return mediaType === "video" ? "mp4" : "jpg";
}

function buildFileDataUrl(path: string, mediaType: "image" | "video"): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const mimeType = getMediaMimeType(ext, mediaType);
  const data = readFileSync(path).toString("base64");
  return `data:${mimeType};base64,${data}`;
}

function getMediaMimeType(
  extension: string,
  mediaType: "image" | "video"
): string {
  const normalized = extension.replace(/^\./, "");
  const known: Record<string, string> = {
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    mov: "video/quicktime",
    mp4: "video/mp4",
    png: "image/png",
    webm: "video/webm",
    webp: "image/webp",
  };
  return known[normalized] ?? `${mediaType}/${normalized || "jpeg"}`;
}

function ffmpegArgsInputIndex(args: string[]): number {
  return args.filter((value) => value === "-i").length;
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatStructuredCardText(value: string): string {
  const preserved = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ");
  if (!preserved.trim()) {
    return "";
  }

  const preservedLines = preserved
    .split("\n")
    .map((line) => line.replace(/[^\S\r\n]+/g, " ").trimEnd());
  const preservedCompacted: string[] = [];
  for (const line of preservedLines) {
    if (
      !line.trim() &&
      preservedCompacted[preservedCompacted.length - 1] === ""
    ) {
      continue;
    }
    preservedCompacted.push(line.trim() ? line : "");
  }
  return preservedCompacted.join("\n").trim();

  const normalized = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!normalized) {
    return "";
  }

  const repaired = restoreInlineCardStructure(normalized);
  const lines = repaired
    .split("\n")
    .map((line) => line.replace(/[^\S\r\n]+/g, " ").trim());

  const compacted: string[] = [];
  for (const line of lines) {
    if (!line && compacted[compacted.length - 1] === "") {
      continue;
    }
    compacted.push(line);
  }

  return compacted.join("\n").trim();
}

function restoreInlineCardStructure(value: string): string {
  let text = String(value ?? "").replace(/\r\n?/g, "\n");
  if (!text) {
    return "";
  }

  const bulletMarkers = Array.from(text.matchAll(/(?:^|\s)[-+]\s+\S/gm));
  const numberedMarkers = Array.from(
    text.matchAll(/(?:^|\s)\d{1,2}[.)]\s+\S/gm)
  );
  const ageRangeMarkers = Array.from(
    text.matchAll(/(?:^|\s)\d{1,2}\s*-\s*\d{1,2}\s*t\s*:/gim)
  );
  const hasSectionHeading = /\s[^\s:]{3,}:\s*(?:[-+]|\d{1,2}[.)])/u.test(text);
  const hasParagraphStarter =
    /[.!?…]\s+(?=(?:Chẳng hạn|Chang han|Ví dụ|Vi du|Ví dụ như|Vi du nhu|Nhưng|Nhung|Tuy nhiên|Tuy nhien|Còn|Con|Riêng|Rieng|Đổi lại|Doi lai|Mặt khác|Mat khac)\b)/iu.test(
      text
    );

  if (
    bulletMarkers.length + numberedMarkers.length + ageRangeMarkers.length <
      2 &&
    !hasSectionHeading &&
    !hasParagraphStarter
  ) {
    return text;
  }

  if (hasParagraphStarter) {
    text = text.replace(
      /([.!?…])\s+(?=(?:Chẳng hạn|Chang han|Ví dụ|Vi du|Ví dụ như|Vi du nhu|Nhưng|Nhung|Tuy nhiên|Tuy nhien|Còn|Con|Riêng|Rieng|Đổi lại|Doi lai|Mặt khác|Mat khac)\b)/giu,
      "$1\n\n"
    );
  }

  if (hasSectionHeading) {
    text = text.replace(
      /\s+([^\s:]{3,}:)\s*(?=(?:[-+]|\d{1,2}[.)]))/gu,
      "\n$1\n"
    );
  }

  if (numberedMarkers.length >= 2) {
    text = text.replace(/\s+(?=\d{1,2}[.)]\s+\S)/g, "\n");
  }

  if (ageRangeMarkers.length >= 2) {
    text = text.replace(/\s+(?=\d{1,2}\s*-\s*\d{1,2}\s*t\s*:)/gi, "\n");
  }

  if (bulletMarkers.length >= 2) {
    text = text.replace(/\s+(?=[-+]\s+\S)/g, "\n");
  }

  return text.replace(/\n{3,}/g, "\n\n");
}

async function buildNarrationAudioLegacy({
  context,
  draft,
  ffmpegPath,
  renderDir,
}: {
  context: RenderContext;
  draft: VideoDraftDocument;
  ffmpegPath: string;
  renderDir: string;
}): Promise<string> {
  const audioInputs = draft.scenes.flatMap((scene) =>
    getSceneAudioInputs(scene)
  );
  if (audioInputs.length === 0) {
    throw new Error("Không có file voice để ghép vào video.");
  }

  const normalizedInputs: string[] = [];
  for (let i = 0; i < audioInputs.length; i++) {
    const originalPath = resolve(context.baseDir, audioInputs[i]!);
    const normalizedPath = resolve(renderDir, `narration-chunk-${i}.m4a`);
    await runProcess(ffmpegPath, [
      "-y",
      "-i",
      originalPath,
      "-vn",
      "-c:a",
      "aac",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-b:a",
      "96k",
      normalizedPath,
    ]);
    normalizedInputs.push(normalizedPath);
  }

  const listPath = resolve(renderDir, "audio-list.txt");
  await writeFile(
    listPath,
    normalizedInputs
      .map((path) => `file '${ffmpegConcatPath(path)}'`)
      .join("\n"),
    "utf8"
  );

  const outputPath = resolve(renderDir, "narration.m4a");
  const narrationGain = normalizeNarrationGain(draft.voice_volume);
  await runProcess(ffmpegPath, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-vn",
    "-af",
    `volume=${narrationGain},alimiter=limit=${NARRATION_LIMIT}`,
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    outputPath,
  ]);
  return outputPath;
}

async function buildNarrationAudio({
  context,
  draft,
  ffmpegPath,
  renderDir,
}: {
  context: RenderContext;
  draft: VideoDraftDocument;
  ffmpegPath: string;
  renderDir: string;
}): Promise<string> {
  const sceneAudioSegments: string[] = [];

  for (let i = 0; i < draft.scenes.length; i++) {
    const scene = draft.scenes[i]!;
    const sceneInputs = getSceneAudioInputs(scene);
    if (scene.kind === "post_video") {
      const sceneStartMs = scene.timeline?.start_ms ?? 0;
      const sceneEndMs = scene.timeline?.end_ms ?? sceneStartMs;
      const nextSceneStartMs =
        draft.scenes[i + 1]?.timeline?.start_ms ?? sceneEndMs;
      const silenceDurationMs = Math.max(
        0,
        sceneEndMs - sceneStartMs + Math.max(0, nextSceneStartMs - sceneEndMs)
      );
      if (silenceDurationMs > 10) {
        const silencePath = resolve(renderDir, `narration-post-video-${i}.m4a`);
        await runProcess(ffmpegPath, [
          "-y",
          "-f",
          "lavfi",
          "-t",
          (silenceDurationMs / 1000).toFixed(3),
          "-i",
          "anullsrc=r=44100:cl=stereo",
          "-c:a",
          "aac",
          "-b:a",
          "96k",
          silencePath,
        ]);
        sceneAudioSegments.push(silencePath);
      }
      continue;
    }
    if (sceneInputs.length === 0) {
      continue;
    }

    const normalizedSceneInputs: string[] = [];
    for (let j = 0; j < sceneInputs.length; j++) {
      const originalPath = resolve(context.baseDir, sceneInputs[j]!);
      const normalizedPath = resolve(
        renderDir,
        `narration-scene-${i}-chunk-${j}.m4a`
      );
      await runProcess(ffmpegPath, [
        "-y",
        "-i",
        originalPath,
        "-vn",
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-b:a",
        "96k",
        normalizedPath,
      ]);
      normalizedSceneInputs.push(normalizedPath);
    }

    let sceneAudioPath = normalizedSceneInputs[0]!;
    if (normalizedSceneInputs.length > 1) {
      sceneAudioPath = resolve(renderDir, `narration-scene-${i}.m4a`);
      const concatGraph = normalizedSceneInputs
        .map((_, index) => `[${index}:a]`)
        .join("");
      await runProcess(ffmpegPath, [
        "-y",
        ...normalizedSceneInputs.flatMap((path) => ["-i", path]),
        "-filter_complex",
        `${concatGraph}concat=n=${normalizedSceneInputs.length}:v=0:a=1[outa]`,
        "-map",
        "[outa]",
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        sceneAudioPath,
      ]);
    }

    const memeLeadMs = getMemeLeadInMs(draft, draft.scenes, i);
    if (memeLeadMs > 10) {
      const leadSilencePath = resolve(renderDir, `narration-lead-${i}.m4a`);
      await runProcess(ffmpegPath, [
        "-y",
        "-f",
        "lavfi",
        "-t",
        (memeLeadMs / 1000).toFixed(3),
        "-i",
        "anullsrc=r=44100:cl=stereo",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        leadSilencePath,
      ]);
      sceneAudioSegments.push(leadSilencePath);
    }
    sceneAudioSegments.push(sceneAudioPath);

    const nextScene = draft.scenes[i + 1];
        const sceneNarrationDurationMs =
      (await probeDurationMs(sceneAudioPath)) ??
      getSceneNarrationDurationMs(scene);
    const dialogueContinuation = Boolean(
      scene.kind === "post" &&
        nextScene?.dialogue_speaker &&
        nextScene.post_id === scene.post_id
    );
    const audioDrivenEndMs =
      (scene.timeline?.start_ms ?? 0) + memeLeadMs + sceneNarrationDurationMs;
    const effectiveSceneEndMs = dialogueContinuation
      ? audioDrivenEndMs
      : (scene.timeline?.end_ms ?? audioDrivenEndMs);
    const sceneTimelineDurationMs = Math.max(
      0,
      effectiveSceneEndMs - (scene.timeline?.start_ms ?? 0)
    );
    const nextSceneStartMs =
      nextScene?.timeline?.start_ms ?? effectiveSceneEndMs;
    const sceneGapMs = Math.max(
      0,
      nextSceneStartMs - effectiveSceneEndMs
    );
    const trailingSilenceMs = Math.max(
      0,
      sceneTimelineDurationMs -
        memeLeadMs -
        sceneNarrationDurationMs +
        sceneGapMs
    );

    if (trailingSilenceMs > 10) {
      const silencePath = resolve(renderDir, `narration-gap-${i}.m4a`);
      await runProcess(ffmpegPath, [
        "-y",
        "-f",
        "lavfi",
        "-t",
        (trailingSilenceMs / 1000).toFixed(3),
        "-i",
        "anullsrc=r=44100:cl=stereo",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        silencePath,
      ]);
      sceneAudioSegments.push(silencePath);
    }
  }

  if (sceneAudioSegments.length === 0) {
    throw new Error("Không có file voice để ghép vào video.");
  }

  const listPath = resolve(renderDir, "audio-list.txt");
  await writeFile(
    listPath,
    sceneAudioSegments
      .map((path) => `file '${ffmpegConcatPath(path)}'`)
      .join("\n"),
    "utf8"
  );

  const outputPath = resolve(renderDir, "narration.m4a");
  const narrationGain = normalizeNarrationGain(draft.voice_volume);
  await runProcess(ffmpegPath, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-vn",
    "-af",
    `volume=${narrationGain},alimiter=limit=${NARRATION_LIMIT}`,
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    outputPath,
  ]);
  return outputPath;
}

function splitSpoilerRevealRegions(
  regions: VideoSpoilerRevealRegion[],
  revealSegmentTexts: string[]
): VideoSpoilerRevealRegion[] {
  if (regions.length !== 1 || revealSegmentTexts.length < 2) {
    return regions;
  }

  const region = regions[0]!;
  const segmentHeight = region.bbox.height / revealSegmentTexts.length;
  return revealSegmentTexts.map((text, index) => ({
    ...region,
    bbox: {
      ...region.bbox,
      height:
        index === revealSegmentTexts.length - 1
          ? region.bbox.height - segmentHeight * index
          : segmentHeight,
      y: region.bbox.y + segmentHeight * index,
    },
    text,
  }));
}

function normalizeNarrationGain(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_NARRATION_GAIN;
  }

  return Math.min(3, Math.max(0, value ?? DEFAULT_NARRATION_GAIN));
}

async function buildFinalAudioTrack({
  context,
  draft,
  ffmpegPath,
  narrationPath,
  renderDir,
  sceneAssets,
  totalDurationSeconds,
}: {
  context: RenderContext;
  draft: VideoDraftDocument;
  ffmpegPath: string;
  narrationPath: string;
  renderDir: string;
  sceneAssets: SceneRenderAsset[];
  totalDurationSeconds: number;
}): Promise<string> {
  const thumbnailDelayMs = draft.thumbnail_intro?.enabled
    ? Math.max(0, Math.round(draft.thumbnail_intro.durationMs))
    : 0;
  let effectiveNarrationPath = narrationPath;
  if (thumbnailDelayMs > 0) {
    effectiveNarrationPath = resolve(renderDir, "narration-with-thumbnail-delay.m4a");
    await runProcess(ffmpegPath, [
      "-y",
      "-i",
      narrationPath,
      "-af",
      `adelay=${thumbnailDelayMs}|${thumbnailDelayMs}`,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      effectiveNarrationPath,
    ]);
  }

  const memeAudioOverlays = await collectMemeAudioOverlays(
    draft,
    context.baseDir
  );
  const postVideoAudioOverlays = await collectPostVideoAudioOverlays(
    draft,
    sceneAssets
  );
  const hasBackgroundMusic =
    Boolean(draft.background_music?.serverPath) &&
    existsSync(
      resolve(context.baseDir, draft.background_music?.serverPath ?? "")
    );

  if (
    !hasBackgroundMusic &&
    memeAudioOverlays.length === 0 &&
    postVideoAudioOverlays.length === 0
  ) {
    return effectiveNarrationPath;
  }

  const mixedAudioPath = resolve(renderDir, "final-audio.m4a");
  const fadeOutStart = Math.max(0, totalDurationSeconds - 2.8);
  const backgroundMusicVolume = normalizeBackgroundMusicVolume(
    draft.background_music_volume
  );

  const args = ["-y", "-i", effectiveNarrationPath];
  const filterParts: string[] = [];
  const mixInputs: string[] = ["[0:a]"];
  let inputIndex = 1;

  if (hasBackgroundMusic && draft.background_music?.serverPath) {
    const musicPath = resolve(
      context.baseDir,
      draft.background_music.serverPath
    );
    args.push("-stream_loop", "-1", "-i", musicPath);
    filterParts.push(
      `[${inputIndex}:a]volume=${backgroundMusicVolume},atrim=0:${totalDurationSeconds.toFixed(
        3
      )},afade=t=in:st=0:d=0.8,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=2.8[bg]`
    );
    mixInputs.push("[bg]");
    inputIndex += 1;
  }

  for (let index = 0; index < memeAudioOverlays.length; index += 1) {
    const overlay = memeAudioOverlays[index]!;
    args.push("-i", overlay.path);
    filterParts.push(
      `[${inputIndex}:a]atrim=0:${overlay.durationSeconds.toFixed(3)},adelay=${overlay.delayMs}|${overlay.delayMs}[meme${index}]`
    );
    mixInputs.push(`[meme${index}]`);
    inputIndex += 1;
  }

  for (let index = 0; index < postVideoAudioOverlays.length; index += 1) {
    const overlay = postVideoAudioOverlays[index]!;
    args.push("-i", overlay.path);
    filterParts.push(
      `[${inputIndex}:a]atrim=0:${overlay.durationSeconds.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=1,adelay=${overlay.delayMs}|${overlay.delayMs}[postvideo${index}]`
    );
    mixInputs.push(`[postvideo${index}]`);
    inputIndex += 1;
  }

  filterParts.push(
    `${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.92[mix]`
  );

  await runProcess(ffmpegPath, [
    ...args,
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[mix]",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    mixedAudioPath,
  ]);

  return mixedAudioPath;
}

function normalizeBackgroundMusicVolume(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_BACKGROUND_MUSIC_VOLUME;
  }

  return Math.min(1, Math.max(0, value ?? DEFAULT_BACKGROUND_MUSIC_VOLUME));
}

async function collectMemeAudioOverlays(
  draft: VideoDraftDocument,
  baseDir: string
): Promise<MemeAudioOverlay[]> {
  const result: MemeAudioOverlay[] = [];
  const ffprobePath = await findAvailableMediaBinary("ffprobe");

  const addTransitionAudio = async (
    transition: MemeTransitionConfig | null | undefined,
    delayMs: number,
    durationSeconds: number
  ): Promise<void> => {
    const memeAudioPath = transition?.audio?.serverPath
      ? resolve(baseDir, transition.audio.serverPath)
      : "";
    const originalVideoPath =
      transition?.visualMode === "sound_only"
        ? ""
        : transition?.image?.serverPath
          ? resolve(baseDir, transition.image.serverPath)
          : "";
    const isVideoMeme =
      Boolean(originalVideoPath) && isVideoPath(originalVideoPath);
    const videoDurationSeconds = isVideoMeme
      ? Math.max(
          0.1,
          (transition?.image?.durationSeconds ?? 0) > 0
            ? Number(transition?.image?.durationSeconds)
            : ((await probeDurationMs(originalVideoPath)) ?? 0) / 1000 ||
                durationSeconds
        )
      : 0;
    const hasOriginalVideoAudio =
      ffprobePath &&
      isVideoMeme &&
      existsSync(originalVideoPath) &&
      (await mediaHasAudio(ffprobePath, originalVideoPath));

    if (hasOriginalVideoAudio) {
      result.push({
        delayMs,
        durationSeconds: Math.min(durationSeconds, videoDurationSeconds),
        path: originalVideoPath,
      });
    }

    if (memeAudioPath && existsSync(memeAudioPath)) {
      const soundDurationSeconds =
        (await probeDurationMs(memeAudioPath) ?? 0) / 1000;
      const soundDelayMs = delayMs + (isVideoMeme ? videoDurationSeconds * 1000 : 0);
      const remainingDurationSeconds = Math.max(
        0.1,
        durationSeconds - (isVideoMeme ? videoDurationSeconds : 0)
      );
      result.push({
        delayMs: soundDelayMs,
        durationSeconds:
          soundDurationSeconds > 0
            ? Math.min(soundDurationSeconds, remainingDurationSeconds)
            : remainingDurationSeconds,
        path: memeAudioPath,
      });
    }
  };

  for (let index = 0; index < draft.scenes.length; index += 1) {
    const scene = draft.scenes[index]!;
    const memeLeadMs = getMemeLeadInMs(draft, draft.scenes, index);
    if (memeLeadMs > 0) {
      await addTransitionAudio(
        resolveSceneMemeTransition(scene, draft.scenes, index, draft),
        Math.max(0, scene.timeline?.start_ms ?? 0),
        getMemeTransitionDurationSeconds(scene, draft, index)
      );
    }

    if (scene.trailing_meme_transition) {
      const trailingDurationMs = getResolvedMemeTransitionDurationMs(
        scene.trailing_meme_transition
      );
      await addTransitionAudio(
        scene.trailing_meme_transition,
        getTrailingMemeStartMs(draft, scene, index),
        trailingDurationMs / 1000
      );
    }
  }

  return result;
}

async function collectPostVideoAudioOverlays(
  draft: VideoDraftDocument,
  sceneAssets: SceneRenderAsset[]
): Promise<MemeAudioOverlay[]> {
  const ffprobePath = await findAvailableMediaBinary("ffprobe");
  if (!ffprobePath) {
    return [];
  }

  const overlays: MemeAudioOverlay[] = [];
  for (let index = 0; index < draft.scenes.length; index += 1) {
    const scene = draft.scenes[index];
    const postVideo = sceneAssets[index]?.postVideo;
    if (
      scene?.kind !== "post_video" ||
      !postVideo?.path ||
      !existsSync(postVideo.path)
    ) {
      continue;
    }

    if (!(await mediaHasAudio(ffprobePath, postVideo.path))) {
      continue;
    }

    const sceneStartMs = Math.max(0, scene.timeline?.start_ms ?? 0);
    const sceneEndMs = Math.max(sceneStartMs, scene.timeline?.end_ms ?? sceneStartMs);
    overlays.push({
      delayMs: sceneStartMs,
      durationSeconds: Math.max(0.1, (sceneEndMs - sceneStartMs) / 1000),
      path: postVideo.path,
    });
  }

  return overlays;
}

async function buildFilterScript({
  draft,
  memeImageInputIndices,
  trailingMemeImageInputIndices,
  renderDir,
  sceneAssets,
  thumbnailInputIndex,
  thumbnailAnimationAssets,
  totalDurationSeconds,
}: {
  draft: VideoDraftDocument;
  memeImageInputIndices: Array<number | null>;
  trailingMemeImageInputIndices: Array<number | null>;
  renderDir: string;
  sceneAssets: SceneRenderAsset[];
  thumbnailInputIndex: number | null;
  thumbnailAnimationAssets: ThumbnailAnimationAsset[];
  totalDurationSeconds: number;
}): Promise<string> {
  const filters: string[] = [
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop=${WIDTH}:${HEIGHT},setsar=1,format=yuv420p,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${totalDurationSeconds.toFixed(3)}[v0]`,
  ];
  let currentLabel = "v0";

  const thumbnailDurationSeconds = draft.thumbnail_intro?.enabled
    ? draft.thumbnail_intro.durationMs / 1000
    : 0;
  if (thumbnailInputIndex !== null && thumbnailDurationSeconds > 0) {
    const thumbnailLabel = "thumbnail_intro";
    const fadeOutStart = Math.max(0, thumbnailDurationSeconds - 0.18);
    filters.push(
      `[${thumbnailInputIndex}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=yuva420p,trim=duration=${thumbnailDurationSeconds.toFixed(3)},setpts=PTS-STARTPTS,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.18:alpha=1[${thumbnailLabel}]`
    );
    filters.push(
      `[${currentLabel}][${thumbnailLabel}]overlay=x=0:y=0:enable='between(t\\,0\\,${thumbnailDurationSeconds.toFixed(3)})':eval=frame[thumbnail_base]`
    );
    currentLabel = "thumbnail_base";
  }

  for (const [index, animation] of thumbnailAnimationAssets.entries()) {
    if (animation.inputIndex === undefined || thumbnailDurationSeconds <= 0) {
      continue;
    }

    const width = Math.max(1, Math.round((WIDTH * animation.width) / 100));
    const height = Math.max(1, Math.round((HEIGHT * animation.height) / 100));
    const x = Math.round((WIDTH * animation.x) / 100 - width / 2);
    const y = Math.round((HEIGHT * animation.y) / 100 - height / 2);
    const animationLabel = `thumbnail_gif_${index}`;
    const nextLabel = `thumbnail_gif_base_${index}`;
    const fadeOutStart = Math.max(0, thumbnailDurationSeconds - 0.18);

    filters.push(
      `[${animation.inputIndex}:v]fps=30,scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,trim=duration=${thumbnailDurationSeconds.toFixed(3)},setpts=PTS-STARTPTS,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.18:alpha=1[${animationLabel}]`
    );
    filters.push(
      `[${currentLabel}][${animationLabel}]overlay=x=${x}:y=${y}:eof_action=repeat:enable='between(t\\,0\\,${thumbnailDurationSeconds.toFixed(3)})':format=auto[${nextLabel}]`
    );
    currentLabel = nextLabel;
  }

  for (let i = 0; i < draft.scenes.length; i++) {
    const scene = draft.scenes[i]!;
    const asset = sceneAssets[i]!;
    const isDialogueScene = Boolean(scene.dialogue_speaker);
    const nextLabel = `v${scene.order}`;
    const sceneStart = (scene.timeline?.start_ms ?? 0) / 1000;
    const memeLeadSeconds = getMemeLeadInMs(draft, draft.scenes, i) / 1000;
    const start = sceneStart + memeLeadSeconds;
    const end = (scene.timeline?.end_ms ?? 0) / 1000;
    const visibleStart = start;
    const trailingMemeStart = scene.trailing_meme_transition
      ? getTrailingMemeStartMs(draft, scene, i) / 1000
      : end;
    const hasMediaReveal = Boolean(
      scene.trailing_meme_transition?.placement === "media_reveal" &&
        asset.mediaReveal
    );

    // Dialogue scenes only add narration. The preceding post scene is
    // intentionally extended through the complete dialogue block, so adding
    // this scene's card would stack a second copy of the post on top of it.
    // The web preview already follows this rule; keep the exported FFmpeg
    // composition in sync. A trailing meme still belongs to the dialogue
    // scene and must remain visible after its narration.
    if (isDialogueScene) {
      if (hasMediaReveal && asset.mediaReveal) {
        currentLabel = appendMediaRevealFilter({
          currentLabel,
          filters,
          media: asset.mediaReveal,
          revealEnd: end,
          revealStart: trailingMemeStart,
          sceneOrder: scene.order,
        });
      } else if (scene.trailing_meme_transition?.image?.serverPath) {
        currentLabel = appendMemeOverlayFilter({
          currentLabel,
          draft,
          filters,
          memeStart: trailingMemeStart,
          memeEnd: end,
          memeImageInputIndex: trailingMemeImageInputIndices[i] ?? null,
          memePosition:
            scene.trailing_meme_transition.placement === "transition"
              ? "center"
              : "below_card",
          cardHeight: asset.cardHeight,
          cardWidth: asset.cardWidth,
          cardY: asset.cardY,
          scene,
          sceneIndex: i,
          overrideMemeTransition: scene.trailing_meme_transition,
        });
      }
      continue;
    }
    if (scene.kind === "post_video") {
      const postVideo = asset.postVideo;
      if (postVideo?.inputIndex === undefined) {
        filters.push(`[${currentLabel}]copy[${nextLabel}]`);
        currentLabel = nextLabel;
        continue;
      }

      const videoDuration = Math.max(0.1, end - start);
      const cardLabel = `post_video_card_${scene.order}`;
      const cardBaseLabel = `post_video_card_base_${scene.order}`;
      const postVideoLabel = `post_video_${scene.order}`;
      // The card screenshot includes a 90px transparent frame on each side.
      // Keep that frame at its native width so the visible card and its video
      // use the same 900px width as the in-tool preview.
      const postVideoCardWidth = Math.min(WIDTH, asset.cardWidth);
      const mediaLayout = resolveExportMediaLayout({
        cardWidth: asset.cardWidth,
        mediaHeight: postVideo.height,
        mediaWidth: postVideo.width,
        mediaX: postVideo.x,
        mediaY: postVideo.y,
        targetCardWidth: postVideoCardWidth,
      });
      const mediaScaleFilter =
        postVideo.fitMode === "contain"
          ? `scale=${mediaLayout.width}:${mediaLayout.height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${mediaLayout.width}:${mediaLayout.height}:(ow-iw)/2:(oh-ih)/2:color=black@0`
          : `scale=${mediaLayout.width}:${mediaLayout.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${mediaLayout.width}:${mediaLayout.height}`;
      filters.push(
        `[${(asset as any).revealInputIndex}:v]scale='min(iw,${postVideoCardWidth})':-2:flags=lanczos:eval=frame,format=yuva420p,trim=duration=${videoDuration.toFixed(3)},setpts=PTS-STARTPTS+${start.toFixed(3)}/TB[${cardLabel}]`
      );
      filters.push(
        `[${currentLabel}][${cardLabel}]overlay=x='(main_w-overlay_w)/2':y='${asset.cardY}':enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})':eval=frame[${cardBaseLabel}]`
      );
      filters.push(
        `[${postVideo.inputIndex}:v]fps=30,${mediaScaleFilter},format=rgba,trim=duration=${videoDuration.toFixed(3)},setpts=PTS-STARTPTS+${start.toFixed(3)}/TB[${postVideoLabel}]`
      );
      filters.push(
        `[${cardBaseLabel}][${postVideoLabel}]overlay=x='(main_w-${mediaLayout.cardWidth})/2+${mediaLayout.x}':y='${asset.cardY + mediaLayout.y}':enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})':eof_action=repeat:format=auto[${nextLabel}]`
      );
      currentLabel = nextLabel;
      continue;
    }
    const hidesCardForTransitionMeme =
      hasMediaReveal || scene.trailing_meme_transition?.placement === "transition";
    const cardEnd = hidesCardForTransitionMeme
      ? Math.max(visibleStart, trailingMemeStart)
      : end;
    const visibleDuration = Math.max(0.1, cardEnd - visibleStart);
    const enable = `between(t\\,${visibleStart.toFixed(3)}\\,${cardEnd.toFixed(3)})`;
    // Dialogue lines reuse the post card and image. Do not apply comment
    // sizing or slide/fade transitions to each line, otherwise the post
    // appears to jump while the two voices are still speaking.
    const enterSeconds = isDialogueScene
      ? 0
      : scene.kind === "post"
        ? POST_ENTER_SECONDS
        : COMMENT_ENTER_SECONDS;
    const fadeInSeconds = isDialogueScene
      ? 0.001
      : scene.kind === "post"
        ? POST_FADE_IN_SECONDS
        : COMMENT_FADE_IN_SECONDS;
    const enterEnd = Math.min(cardEnd, visibleStart + enterSeconds);
    const effectiveEnterSeconds = Math.max(0.01, enterEnd - visibleStart);
    const exitStart = Math.max(visibleStart, cardEnd - CARD_EXIT_SECONDS);
    const fadeOutStart = Math.max(visibleStart, cardEnd - CARD_FADE_OUT_SECONDS);
    const memeStart = sceneStart;
    const memeEnd = Math.min(
      start,
      sceneStart + getMemeTransitionDurationSeconds(scene, draft, i)
    );
    const cardLabel = `card${scene.order}`;
    const enterOffset =
      scene.kind === "comment" && !isDialogueScene
        ? `if(lte(t\\,${enterEnd.toFixed(3)})\\,pow(1-(t-${visibleStart.toFixed(
            3
          )})/${effectiveEnterSeconds.toFixed(3)}\\,2)*${COMMENT_ENTER_OFFSET_Y}\\,0)`
        : "0";
    const exitOffset =
      scene.kind === "comment" && !isDialogueScene
        ? `if(gte(t\\,${exitStart.toFixed(3)})\\,pow((t-${exitStart.toFixed(
            3
          )})/${CARD_EXIT_SECONDS}\\,1.6)*${COMMENT_EXIT_OFFSET_Y}\\,0)`
        : "0";
    const slideOffset = `+${enterOffset}-${exitOffset}`;
    const scaleExpression =
      scene.kind === "post" && !asset.media
        ? `'min(iw,900)*(if(lte(t\\,${effectiveEnterSeconds.toFixed(3)})\\,${POST_ENTER_SCALE}+((1-${POST_ENTER_SCALE})*(t/${effectiveEnterSeconds.toFixed(3)}))\\,1))'`
        : "'min(iw,900)'";
    const baseLabel = asset.media ? `scene${scene.order}_base` : nextLabel;

    const hasTextReveal =
      asset.cardPathInitial !== undefined &&
      asset.spoilerRevealTimeSeconds !== undefined &&
      asset.spoilerRevealTimeSeconds > 0;
    const hasMediaSpoiler =
      asset.hasMediaSpoiler &&
      asset.spoilerMediaRevealTimeSeconds !== undefined &&
      asset.spoilerMediaRevealTimeSeconds > 0;
    const hasSpoilerSegments =
      asset.cardPathSpoilerStages?.length &&
      asset.spoilerRevealSegments?.length &&
      asset.spoilerRevealSegments.length > 1 &&
      asset.cardPathInitial;

    const staticScaleExpression = "'min(iw,900)'";

    if (hasSpoilerSegments) {
      const segmentTimes = (asset.spoilerRevealSegments ?? []).map((segment) =>
        Math.max(0.05, segment.revealTimeSeconds)
      );
      const cardInitialLabel = `card${scene.order}_initial`;
      const initialDuration = Math.max(0.05, visibleDuration);
      filters.push(
        `[${(asset as any).initialInputIndex}:v]scale=${scaleExpression}:-2:flags=lanczos:eval=frame,format=yuva420p,trim=duration=${initialDuration.toFixed(3)},setpts=PTS-STARTPTS+${visibleStart.toFixed(3)}/TB,fade=t=in:st=${visibleStart.toFixed(3)}:d=${fadeInSeconds}:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${CARD_FADE_OUT_SECONDS}:alpha=1[${cardInitialLabel}]`
      );

      let stageLabel = `scene${scene.order}_spoiler_initial`;
      filters.push(
        `[${currentLabel}][${cardInitialLabel}]overlay=x='(main_w-overlay_w)/2':y='${asset.cardY}${slideOffset}':enable='between(t\\,${visibleStart.toFixed(3)}\\,${cardEnd.toFixed(3)})':eval=frame[${stageLabel}]`
      );

      const stageInputIndices = ((asset as any).spoilerStageInputIndices ??
        []) as number[];
      for (let stageIndex = 0; stageIndex < stageInputIndices.length; stageIndex += 1) {
        const revealTime = Math.min(
          cardEnd - 0.01,
          visibleStart + (segmentTimes[stageIndex] ?? segmentTimes[0] ?? 0)
        );
        const stageDuration = Math.max(0.05, cardEnd - revealTime);
        const cardStageLabel = `card${scene.order}_spoiler_${stageIndex}`;
        const nextStageLabel = `scene${scene.order}_spoiler_stage_${stageIndex}`;
        filters.push(
          `[${stageInputIndices[stageIndex]}:v]scale=${staticScaleExpression}:-2:flags=lanczos:eval=frame,format=yuva420p,trim=duration=${stageDuration.toFixed(3)},setpts=PTS-STARTPTS+${revealTime.toFixed(3)}/TB,fade=t=in:st=${revealTime.toFixed(3)}:d=0.12:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${CARD_FADE_OUT_SECONDS}:alpha=1[${cardStageLabel}]`
        );
        filters.push(
          `[${stageLabel}][${cardStageLabel}]overlay=x='(main_w-overlay_w)/2':y='${asset.cardY}${slideOffset}':enable='between(t\\,${revealTime.toFixed(3)}\\,${cardEnd.toFixed(3)})':eval=frame[${nextStageLabel}]`
        );
        stageLabel = nextStageLabel;
      }

      const finalRevealTime = Math.min(
        cardEnd - 0.01,
        visibleStart + (segmentTimes[segmentTimes.length - 1] ?? 0)
      );
      const finalRevealDuration = Math.max(0.05, cardEnd - finalRevealTime);
      const cardRevealLabel = `card${scene.order}_spoiler_full`;
      filters.push(
        `[${(asset as any).revealInputIndex}:v]scale=${staticScaleExpression}:-2:flags=lanczos:eval=frame,format=yuva420p,trim=duration=${finalRevealDuration.toFixed(3)},setpts=PTS-STARTPTS+${finalRevealTime.toFixed(3)}/TB,fade=t=in:st=${finalRevealTime.toFixed(3)}:d=0.12:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${CARD_FADE_OUT_SECONDS}:alpha=1[${cardRevealLabel}]`
      );
      filters.push(
        `[${stageLabel}][${cardRevealLabel}]overlay=x='(main_w-overlay_w)/2':y='${asset.cardY}${slideOffset}':enable='between(t\\,${finalRevealTime.toFixed(3)}\\,${cardEnd.toFixed(3)})':eval=frame[${baseLabel}]`
      );
    } else if (hasTextReveal && hasMediaSpoiler && asset.cardPathTextReveal) {
      // 3-stage reveal: Initial (text 1, no img) -> Text Reveal (text 1+2, no img) -> Full Reveal (text 1+2, img)
      const T_text = visibleStart + asset.spoilerRevealTimeSeconds!;
      const T_media = visibleStart + asset.spoilerMediaRevealTimeSeconds!;

      const cardInitialLabel = `card${scene.order}_initial`;
      const cardTextRevealLabel = `card${scene.order}_textreveal`;
      const cardRevealLabel = `card${scene.order}_reveal`;
      const mid1Label = `scene${scene.order}_mid1`;
      const mid2Label = `scene${scene.order}_mid2`;

      const textRevealDuration = Math.max(0.05, cardEnd - T_text);
      const mediaRevealDuration = Math.max(0.05, cardEnd - T_media);

      filters.push(
        `[${(asset as any).initialInputIndex}:v]scale=${scaleExpression}:-2:flags=lanczos:eval=frame,format=yuva420p,trim=duration=${visibleDuration.toFixed(3)},setpts=PTS-STARTPTS+${visibleStart.toFixed(3)}/TB,fade=t=in:st=${visibleStart.toFixed(3)}:d=${fadeInSeconds}:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${CARD_FADE_OUT_SECONDS}:alpha=1[${cardInitialLabel}]`
      );
      filters.push(
        `[${(asset as any).textRevealInputIndex}:v]scale=${staticScaleExpression}:-2:flags=lanczos:eval=frame,format=yuva420p,trim=duration=${textRevealDuration.toFixed(3)},setpts=PTS-STARTPTS+${T_text.toFixed(3)}/TB,fade=t=in:st=${T_text.toFixed(3)}:d=0.15:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${CARD_FADE_OUT_SECONDS}:alpha=1[${cardTextRevealLabel}]`
      );
      filters.push(
        `[${(asset as any).revealInputIndex}:v]scale=${staticScaleExpression}:-2:flags=lanczos:eval=frame,format=yuva420p,trim=duration=${mediaRevealDuration.toFixed(3)},setpts=PTS-STARTPTS+${T_media.toFixed(3)}/TB,fade=t=in:st=${T_media.toFixed(3)}:d=0.15:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${CARD_FADE_OUT_SECONDS}:alpha=1[${cardRevealLabel}]`
      );

      filters.push(
        `[${currentLabel}][${cardInitialLabel}]overlay=x='(main_w-overlay_w)/2':y='${asset.cardY}${slideOffset}':enable='between(t\\,${visibleStart.toFixed(3)}\\,${cardEnd.toFixed(3)})':eval=frame[${mid1Label}]`
      );
      filters.push(
        `[${mid1Label}][${cardTextRevealLabel}]overlay=x='(main_w-overlay_w)/2':y='${asset.cardY}${slideOffset}':enable='between(t\\,${T_text.toFixed(3)}\\,${cardEnd.toFixed(3)})':eval=frame[${mid2Label}]`
      );
      filters.push(
        `[${mid2Label}][${cardRevealLabel}]overlay=x='(main_w-overlay_w)/2':y='${asset.cardY}${slideOffset}':enable='between(t\\,${T_media.toFixed(3)}\\,${cardEnd.toFixed(3)})':eval=frame[${baseLabel}]`
      );
    } else if (hasMediaSpoiler && asset.cardPathInitial) {
      // 2-stage media spoiler: Initial (img hidden) -> Full (img visible)
      const T_media = visibleStart + asset.spoilerMediaRevealTimeSeconds!;
      const cardInitialLabel = `card${scene.order}_initial`;
      const cardRevealLabel = `card${scene.order}_reveal`;
      const midLabel = `scene${scene.order}_mid`;

      const mediaRevealDuration = Math.max(0.05, cardEnd - T_media);

      filters.push(
        `[${(asset as any).initialInputIndex}:v]scale=${scaleExpression}:-2:flags=lanczos:eval=frame,format=yuva420p,trim=duration=${visibleDuration.toFixed(3)},setpts=PTS-STARTPTS+${visibleStart.toFixed(3)}/TB,fade=t=in:st=${visibleStart.toFixed(3)}:d=${fadeInSeconds}:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${CARD_FADE_OUT_SECONDS}:alpha=1[${cardInitialLabel}]`
      );
      filters.push(
        `[${(asset as any).revealInputIndex}:v]scale=${staticScaleExpression}:-2:flags=lanczos:eval=frame,format=yuva420p,trim=duration=${mediaRevealDuration.toFixed(3)},setpts=PTS-STARTPTS+${T_media.toFixed(3)}/TB,fade=t=in:st=${T_media.toFixed(3)}:d=0.15:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${CARD_FADE_OUT_SECONDS}:alpha=1[${cardRevealLabel}]`
      );

      filters.push(
        `[${currentLabel}][${cardInitialLabel}]overlay=x='(main_w-overlay_w)/2':y='${asset.cardY}${slideOffset}':enable='between(t\\,${visibleStart.toFixed(3)}\\,${cardEnd.toFixed(3)})':eval=frame[${midLabel}]`
      );
      filters.push(
        `[${midLabel}][${cardRevealLabel}]overlay=x='(main_w-overlay_w)/2':y='${asset.cardY}${slideOffset}':enable='between(t\\,${T_media.toFixed(3)}\\,${cardEnd.toFixed(3)})':eval=frame[${baseLabel}]`
      );
    } else if (hasTextReveal && asset.cardPathInitial) {
      // 2-stage text spoiler: Initial (text 2 hidden) -> Full (text 2 visible)
      const T_text = visibleStart + asset.spoilerRevealTimeSeconds!;
      const cardInitialLabel = `card${scene.order}_initial`;
      const cardRevealLabel = `card${scene.order}_reveal`;
      const midLabel = `scene${scene.order}_mid`;

      const textRevealDuration = Math.max(0.05, cardEnd - T_text);

      filters.push(
        `[${(asset as any).initialInputIndex}:v]scale=${scaleExpression}:-2:flags=lanczos:eval=frame,format=yuva420p,trim=duration=${visibleDuration.toFixed(3)},setpts=PTS-STARTPTS+${visibleStart.toFixed(3)}/TB,fade=t=in:st=${visibleStart.toFixed(3)}:d=${fadeInSeconds}:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${CARD_FADE_OUT_SECONDS}:alpha=1[${cardInitialLabel}]`
      );
      filters.push(
        `[${(asset as any).revealInputIndex}:v]scale=${staticScaleExpression}:-2:flags=lanczos:eval=frame,format=yuva420p,trim=duration=${textRevealDuration.toFixed(3)},setpts=PTS-STARTPTS+${T_text.toFixed(3)}/TB,fade=t=in:st=${T_text.toFixed(3)}:d=0.15:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${CARD_FADE_OUT_SECONDS}:alpha=1[${cardRevealLabel}]`
      );

      filters.push(
        `[${currentLabel}][${cardInitialLabel}]overlay=x='(main_w-overlay_w)/2':y='${asset.cardY}${slideOffset}':enable='between(t\\,${visibleStart.toFixed(3)}\\,${cardEnd.toFixed(3)})':eval=frame[${midLabel}]`
      );
      filters.push(
        `[${midLabel}][${cardRevealLabel}]overlay=x='(main_w-overlay_w)/2':y='${asset.cardY}${slideOffset}':enable='between(t\\,${T_text.toFixed(3)}\\,${cardEnd.toFixed(3)})':eval=frame[${baseLabel}]`
      );
    } else {
      const cardLabel = `card${scene.order}`;
      filters.push(
        `[${(asset as any).revealInputIndex}:v]scale=${scaleExpression}:-2:flags=lanczos:eval=frame,format=yuva420p,trim=duration=${visibleDuration.toFixed(3)},setpts=PTS-STARTPTS+${visibleStart.toFixed(
          3
        )}/TB,fade=t=in:st=${visibleStart.toFixed(3)}:d=${fadeInSeconds}:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(
          3
        )}:d=${CARD_FADE_OUT_SECONDS}:alpha=1[${cardLabel}]`
      );
      filters.push(
        `[${currentLabel}][${cardLabel}]overlay=x='(main_w-overlay_w)/2':y='${asset.cardY}${slideOffset}':enable='${enable}':eval=frame[${baseLabel}]`
      );
    }

    if (!asset.media || asset.media.inputIndex === undefined) {
      currentLabel = baseLabel;
      currentLabel = appendMemeOverlayFilter({
        currentLabel,
        draft,
        filters,
        memeStart,
        memeEnd,
        memeImageInputIndex: memeImageInputIndices[i] ?? null,
        scene,
        sceneIndex: i,
      });
      if (hasMediaReveal && asset.mediaReveal) {
        currentLabel = appendMediaRevealFilter({
          currentLabel,
          filters,
          media: asset.mediaReveal,
          revealEnd: end,
          revealStart: trailingMemeStart,
          sceneOrder: scene.order,
        });
      } else if (scene.trailing_meme_transition?.image?.serverPath) {
        currentLabel = appendMemeOverlayFilter({
          currentLabel,
          draft,
          filters,
          memeStart: trailingMemeStart,
          memeEnd: end,
          memeImageInputIndex: trailingMemeImageInputIndices[i] ?? null,
          memePosition:
            scene.trailing_meme_transition.placement === "transition"
              ? "center"
              : "below_card",
          cardHeight: asset.cardHeight,
          cardWidth: asset.cardWidth,
          cardY: asset.cardY,
          scene,
          sceneIndex: i,
          overrideMemeTransition: scene.trailing_meme_transition,
        });
      }
      if (baseLabel !== nextLabel) {
        filters.push(`[${currentLabel}]copy[${nextLabel}]`);
        currentLabel = nextLabel;
      }
      continue;
    }

    const mediaInputIndices = asset.media.inputIndices?.length
      ? asset.media.inputIndices
      : asset.media.inputIndex !== undefined
        ? [asset.media.inputIndex]
        : [];
    const mediaLabel = `scene${scene.order}_media`;
    const mediaLayout = resolveSceneMediaLayout(asset);
    const mediaScaleFilter =
      asset.media.fitMode === "contain"
        ? `scale=${mediaLayout.width}:${mediaLayout.height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${mediaLayout.width}:${mediaLayout.height}:(ow-iw)/2:(oh-ih)/2:color=black@0`
        : `scale=${mediaLayout.width}:${mediaLayout.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${mediaLayout.width}:${mediaLayout.height}`;
    const roundedMediaFilter =
      `${mediaScaleFilter},format=rgba,` +
      `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':` +
      `a='if(lte(pow(max(abs(X-W/2)-(W/2-${mediaLayout.radius}),0),2)+pow(max(abs(Y-H/2)-(H/2-${mediaLayout.radius}),0),2),${mediaLayout.radius ** 2}),alpha(X,Y),0)'`;

    const isMediaHiddenBySpoiler =
      !!asset.hasMediaSpoiler &&
      asset.spoilerMediaRevealTimeSeconds !== undefined;
    const T_media_dynamic = isMediaHiddenBySpoiler
      ? visibleStart + asset.spoilerMediaRevealTimeSeconds!
      : visibleStart;
    const mediaStart = isMediaHiddenBySpoiler ? T_media_dynamic : visibleStart;
    const mediaDuration = isMediaHiddenBySpoiler
      ? Math.max(0.05, cardEnd - T_media_dynamic)
      : visibleDuration;
    const mediaFadeInStart = mediaStart;
    const mediaEnable = isMediaHiddenBySpoiler
      ? `between(t\\,${T_media_dynamic.toFixed(3)}\\,${cardEnd.toFixed(3)})`
      : enable;

    if (mediaInputIndices.length > 1 && asset.media.paths?.length) {
      let slideshowBaseLabel = baseLabel;
      const slideshowDuration = Math.max(
        0.05,
        mediaDuration / mediaInputIndices.length
      );
      for (let sourceIndex = 0; sourceIndex < mediaInputIndices.length; sourceIndex += 1) {
        const sourceStart = mediaStart + sourceIndex * slideshowDuration;
        const sourceEnd =
          sourceIndex === mediaInputIndices.length - 1
            ? cardEnd
            : Math.min(cardEnd, sourceStart + slideshowDuration);
        const sourceDuration = Math.max(0.05, sourceEnd - sourceStart);
        const sourceLabel = `${mediaLabel}_${sourceIndex}`;
        const overlayLabel =
          sourceIndex === mediaInputIndices.length - 1
            ? nextLabel
            : `${mediaLabel}_base_${sourceIndex}`;
        const sourceFadeIn = sourceIndex === 0 ? fadeInSeconds : 0.001;
        const sourceFadeOut =
          sourceIndex === mediaInputIndices.length - 1
            ? CARD_FADE_OUT_SECONDS
            : 0.001;
        filters.push(
          `[${mediaInputIndices[sourceIndex]}:v]${roundedMediaFilter},format=yuva420p,trim=duration=${sourceDuration.toFixed(
            3
          )},setpts=PTS-STARTPTS+${sourceStart.toFixed(3)}/TB,fade=t=in:st=${sourceStart.toFixed(
            3
          )}:d=${sourceFadeIn}:alpha=1,fade=t=out:st=${Math.max(
            sourceStart,
            sourceEnd - sourceFadeOut
          ).toFixed(3)}:d=${sourceFadeOut}:alpha=1[${sourceLabel}]`
        );
        filters.push(
          `[${slideshowBaseLabel}][${sourceLabel}]overlay=x='(main_w-${mediaLayout.cardWidth})/2+${mediaLayout.x}':y='${asset.cardY + mediaLayout.y}${slideOffset}':enable='between(t\\,${sourceStart.toFixed(
            3
          )}\\,${sourceEnd.toFixed(3)})':eval=frame[${overlayLabel}]`
        );
        slideshowBaseLabel = overlayLabel;
      }
    } else {
      filters.push(
        `[${asset.media.inputIndex}:v]${roundedMediaFilter},format=yuva420p,trim=duration=${mediaDuration.toFixed(
          3
        )},setpts=PTS-STARTPTS+${mediaStart.toFixed(3)}/TB,fade=t=in:st=${mediaFadeInStart.toFixed(
          3
        )}:d=${fadeInSeconds}:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(
          3
        )}:d=${CARD_FADE_OUT_SECONDS}:alpha=1[${mediaLabel}]`
      );
      filters.push(
        `[${baseLabel}][${mediaLabel}]overlay=x='(main_w-${mediaLayout.cardWidth})/2+${mediaLayout.x}':y='${asset.cardY + mediaLayout.y}${slideOffset}':enable='${mediaEnable}':eval=frame[${nextLabel}]`
      );
    }
    currentLabel = nextLabel;
    currentLabel = appendMemeOverlayFilter({
      currentLabel,
      draft,
      filters,
      memeStart,
      memeEnd,
      memeImageInputIndex: memeImageInputIndices[i] ?? null,
      scene,
      sceneIndex: i,
    });

    if (hasMediaReveal && asset.mediaReveal) {
      currentLabel = appendMediaRevealFilter({
        currentLabel,
        filters,
        media: asset.mediaReveal,
        revealEnd: end,
        revealStart: trailingMemeStart,
        sceneOrder: scene.order,
      });
    } else if (scene.trailing_meme_transition?.image?.serverPath) {
      currentLabel = appendMemeOverlayFilter({
        currentLabel,
        draft,
        filters,
        memeStart: trailingMemeStart,
        memeEnd: end,
        memeImageInputIndex: trailingMemeImageInputIndices[i] ?? null,
        memePosition:
          scene.trailing_meme_transition.placement === "transition"
            ? "center"
            : "below_card",
        cardHeight: asset.cardHeight,
        cardWidth: asset.cardWidth,
        cardY: asset.cardY,
        scene,
        sceneIndex: i,
        overrideMemeTransition: scene.trailing_meme_transition,
      });
    }
  }

  filters.push(
    `[${currentLabel}]scale=${WIDTH}:${HEIGHT}:flags=lanczos,setsar=1[vout]`
  );
  const filterPath = resolve(renderDir, "render-filter.txt");
  await writeFile(filterPath, filters.join(";\n"), "utf8");
  return filterPath;
}

function resolveSceneMediaLayout(asset: SceneRenderAsset): {
  cardWidth: number;
  height: number;
  radius: number;
  width: number;
  x: number;
  y: number;
} {
  if (!asset.media) {
    throw new Error("Scene media layout requires a media asset.");
  }
  return resolveExportMediaLayout({
    cardWidth: asset.cardWidth,
    mediaHeight: asset.media.height,
    mediaWidth: asset.media.width,
    mediaX: asset.media.x,
    mediaY: asset.media.y,
  });
}

export function resolveExportMediaLayout(input: {
  cardWidth: number;
  mediaHeight: number;
  mediaWidth: number;
  mediaX: number;
  mediaY: number;
  targetCardWidth?: number;
}): {
  cardWidth: number;
  height: number;
  radius: number;
  width: number;
  x: number;
  y: number;
} {
  const targetCardWidth = input.targetCardWidth ?? CARD_WIDTH;
  const cardScale = Math.min(
    1,
    targetCardWidth / Math.max(1, input.cardWidth)
  );
  return {
    cardWidth: Math.max(1, Math.round(input.cardWidth * cardScale)),
    height: roundEvenDimension(input.mediaHeight * cardScale),
    radius: Math.max(1, Math.round(CARD_MEDIA_BORDER_RADIUS * cardScale)),
    width: roundEvenDimension(input.mediaWidth * cardScale),
    x: Math.round(input.mediaX * cardScale),
    y: Math.round(input.mediaY * cardScale),
  };
}

export function resolveVideoCardAspectRatio(sourceAspectRatio?: number): number {
  const normalizedSourceAspectRatio =
    typeof sourceAspectRatio === "number" &&
    Number.isFinite(sourceAspectRatio) &&
    sourceAspectRatio > 0
      ? sourceAspectRatio
      : CARD_MEDIA_ASPECT_RATIO;
  return Math.min(
    CARD_MEDIA_ASPECT_RATIO,
    Math.max(MIN_VIDEO_CARD_ASPECT_RATIO, normalizedSourceAspectRatio)
  );
}

function roundEvenDimension(value: number): number {
  return Math.max(2, Math.round(Math.max(1, value) / 2) * 2);
}

export function resolveMediaRevealScaleFilter(
  mediaType: "image" | "video"
): string {
  return mediaType === "video"
    ? `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop=${WIDTH}:${HEIGHT}`
    : `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black@0`;
}

function appendMediaRevealFilter({
  currentLabel,
  filters,
  media,
  revealEnd,
  revealStart,
  sceneOrder,
}: {
  currentLabel: string;
  filters: string[];
  media: SceneRenderMedia;
  revealEnd: number;
  revealStart: number;
  sceneOrder: number;
}): string {
  const inputIndices = media.inputIndices?.length
    ? media.inputIndices
    : media.inputIndex === undefined
      ? []
      : [media.inputIndex];
  const duration = Math.max(0, revealEnd - revealStart);
  if (inputIndices.length === 0 || duration <= 0.01) {
    return currentLabel;
  }

  let outputLabel = currentLabel;
  const segmentDuration = duration / inputIndices.length;
  for (const [sourceIndex, inputIndex] of inputIndices.entries()) {
    const start = revealStart + sourceIndex * segmentDuration;
    const end =
      sourceIndex === inputIndices.length - 1
        ? revealEnd
        : Math.min(revealEnd, start + segmentDuration);
    const sourceDuration = Math.max(0.05, end - start);
    const fadeDuration = Math.min(0.16, sourceDuration / 2);
    const mediaLabel = `media_reveal_${sceneOrder}_${sourceIndex}`;
    const nextLabel = `media_reveal_base_${sceneOrder}_${sourceIndex}`;
    filters.push(
      `[${inputIndex}:v]${resolveMediaRevealScaleFilter(media.type)},format=yuva420p,trim=duration=${sourceDuration.toFixed(3)},setpts=PTS-STARTPTS+${start.toFixed(3)}/TB,fade=t=in:st=${start.toFixed(3)}:d=${fadeDuration.toFixed(3)}:alpha=1,fade=t=out:st=${Math.max(start, end - fadeDuration).toFixed(3)}:d=${fadeDuration.toFixed(3)}:alpha=1[${mediaLabel}]`
    );
    filters.push(
      `[${outputLabel}][${mediaLabel}]overlay=x=0:y=0:enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})':eval=frame[${nextLabel}]`
    );
    outputLabel = nextLabel;
  }

  return outputLabel;
}

function appendMemeOverlayFilter({
  currentLabel,
  draft,
  filters,
  memeStart,
  memeEnd,
  memeImageInputIndex,
  memePosition = "center",
  cardHeight,
  cardWidth,
  cardY,
  scene,
  sceneIndex,
  overrideMemeTransition,
}: {
  currentLabel: string;
  draft: VideoDraftDocument;
  filters: string[];
  memeStart: number;
  memeEnd: number;
  memeImageInputIndex: number | null;
  memePosition?: "center" | "below_card";
  cardHeight?: number;
  cardWidth?: number;
  cardY?: number;
  scene: VideoDraftScene;
  sceneIndex: number;
  overrideMemeTransition?: MemeTransitionConfig | null;
}): string {
  const memeTransition =
    overrideMemeTransition ??
    resolveSceneMemeTransition(scene, draft.scenes, sceneIndex, draft);
  if (
    memeImageInputIndex === null ||
    memeTransition?.visualMode === "sound_only" ||
    !memeTransition?.image?.serverPath ||
    memeEnd - memeStart <= 0.01
  ) {
    return currentLabel;
  }

  const labelSuffix = memePosition === "below_card" ? "_trailing" : "";
  const label = `meme_overlay_${scene.order}${labelSuffix}`;
  const imageLabel = `meme_${scene.order}${labelSuffix}`;
  const memeSize =
    memePosition === "below_card"
      ? Math.min(
          PREVIEW_EXPORT_MEME_SIZE,
          Math.max(
            180,
            Math.round((cardWidth ?? PREVIEW_EXPORT_MEME_SIZE) * 0.42)
          )
        )
      : PREVIEW_EXPORT_MEME_SIZE;
  const overlayY =
    memePosition === "below_card"
      ? Math.min(
          HEIGHT - PREVIEW_EXPORT_BOTTOM_PADDING - memeSize,
          Math.max(0, (cardY ?? 0) + (cardHeight ?? 0) + 24)
        ).toFixed(3)
      : "(main_h-overlay_h)/2";
  const memeDurationSeconds = Math.max(0.1, memeEnd - memeStart);
  const fadeInSeconds = Math.min(
    0.24,
    Math.max(0.16, memeDurationSeconds * 0.32)
  );
  const fadeOutSeconds = Math.min(
    0.32,
    Math.max(0.2, memeDurationSeconds * 0.38)
  );
  const fadeOutStart = Math.max(memeStart, memeEnd - fadeOutSeconds);
  filters.push(
    `[${memeImageInputIndex}:v]scale=${memeSize}:${memeSize}:force_original_aspect_ratio=increase:flags=lanczos,crop=${memeSize}:${memeSize},format=rgba,trim=duration=${Math.max(
      0.1,
      memeEnd - memeStart
    ).toFixed(3)},setpts=PTS-STARTPTS+${memeStart.toFixed(
      3
    )}/TB,fade=t=in:st=${memeStart.toFixed(3)}:d=${fadeInSeconds.toFixed(
      3
    )}:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutSeconds.toFixed(
      3
    )}:alpha=1[${imageLabel}]`
  );
  filters.push(
    `[${currentLabel}][${imageLabel}]overlay=x='(main_w-overlay_w)/2':y='${overlayY}':enable='between(t\\,${memeStart.toFixed(
      3
    )}\\,${memeEnd.toFixed(3)})':eval=frame[${label}]`
  );
  return label;
}

function getSceneAudioInputs(scene: VideoDraftScene): string[] {
  const chunks = scene.narration.chunks ?? [];
  if (chunks.length > 0) {
    return chunks.map((chunk) => chunk.audio_path);
  }
  if (scene.narration.merged_audio_path) {
    return [scene.narration.merged_audio_path];
  }
  return [];
}

function getMemeTransitionDurationSeconds(
  scene: VideoDraftScene,
  draft: VideoDraftDocument,
  sceneIndex: number
): number {
  const memeTransition = resolveSceneMemeTransition(
    scene,
    draft.scenes,
    sceneIndex,
    draft
  );
  if (!memeTransition) {
    return 0;
  }
  return getResolvedMemeTransitionDurationMs(memeTransition) / 1000;
}

function getMemeLeadInMs(
  draft: VideoDraftDocument,
  scenes: VideoDraftScene[],
  sceneIndex: number
): number {
  const scene = scenes[sceneIndex]!;
  if (scene.dialogue_speaker) {
    return 0;
  }
  const memeTransition = resolveSceneMemeTransition(
    scene,
    scenes,
    sceneIndex,
    draft
  );
  if (!memeTransition) {
    return 0;
  }

  return getResolvedMemeTransitionDurationMs(memeTransition);
}

function normalizeMemeTransitionDurationMs(
  value: number | undefined,
  allowLongVideoSequence = false
): number {
  if (allowLongVideoSequence && Number.isFinite(value)) {
    return Math.max(MIN_MEME_TRANSITION_MS, Math.round(value ?? 0));
  }
  return Math.max(
    MIN_MEME_TRANSITION_MS,
    Math.min(MAX_MEME_TRANSITION_MS, value ?? DEFAULT_MEME_TRANSITION_MS)
  );
}

function getResolvedMemeTransitionDurationMs(
  transition: MemeTransitionConfig,
  fallbackDurationMs = DEFAULT_MEME_TRANSITION_MS
): number {
  if (
    transition.visualMode === "sound_only" &&
    typeof transition.audio?.durationSeconds === "number" &&
    transition.audio.durationSeconds > 0
  ) {
    return Math.max(
      MIN_MEME_TRANSITION_MS,
      Math.round(transition.audio.durationSeconds * 1000)
    );
  }
  const imageDurationMs =
    typeof transition.image?.durationSeconds === "number" &&
    transition.image.durationSeconds > 0
      ? Math.round(transition.image.durationSeconds * 1000)
      : 0;
  if (imageDurationMs > 0) {
    const audioDurationMs =
      typeof transition.audio?.durationSeconds === "number" &&
      transition.audio.durationSeconds > 0
        ? Math.round(transition.audio.durationSeconds * 1000)
        : 0;
    return Math.max(MIN_MEME_TRANSITION_MS, imageDurationMs + audioDurationMs);
  }
  return normalizeMemeTransitionDurationMs(
    transition.durationMs ?? fallbackDurationMs,
    hasVideoMemeDuration(transition)
  );
}

function hasVideoMemeDuration(
  transition: MemeTransitionConfig | null | undefined
): boolean {
  const serverPath = transition?.image?.serverPath ?? "";
  return Boolean(
    transition?.visualMode !== "sound_only" &&
      ((transition?.image?.durationSeconds ?? 0) > 0 || isVideoPath(serverPath))
  );
}

function getTrailingMemeStartMs(
  draft: VideoDraftDocument,
  scene: VideoDraftScene,
  sceneIndex: number
): number {
  const sceneStartMs = scene.timeline?.start_ms ?? 0;
  const sceneEndMs = scene.timeline?.end_ms ?? sceneStartMs;
  const trailingDurationMs = scene.trailing_meme_transition
    ? getResolvedMemeTransitionDurationMs(scene.trailing_meme_transition)
    : 0;
  const narrationEndMs =
    sceneStartMs +
    getMemeLeadInMs(draft, draft.scenes, sceneIndex) +
    getSceneNarrationDurationMs(scene);
  return Math.max(
    sceneStartMs,
    Math.min(sceneEndMs - trailingDurationMs, narrationEndMs)
  );
}

/**
 * Single source of truth for resolving a scene's meme transition.
 * - If scene.meme_transition !== undefined: use the scene-specific value
 *   (null means user explicitly cleared the meme for this scene in advanced mode)
 * - If scene.meme_transition === undefined: automatic mode - fall back to the
 *   draft-level meme only for the first comment scene after a post.
 */
function resolveSceneMemeTransition(
  scene: VideoDraftScene,
  scenes: VideoDraftScene[],
  sceneIndex: number,
  draft: VideoDraftDocument
): MemeTransitionConfig | null | undefined {
  if (scene.meme_transition !== undefined) {
    // A trailing meme belongs after this scene. It must not also become a
    // lead-in, otherwise the narration/card sequence can be played twice.
    return scene.meme_transition?.placement === "after_comment" ||
      scene.meme_transition?.placement === "media_reveal"
      ? null
      : scene.meme_transition; // null = explicit no-meme, config = use it
  }
  // Automatic mode: apply draft-level meme only to the first comment of each post
  return isFirstCommentScene(scenes, sceneIndex) ? draft.meme_transition : null;
}

function isFirstCommentScene(
  scenes: VideoDraftScene[],
  sceneIndex: number
): boolean {
  const scene = scenes[sceneIndex];
  if (scene?.kind !== "comment" || scene.dialogue_speaker) {
    return false;
  }

  for (let index = sceneIndex - 1; index >= 0; index -= 1) {
    const previousScene = scenes[index];
    if (!previousScene || previousScene.post_id !== scene.post_id) {
      return false;
    }
    if (previousScene.dialogue_speaker) {
      continue;
    }
    if (previousScene.kind === "post_video") {
      continue;
    }
    return previousScene.kind === "post";
  }

  return false;
}

function getSceneNarrationDurationMs(scene: VideoDraftScene): number {
  if (scene.narration.total_duration_ms > 0) {
    return scene.narration.total_duration_ms;
  }

  const chunkDurationMs = (scene.narration.chunks ?? []).reduce(
    (total, chunk) => total + Math.max(0, chunk.duration_ms ?? 0),
    0
  );
  if (chunkDurationMs > 0) {
    return chunkDurationMs;
  }

  return Math.max(
    0,
    (scene.timeline?.end_ms ?? 0) - (scene.timeline?.start_ms ?? 0)
  );
}

function getDraftDurationSeconds(draft: VideoDraftDocument): number {
  const durationMs = draft.scenes.reduce(
    (max, scene) => Math.max(max, scene.timeline?.end_ms ?? 0),
    0
  );
  return Math.max(1, durationMs / 1000);
}

async function synchronizeRenderedPostVideoTimelines(
  draft: VideoDraftDocument,
  sceneAssets: SceneRenderAsset[]
): Promise<void> {
  let timelineShiftMs = 0;

  for (let index = 0; index < draft.scenes.length; index += 1) {
    const scene = draft.scenes[index];
    const timeline = scene?.timeline;
    if (!scene || !timeline) {
      continue;
    }

    const startMs = timeline.start_ms + timelineShiftMs;
    let durationMs = Math.max(1, timeline.end_ms - timeline.start_ms);
    const nextScene = draft.scenes[index + 1];

    // Older voice drafts stored the user-entered duration on the caption
    // itself. When a source video follows, that value is the total budget for
    // caption + video, so remove the obsolete card hold before splitting it.
    if (isPostVideoAfterCaption(scene, nextScene)) {
      durationMs = getPostVideoCaptionDurationMs(draft, scene, index);
    }

    if (scene.kind === "post_video") {
      const localPath = sceneAssets[index]?.postVideo?.path;
      const probedDurationMs = localPath
        ? await probeVideoDurationMs(localPath)
        : null;
      const declaredDurationMs = normalizeSourceVideoDurationMs(
        scene.video_media?.duration_seconds
      );
      const sourceDurationMs = probedDurationMs ?? declaredDurationMs;
      if (sourceDurationMs && sourceDurationMs > 0) {
        const post = draft.selected_posts.find(
          (candidate) => candidate.post_id === scene.post_id
        );
        const source = scene.comment_id
          ? post?.top_comments.find(
              (comment) => comment.comment_id === scene.comment_id
            )
          : post;
        const configuredDurationMs = Number(
          source?.video_duration_seconds ?? 0
        ) * 1000;
        const previousScene = draft.scenes[index - 1];
        const previousTimeline = previousScene?.timeline;
        const isVideoAfterCaption = isPostVideoAfterCaption(previousScene, scene);
        durationMs = resolvePostVideoPlaybackDurationMs({
          captionDurationMs:
            isVideoAfterCaption && previousTimeline
              ? Math.max(
                  0,
                  previousTimeline.end_ms - previousTimeline.start_ms
                )
              : undefined,
          totalDurationMs:
            Number.isFinite(configuredDurationMs) && configuredDurationMs > 0
              ? configuredDurationMs
              : undefined,
          sourceDurationMs,
        });
        scene.display_duration_ms = durationMs;
      }
    }

    const endMs = startMs + durationMs;
    timelineShiftMs += durationMs - (timeline.end_ms - timeline.start_ms);
    scene.timeline = {
      end_ms: endMs,
      start_ms: startMs,
    };
  }
}

function normalizeSourceVideoDurationMs(
  value: number | undefined
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(120_000, Math.max(500, Math.round(value * 1000)));
}

export function resolvePostVideoPlaybackDurationMs(input: {
  captionDurationMs?: number;
  sourceDurationMs: number;
  totalDurationMs?: number;
}): number {
  const sourceDurationMs = Math.min(
    MAX_POST_VIDEO_DURATION_MS,
    Math.max(500, Math.round(input.sourceDurationMs))
  );
  const totalDurationMs = Number(input.totalDurationMs);
  if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0) {
    return sourceDurationMs;
  }
  return Math.min(
    sourceDurationMs,
    Math.max(
      500,
      Math.round(totalDurationMs - Math.max(0, input.captionDurationMs ?? 0))
    )
  );
}

function isPostVideoAfterCaption(
  scene: VideoDraftScene | undefined,
  nextScene: VideoDraftScene | undefined
): boolean {
  return Boolean(
    scene &&
      (scene.kind === "post" || scene.kind === "comment") &&
      !scene.dialogue_speaker &&
      nextScene?.kind === "post_video" &&
      nextScene.post_id === scene.post_id &&
      nextScene.comment_id === scene.comment_id
  );
}

function getPostVideoCaptionDurationMs(
  draft: VideoDraftDocument,
  scene: VideoDraftScene,
  sceneIndex: number
): number {
  const memeLeadMs = getMemeLeadInMs(draft, draft.scenes, sceneIndex);
  const trailingMemeMs = scene.trailing_meme_transition
    ? getResolvedMemeTransitionDurationMs(scene.trailing_meme_transition)
    : 0;
  return Math.max(1, memeLeadMs + getSceneNarrationDurationMs(scene) + trailingMemeMs);
}

function resolveFontPath(filename: string): string {
  const candidates = [
    resolve("C:/Windows/Fonts", filename),
    resolve("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    resolve("/System/Library/Fonts/Supplemental/Arial.ttf"),
  ];
  return candidates.find((path) => existsSync(path)) ?? candidates[0]!;
}

async function ensureFfmpegReadyLegacy(
  configuredPath?: string
): Promise<string> {
  const executable = resolveExecutable(configuredPath?.trim() || "ffmpeg");
  try {
    await runProcess(executable, ["-version"]);
    return executable;
  } catch {
    throw new Error(
      `Chưa tìm thấy FFmpeg tại "${executable}". Hãy kiểm tra config.video.ffmpegPath hoặc thêm ffmpeg.exe vào PATH rồi mở lại server.`
    );
  }
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) {
    return `${trimZero((value / 1_000_000).toFixed(1))}M`;
  }
  if (value >= 1000) {
    return `${trimZero((value / 1000).toFixed(1))}K`;
  }
  return String(value);
}

function trimZero(value: string): string {
  return value.replace(/\.0$/, "");
}

function metricValueSizeClass(value: string): string {
  const length = String(value).trim().length;
  if (length >= 8) {
    return "size-xxs";
  }
  if (length >= 7) {
    return "size-xs";
  }
  if (length >= 6) {
    return "size-sm";
  }
  if (length >= 5) {
    return "size-md";
  }
  return "size-lg";
}

function formatRelativeTime(value: string | undefined): string {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const diffSeconds = Math.max(
    0,
    Math.round((Date.now() - date.getTime()) / 1000)
  );
  if (diffSeconds < 60) {
    return `${Math.max(1, diffSeconds)} giây`;
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes} phút`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} giờ`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays} ngày`;
  }
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) {
    return `${diffWeeks} tuần`;
  }
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${Math.max(1, diffMonths)} tháng`;
  }
  return `${Math.max(1, Math.floor(diffDays / 365))} năm`;
}

function resolveSceneCreatedAt(
  commentCreatedAt: string | undefined,
  postCreatedAt: string | undefined
): string {
  return (
    String(commentCreatedAt ?? "").trim() || String(postCreatedAt ?? "").trim()
  );
}

function ffmpegConcatPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

function ffmpegFilterPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function toUrlPath(value: string): string {
  return value.split(sep).join("/");
}

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const executable = resolveExecutable(command);
    const child = trackVideoChildProcess(
      spawn(executable, args, {
        shell: false,
        windowsHide: true,
      })
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      reject(
        new Error(
          compactMediaProcessError(
            stderr,
            `${executable} exited with code ${code}`,
          ),
        ),
      );
    });
  });
}

function resolveExecutable(command: string): string {
  if (command && (command.includes("\\") || command.includes("/"))) {
    return command;
  }
  const extension = process.platform === "win32" ? ".exe" : "";
  const executableName = command.endsWith(extension)
    ? command
    : `${command}${extension}`;
  const pathCandidates = (process.env.PATH ?? "")
    .split(process.platform === "win32" ? ";" : ":")
    .filter(Boolean)
    .map((path) => resolve(path, executableName));
  const wingetPackageRoot = process.env.LOCALAPPDATA
    ? resolve(process.env.LOCALAPPDATA, "Microsoft/WinGet/Packages")
    : "";
  const wingetCandidates =
    process.platform === "win32" &&
    wingetPackageRoot &&
    existsSync(wingetPackageRoot)
      ? findExecutableCandidates(wingetPackageRoot, executableName)
      : [];
  return (
    [...pathCandidates, ...wingetCandidates].find((path) => existsSync(path)) ??
    command
  );
}

function findExecutableCandidates(
  root: string,
  executableName: string
): string[] {
  const candidates: string[] = [];
  const stack = [root];
  const maxMatches = 12;

  while (stack.length > 0 && candidates.length < maxMatches) {
    const current = stack.pop()!;
    let entries: Array<{ isDirectory: () => boolean; name: string }>;
    try {
      entries = readdirSync(current, {
        withFileTypes: true,
      }) as unknown as Array<{
        isDirectory: () => boolean;
        name: string;
      }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.name.toLowerCase() === executableName.toLowerCase()) {
        candidates.push(path);
        continue;
      }
      if (
        candidates.length < maxMatches &&
        entry.isDirectory() &&
        !path.includes("node_modules")
      ) {
        stack.push(path);
      }
    }
  }

  return candidates;
}
