import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AvatarImage } from "@/features/output-preview/asset-status";
import {
  ocrVideoDialogue,
  suggestVideoDialogueText,
  type CrawlPost,
  type MemeLibraryEntry,
  type SpoilerRevealRegion,
} from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/formatters";
import { formatStructuredPreviewText } from "@/lib/structured-preview-text";
import {
  stopCommentListDragScroll,
  updateCommentListDragScroll,
} from "./comment-list-drag-scroll";
import {
  AttachmentMediaPreview,
  CommentMediaActions,
} from "./attachment-media-preview";
import { MemePicker, type SelectedMemeEntry } from "./video-post-list-card-v2";
import { selectOcrTextForTts } from "./ocr-text-for-tts";
import { joinSpoilerText, splitSpoilerText } from "./spoiler-text";
import {
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  LoaderCircle,
  MessageCircle,
  Save,
  Sparkles,
  Smile,
  SquareArrowOutUpRight,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_VIDEO_COMMENT_ID = "__default_monback_comment__";
const TEXT_UPDATE_DEBOUNCE_MS = 300;

const BufferedTextarea = ({
  className,
  onValueChange,
  placeholder,
  rows,
  value,
}: {
  className: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  rows: number;
  value: string;
}) => {
  const [draftValue, setDraftValue] = useState(value);
  const commitTimerRef = useRef<number | undefined>(undefined);
  const draftValueRef = useRef(value);
  const syncedValueRef = useRef(value);
  const isComposingRef = useRef(false);

  const clearPendingCommit = useCallback(() => {
    if (commitTimerRef.current === undefined) {
      return;
    }
    window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = undefined;
  }, []);

  const commitValue = useCallback(() => {
    clearPendingCommit();
    const nextValue = draftValueRef.current;
    if (nextValue === syncedValueRef.current) {
      return;
    }
    syncedValueRef.current = nextValue;
    onValueChange(nextValue);
  }, [clearPendingCommit, onValueChange]);

  const scheduleCommit = useCallback(() => {
    clearPendingCommit();
    commitTimerRef.current = window.setTimeout(
      commitValue,
      TEXT_UPDATE_DEBOUNCE_MS
    );
  }, [clearPendingCommit, commitValue]);

  useEffect(() => {
    if (value === syncedValueRef.current) {
      return;
    }
    clearPendingCommit();
    syncedValueRef.current = value;
    draftValueRef.current = value;
    setDraftValue(value);
  }, [clearPendingCommit, value]);

  useEffect(() => clearPendingCommit, [clearPendingCommit]);

  return (
    <textarea
      className={className}
      onBlur={commitValue}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        draftValueRef.current = nextValue;
        setDraftValue(nextValue);
        if (!isComposingRef.current) {
          scheduleCommit();
        }
      }}
      onCompositionEnd={() => {
        isComposingRef.current = false;
        scheduleCommit();
      }}
      onCompositionStart={() => {
        isComposingRef.current = true;
        clearPendingCommit();
      }}
      placeholder={placeholder}
      rows={rows}
      value={draftValue}
    />
  );
};

const AttachedPostMedia = ({
  media,
  onImportOcr,
  contextText,
}: {
  contextText?: string;
  media: CrawlPost["media"];
  onImportOcr: (payload: { regions: SpoilerRevealRegion[]; text: string }) => void;
}) => {
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrMessage, setOcrMessage] = useState("");
  const firstAsset = media[0];
  const imageAssets = media.filter(
    (asset) => asset.type === "image" && Boolean(asset.asset_path)
  );
  const imageAsset = imageAssets[0];

  if (!firstAsset) return null;

  const handleOcr = async () => {
    if (!imageAsset?.asset_path) return;
    setOcrBusy(true);
    setOcrMessage("");
    try {
      const result = await ocrVideoDialogue(imageAsset.asset_path);
      const ocrLines = selectOcrTextForTts(
        result.lines.filter((line) => Boolean(line.text.trim()))
      );
      if (ocrLines.length === 0) {
        throw new Error("Không nhận diện được chữ trong ảnh.");
      }
      let correctedLines = ocrLines;
      let usedSmartSuggestion = false;
      try {
        const suggestion = await suggestVideoDialogueText({
          contextText,
          lines: ocrLines.map(({ id, speaker, text }) => ({ id, speaker, text })),
        });
        if (suggestion.lines.length === ocrLines.length) {
          correctedLines = ocrLines.map((line) => {
            const suggested = suggestion.lines.find((item) => item.id === line.id);
            return suggested ? { ...line, text: suggested.text } : line;
          });
          usedSmartSuggestion = true;
        }
      } catch {
        // OCR text remains usable if the optional AI provider is unavailable.
      }
      const firstText = correctedLines
        .map((line) => line.text.trim())
        .filter(Boolean)
        .join("\n");
      const additionalTexts = await Promise.all(
        imageAssets.slice(1).map(async (asset) => {
          const additionalResult = await ocrVideoDialogue(asset.asset_path);
          return selectOcrTextForTts(additionalResult.lines)
            .map((line) => line.text.trim())
            .filter(Boolean)
            .join("\n");
        })
      );
      const text = [firstText, ...additionalTexts]
        .filter(Boolean)
        .join("\n");
      if (!text) {
        throw new Error("Không nhận diện được chữ trong ảnh.");
      }
      onImportOcr({
        regions: correctedLines.flatMap((line) =>
          splitSpoilerRevealRegion({
            bbox: line.bbox,
            image_height: result.height,
            image_width: result.width,
            text: line.text.trim(),
          })
        ),
        text,
      });
      setOcrMessage(
        usedSmartSuggestion
          ? "Đã OCR và tự sửa viết tắt cho TTS."
          : "Đã nhập OCR và tạo reveal theo từng dòng.",
      );
    } catch (cause) {
      setOcrMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOcrBusy(false);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900"
      onClick={(event) => event.stopPropagation()}
    >
      <AttachmentMediaPreview media={media} />

      {imageAssets.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="h-7 px-2 text-[10px]"
            disabled={ocrBusy}
            onClick={() => void handleOcr()}
            type="button"
            variant="outline"
          >
            {ocrBusy ? <LoaderCircle className="mr-1 size-3 animate-spin" /> : null}
            Đọc chữ → nhập TTS
          </Button>
          {ocrMessage ? (
            <span className="max-w-48 text-[10px] text-muted-foreground">
              {ocrMessage}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

function splitSpoilerRevealRegion(
  region: SpoilerRevealRegion
): SpoilerRevealRegion[] {
  const lines = region.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return [region];
  }

  const lineHeight = region.bbox.height / lines.length;
  return lines.map((text, index) => ({
    ...region,
    bbox: {
      ...region.bbox,
      height:
        index === lines.length - 1
          ? region.bbox.height - lineHeight * index
          : lineHeight,
      y: region.bbox.y + lineHeight * index,
    },
    text,
  }));
}

const DISPLAY_METRIC_MIN_BUMP = 100;
const DISPLAY_METRIC_MAX_BUMP = 200;
const DISPLAY_LIKE_MIN_BUMP = 103;

type MemePlacement = "after_comment" | "media_reveal" | "transition";

const MemePlacementSelect = ({
  ariaLabel,
  allowMediaReveal = false,
  disabled = false,
  onChange,
  title,
  value,
}: {
  ariaLabel: string;
  allowMediaReveal?: boolean;
  disabled?: boolean;
  onChange: (value: MemePlacement) => void;
  title?: string;
  value: MemePlacement;
}) => (
  <Select
    onValueChange={(nextValue) => onChange(nextValue as MemePlacement)}
    value={value}
  >
    <SelectTrigger
      aria-label={ariaLabel}
      className="h-8 w-auto min-w-40 max-w-44 shrink-0 border-emerald-400/70 bg-white/90 px-2 font-medium text-[10px] text-slate-800 shadow-sm hover:bg-white dark:bg-slate-950/60 dark:text-slate-100 dark:hover:bg-slate-950/80"
      disabled={disabled}
      title={title}
    >
      <SelectValue />
    </SelectTrigger>
    <SelectContent className="min-w-40 border-emerald-400/40 bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-100">
      <SelectItem
        className="text-[10px] focus:bg-emerald-50 focus:text-emerald-900 dark:focus:bg-emerald-950/60 dark:focus:text-emerald-100"
        value="after_comment"
      >
        Ngay sau khi đọc
      </SelectItem>
      {allowMediaReveal ? (
        <SelectItem
          className="text-[10px] focus:bg-emerald-50 focus:text-emerald-900 dark:focus:bg-emerald-950/60 dark:focus:text-emerald-100"
          value="media_reveal"
        >
          Ảnh gốc + sound
        </SelectItem>
      ) : null}
      <SelectItem
        className="text-[10px] focus:bg-emerald-50 focus:text-emerald-900 dark:focus:bg-emerald-950/60 dark:focus:text-emerald-100"
        value="transition"
      >
        Sau chuyển cảnh
      </SelectItem>
    </SelectContent>
  </Select>
);

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
  const likeBump = likeValue - Math.max(0, Math.floor(Number(counts.likes) || 0));
  const secondaryMaxBump = Math.max(DISPLAY_METRIC_MIN_BUMP, likeBump - 1);

  return {
    likes: likeValue,
    replies: resolveMetric("replies", counts.replies, DISPLAY_METRIC_MIN_BUMP, secondaryMaxBump),
    reposts: resolveMetric("reposts", counts.reposts, DISPLAY_METRIC_MIN_BUMP, secondaryMaxBump),
    shares: resolveMetric("shares", counts.shares, DISPLAY_METRIC_MIN_BUMP, secondaryMaxBump),
  };
}

function getCommentDisplayMetrics(
  comment: CrawlPost["top_comments"][number]
): { likes: number; replies: number; reposts: number; shares: number } {
  const seed = comment.comment_id || comment.text || "";
  const metrics = buildDisplayMetrics(seed, {
    likes: comment.like_count ?? 0,
    replies: comment.reply_count ?? 0,
    reposts: comment.repost_count ?? 0,
    shares: comment.share_count ?? 0,
  });

  return {
    likes: comment.video_like_count ?? metrics.likes,
    replies: comment.video_reply_count ?? metrics.replies,
    reposts: metrics.reposts,
    shares: comment.video_share_count ?? metrics.shares,
  };
}

const CommentMetricFields = ({
  comment,
  onChange,
}: {
  comment: CrawlPost["top_comments"][number];
  onChange: (fields: {
    video_like_count: number | null;
    video_reply_count: number | null;
    video_share_count: number | null;
  }) => void;
}) => {
  const metrics = getCommentDisplayMetrics(comment);
  const fields = [
    {
      fallback: metrics.likes,
      key: "video_like_count" as const,
      label: "Tym",
      value: comment.video_like_count,
    },
    {
      fallback: metrics.replies,
      key: "video_reply_count" as const,
      label: "Cmt",
      value: comment.video_reply_count,
    },
    {
      fallback: metrics.shares,
      key: "video_share_count" as const,
      label: "Share",
      value: comment.video_share_count,
    },
  ];

  return (
    <div className="grid w-[8.5rem] max-w-full grid-cols-3 gap-1">
      {fields.map((field) => (
        <label
          className="grid gap-0.5 text-[8px] font-semibold text-slate-500 dark:text-slate-400"
          key={field.key}
          title="Để trống để tự động tăng nhẹ từ số gốc"
        >
          <span>{field.label}</span>
          <input
            className="h-6 w-full rounded border border-slate-200 bg-white px-1 text-[10px] font-medium text-slate-800 outline-none focus-visible:border-emerald-400 focus-visible:ring-1 focus-visible:ring-emerald-400/20 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200"
            inputMode="numeric"
            min={0}
            onChange={(event) => {
              const raw = event.currentTarget.value.trim();
              const parsed = raw === "" ? null : Number(raw);
              const nextValue =
                parsed === null
                  ? null
                  : Number.isFinite(parsed)
                    ? Math.max(0, Math.floor(parsed))
                    : null;
              onChange({
                video_like_count:
                  field.key === "video_like_count"
                    ? nextValue
                    : comment.video_like_count ?? null,
                video_reply_count:
                  field.key === "video_reply_count"
                    ? nextValue
                    : comment.video_reply_count ?? null,
                video_share_count:
                  field.key === "video_share_count"
                    ? nextValue
                    : comment.video_share_count ?? null,
              });
            }}
            placeholder={formatNumber(field.fallback)}
            type="number"
            value={field.value ?? ""}
          />
        </label>
      ))}
    </div>
  );
};

export const VideoPostListCard = ({
  isEditorOpen,
  isGeneratingTts,
  isSaving,
  isSelected,
  llmTextConfigured,
  memeBySceneId,
  memeLibraryItems,
  memePlacementBySceneId,
  onCommentReorder,
  onCommentMetricsChange,
  onCommentSelectedChange,
  onCommentTextChange,
  onCommentTtsTextChange,
  onCommentDurationChange,
  onMemeChange,
  onMemePlacementChange,
  onDefaultCommentAvatarUpload,
  onCommentMediaRemove,
  onCommentMediaUpload,
  onGenerateTtsSuggestions,
  onPostTextChange,
  onPostSpoilerFieldsChange,
  onPostTtsTextChange,
  onPostDurationChange,
  onSaveEditor,
  onToggleEditor,
  onToggleSelected,
  post,
  saveMessage,
  uploadingAssetKey,
  uploadingAvatar,
}: {
  isEditorOpen: boolean;
  isGeneratingTts?: boolean;
  isSaving?: boolean;
  isSelected: boolean;
  llmTextConfigured?: boolean;
  memeBySceneId: Record<string, SelectedMemeEntry | null | undefined>;
  memeLibraryItems: MemeLibraryEntry[];
  memePlacementBySceneId: Record<
    string,
    "after_comment" | "media_reveal" | "transition" | undefined
  >;
  onCommentReorder: (draggedCommentId: string, targetCommentId: string) => void;
  onCommentMetricsChange: (
    commentId: string,
    fields: {
      video_like_count: number | null;
      video_reply_count: number | null;
      video_share_count: number | null;
    }
  ) => void;
  onCommentSelectedChange: (commentId: string, value: boolean) => void;
  onCommentTextChange: (commentId: string, value: string) => void;
  onCommentTtsTextChange: (commentId: string, value: string) => void;
  onCommentDurationChange: (commentId: string, value: number | undefined) => void;
  onMemeChange: (sceneId: string, meme: SelectedMemeEntry | null) => void;
  onMemePlacementChange: (
    sceneId: string,
    placement: "after_comment" | "media_reveal" | "transition"
  ) => void;
  onDefaultCommentAvatarUpload: (file: File) => void;
  onCommentMediaRemove: (commentId: string) => void;
  onCommentMediaUpload: (commentId: string, file: File) => void;
  onGenerateTtsSuggestions: () => void;
  onPostTextChange: (value: string) => void;
  onPostSpoilerFieldsChange?: (fields: {
    is_spoiler?: boolean;
    spoiler_initial_text?: string;
    spoiler_media?: boolean;
    spoiler_reveal_regions?: SpoilerRevealRegion[];
    spoiler_reveal_media_only?: boolean;
    spoiler_reveal_text?: string;
    spoiler_style?: "blur" | "hide";
    tts_text?: string;
  }) => void;
  onPostTtsTextChange: (value: string) => void;
  onPostDurationChange: (value: number | undefined) => void;
  onSaveEditor: () => void;
  onToggleEditor: () => void;
  onToggleSelected: () => void;
  post: CrawlPost;
  saveMessage?: string;
  uploadingAssetKey?: string | null;
  uploadingAvatar?: boolean;
}) => {
  const selectedCommentCount = post.top_comments.filter(
    (comment) => comment.selected_for_video !== false
  ).length;
  const postPreviewText = formatStructuredPreviewText(post.text);
  const postMeme = memeBySceneId[post.post_id];
  const postMemePlacement =
    memePlacementBySceneId[post.post_id] ??
    postMeme?.placement ??
    "transition";
  const postHasRevealImage = Boolean(
    post.media?.some(
      (media) =>
        media.type === "image" && Boolean(media.asset_path || media.remote_url)
    )
  );
  const repliesByParent = new Map<string, CrawlPost["top_comments"]>();
  const topLevelComments = post.top_comments.filter((comment) => !comment.is_reply);
  for (const comment of post.top_comments) {
    if (!comment.is_reply || !comment.parent_comment_id) continue;
    const replies = repliesByParent.get(comment.parent_comment_id) ?? [];
    replies.push(comment);
    repliesByParent.set(comment.parent_comment_id, replies);
  }
  const orderedComments = [
    ...topLevelComments.flatMap((comment) => [
      comment,
      ...(repliesByParent.get(comment.comment_id) ?? []),
    ]),
    ...post.top_comments.filter(
      (comment) =>
        Boolean(comment.is_reply) &&
        (!comment.parent_comment_id || !repliesByParent.has(comment.parent_comment_id))
    ),
  ];

  return (
    <article
      aria-pressed={isSelected}
      className={`rounded-xl border p-3 transition-colors [contain-intrinsic-size:auto_360px] [content-visibility:auto] ${
        isSelected
          ? "border-emerald-400/90 bg-emerald-500/10 shadow-md ring-2 ring-emerald-400/25 dark:border-emerald-400/80 dark:bg-emerald-500/10 dark:ring-emerald-400/20"
          : "border-border bg-card hover:border-foreground/35"
      }`}
      onClick={onToggleSelected}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggleSelected();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2.5">
          <AvatarImage
            alt={`@${post.username}`}
            assetPath={post.avatar_asset_path}
            className="size-9 ring-1 ring-border/70"
            remoteUrl={post.avatar_url}
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-0.5">
                <a
                  className="inline-flex min-w-0 items-center gap-1 font-semibold text-[12px] underline-offset-4 hover:underline"
                  href={post.url}
                  onClick={(event) => event.stopPropagation()}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="truncate">@{post.username}</span>
                  <SquareArrowOutUpRight className="size-3 shrink-0" />
                </a>

                <p className="text-muted-foreground text-[10px] leading-4">
                  {formatDateTime(post.created_at || post.crawled_at)}
                </p>
              </div>

              <Button
                className="shrink-0"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleEditor();
                }}
                size="xs"
                type="button"
                variant="outline"
              >
                {isEditorOpen ? (
                  <ChevronUp className="size-3" />
                ) : (
                  <ChevronDown className="size-3" />
                )}
                Chi tiết
              </Button>
            </div>

            <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[12px] leading-5 text-foreground">
              {postPreviewText}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                <MessageCircle className="size-3" />
                {formatNumber(post.top_comments.length)} bình luận
              </span>
              <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                {selectedCommentCount} comment được chọn
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  isSelected
                    ? "border-emerald-400 bg-emerald-500 text-white"
                    : "border-border bg-background text-muted-foreground"
                }`}
              >
                {isSelected ? <Check className="size-3" /> : null}
                {isSelected ? "Đã chọn làm video" : "Chưa chọn"}
              </span>
            </div>
          </div>
        </div>

        {isEditorOpen ? (
          <div
            className="mt-3 grid gap-3.5 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 shadow-inner dark:border-slate-800 dark:bg-slate-900/50"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-bold text-[13px] text-slate-800 dark:text-slate-200">
                  Chỉnh sửa bài viết
                </p>
              </div>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                @{post.username}
              </span>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1.5 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Nội dung bài viết
                </span>
                <BufferedTextarea
                  className="min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-800 shadow-sm outline-none transition-all placeholder:text-slate-400 focus-visible:border-slate-400 focus-visible:ring-4 focus-visible:ring-slate-400/10 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus-visible:border-slate-500"
                  onValueChange={onPostTextChange}
                  rows={4}
                  value={post.text}
                />
              </label>

              <label className="grid gap-1.5 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Text TTS cho bài viết
                </span>
                <BufferedTextarea
                  className="min-h-24 w-full resize-y rounded-xl border border-sky-200 bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-800 shadow-sm outline-none transition-all placeholder:text-slate-400 focus-visible:border-sky-400 focus-visible:ring-4 focus-visible:ring-sky-400/15 dark:border-sky-900 dark:bg-slate-800/80 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus-visible:border-sky-500"
                  onValueChange={onPostTtsTextChange}
                  placeholder="AI sẽ giữ sát text crawl, chủ yếu mở rộng viết tắt để voice đọc tự nhiên hơn."
                  rows={4}
                  value={post.tts_text ?? ""}
                />
              </label>
            </div>

            <label className="grid min-w-0 gap-1.5 rounded-xl border border-amber-200/60 bg-amber-50/40 px-3 py-2 text-[10px] text-slate-600 dark:border-amber-500/15 dark:bg-amber-900/10 dark:text-slate-300 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
              <span className="font-semibold text-amber-900 dark:text-amber-200">Thời lượng caption tối thiểu</span>
              <input
                className="h-8 w-full rounded-lg border border-amber-200 bg-white px-2.5 text-[11px] text-slate-800 outline-none focus-visible:border-amber-400 dark:border-amber-500/30 dark:bg-slate-800/80 dark:text-slate-200 sm:w-20"
                max={120}
                min={0.5}
                onChange={(event) => {
                  const rawValue = event.currentTarget.value.trim();
                  const value = rawValue ? Number(rawValue) : undefined;
                  onPostDurationChange(
                    value !== undefined && Number.isFinite(value)
                      ? Math.min(120, Math.max(0.5, value))
                      : undefined
                  );
                }}
                placeholder="Tự động"
                step={0.5}
                type="number"
                value={post.video_duration_seconds ?? ""}
              />
              <span className="text-[9px] text-amber-700/80 dark:text-amber-300/80">giây · để trống = tự động</span>
            </label>

            <AttachedPostMedia
              contextText={post.text}
              media={post.media}
              onImportOcr={({ regions, text }) => {
                const importedText = text.trim();
                if (!importedText) {
                  return;
                }

                const initialText =
                  post.spoiler_initial_text?.trim() || post.text.trim();
                const currentReveal = post.spoiler_reveal_text?.trim() ?? "";
                const revealLines = importedText
                  .split(/\r?\n/)
                  .map((line) => line.trim())
                  .filter(Boolean);
                const nextReveal = currentReveal
                  ? `${currentReveal}\n${revealLines.filter(
                      (line) => !currentReveal.split(/\r?\n/).includes(line)
                    ).join("\n")}`.replace(/\n+$/, "")
                  : revealLines.join("\n");
                if (onPostSpoilerFieldsChange) {
                  onPostSpoilerFieldsChange({
                    is_spoiler: true,
                    spoiler_initial_text: initialText,
                    spoiler_media: true,
                    spoiler_reveal_regions: regions,
                    spoiler_reveal_media_only: true,
                    spoiler_reveal_text: nextReveal,
                    spoiler_style: post.spoiler_style ?? "blur",
                  });
                  return;
                }

                const currentText = post.tts_text?.trim() ?? "";
                if (!currentText) {
                  onPostTtsTextChange(importedText);
                  return;
                }

                // OCR is an additive action: keep the manually edited TTS
                // text and append the recognized text after it.
                if (
                  currentText === importedText ||
                  currentText.endsWith(`\n${importedText}`)
                ) {
                  return;
                }
                onPostTtsTextChange(`${currentText}\n${importedText}`);
              }}
            />

            <div className="grid gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/10 p-2.5 dark:bg-emerald-950/25">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  checked={Boolean(post.is_spoiler)}
                  className="size-3.5 rounded border-emerald-400 text-emerald-600 focus:ring-emerald-500"
                  onChange={(event) => {
                    const enabled = event.currentTarget.checked;
                    const parts =
                      post.spoiler_initial_text?.trim() ||
                      post.spoiler_reveal_text?.trim()
                        ? {
                            initial: post.spoiler_initial_text ?? post.text,
                            reveal: post.spoiler_reveal_text ?? "",
                          }
                        : splitSpoilerText(post.text);
                    onPostSpoilerFieldsChange?.({
                      is_spoiler: enabled,
                      ...(enabled
                        ? {
                            spoiler_initial_text: parts.initial,
                            spoiler_reveal_text: parts.reveal,
                            spoiler_media: false,
                            spoiler_reveal_media_only: false,
                            tts_text: joinSpoilerText(parts.initial, parts.reveal),
                          }
                        : { spoiler_media: false }),
                    });
                  }}
                  type="checkbox"
                />
                <span className="font-semibold text-[11px] text-emerald-800 dark:text-emerald-300">
                  Spoiler nội dung
                </span>
                {post.spoiler_reveal_regions?.length ? (
                  <span className="text-[10px] text-emerald-700/80 dark:text-emerald-300/80">
                    ({post.spoiler_reveal_regions.length} vùng OCR)
                  </span>
                ) : null}
              </label>

              {post.is_spoiler ? (
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="grid gap-1 text-[11px]">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      Hiển thị ban đầu
                    </span>
                    <textarea
                      className="min-h-14 w-full resize-y rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs leading-relaxed text-slate-800 outline-none focus-visible:border-emerald-400 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200"
                      onChange={(event) => {
                        const initial = event.currentTarget.value;
                        const reveal = post.spoiler_reveal_text ?? "";
                        onPostSpoilerFieldsChange?.({
                          spoiler_initial_text: initial,
                          tts_text: joinSpoilerText(initial, reveal),
                        });
                      }}
                      rows={2}
                      value={post.spoiler_initial_text ?? post.text}
                    />
                  </label>
                  <label className="grid gap-1 text-[11px]">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                      Dòng hiện ra theo voice
                    </span>
                    <textarea
                      className="min-h-14 w-full resize-y rounded-lg border border-emerald-300 bg-emerald-50/30 px-2.5 py-2 text-xs leading-relaxed text-slate-800 outline-none focus-visible:border-emerald-500 dark:border-emerald-900/60 dark:bg-slate-800/80 dark:text-slate-200"
                      onChange={(event) => {
                        const reveal = event.currentTarget.value;
                        const initial = post.spoiler_initial_text || post.text;
                        onPostSpoilerFieldsChange?.({
                          spoiler_reveal_text: reveal,
                          tts_text: joinSpoilerText(initial, reveal),
                        });
                      }}
                      placeholder="Mỗi dòng là một vùng sẽ mở theo thứ tự OCR..."
                      rows={2}
                      value={post.spoiler_reveal_text ?? ""}
                    />
                  </label>
                </div>
              ) : null}

              {post.is_spoiler && post.media?.length ? (
                <label className="inline-flex cursor-pointer items-center gap-2 text-[10px] font-medium text-emerald-800 dark:text-emerald-300">
                  <input
                    checked={Boolean(post.spoiler_media)}
                    className="size-3 rounded border-emerald-400 text-emerald-600"
                    onChange={(event) =>
                      onPostSpoilerFieldsChange?.({
                        spoiler_media: event.currentTarget.checked,
                      })
                    }
                    type="checkbox"
                  />
                  Ẩn hoặc làm mờ ảnh đến khi đọc xong
                </label>
              ) : null}

              {post.is_spoiler && post.media?.length ? (
                <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="font-semibold">Kiểu ảnh:</span>
                  <label className="inline-flex cursor-pointer items-center gap-1">
                    <input
                      checked={post.spoiler_style !== "hide"}
                      className="size-3 text-emerald-600"
                      name={`automatic-spoiler-style-${post.post_id}`}
                      onChange={() =>
                        onPostSpoilerFieldsChange?.({ spoiler_style: "blur" })
                      }
                      type="radio"
                    />
                    Làm mờ
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-1">
                    <input
                      checked={post.spoiler_style === "hide"}
                      className="size-3 text-emerald-600"
                      name={`automatic-spoiler-style-${post.post_id}`}
                      onChange={() =>
                        onPostSpoilerFieldsChange?.({ spoiler_style: "hide" })
                      }
                      type="radio"
                    />
                    Ẩn hoàn toàn
                  </label>
                </div>
              ) : null}
            </div>

             <div className="grid gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/10 px-3 py-2.5 shadow-inner dark:bg-emerald-950/25">
               <div className="flex min-w-0 items-center gap-1.5">
                 <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
                   <Smile className="size-3.5 text-emerald-500 dark:text-emerald-300" />
                 </span>
                 <div>
                   <span className="block line-clamp-2 font-semibold text-[10px] leading-tight text-emerald-800 dark:text-emerald-300">
                     Meme sau bài viết
                   </span>
                 </div>
               </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <MemePicker
                  items={memeLibraryItems}
                  onSelect={(meme) =>
                    onMemeChange(
                      post.post_id,
                      meme ? { ...meme, placement: postMemePlacement } : null
                    )
                  }
                  selected={postMeme}
                />
                <MemePlacementSelect
                  ariaLabel="Cách hiển thị meme sau bài viết"
                  allowMediaReveal={postHasRevealImage}
                  onChange={(placement) => {
                    onMemePlacementChange(post.post_id, placement);
                    if (postMeme) {
                      onMemeChange(post.post_id, { ...postMeme, placement });
                    }
                  }}
                  value={postMemePlacement}
                />
              </div>
            </div>

             <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-slate-700 dark:text-slate-300">
                  Bình luận đưa vào video
                </span>
                <span className="rounded-full bg-slate-200/60 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  {selectedCommentCount}/{post.top_comments.length} được chọn
                </span>
              </div>

              {post.top_comments.length === 0 ? (
                <div className="rounded-lg border border-dashed px-3 py-4 text-center text-[11px] text-muted-foreground">
                  Bài này chưa có bình luận.
                </div>
              ) : (
                <div
                  className="grid gap-2"
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    updateCommentListDragScroll(
                      event.currentTarget,
                      event.clientY
                    );
                  }}
                >
                  {orderedComments.map((comment, index) => {
                    const commentMeme = memeBySceneId[comment.comment_id];
                    const commentMemePlacement =
                      memePlacementBySceneId[comment.comment_id] ??
                      commentMeme?.placement ??
                      (commentMeme ? "transition" : "after_comment");
                    const commentHasRevealImage = Boolean(
                      comment.media?.some(
                        (media) =>
                          media.type === "image" &&
                          Boolean(media.asset_path || media.remote_url)
                      )
                    );
                    const isReply = Boolean(comment.is_reply);
                    return (
                    <div
                      className={`relative grid gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${
                        comment.selected_for_video !== false
                          ? "border-emerald-400/90 bg-emerald-500/15 shadow-sm ring-2 ring-emerald-400/20 dark:border-emerald-400/70 dark:bg-emerald-500/10"
                          : "border-border/80 bg-muted/20 hover:bg-muted/35 dark:bg-muted/20"
                      } cursor-grab active:cursor-grabbing`}
                      style={{ marginLeft: isReply ? "1.75rem" : undefined }}
                      draggable
                      onDragStart={(event) => {
                        const target = event.target as HTMLElement | null;
                        const interactiveParent = target?.closest(
                          "textarea, input, button, label, video, img"
                        );
                        if (interactiveParent) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", comment.comment_id);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        stopCommentListDragScroll(event.currentTarget.parentElement);
                        const draggedCommentId = event.dataTransfer.getData("text/plain");
                        onCommentReorder(draggedCommentId, comment.comment_id);
                      }}
                      onDragEnd={(event) =>
                        stopCommentListDragScroll(event.currentTarget.parentElement)
                      }
                      key={comment.comment_id}
                    >
                      {isReply ? <span aria-hidden='true' className='absolute' style={{ backgroundColor: '#cbd5e1', bottom: '1rem', left: '-1.25rem', top: '-0.75rem', width: '1px' }} /> : null}
                      {comment.selected_for_video !== false ? (
                        <span className="absolute inset-y-0 left-0 w-1 rounded-l-xl bg-emerald-400" />
                      ) : null}
                      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                        <div className="flex min-w-0 items-start gap-2">
                          <div
                            className="mt-0.5 flex shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white/80 p-1 text-slate-400 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
                            title="Kéo thả để đổi thứ tự xuất hiện"
                          >
                            <AvatarImage alt='comment avatar' assetPath={comment.avatar_asset_path} className='size-6' remoteUrl={comment.avatar_url} />
                            <GripVertical className="size-3.5" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                              <p className="truncate font-semibold text-[11px] text-slate-800 dark:text-slate-200">
                                @{comment.username || comment.display_name || `comment ${index + 1}`}
                              </p>
                              {comment.is_author_reply ? (
                                <span className='rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold text-white'>Tác giả</span>
                              ) : null}
                              <span className="rounded-full bg-slate-200/70 px-1.5 py-0.5 text-[9px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                {isReply ? 'Phản hồi' : `#${index + 1}`}
                              </span>
                            </div>
                            <p className="mt-1 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                              {(() => {
                                const metrics = getCommentDisplayMetrics(comment);
                                return (
                                  <>
                                    <span className="whitespace-nowrap">
                                      {formatNumber(metrics.likes)} like / {formatNumber(metrics.replies)} reply /
                                    </span>
                                    <br />
                                    <span className="whitespace-nowrap">
                                      {formatNumber(metrics.reposts)} repost / {formatNumber(metrics.shares)} share
                                    </span>
                                  </>
                                );
                              })()}
                            </p>
                          </div>
                        </div>

                        <div className="flex min-w-0 max-w-full flex-wrap items-end justify-start gap-2 sm:justify-end">
                          <CommentMetricFields
                            comment={comment}
                            onChange={(fields) =>
                              onCommentMetricsChange(comment.comment_id, fields)
                            }
                          />
                        <label
                          className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                            comment.selected_for_video !== false
                              ? "border-emerald-400 bg-emerald-500 text-white shadow-sm hover:bg-emerald-600 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                              : "border-border bg-background text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          <input
                            checked={comment.selected_for_video !== false}
                            className="hidden"
                            onChange={(event) =>
                              onCommentSelectedChange(
                                comment.comment_id,
                                event.currentTarget.checked
                              )
                            }
                            type="checkbox"
                          />
                          {comment.selected_for_video !== false ? (
                            <Check className="size-3" />
                          ) : null}
                          {comment.selected_for_video !== false ? "Đã chọn" : "Chọn"}
                        </label>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                        <label className="grid min-w-0 gap-1.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                          <span>Comment hiển thị</span>
                          <BufferedTextarea
                              className={`min-h-24 w-full resize-y rounded-xl border px-3 py-2.5 text-[12px] leading-relaxed outline-none transition-all placeholder:text-slate-400 focus-visible:ring-4 ${
                              comment.selected_for_video !== false
                                ? "border-emerald-200 bg-white/60 text-slate-800 focus-visible:border-emerald-400 focus-visible:ring-emerald-400/20 dark:border-emerald-500/30 dark:bg-emerald-950/20 dark:text-slate-200 dark:focus-visible:border-emerald-500/50"
                                : "border-border bg-background text-foreground focus-visible:border-foreground/50 focus-visible:ring-foreground/10"
                            }`}
                            onValueChange={(value) =>
                              onCommentTextChange(comment.comment_id, value)
                            }
                            rows={3}
                            value={comment.text}
                          />
                        </label>

                        <label className="grid min-w-0 gap-1.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                          <span>Text TTS</span>
                          <BufferedTextarea
                              className={`min-h-24 w-full resize-y rounded-xl border px-3 py-2.5 text-[12px] leading-relaxed outline-none transition-all placeholder:text-slate-400 focus-visible:ring-4 ${
                              comment.selected_for_video !== false
                                ? "border-emerald-200 bg-white/60 text-slate-800 focus-visible:border-emerald-400 focus-visible:ring-emerald-400/20 dark:border-emerald-500/30 dark:bg-emerald-950/20 dark:text-slate-200 dark:focus-visible:border-emerald-500/50"
                                : "border-border bg-background text-foreground focus-visible:border-foreground/50 focus-visible:ring-foreground/10"
                            }`}
                            onValueChange={(value) =>
                              onCommentTtsTextChange(comment.comment_id, value)
                            }
                            placeholder="Để trống để hệ thống tự xử lý, hoặc sửa tay để TTS đọc đúng câu này."
                            rows={3}
                            value={comment.tts_text ?? ""}
                          />
                        </label>
                      </div>

                      <label className="grid min-w-0 gap-1.5 rounded-xl border border-amber-200/60 bg-amber-50/40 px-3 py-2 text-[10px] text-slate-600 dark:border-amber-500/15 dark:bg-amber-900/10 dark:text-slate-300 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                        <span className="font-semibold text-amber-900 dark:text-amber-200">Thời lượng hiển thị tối thiểu</span>
                        <input
                          className="h-8 w-full rounded-lg border border-amber-200 bg-white px-2.5 text-[11px] text-slate-800 outline-none focus-visible:border-amber-400 dark:border-amber-500/30 dark:bg-slate-800/80 dark:text-slate-200 sm:w-20"
                          max={120}
                          min={0.5}
                          onChange={(event) => {
                            const rawValue = event.currentTarget.value.trim();
                            const value = rawValue ? Number(rawValue) : undefined;
                            onCommentDurationChange(
                              comment.comment_id,
                              value !== undefined && Number.isFinite(value)
                                ? Math.min(120, Math.max(0.5, value))
                                : undefined
                            );
                          }}
                          placeholder="Tự động"
                          step={0.5}
                          type="number"
                          value={comment.video_duration_seconds ?? ""}
                        />
                        <span className="text-[9px] text-amber-700/80 dark:text-amber-300/80">giây · để trống = tự động</span>
                      </label>

                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/10 px-2 py-1.5 dark:bg-emerald-950/25">
                        <AttachmentMediaPreview media={comment.media} />
                        <CommentMediaActions
                          media={comment.media}
                          onRemove={() =>
                            onCommentMediaRemove(comment.comment_id)
                          }
                          onUpload={(file) =>
                            onCommentMediaUpload(comment.comment_id, file)
                          }
                          uploading={
                            uploadingAssetKey ===
                            `${post.post_id}:${comment.comment_id}:media`
                          }
                        />
                      </div>

                      <div className="grid gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/10 px-3 py-2.5 shadow-inner dark:bg-emerald-950/25">
                        <span className="flex min-w-0 items-center gap-1.5 line-clamp-2 font-semibold text-[10px] leading-tight text-emerald-500 dark:text-emerald-300">
                          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
                            <Smile className="size-3.5" />
                          </span>
                          Meme sau bình luận
                        </span>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <MemePicker
                            items={memeLibraryItems}
                            onSelect={(meme) =>
                              onMemeChange(
                                comment.comment_id,
                                meme
                                  ? {
                                      ...meme,
                                      placement:
                                        memePlacementBySceneId[comment.comment_id] ??
                                        commentMeme?.placement ??
                                        "after_comment",
                                    }
                                  : null
                              )
                            }
                            selected={commentMeme}
                          />
                          <MemePlacementSelect
                            ariaLabel="Cách hiển thị meme"
                            allowMediaReveal={commentHasRevealImage}
                            onChange={(placement) => {
                              onMemePlacementChange(comment.comment_id, placement);
                              if (commentMeme) {
                                onMemeChange(comment.comment_id, {
                                  ...commentMeme,
                                  placement,
                                });
                              }
                            }}
                            title={
                              commentMeme
                                ? "Chọn thời điểm hiển thị meme"
                                : "Chọn meme trước để bật tùy chọn này"
                            }
                            value={commentMemePlacement}
                          />
                        </div>
                      </div>

                      {comment.comment_id === DEFAULT_VIDEO_COMMENT_ID ? (
                        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/70 p-2 dark:border-amber-500/30 dark:bg-amber-500/10">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-[10px] leading-tight text-amber-900 dark:text-amber-200">
                                Comment mặc định thêm cuối video
                              </p>
                              <p className="mt-0.5 text-[9px] leading-tight text-amber-700 dark:text-amber-300">
                                Avatar và username cố định là @{comment.username || "monback.app"}.
                              </p>
                            </div>

                            <AvatarImage
                              alt={`@${comment.username || "monback.app"}`}
                              assetPath={comment.avatar_asset_path}
                              className="size-7 shrink-0 ring-2 ring-amber-300 dark:ring-amber-500/50"
                              remoteUrl={comment.avatar_url}
                            />

                            <label
                              className="flex shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-amber-400/60 bg-amber-50/60 px-2 py-1 text-[9px] font-medium text-amber-700 transition-colors hover:bg-amber-100/60 dark:border-amber-600/40 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/40"
                              title="Upload avatar mới cho comment mặc định (áp dụng cho tất cả bài viết)"
                            >
                              {uploadingAvatar ? (
                                <LoaderCircle className="size-3 animate-spin" />
                              ) : (
                                <UserRound className="size-3" />
                              )}
                              <span>Avatar</span>
                              <input
                                accept="image/*"
                                className="hidden"
                                disabled={uploadingAvatar}
                                onChange={(event) => {
                                  const file = event.currentTarget.files?.[0];
                                  if (!file) return;
                                  onDefaultCommentAvatarUpload(file);
                                  event.currentTarget.value = "";
                                }}
                                type="file"
                              />
                            </label>

                          </div>
                        </div>
                      ) : null}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-1 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <div className="text-[11px] font-medium leading-4 text-slate-500 dark:text-slate-400">
                {saveMessage || "Lưu để cập nhật dữ liệu hiện tại trong hệ thống."}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  className="rounded-lg px-4 shadow-sm"
                  disabled={isGeneratingTts}
                  onClick={onGenerateTtsSuggestions}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isGeneratingTts ? (
                    <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1.5 size-3.5" />
                  )}
                  {isGeneratingTts
                    ? "Đang gợi ý TTS..."
                    : llmTextConfigured
                      ? "AI gợi ý TTS"
                      : "Gợi ý TTS"}
                </Button>

                <Button
                  className="shrink-0 rounded-lg px-4 shadow-sm"
                  disabled={isSaving}
                  onClick={onSaveEditor}
                  size="sm"
                  type="button"
                >
                  <Save className="mr-1.5 size-3.5" />
                  {isSaving ? "Đang lưu..." : "Lưu nội dung"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
};
