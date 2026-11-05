import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  GripVertical,
  LoaderCircle,
  MessageCircle,
  Save,
  Smile,
  Sparkles,
  SquareArrowOutUpRight,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AvatarImage } from "@/features/output-preview/asset-status";
import { ocrVideoDialogue, suggestVideoDialogueText } from "@/lib/api";
import type {
  CrawlPost,
  MemeLibraryEntry,
  UploadedAudioPayload,
  UploadedImagePayload,
} from "@/lib/api";
import { assetSources, formatDateTime, formatNumber } from "@/lib/formatters";
import { formatStructuredPreviewText } from "@/lib/structured-preview-text";
import {
  stopCommentListDragScroll,
  updateCommentListDragScroll,
} from "./comment-list-drag-scroll";
import {
  AttachmentMediaPreview,
  CommentMediaActions,
} from "./attachment-media-preview";
import { selectOcrTextForTts } from "./ocr-text-for-tts";
import { joinSpoilerText, splitSpoilerText } from "./spoiler-text";

const DEFAULT_VIDEO_COMMENT_ID = "__default_monback_comment__";

const DISPLAY_METRIC_MIN_BUMP = 100;
const DISPLAY_METRIC_MAX_BUMP = 200;
const DISPLAY_LIKE_MIN_BUMP = 103;

function resolveMemeAssetUrl(
  asset:
    | { mediaUrl?: string; serverPath?: string }
    | null
    | undefined
): string {
  return assetSources(asset?.serverPath, asset?.mediaUrl)[0] ?? "";
}

function isVideoMemeAsset(
  asset:
    | { mediaUrl?: string; name?: string; serverPath?: string; type?: string }
    | null
    | undefined,
): boolean {
  const type = String(asset?.type ?? "").toLowerCase();
  const path = String(
    asset?.name ?? asset?.serverPath ?? asset?.mediaUrl ?? "",
  ).toLowerCase();
  return (
    type.startsWith("video/") ||
    /\.(mp4|m4v|webm|mov|avi|mkv)(?:\?|$)/i.test(path)
  );
}

function MemeAssetPreview({
  alt,
  asset,
  className,
}: {
  alt: string;
  asset:
    | { mediaUrl?: string; name?: string; serverPath?: string; type?: string }
    | null
    | undefined;
  className: string;
}) {
  const src = resolveMemeAssetUrl(asset);
  if (!src) return null;

  if (isVideoMemeAsset(asset)) {
    return (
      <video
        aria-label={alt}
        autoPlay
        className={className}
        loop
        muted
        playsInline
        preload="metadata"
        src={src}
      />
    );
  }

  return <img alt={alt} className={className} src={src} />;
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

// ─── Meme entry type used in state ─────────────────────────────────────────────
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

export interface SelectedMemeEntry {
  audio?: UploadedAudioPayload | null;
  audios?: UploadedAudioPayload[];
  durationMs?: number;
  emotion: string;
  label?: string;
  image?: UploadedImagePayload | null;
  images?: UploadedImagePayload[];
  placement?: "after_comment" | "media_reveal" | "transition";
  visualMode?: "meme" | "sound_only";
}

type MemePlacement = "after_comment" | "media_reveal" | "transition";

const MemePlacementSelect = ({
  allowMediaReveal,
  disabled,
  onChange,
  value,
}: {
  allowMediaReveal: boolean;
  disabled: boolean;
  onChange: (placement: MemePlacement) => void;
  value: MemePlacement;
}) => (
  <select
    aria-label="Vị trí meme"
    className="h-7 shrink-0 rounded-md border border-pink-300/70 bg-white/90 px-2 text-[10px] font-medium text-pink-900 outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-pink-500/30 dark:bg-slate-950 dark:text-pink-200"
    disabled={disabled}
    onChange={(event) => onChange(event.currentTarget.value as MemePlacement)}
    onClick={(event) => event.stopPropagation()}
    value={value}
  >
    <option value="after_comment">Ngay sau khi đọc</option>
    {allowMediaReveal ? (
      <option value="media_reveal">Ảnh gốc + sound</option>
    ) : null}
    <option value="transition">Sau chuyển cảnh</option>
  </select>
);

const SimpleMediaPreview = ({
  contextText,
  media,
  isSpoiler,
  spoilerStyle = "blur",
  onImportTts,
  onSpoilerStyleChange,
}: {
  contextText?: string;
  media?: { type: "image" | "video"; remote_url: string; asset_path?: string }[];
  isSpoiler?: boolean;
  onImportTts?: (text: string) => void;
  spoilerStyle?: "blur" | "hide";
  onSpoilerStyleChange?: (style: "blur" | "hide") => void;
}) => {
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrMessage, setOcrMessage] = useState("");
  const imageAssets = media?.filter(
    (asset) => asset.type === "image" && Boolean(asset.asset_path)
  );
  const imageAsset = imageAssets?.[0];

  if (!media || media.length === 0) return null;

  const firstAsset = media[0];
  const url = firstAsset.asset_path ? `/media/${firstAsset.asset_path}` : firstAsset.remote_url;

  const handleOcr = async () => {
    if (!imageAsset?.asset_path || !onImportTts) return;
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
        // Keep the raw OCR result if the optional AI provider is unavailable.
      }
      const firstText = correctedLines
        .map((line) => line.text.trim())
        .filter(Boolean)
        .join("\n");
      const additionalTexts = await Promise.all(
        (imageAssets?.slice(1) ?? []).map(async (asset) => {
          const assetPath = asset.asset_path;
          if (!assetPath) {
            return "";
          }
          const additionalResult = await ocrVideoDialogue(assetPath);
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
      onImportTts(text);
      setOcrMessage(
        usedSmartSuggestion
          ? "Đã OCR và tự sửa viết tắt cho TTS."
          : "Đã nhập chữ vào ô TTS.",
      );
    } catch (cause) {
      setOcrMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOcrBusy(false);
    }
  };

  return (
    <div
      className="mt-2.5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900"
      onClick={(e) => e.stopPropagation()}
    >
      <AttachmentMediaPreview media={media} />

      {imageAssets?.length && onImportTts ? (
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

      {isSpoiler && onSpoilerStyleChange ? (
        <div className="flex items-center gap-3 rounded-md border border-pink-200/70 bg-pink-50/70 px-2.5 py-1.5 dark:border-pink-800/40 dark:bg-pink-950/40">
          <span className="text-[10px] font-bold text-pink-900 dark:text-pink-300">
            Kiểu spoiler chữ:
          </span>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-700 hover:text-pink-700 dark:text-slate-300">
            <input
              type="radio"
              className="size-3.5 text-pink-600 focus:ring-pink-500"
              name={`spoiler-style-${firstAsset.remote_url || url}`}
              checked={spoilerStyle !== "hide"}
              onChange={() => onSpoilerStyleChange("blur")}
            />
            Làm mờ
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-700 hover:text-pink-700 dark:text-slate-300">
            <input
              type="radio"
              className="size-3.5 text-pink-600 focus:ring-pink-500"
              name={`spoiler-style-${firstAsset.remote_url || url}`}
              checked={spoilerStyle === "hide"}
              onChange={() => onSpoilerStyleChange("hide")}
            />
            Mất đi hoàn toàn
          </label>
        </div>
      ) : null}
    </div>
  );
};

const MEME_EMOTION_LABELS: Record<string, string> = {
  angry: "Tức giận",
  confused: "Bối rối",
  cringe: "Cringe",
  cute: "Dễ thương",
  dramatic: "Kịch tính",
  funny: "Hài hước",
  sad: "Buồn",
  shock: "Sốc",
};

const getMemeDisplayLabel = (
  emotion: string,
  selectedLabel: string | undefined,
  items: MemeLibraryEntry[]
) => {
  const normalizedEmotion = emotion.trim().toLowerCase();
  const libraryItem = items.find(
    (item) => item.emotion.trim().toLowerCase() === normalizedEmotion
  );

  return (
    libraryItem?.label?.trim() ||
    selectedLabel?.trim() ||
    MEME_EMOTION_LABELS[normalizedEmotion] ||
    emotion
  );
};

// ─── Mini meme picker component ────────────────────────────────────────────────
function pickRandomMemeAsset<T>(
  assets: T[] | undefined,
  legacyAsset: T | null | undefined
): T | null {
  const pool = assets?.length ? assets : legacyAsset ? [legacyAsset] : [];
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

function getMemeAssetKey(
  asset:
    | { mediaUrl?: string; name?: string; serverPath?: string }
    | null
    | undefined
): string {
  return asset?.serverPath ?? asset?.mediaUrl ?? asset?.name ?? "";
}

export const MemePicker = ({
  items,
  selected,
  onSelect,
}: {
  items: MemeLibraryEntry[];
  selected: SelectedMemeEntry | null | undefined;
  onSelect: (meme: SelectedMemeEntry | null) => void;
}) => {
  const pickerRef = useRef<HTMLDivElement>(null);
  const [pickerMode, setPickerMode] = useState<"categories" | "memes" | null>(
    null
  );
  const [browseEmotion, setBrowseEmotion] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const open = pickerMode !== null;

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !pickerRef.current?.contains(target)) {
        setPickerMode(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerMode(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectedLabel = selected
    ? getMemeDisplayLabel(selected.emotion, selected.label, items)
    : "Chọn meme";

  const selectedCategory = selected
    ? items.find(
        (item) =>
          item.emotion.trim().toLowerCase() === selected.emotion.trim().toLowerCase()
      )
    : undefined;
  const browseCategory =
    items.find(
      (item) =>
        item.emotion.trim().toLowerCase() === browseEmotion?.trim().toLowerCase()
    ) ?? selectedCategory;
  const categoryOptions = items.map((item) => ({
    image: item.image ?? item.images?.[0] ?? null,
    item,
    key: `category-${item.emotion}`,
  }));
  const memeOptions = (pickerMode === "memes" && browseCategory
    ? [browseCategory]
    : []
  ).flatMap((item) => {
    const images = item.images?.length
      ? item.images
      : item.image
        ? [item.image]
        : [null];

    return images.map((image, index) => ({
      image,
      index,
      item,
      key: `${item.emotion}-${getMemeAssetKey(image)}-${index}`,
    }));
  });
  const pageSize = 24;
  const visibleOptions =
    pickerMode === "categories"
      ? categoryOptions.slice(page * pageSize, (page + 1) * pageSize)
      : memeOptions.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.max(
    1,
    Math.ceil(
      (pickerMode === "categories" ? categoryOptions.length : memeOptions.length) /
        pageSize
    )
  );

  if (items.length === 0) {
    return (
      <span className="text-[10px] text-slate-400 italic">
        Chưa có meme trong thư viện
      </span>
    );
  }

  return (
    <div className="relative min-w-0" ref={pickerRef}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <button
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all ${
            selected
              ? "border-pink-400 bg-pink-600 text-white shadow-xs hover:bg-pink-700"
              : "border-slate-300 bg-white text-slate-600 hover:border-pink-300 hover:bg-pink-50/50 hover:text-pink-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          }`}
          onClick={() => {
            setPage(0);
            setBrowseEmotion(selected?.emotion ?? null);
            setPickerMode((current) =>
              current === "categories" ? null : "categories"
            );
          }}
          type="button"
        >
          <Smile className="size-3.5" />
          <span className="max-w-[9rem] truncate sm:max-w-[12rem]">{selectedLabel}</span>
          {open ? (
            <ChevronUp className="size-3 opacity-70" />
          ) : (
            <ChevronDown className="size-3 opacity-70" />
          )}
        </button>

        {selected?.visualMode === "sound_only" ? (
          <span
            className="inline-flex size-6 items-center justify-center rounded-md bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-200"
            title="Chỉ phát sound"
          >
            <Volume2 className="size-3.5" />
          </span>
        ) : resolveMemeAssetUrl(selected?.image) ? (
          <button
            className="rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pink-400"
            onClick={() => {
              setPage(0);
              setBrowseEmotion(selected?.emotion ?? null);
              setPickerMode((current) =>
                current === "memes" ? null : "memes"
              );
            }}
            title="Đổi meme"
            type="button"
          >
            <MemeAssetPreview
              alt={selectedLabel}
              asset={selected?.image}
              className="size-6 rounded-md object-cover ring-1 ring-pink-400/60 shadow-xs"
            />
          </button>
        ) : null}

        {selected?.audio ? (
          <select
            aria-label="Chế độ phát meme"
            className="h-7 max-w-24 shrink-0 rounded-md border border-pink-300/70 bg-white/90 px-1.5 text-[10px] font-medium text-pink-900 outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-pink-500/30 dark:bg-slate-950 dark:text-pink-200"
            onChange={(event) =>
              onSelect({
                ...selected,
                visualMode:
                  event.currentTarget.value === "sound_only"
                    ? "sound_only"
                    : "meme",
              })
            }
            onClick={(event) => event.stopPropagation()}
            value={selected.visualMode ?? "meme"}
          >
            <option value="meme">Meme + sound</option>
            <option value="sound_only">Chỉ sound</option>
          </select>
        ) : null}

        {selected ? (
          <button
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-rose-950/40"
            onClick={() => {
              onSelect(null);
              setPickerMode(null);
            }}
            title="Xóa meme"
            type="button"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="absolute left-0 z-30 mt-1.5 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-2.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-1">
              {pickerMode === "memes" ? (
                <button
                  aria-label="Quay lại danh sách đầu mục meme"
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  onClick={() => {
                    setPage(0);
                    setPickerMode("categories");
                  }}
                  type="button"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
              ) : null}
              <p className="truncate font-bold text-[10px] text-slate-500 uppercase tracking-wide dark:text-slate-400">
                {pickerMode === "memes"
                  ? `Meme ${
                      browseCategory
                        ? getMemeDisplayLabel(
                            browseCategory.emotion,
                            browseCategory.label,
                            items
                          )
                        : selectedLabel
                    }`
                  : "Chọn đầu mục meme"}
              </p>
            </div>
            <button
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              onClick={() => setPickerMode(null)}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="grid max-h-64 grid-cols-4 gap-1.5 overflow-y-auto pr-0.5">
            {visibleOptions.map((option) => {
              const { image, item } = option;
              const index =
                "index" in option && typeof option.index === "number"
                  ? option.index
                  : 0;
              const key = option.key;
              const imgUrl = resolveMemeAssetUrl(image);
              const isActive =
                pickerMode === "memes" &&
                selected?.emotion === item.emotion &&
                getMemeAssetKey(selected.image) === getMemeAssetKey(image);
              return (
                <button
                  className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 font-medium text-[9px] transition-all ${
                    isActive
                      ? "border-pink-500 bg-pink-50 text-pink-700 ring-2 ring-pink-500/20 dark:border-pink-400 dark:bg-pink-900/30 dark:text-pink-300"
                      : "border-slate-200 bg-white text-slate-600 hover:border-pink-300 hover:bg-pink-50/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  }`}
                  key={key}
                  onClick={() => {
                    if (pickerMode === "categories") {
                      setPage(0);
                      setBrowseEmotion(item.emotion);
                      setPickerMode("memes");
                      return;
                    }
                    const selectedAudio = pickRandomMemeAsset(
                      item.audios,
                      item.audio
                    );

                    onSelect({
                      audio: selectedAudio,
                      audios: item.audios,
                      emotion: item.emotion,
                      label: item.label,
                      image,
                      images: item.images,
                      visualMode: "meme",
                    });
                    setPickerMode(null);
                  }}
                  type="button"
                >
                  {imgUrl ? (
                    <MemeAssetPreview
                      alt={`${getMemeDisplayLabel(item.emotion, item.label, items)} ${index + 1}`}
                      asset={image}
                      className="size-10 rounded-md object-cover"
                    />
                  ) : (
                    <div className="flex size-10 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800">
                      <Smile className="size-5 text-slate-400" />
                    </div>
                  )}
                  <span className="max-w-full truncate leading-tight font-semibold">
                    {getMemeDisplayLabel(item.emotion, item.label, items)}
                    {pickerMode === "memes" && item.images?.length && item.images.length > 1
                      ? ` #${index + 1}`
                      : ""}
                  </span>
                </button>
              );
            })}
          </div>
          {totalPages > 1 ? (
            <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <button
                aria-label="Trang trước"
                className="inline-flex size-6 items-center justify-center rounded-md border border-slate-200 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                type="button"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <span>
                Trang {page + 1}/{totalPages}
              </span>
              <button
                aria-label="Trang sau"
                className="inline-flex size-6 items-center justify-center rounded-md border border-slate-200 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
                disabled={page >= totalPages - 1}
                onClick={() =>
                  setPage((current) => Math.min(totalPages - 1, current + 1))
                }
                type="button"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

// ─── Main component ─────────────────────────────────────────────────────────────
export const VideoPostListCardV2 = ({
  isEditorOpen,
  isGeneratingTts,
  isSaving,
  isSelected,
  llmTextConfigured,
  memeBySceneId,
  memeLibraryItems,
  onCommentReorder,
  onCommentMetricsChange,
  onCommentSelectedChange,
  onCommentTextChange,
  onCommentTtsTextChange,
  onDefaultCommentAvatarUpload,
  onCommentMediaRemove,
  onCommentMediaUpload,
  onGenerateTtsSuggestions,
  onMemeChange,
  onMemePlacementChange,
  onPostTextChange,
  onPostTtsTextChange,
  onSaveEditor,
  onToggleEditor,
  onToggleSelected,
  post,
  saveMessage,
  uploadingAssetKey,
  uploadingAvatar,
  onPostSpoilerFieldsChange,
}: {
  isEditorOpen: boolean;
  isGeneratingTts?: boolean;
  isSaving?: boolean;
  isSelected: boolean;
  llmTextConfigured?: boolean;
  memeBySceneId: Record<string, SelectedMemeEntry | null | undefined>;
  memeLibraryItems: MemeLibraryEntry[];
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
  onDefaultCommentAvatarUpload: (file: File) => void;
  onCommentMediaRemove: (commentId: string) => void;
  onCommentMediaUpload: (commentId: string, file: File) => void;
  onGenerateTtsSuggestions: () => void;
  onMemeChange: (sceneId: string, meme: SelectedMemeEntry | null) => void;
  onMemePlacementChange: (sceneId: string, placement: MemePlacement) => void;
  onPostTextChange: (value: string) => void;
  onPostTtsTextChange: (value: string) => void;
  onSaveEditor: () => void;
  onToggleEditor: () => void;
  onToggleSelected: () => void;
  post: CrawlPost;
  saveMessage?: string;
  uploadingAssetKey?: string | null;
  uploadingAvatar?: boolean;
  onPostSpoilerFieldsChange?: (fields: {
    is_spoiler?: boolean;
    spoiler_initial_text?: string;
    spoiler_reveal_text?: string;
    spoiler_media?: boolean;
    spoiler_style?: "blur" | "hide";
    tts_text?: string;
  }) => void;
  onCommentSpoilerFieldsChange?: (
    commentId: string,
    fields: {
      is_spoiler?: boolean;
      spoiler_initial_text?: string;
      spoiler_reveal_text?: string;
      spoiler_media?: boolean;
      tts_text?: string;
    }
  ) => void;
}) => {
  const selectedCommentCount = post.top_comments.filter(
    (comment) => comment.selected_for_video !== false
  ).length;
  const postPreviewText = formatStructuredPreviewText(post.text);
  const postMeme = memeBySceneId[post.post_id];
  const postMemePlacement = postMeme?.placement ?? "transition";
  const postHasRevealImage = Boolean(
    post.media?.some(
      (media) =>
        media.type === "image" && Boolean(media.asset_path || media.remote_url)
    )
  );

  return (
    <article
      aria-pressed={isSelected}
      className={`rounded-xl border bg-card p-3 transition-all [contain-intrinsic-size:auto_360px] [content-visibility:auto] ${
        isSelected
          ? "border-pink-500 bg-pink-50/70 shadow-sm ring-1 ring-pink-500/20 dark:border-pink-400 dark:bg-pink-500/10 dark:ring-pink-400/20"
          : "border-border hover:border-slate-300 dark:hover:border-slate-700"
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

                <p className="text-[10px] text-muted-foreground leading-4">
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

            <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[12px] text-foreground leading-5">
              {postPreviewText}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-[10px] text-muted-foreground">
                <MessageCircle className="size-3" />
                {formatNumber(post.top_comments.length)} bình luận
              </span>
              <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-[10px] text-emerald-700">
                {selectedCommentCount} bình luận được chọn
              </span>
              {postMeme ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-pink-50 px-2 py-0.5 font-medium text-[10px] text-pink-700 dark:bg-pink-900/30 dark:text-pink-300">
                  <Smile className="size-3" />
                  Meme: {getMemeDisplayLabel(postMeme.emotion, postMeme.label, memeLibraryItems)}
                </span>
              ) : null}
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
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-[11px] text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                @{post.username}
              </span>
            </div>

            <div className="flex items-center gap-2 rounded-lg bg-pink-50/50 p-2 dark:bg-pink-950/20">
              <input
                className="size-3.5 rounded border-slate-300 text-pink-600 focus:ring-pink-500"
                id={`post-spoiler-toggle-${post.post_id}`}
                checked={!!post.is_spoiler}
                onChange={(e) => {
                  const checked = e.target.checked;
                  const parts =
                    post.spoiler_initial_text?.trim() ||
                    post.spoiler_reveal_text?.trim()
                      ? {
                          initial: post.spoiler_initial_text ?? post.text,
                          reveal: post.spoiler_reveal_text ?? "",
                        }
                      : splitSpoilerText(post.text);
                  onPostSpoilerFieldsChange?.({
                    is_spoiler: checked,
                    spoiler_initial_text: checked
                      ? parts.initial
                      : post.spoiler_initial_text,
                    spoiler_reveal_text: checked
                      ? parts.reveal
                      : post.spoiler_reveal_text,
                    spoiler_media: checked ? Boolean(post.spoiler_media) : false,
                    ...(checked
                      ? { tts_text: joinSpoilerText(parts.initial, parts.reveal) }
                      : {}),
                  });
                }}
                type="checkbox"
              />
              <label
                className="cursor-pointer text-[11px] font-bold text-pink-800 dark:text-pink-300"
                htmlFor={`post-spoiler-toggle-${post.post_id}`}
              >
                Spoiler nội dung (tự chia nửa đầu/nửa sau theo caption)
              </label>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              {post.is_spoiler ? (
                <div className="grid gap-2 text-xs">
                  <label className="grid gap-1">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      Nội dung hiển thị ban đầu
                    </span>
                    <textarea
                      className="min-h-16 w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] text-slate-800 leading-relaxed shadow-sm outline-none transition-all placeholder:text-slate-400 focus-visible:border-slate-400 focus-visible:ring-4 focus-visible:ring-slate-400/10 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200"
                      onChange={(event) => {
                        const nextInitial = event.currentTarget.value;
                        const reveal = post.spoiler_reveal_text ?? "";
                        onPostSpoilerFieldsChange?.({
                          spoiler_initial_text: nextInitial,
                          tts_text: joinSpoilerText(nextInitial, reveal),
                        });
                      }}
                      placeholder="Phần văn bản hiển thị từ đầu..."
                      rows={2}
                      value={post.spoiler_initial_text ?? ""}
                    />
                  </label>
                  <label className="grid gap-1 text-pink-700 dark:text-pink-300">
                    <span className="font-semibold">
                      Nội dung hiện ra sau (Spoiler)
                    </span>
                    <textarea
                      className="min-h-16 w-full resize-y rounded-xl border border-pink-200 bg-pink-50/20 px-3.5 py-2.5 text-[13px] text-slate-800 leading-relaxed shadow-sm outline-none transition-all placeholder:text-slate-400 focus-visible:border-pink-400 focus-visible:ring-4 focus-visible:ring-pink-400/10 dark:border-pink-900/30 dark:bg-slate-800/80 dark:text-slate-200"
                      onChange={(event) => {
                        const nextReveal = event.currentTarget.value;
                        const initial = post.spoiler_initial_text || post.text;
                        onPostSpoilerFieldsChange?.({
                          spoiler_reveal_text: nextReveal,
                          tts_text: joinSpoilerText(initial, nextReveal),
                        });
                      }}
                      placeholder="Phần văn bản ẩn..."
                      rows={2}
                      value={post.spoiler_reveal_text ?? ""}
                    />
                  </label>
                </div>
              ) : (
                <label className="grid gap-1.5 text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Nội dung bài viết
                  </span>
                  <textarea
                    className="min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] text-slate-800 leading-relaxed shadow-sm outline-none transition-all placeholder:text-slate-400 focus-visible:border-slate-400 focus-visible:ring-4 focus-visible:ring-slate-400/10 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:focus-visible:border-slate-500 dark:placeholder:text-slate-500"
                    onChange={(event) =>
                      onPostTextChange(event.currentTarget.value)
                    }
                    rows={4}
                    value={post.text}
                  />
                </label>
              )}

              <label className="grid gap-1.5 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Văn bản đọc (TTS) cho bài viết
                </span>
                <textarea
                  className="min-h-24 w-full resize-y rounded-xl border border-sky-200 bg-white px-3.5 py-2.5 text-[13px] text-slate-800 leading-relaxed shadow-sm outline-none transition-all placeholder:text-slate-400 focus-visible:border-sky-400 focus-visible:ring-4 focus-visible:ring-sky-400/15 dark:border-sky-900 dark:bg-slate-800/80 dark:text-slate-200 dark:focus-visible:border-sky-500 dark:placeholder:text-slate-500"
                  onChange={(event) =>
                    onPostTtsTextChange(event.currentTarget.value)
                  }
                  placeholder="AI sẽ giữ sát text crawl, chủ yếu mở rộng viết tắt để giọng đọc tự nhiên hơn."
                  rows={4}
                  value={post.tts_text ?? ""}
                />
              </label>
            </div>

            {post.is_spoiler ? (
              <div className="mt-1 flex items-center justify-between rounded-lg border border-pink-200/70 bg-pink-50/70 px-3 py-2 dark:border-pink-800/40 dark:bg-pink-950/40">
                <span className="text-[11px] font-bold text-pink-900 dark:text-pink-300">
                  Kiểu phần ẩn:
                </span>
                <div className="flex items-center gap-4">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-700 hover:text-pink-700 dark:text-slate-300">
                    <input
                      type="radio"
                      className="size-3.5 text-pink-600 focus:ring-pink-500"
                      name={`spoiler-style-standalone-${post.post_id}`}
                      checked={post.spoiler_style !== "hide"}
                      onChange={() => onPostSpoilerFieldsChange?.({ spoiler_style: "blur" })}
                    />
                    Làm mờ
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-700 hover:text-pink-700 dark:text-slate-300">
                    <input
                      type="radio"
                      className="size-3.5 text-pink-600 focus:ring-pink-500"
                      name={`spoiler-style-standalone-${post.post_id}`}
                      checked={post.spoiler_style === "hide"}
                      onChange={() => onPostSpoilerFieldsChange?.({ spoiler_style: "hide" })}
                    />
                    Mất đi hoàn toàn
                  </label>
                </div>
              </div>
            ) : null}

            {post.is_spoiler && post.media?.length ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white/60 px-3 py-2 text-[11px] font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300">
                <input
                  checked={Boolean(post.spoiler_media)}
                  className="size-3.5 rounded border-slate-300 text-pink-600 focus:ring-pink-500"
                  onChange={(event) =>
                    onPostSpoilerFieldsChange?.({
                      spoiler_media: event.currentTarget.checked,
                    })
                  }
                  type="checkbox"
                />
                Ẩn hoặc làm mờ ảnh đính kèm đến khi đọc xong
              </label>
            ) : null}

            <SimpleMediaPreview
              contextText={post.text}
              media={post.media}
              isSpoiler={post.is_spoiler && post.spoiler_media}
              spoilerStyle={post.spoiler_style}
              onImportTts={(text) => {
                const importedLines = text
                  .split(/\r?\n/)
                  .map((line) => line.trim())
                  .filter(Boolean);
                const importedText = importedLines.join("\n");
                if (!importedText) return;

                const currentText = post.tts_text?.trim() ?? "";
                const nextTtsText =
                  !currentText || currentText.includes(importedText)
                    ? currentText || importedText
                    : `${currentText}\n${importedText}`;

                if (post.is_spoiler) {
                  const currentReveal = post.spoiler_reveal_text?.trim() ?? "";
                  const nextReveal =
                    !currentReveal || currentReveal.includes(importedText)
                      ? currentReveal || importedText
                      : `${currentReveal}\n${importedText}`;
                  onPostSpoilerFieldsChange?.({
                    spoiler_initial_text:
                      post.spoiler_initial_text?.trim() || post.text.trim(),
                    spoiler_media: true,
                    spoiler_reveal_text: nextReveal,
                  });
                  return;
                }

                if (!currentText) {
                  onPostTtsTextChange(importedText);
                  return;
                }
                if (nextTtsText === currentText) {
                  return;
                }
                onPostTtsTextChange(nextTtsText);
              }}
              onSpoilerStyleChange={(style) => onPostSpoilerFieldsChange?.({ spoiler_style: style })}
            />

            {/* Meme picker for the post scene */}
            <div className="grid gap-2 rounded-xl border border-pink-200/80 bg-pink-50/50 px-3.5 py-2.5 transition-all hover:border-pink-300 dark:border-pink-900/30 dark:bg-pink-950/20">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-pink-100 text-pink-600 dark:bg-pink-900/40 dark:text-pink-300">
                  <Smile className="size-4" />
                </div>
                <div className="flex flex-col">
                  <span className="font-semibold text-[11px] text-pink-900 leading-tight dark:text-pink-200">
                    Meme sau bài viết
                  </span>
                  <span className="text-[9px] text-pink-600/80 leading-tight dark:text-pink-400/80">
                    Hiển thị ngay sau khi đọc xong bài viết
                  </span>
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <MemePicker
                  items={memeLibraryItems}
                  onSelect={(meme) =>
                    onMemeChange(
                      post.post_id,
                      meme
                        ? { ...meme, placement: postMemePlacement }
                        : null
                    )
                  }
                  selected={postMeme}
                />
                <MemePlacementSelect
                  allowMediaReveal={postHasRevealImage}
                  disabled={!postMeme}
                  onChange={(placement) =>
                    onMemePlacementChange(post.post_id, placement)
                  }
                  value={postMemePlacement}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700 text-xs dark:text-slate-300">
                  Bình luận đưa vào video
                </span>
                <span className="rounded-full bg-slate-200/60 px-2 py-0.5 font-medium text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
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
                  {post.top_comments.map((comment, index) => {
                    const commentMeme = memeBySceneId[comment.comment_id];
                    const commentMemePlacement =
                      commentMeme?.placement ?? "after_comment";
                    const commentHasRevealImage = Boolean(
                      comment.media?.some(
                        (media) =>
                          media.type === "image" &&
                          Boolean(media.asset_path || media.remote_url)
                      )
                    );
                    return (
                      <div
                        className={`grid gap-2.5 rounded-xl border px-3 py-2.5 transition-all ${
                          comment.selected_for_video === false
                            ? "border-slate-200 bg-white opacity-70 hover:opacity-100 dark:border-slate-800 dark:bg-slate-900"
                            : "border-emerald-300 bg-emerald-50/80 shadow-sm ring-1 ring-emerald-500/10 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                        } cursor-grab active:cursor-grabbing`}
                        draggable
                        key={comment.comment_id}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }}
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
                          event.dataTransfer.setData(
                            "text/plain",
                            comment.comment_id
                          );
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          stopCommentListDragScroll(event.currentTarget.parentElement);
                          const draggedCommentId =
                            event.dataTransfer.getData("text/plain");
                          onCommentReorder(
                            draggedCommentId,
                            comment.comment_id
                          );
                        }}
                        onDragEnd={(event) =>
                          stopCommentListDragScroll(event.currentTarget.parentElement)
                        }
                      >
                        <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                          <div className="flex min-w-0 items-start gap-2">
                            <div
                              className="mt-0.5 flex shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white/80 p-1 text-slate-400 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
                              title="Kéo thả để đổi thứ tự xuất hiện"
                            >
                              <GripVertical className="size-3.5" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                                <p className="truncate font-semibold text-[11px] text-slate-800 dark:text-slate-200">
                                  @
                                  {comment.username ||
                                    comment.display_name ||
                                    `comment ${index + 1}`}
                                </p>
                                <span className="rounded-full bg-slate-200/70 px-1.5 py-0.5 font-medium text-[9px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                  #{index + 1}
                                </span>
                              </div>
                              <p className="mt-1 font-medium text-[10px] text-slate-500 dark:text-slate-400">
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

                          <div className="flex min-w-0 max-w-full flex-wrap items-end justify-start gap-1.5 sm:justify-end">
                            {/* Meme indicator badge */}
                            {commentMeme ? (
                              <span className="rounded-full bg-pink-100 px-1.5 py-0.5 font-medium text-[9px] text-pink-700 dark:bg-pink-900/40 dark:text-pink-300">
                                <Smile className="mr-0.5 inline size-2.5" />
                                {getMemeDisplayLabel(
                                  commentMeme.emotion,
                                  commentMeme.label,
                                  memeLibraryItems
                                )}
                              </span>
                            ) : null}

                            <CommentMetricFields
                              comment={comment}
                              onChange={(fields) =>
                                onCommentMetricsChange(comment.comment_id, fields)
                              }
                            />

                            <label
                              className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold text-[10px] transition-colors ${
                                comment.selected_for_video === false
                                  ? "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                                  : "border-emerald-400 bg-emerald-500 text-white shadow-sm hover:bg-emerald-600 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500"
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
                              {comment.selected_for_video === false
                                ? "Chọn"
                                : "Đã chọn"}
                            </label>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                          <label className="grid min-w-0 gap-1.5 font-medium text-[10px] text-slate-600 dark:text-slate-300">
                            <span>Bình luận hiển thị</span>
                            <textarea
                                className={`min-h-24 w-full resize-y rounded-xl border px-3 py-2.5 text-[12px] leading-relaxed outline-none transition-all placeholder:text-slate-400 focus-visible:ring-4 ${
                                comment.selected_for_video === false
                                  ? "border-slate-200 bg-white text-slate-600 focus-visible:border-slate-400 focus-visible:ring-slate-400/10 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400 dark:focus-visible:border-slate-500"
                                  : "border-emerald-200 bg-white/60 text-slate-800 focus-visible:border-emerald-400 focus-visible:ring-emerald-400/20 dark:border-emerald-500/30 dark:bg-emerald-950/20 dark:text-slate-200 dark:focus-visible:border-emerald-500/50"
                              }`}
                              onChange={(event) =>
                                onCommentTextChange(
                                  comment.comment_id,
                                  event.currentTarget.value
                                )
                              }
                              rows={3}
                              value={comment.text}
                            />
                          </label>

                          <label className="grid min-w-0 gap-1.5 font-medium text-[10px] text-slate-600 dark:text-slate-300">
                            <span>Văn bản đọc (TTS)</span>
                            <textarea
                                className={`min-h-24 w-full resize-y rounded-xl border px-3 py-2.5 text-[12px] leading-relaxed outline-none transition-all placeholder:text-slate-400 focus-visible:ring-4 ${
                                comment.selected_for_video === false
                                  ? "border-slate-200 bg-white text-slate-600 focus-visible:border-slate-400 focus-visible:ring-slate-400/10 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400 dark:focus-visible:border-slate-500"
                                  : "border-sky-200 bg-white/60 text-slate-800 focus-visible:border-sky-400 focus-visible:ring-sky-400/20 dark:border-sky-500/30 dark:bg-sky-950/20 dark:text-slate-200 dark:focus-visible:border-sky-500/50"
                              }`}
                              onChange={(event) =>
                                onCommentTtsTextChange(
                                  comment.comment_id,
                                  event.currentTarget.value
                                )
                              }
                              placeholder="Để trống để hệ thống tự xử lý, hoặc sửa tay để TTS đọc đúng câu này."
                              rows={3}
                              value={comment.tts_text ?? ""}
                            />
                          </label>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/10 px-2 py-1.5 dark:bg-emerald-950/25">
                          <SimpleMediaPreview media={comment.media} />
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

                        {/* Meme picker per comment */}
                        <div className="grid gap-2 rounded-xl border border-pink-200/60 bg-pink-50/40 px-3 py-2.5 dark:border-pink-500/15 dark:bg-pink-900/10">
                          <span className="flex min-w-0 items-center line-clamp-2 font-semibold text-[10px] leading-tight text-pink-800 dark:text-pink-300">
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
                                        placement: commentMemePlacement,
                                      }
                                    : null
                                )
                              }
                              selected={commentMeme}
                            />
                            <MemePlacementSelect
                              allowMediaReveal={commentHasRevealImage}
                              disabled={!commentMeme}
                              onChange={(placement) =>
                                onMemePlacementChange(
                                  comment.comment_id,
                                  placement
                                )
                              }
                              value={commentMemePlacement}
                            />
                          </div>
                        </div>

                        {comment.comment_id === DEFAULT_VIDEO_COMMENT_ID ? (
                          <div className="rounded-lg border border-amber-300 border-dashed bg-amber-50/70 p-2 dark:border-amber-500/30 dark:bg-amber-500/10">
                            <div className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-[10px] text-amber-900 leading-tight dark:text-amber-200">
                                  Bình luận mặc định thêm cuối video
                                </p>
                                <p className="mt-0.5 text-[9px] text-amber-700 leading-tight dark:text-amber-300">
                                  Avatar và username cố định là @
                                  {comment.username || "monback.app"}.
                                </p>
                              </div>

                              <AvatarImage
                                alt={`@${comment.username || "monback.app"}`}
                                assetPath={comment.avatar_asset_path}
                                className="size-7 shrink-0 ring-2 ring-amber-300 dark:ring-amber-500/50"
                                remoteUrl={comment.avatar_url}
                              />

                              <label
                                className="flex shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border border-amber-400/60 border-dashed bg-amber-50/60 px-2 py-1 font-medium text-[9px] text-amber-700 transition-colors hover:bg-amber-100/60 dark:border-amber-600/40 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/40"
                                title="Tải lên avatar mới cho bình luận mặc định (áp dụng cho tất cả bài viết)"
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
                                    if (!file) {
                                      return;
                                    }
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
              <div className="font-medium text-[11px] text-slate-500 leading-4 dark:text-slate-400">
                {saveMessage ||
                  "Lưu để cập nhật dữ liệu hiện tại trong hệ thống."}
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
