import { useMemo, useSyncExternalStore } from "react";
import { LoaderCircle, Save, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createVideoVoice,
  renderVideo,
  type CrawlPost,
  type MemeTransitionConfig,
  type UploadedAudioPayload,
  type UploadedVideoPayload,
  type VideoDraftDocument,
  type VideoDialogueConfig,
  type VideoPromotionConfig,
  type VideoThumbnailIntro,
  type VideoVoiceSettings,
} from "@/lib/api";
import type { SelectedMemeEntry } from "./video-post-list-card-v2";
import { formatVideoRenderErrorMessage } from "./render-error-message";
import { resolveThumbnailIntroForPost } from "./video-thumbnail-editor";

export interface VideoPostWorkflowOptions {
  backgroundMusic?: UploadedAudioPayload | null;
  backgroundMusicVolume?: number;
  cardTheme?: "light" | "dark";
  commentVoiceMode?: "emotion" | "fixed";
  dialogue?: VideoDialogueConfig | null;
  memeBySceneId?: Record<
    string,
    SelectedMemeEntry | MemeTransitionConfig | null | undefined
  >;
  memeTransition?: MemeTransitionConfig | null;
  playPostVideoAfterCaption?: boolean;
  promotion?: VideoPromotionConfig | null;
  videoMode?: string;
  voiceSettings?: VideoVoiceSettings | null;
}

interface DraftActionItem {
  assignedVideo: UploadedVideoPayload | null;
  currentSignature: string;
  draft?: VideoDraftDocument | null;
  draftSignature?: string;
  post: CrawlPost;
  workflowOptions: VideoPostWorkflowOptions;
}

interface PersistedDraftResult {
  draft: VideoDraftDocument;
  signature: string;
}

export function buildVoiceDraftSignature({
  abbreviations,
  commentVoiceMode,
  memeBySceneId,
  memeTransition,
  post,
  dialogue,
  videoMode,
  textProcessingMode,
  voiceSettings,
}: {
  abbreviations?: Record<string, string>;
  commentVoiceMode?: "emotion" | "fixed";
  dialogue?: VideoDialogueConfig | null;
  memeBySceneId?: Record<string, SelectedMemeEntry | MemeTransitionConfig | null | undefined>;
  memeTransition?: MemeTransitionConfig | null;
  post: CrawlPost;
  textProcessingMode?: "off" | "rules_only" | "llm_assist";
  videoMode?: string;
  voiceSettings?: VideoVoiceSettings | null;
}): string {
  const voicePipelineVersion = 29;
  const normalizedAbbreviations = Object.entries(abbreviations ?? {})
    .map(([key, value]) => [key.trim(), value.trim()] as const)
    .filter(([key, value]) => key && value)
    .sort(([a], [b]) => a.localeCompare(b));

  const normalizedMemeBySceneId = memeBySceneId
    ? Object.fromEntries(
        Object.entries(memeBySceneId)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [
            k,
            {
              audioPath: v?.audio?.serverPath ?? "",
              emotion: v?.emotion ?? "",
              imagePath: v?.image?.serverPath ?? "",
              placement: v?.placement ?? "transition",
              visualMode: v?.visualMode ?? "meme",
            },
          ])
      )
    : null;

  return JSON.stringify({
    abbreviations: normalizedAbbreviations,
    commentVoiceMode: commentVoiceMode ?? "fixed",
    dialogue: dialogue ?? null,
    memeBySceneId: normalizedMemeBySceneId,
    memeTransition:
      memeTransition &&
      (
        memeTransition.image ||
        memeTransition.audio ||
        (memeTransition.images?.length ?? 0) > 0 ||
        (memeTransition.audios?.length ?? 0) > 0
      )
        ? {
            audioPath: memeTransition.audio?.serverPath ?? "",
            audioPool: (memeTransition.audios ?? [])
              .map((audio) => audio?.serverPath ?? audio?.name ?? "")
              .filter(Boolean)
              .sort(),
            durationMs: memeTransition.durationMs ?? 0,
            emotion: memeTransition.emotion,
            imagePath: memeTransition.image?.serverPath ?? "",
            imagePool: (memeTransition.images ?? [])
              .map((image) => image?.serverPath ?? image?.name ?? "")
              .filter(Boolean)
              .sort(),
            visualMode: memeTransition.visualMode ?? "meme",
          }
        : null,
    textProcessingMode: textProcessingMode ?? "rules_only",
    videoMode: videoMode ?? "single_post_recap",
    voicePipelineVersion,
    post: {
      is_spoiler: post.is_spoiler,
      post_id: post.post_id,
      spoiler_initial_text: post.spoiler_initial_text,
      spoiler_media: post.spoiler_media,
      spoiler_reveal_text: post.spoiler_reveal_text,
      spoiler_reveal_regions: post.spoiler_reveal_regions,
      spoiler_reveal_media_only: post.spoiler_reveal_media_only,
      spoiler_style: post.spoiler_style,
      // Display text can change without changing the narration that is already
      // generated. Use the effective narration text for voice reuse instead.
      text: post.tts_text?.trim() || post.text.trim(),
      tts_text: post.tts_text ?? "",
      top_comments: post.top_comments.map((comment) => ({
        comment_id: comment.comment_id,
        is_spoiler: comment.is_spoiler,
        selected_for_video: comment.selected_for_video !== false,
        spoiler_initial_text: comment.spoiler_initial_text,
        spoiler_media: comment.spoiler_media,
        spoiler_reveal_text: comment.spoiler_reveal_text,
        spoiler_reveal_regions: comment.spoiler_reveal_regions,
        spoiler_reveal_media_only: comment.spoiler_reveal_media_only,
        spoiler_style: comment.spoiler_style,
        text: comment.tts_text?.trim() || comment.text.trim(),
        tts_text: comment.tts_text ?? "",
      })),
    },
    voiceSettings: voiceSettings ?? null,
  });
}

export function isVoiceDraftSignatureReusable({
  currentSignature,
  draftSignature,
}: {
  currentSignature?: string | null;
  draftSignature?: string | null;
}): boolean {
  if (!currentSignature || !draftSignature) {
    return false;
  }

  if (currentSignature === draftSignature) {
    return true;
  }

  const currentCore = extractVoiceDraftSignatureCore(currentSignature);
  const draftCore = extractVoiceDraftSignatureCore(draftSignature);
  if (!currentCore || !draftCore) {
    return false;
  }

  return JSON.stringify(currentCore) === JSON.stringify(draftCore);
}

type GlobalDraftState = {
  draftResultsByPostId: Record<string, PersistedDraftResult>;
  error: string;
  isCreatingVoice: boolean;
  isSaving: boolean;
  successMessage: string;
};

const VIDEO_WORKFLOW_TASK_STATE_PREFIX = "videoWorkflow.taskState.";
const DEFAULT_DRAFT_STATE: GlobalDraftState = {
  draftResultsByPostId: {},
  error: "",
  isCreatingVoice: false,
  isSaving: false,
  successMessage: "",
};
let globalDraftStateByStorageKey: Record<string, GlobalDraftState> = {};

const draftStateListeners = new Set<() => void>();

const THUMBNAIL_FONT_VALUES = [
  "beVietnam",
  "georgia",
  "geist",
  "mono",
  "montserrat",
  "notoSans",
  "oswald",
  "poppins",
  "roboto",
  "trebuchet",
  "verdana",
] as const;

const THUMBNAIL_DURATION_VALUES = [100, 250, 500, 1000] as const;

const clampThumbnailInteger = (
  value: unknown,
  min: number,
  max: number,
  fallback: number
) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numericValue)));
};

const normalizeThumbnailIntroForDraft = (
  thumbnailIntro: VideoThumbnailIntro | null | undefined,
  post: CrawlPost
): VideoThumbnailIntro | null => {
  const resolved = resolveThumbnailIntroForPost(thumbnailIntro, post);
  if (!resolved) return null;

  // These maps are editor-only state. The resolved `title` and layer values
  // above are all the server needs for this one-post draft.
  const {
    postOverridesByPostId: _postOverridesByPostId,
    titleOverridesByPostId: _titleOverridesByPostId,
    ...draftThumbnail
  } = resolved;
  const durationCandidate = Number(draftThumbnail.durationMs);
  const durationMs = THUMBNAIL_DURATION_VALUES.includes(
    durationCandidate as (typeof THUMBNAIL_DURATION_VALUES)[number]
  )
    ? durationCandidate
    : 1000;
  const titleFont = THUMBNAIL_FONT_VALUES.includes(
    draftThumbnail.titleFont as (typeof THUMBNAIL_FONT_VALUES)[number]
  )
    ? draftThumbnail.titleFont
    : "poppins";
  const channelFont = THUMBNAIL_FONT_VALUES.includes(
    draftThumbnail.channelFont as (typeof THUMBNAIL_FONT_VALUES)[number]
  )
    ? draftThumbnail.channelFont
    : "geist";
  const isHexColor = (value: unknown): value is string =>
    typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

  return {
    ...draftThumbnail,
    backgroundFit:
      draftThumbnail.backgroundFit === "contain" ? "contain" : "cover",
    backgroundPositionX: clampThumbnailInteger(
      draftThumbnail.backgroundPositionX,
      0,
      100,
      50
    ),
    backgroundPositionY: clampThumbnailInteger(
      draftThumbnail.backgroundPositionY,
      0,
      100,
      50
    ),
    backgroundZoom: Math.min(
      3,
      Math.max(
        1,
        Number.isFinite(Number(draftThumbnail.backgroundZoom))
          ? Number(draftThumbnail.backgroundZoom)
          : 1
      )
    ),
    brandImageSizePercent: clampThumbnailInteger(
      draftThumbnail.brandImageSizePercent,
      30,
      100,
      92
    ),
    channelColor: isHexColor(draftThumbnail.channelColor)
      ? draftThumbnail.channelColor
      : undefined,
    channelFont,
    channelFontSize: clampThumbnailInteger(
      draftThumbnail.channelFontSize,
      16,
      72,
      36
    ),
    durationMs,
    mode: draftThumbnail.mode === "automatic" ? "automatic" : "advanced",
    title: String(draftThumbnail.title ?? "").slice(0, 160),
    titleColor: isHexColor(draftThumbnail.titleColor)
      ? draftThumbnail.titleColor
      : "#741b1b",
    titleFont,
    titleFontSize: clampThumbnailInteger(
      draftThumbnail.titleFontSize,
      28,
      120,
      42
    ),
    watermarkPosition:
      draftThumbnail.watermarkPosition === "top-left" ||
      draftThumbnail.watermarkPosition === "bottom-left" ||
      draftThumbnail.watermarkPosition === "bottom-right" ||
      draftThumbnail.watermarkPosition === "center"
        ? draftThumbnail.watermarkPosition
        : "top-right",
    watermarkSizePercent: clampThumbnailInteger(
      draftThumbnail.watermarkSizePercent,
      6,
      30,
      19
    ),
    channelName: draftThumbnail.channelName?.trim().slice(0, 80),
    subtitle: draftThumbnail.subtitle?.trim().slice(0, 120),
  };
};

function setDraftState(
  storageKey: string,
  update: Partial<GlobalDraftState>
) {
  const current = getDraftState(storageKey);
  const next = { ...current, ...update };
  globalDraftStateByStorageKey = {
    ...globalDraftStateByStorageKey,
    [storageKey]: next,
  };
  writePersistedDraftState(storageKey, next);
  draftStateListeners.forEach((fn) => fn());
}

export const VideoDraftActions = ({
  dialogue,
  abbreviations,
  assignedVideosByPostId,
  backgroundMusic,
  backgroundMusicVolume,
  voiceVolume,
  cardTheme,
  commentVoiceMode,
  memeBySceneId,
  memeTransition,
  thumbnailIntro,
  draftsByPostId,
  draftSignaturesByPostId,
  onDraftCreated,
  outputPath,
  promotion,
  selectedPosts,
  storageKey,
  textProcessingMode,
  voiceConfigured,
  voiceSettings,
  workflowOptionsByPostId,
}: {
  abbreviations?: Record<string, string>;
  assignedVideosByPostId: Record<string, UploadedVideoPayload | null | undefined>;
  backgroundMusic?: UploadedAudioPayload | null;
  backgroundMusicVolume?: number;
  voiceVolume?: number;
  cardTheme?: "light" | "dark";
  commentVoiceMode?: "emotion" | "fixed";
  memeBySceneId?: Record<string, SelectedMemeEntry | MemeTransitionConfig | null | undefined>;
  memeTransition?: MemeTransitionConfig | null;
  thumbnailIntro?: VideoThumbnailIntro | null;
  draftsByPostId: Record<string, VideoDraftDocument | undefined>;
  dialogue?: VideoDialogueConfig | null;
  draftSignaturesByPostId: Record<string, string | undefined>;
  onDraftCreated?: (
    postId: string,
    draft: VideoDraftDocument,
    signature: string
  ) => void;
  outputPath: string;
  promotion?: VideoPromotionConfig | null;
  selectedPosts: CrawlPost[];
  storageKey?: string;
  textProcessingMode?: "off" | "rules_only" | "llm_assist";
  voiceConfigured: boolean;
  voiceSettings?: VideoVoiceSettings | null;
  workflowOptionsByPostId?: Record<string, VideoPostWorkflowOptions>;
}) => {
  const persistedStorageKey = storageKey || "__default__";
  const { error, isCreatingVoice, isSaving, successMessage } = useSyncExternalStore(
    (onStoreChange) => {
      draftStateListeners.add(onStoreChange);
      return () => draftStateListeners.delete(onStoreChange);
    },
    () => getDraftState(persistedStorageKey),
    () => getDraftState(persistedStorageKey)
  );
  const videoMode = "single_post_recap";

  const items = useMemo<DraftActionItem[]>(
    () =>
      selectedPosts.map((post) => {
        const options = workflowOptionsByPostId?.[post.post_id] ?? {
          backgroundMusic,
          backgroundMusicVolume,
          cardTheme,
          commentVoiceMode,
          dialogue,
          memeBySceneId,
          memeTransition,
          playPostVideoAfterCaption: false,
          promotion,
          videoMode,
          voiceSettings,
        };
        return {
          assignedVideo: assignedVideosByPostId[post.post_id] ?? null,
          currentSignature: buildVoiceDraftSignature({
            abbreviations,
            commentVoiceMode: options.commentVoiceMode,
            dialogue: options.dialogue,
            memeBySceneId: options.memeBySceneId,
            memeTransition: options.memeTransition,
            post,
            textProcessingMode,
            videoMode: options.videoMode,
            voiceSettings: options.voiceSettings,
          }),
          draft: draftsByPostId[post.post_id] ?? null,
          draftSignature: draftSignaturesByPostId[post.post_id],
          post,
          workflowOptions: options,
        };
      }),
    [
      abbreviations,
      assignedVideosByPostId,
      backgroundMusic,
      backgroundMusicVolume,
      cardTheme,
      commentVoiceMode,
      dialogue,
      memeBySceneId,
      memeTransition,
      draftSignaturesByPostId,
      draftsByPostId,
      promotion,
      selectedPosts,
      textProcessingMode,
      voiceSettings,
      videoMode,
      workflowOptionsByPostId,
    ]
  );

  const readyVoiceCount = items.filter(hasReusableVoice).length;
  const totalVoiceCharacters = items.reduce(
    (total, item) =>
      total + countVoiceCharacters(item.post, item.workflowOptions.dialogue),
    0
  );
  const pendingVoiceCharacters = items.reduce(
    (total, item) =>
      total +
      (!item.workflowOptions.dialogue && hasReusableVoice(item)
        ? 0
        : countVoiceCharacters(item.post, item.workflowOptions.dialogue)),
    0
  );
  const missingVideoCount = items.filter((item) => !item.assignedVideo).length;
  const baseDisabled =
    selectedPosts.length === 0 || !outputPath || isSaving || isCreatingVoice;
  const voiceDisabled = baseDisabled || !voiceConfigured;
  const saveDisabled = baseDisabled || missingVideoCount === items.length;
  const actionStatusText = resolveActionStatusText({
    hasOutputPath: Boolean(outputPath),
    hasSelectedPosts: selectedPosts.length > 0,
    isCreatingVoice,
    isSaving,
    missingVideoCount,
    readyVoiceCount,
    totalSelectedPosts: selectedPosts.length,
    voiceConfigured,
  });

	  const createPayload = (
	    post: CrawlPost,
	    uploadedVideo: UploadedVideoPayload | null,
      existingDraft?: VideoDraftDocument | null
	  ) => {
      const options = items.find((item) => item.post.post_id === post.post_id)
        ?.workflowOptions ?? {
          backgroundMusic,
          backgroundMusicVolume,
          cardTheme,
          commentVoiceMode,
          dialogue,
          memeBySceneId,
          memeTransition,
          promotion,
          playPostVideoAfterCaption: false,
          videoMode,
          voiceSettings,
        };

      return {
      dialogue: options.dialogue ?? null,
	    abbreviations,
	    backgroundMusic: options.backgroundMusic,
      backgroundMusicVolume: options.backgroundMusicVolume,
      voiceVolume,
      cardTheme: options.cardTheme,
    commentVoiceMode: options.commentVoiceMode ?? "fixed",
    existingDraft: existingDraft ?? null,
    memeBySceneId: (options.memeBySceneId as Record<string, MemeTransitionConfig | null>) ?? null,
    memeTransition: options.memeTransition ?? null,
    playPostVideoAfterCaption: Boolean(options.playPostVideoAfterCaption),
    thumbnailIntro: normalizeThumbnailIntroForDraft(thumbnailIntro, post),
    outputPath,
    promotion: options.promotion ?? null,
    selectedPosts: [post],
    textProcessing: {
      mode: textProcessingMode ?? "rules_only",
    },
    uploadedVideo,
    videoMode: options.videoMode ?? "single_post_recap",
    voiceSettings: options.voiceSettings ?? null,
  };
  };

  const handleCreateVoice = async () => {
    try {
      setDraftState(persistedStorageKey, {
        error: "",
        successMessage: "",
        isCreatingVoice: true,
      });

      let generatedCount = 0;
      let reusedCount = 0;
      for (const item of items) {
        if (!item.workflowOptions.dialogue && hasReusableVoice(item)) {
          reusedCount += 1;
          continue;
        }

        const result = await createVideoVoice(
          createPayload(item.post, item.assignedVideo)
        );
        persistDraftResult(
          persistedStorageKey,
          item.post.post_id,
          result.draft,
          item.currentSignature
        );
        onDraftCreated?.(item.post.post_id, result.draft, item.currentSignature);
        generatedCount += 1;
      }

      setDraftState(persistedStorageKey, {
        successMessage: generatedCount === 0
          ? `Tất cả ${reusedCount} bài đã có voice phù hợp, không cần tạo lại.`
          : `Đã xử lý voice cho ${generatedCount} bài${reusedCount > 0 ? `, tái sử dụng ${reusedCount} bài` : ""}.`
      });
    } catch (cause) {
      setDraftState(persistedStorageKey, {
        error: formatVideoRenderErrorMessage(
          cause instanceof Error ? cause.message : String(cause)
        )
      });
    } finally {
      setDraftState(persistedStorageKey, { isCreatingVoice: false });
    }
  };

  const handleSaveVideo = async () => {
    try {
      setDraftState(persistedStorageKey, {
        error: "",
        successMessage: "",
        isSaving: true,
      });

      const renderableItems = items.filter((item) => item.assignedVideo);
      if (renderableItems.length === 0) {
        throw new Error("Hãy chọn video nền cho ít nhất 1 bài trước khi xuất.");
      }

      let renderedCount = 0;
      for (const item of renderableItems) {
        const result = await renderVideo(
          createPayload(
            item.post,
            item.assignedVideo,
            !item.workflowOptions.dialogue && hasReusableVoice(item)
              ? item.draft ?? null
              : null
          )
        );
        persistDraftResult(
          persistedStorageKey,
          item.post.post_id,
          result.draft,
          item.currentSignature
        );
        onDraftCreated?.(item.post.post_id, result.draft, item.currentSignature);
        renderedCount += 1;
      }

      const skippedCount = items.length - renderableItems.length;
      setDraftState(persistedStorageKey, {
        successMessage: skippedCount > 0
          ? `Đã đưa ${renderedCount} video vào hàng chờ. Bỏ qua ${skippedCount} bài chưa gán video nền.`
          : `Đã đưa ${renderedCount} video vào hàng chờ render.`
      });
    } catch (cause) {
      setDraftState(persistedStorageKey, {
        error: formatVideoRenderErrorMessage(
          cause instanceof Error ? cause.message : String(cause)
        )
      });
    } finally {
      setDraftState(persistedStorageKey, { isSaving: false });
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid gap-1.5 sm:grid-cols-2">
        <Button
          className="h-9 w-full text-xs"
          disabled={voiceDisabled}
          onClick={handleCreateVoice}
        >
          {isCreatingVoice ? (
            <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Volume2 className="mr-1.5 h-3.5 w-3.5" />
          )}
          {isCreatingVoice ? "Đang tạo voice..." : "Tạo voice tất cả"}
        </Button>

        <Button
          className="h-9 w-full text-xs"
          disabled={saveDisabled}
          onClick={handleSaveVideo}
          variant="outline"
        >
          {isSaving ? (
            <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-3.5 w-3.5" />
          )}
          {isSaving ? "Đang đưa vào hàng chờ..." : "Xuất tất cả video"}
        </Button>
      </div>

      <p
        className="rounded-md border border-border/70 bg-muted/20 px-2 py-1 text-[9.5px] leading-tight text-muted-foreground"
        title="Tính theo nội dung TTS của bài viết, comment đã chọn và hội thoại nếu có."
      >
        Tổng ký tự TTS: {formatCharacterCount(totalVoiceCharacters)}
        {pendingVoiceCharacters !== totalVoiceCharacters
          ? ` · cần tạo mới: ${formatCharacterCount(pendingVoiceCharacters)}`
          : ""}
      </p>

      {actionStatusText ? (
        <p className="rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-[9.5px] leading-tight text-muted-foreground">
          {actionStatusText}
        </p>
      ) : null}

      {successMessage ? (
        <p className="rounded-md border border-green-500/30 bg-green-500/10 px-2 py-1 text-[9.5px] leading-tight text-green-600">
          {successMessage}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[9.5px] leading-tight text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
};

function countVoiceCharacters(
  post: CrawlPost,
  dialogue?: VideoDialogueConfig | null
): number {
  const texts = [
    post.tts_text?.trim() || post.text.trim(),
    ...post.top_comments
      .filter((comment) => comment.selected_for_video !== false)
      .map((comment) => comment.tts_text?.trim() || comment.text.trim()),
    ...(dialogue?.lines ?? []).map((line) => line.text.trim()),
  ];

  return texts.reduce((total, text) => total + Array.from(text).length, 0);
}

function formatCharacterCount(value: number): string {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function hasReusableVoice(item: DraftActionItem): boolean {
  return Boolean(
    item.draft?.video_plan.voice_ready &&
      isVoiceDraftSignatureReusable({
        currentSignature: item.currentSignature,
        draftSignature: item.draftSignature,
      })
  );
}

function extractVoiceDraftSignatureCore(signature: string): unknown {
  try {
    const parsed = JSON.parse(signature) as {
      abbreviations?: unknown;
      commentVoiceMode?: unknown;
      dialogue?: unknown;
      memeTransition?: unknown;
      post?: unknown;
      textProcessingMode?: unknown;
      voicePipelineVersion?: unknown;
      voiceSettings?: unknown;
      videoMode?: unknown;
    };

    const post = normalizeVoiceSignaturePost(parsed.post);

    return {
      abbreviations: parsed.abbreviations ?? [],
      commentVoiceMode: parsed.commentVoiceMode ?? "fixed",
      dialogue: parsed.dialogue ?? null,
      memeTransition: parsed.memeTransition ?? null,
      post,
      textProcessingMode: parsed.textProcessingMode ?? "rules_only",
      videoMode: parsed.videoMode ?? "single_post_recap",
      voicePipelineVersion:
        typeof parsed.voicePipelineVersion === "number"
          ? parsed.voicePipelineVersion
          : 0,
      voiceSettings: parsed.voiceSettings ?? null,
    };
  } catch {
    return null;
  }
}

function normalizeVoiceSignaturePost(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value ?? null;
  }

  const post = value as {
    text?: unknown;
    tts_text?: unknown;
    top_comments?: unknown;
  } & Record<string, unknown>;
  const normalizeText = (text: unknown, ttsText: unknown) => {
    const explicitTts = typeof ttsText === "string" ? ttsText.trim() : "";
    const displayText = typeof text === "string" ? text.trim() : "";
    return explicitTts || displayText;
  };

  return {
    ...post,
    text: normalizeText(post.text, post.tts_text),
    top_comments: Array.isArray(post.top_comments)
      ? post.top_comments.map((value) => {
          if (!value || typeof value !== "object") {
            return value;
          }
          const comment = value as {
            text?: unknown;
            tts_text?: unknown;
          } & Record<string, unknown>;
          return {
            ...comment,
            text: normalizeText(comment.text, comment.tts_text),
          };
        })
      : post.top_comments,
  };
}

export function readPersistedDraftResults(
  storageKey?: string
): Record<string, PersistedDraftResult> {
  return getDraftState(storageKey || "__default__").draftResultsByPostId;
}

function getDraftState(storageKey: string): GlobalDraftState {
  const existing = globalDraftStateByStorageKey[storageKey];
  if (existing) {
    return existing;
  }

  const persisted = readPersistedDraftState(storageKey);
  globalDraftStateByStorageKey = {
    ...globalDraftStateByStorageKey,
    [storageKey]: persisted,
  };
  return persisted;
}

function readPersistedDraftState(storageKey: string): GlobalDraftState {
  if (typeof window === "undefined") {
    return DEFAULT_DRAFT_STATE;
  }

  try {
    const persistedKey = `${VIDEO_WORKFLOW_TASK_STATE_PREFIX}${storageKey}`;
    const raw =
      window.localStorage.getItem(persistedKey) ??
      window.sessionStorage.getItem(persistedKey);
    if (!raw) {
      return DEFAULT_DRAFT_STATE;
    }

    const parsed = JSON.parse(raw) as Partial<GlobalDraftState>;
    return {
      ...DEFAULT_DRAFT_STATE,
      ...parsed,
      draftResultsByPostId: parsed.draftResultsByPostId ?? {},
    };
  } catch {
    return DEFAULT_DRAFT_STATE;
  }
}

function writePersistedDraftState(
  storageKey: string,
  state: GlobalDraftState
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const persistedKey = `${VIDEO_WORKFLOW_TASK_STATE_PREFIX}${storageKey}`;
    const serialized = JSON.stringify(state);
    window.localStorage.setItem(persistedKey, serialized);
    window.sessionStorage.setItem(persistedKey, serialized);
  } catch {
    return;
  }
}

function persistDraftResult(
  storageKey: string,
  postId: string,
  draft: VideoDraftDocument,
  signature: string
): void {
  const current = getDraftState(storageKey);
  setDraftState(storageKey, {
    draftResultsByPostId: {
      ...current.draftResultsByPostId,
      [postId]: {
        draft,
        signature,
      },
    },
  });
}

function resolveActionStatusText({
  hasOutputPath,
  hasSelectedPosts,
  isCreatingVoice,
  isSaving,
  missingVideoCount,
  readyVoiceCount,
  totalSelectedPosts,
  voiceConfigured,
}: {
  hasOutputPath: boolean;
  hasSelectedPosts: boolean;
  isCreatingVoice: boolean;
  isSaving: boolean;
  missingVideoCount: number;
  readyVoiceCount: number;
  totalSelectedPosts: number;
  voiceConfigured: boolean;
}): string {
  if (!hasSelectedPosts) {
    return "";
  }
  if (!hasOutputPath) {
    return "Chọn file dữ liệu crawl trước khi tạo video.";
  }
  if (!voiceConfigured) {
    return "Bạn cần cấu hình API voice trước trong mục Cài đặt.";
  }
  if (isCreatingVoice) {
    return "Đang tạo voice lần lượt cho từng bài để tránh lỗi và để tái sử dụng cache.";
  }
  if (isSaving) {
    return "Đang đưa từng video vào hàng chờ render.";
  }
  if (readyVoiceCount < totalSelectedPosts) {
    return `Đã sẵn sàng voice cho ${readyVoiceCount}/${totalSelectedPosts} bài.`;
  }
  if (missingVideoCount > 0) {
    return `Còn ${missingVideoCount} bài chưa được gán video nền. Vẫn có thể xuất các bài đã gán video.`;
  }
  return `Đã sẵn sàng xuất ${totalSelectedPosts} video.`;
}
