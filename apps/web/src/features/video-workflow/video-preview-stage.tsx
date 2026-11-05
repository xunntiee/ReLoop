import {
  Expand,
  Heart,
  MoreHorizontal,
  Pause,
  Play,
  Shrink,
  X,
} from "lucide-react";
import {
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SyntheticEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { formatStructuredPreviewText } from "@/lib/structured-preview-text";

/** Icon mũi tên share kiểu Threads/Twitter (outline). */
const ReplyThreadsIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    viewBox="0 0 24 24"
  >
    <path d="M20.656 17.008a9.993 9.993 0 1 0-3.59 3.615L22 22Z" />
  </svg>
);

const ShareArrowIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path
      clipRule="evenodd"
      d="M7.2474 1.49853C4.18324 -0.187039 0.600262 2.64309 1.53038 6.01431L3.18181 12L1.53038 17.9857C0.600277 21.3569 4.18324 24.1871 7.2474 22.5015L20.8245 15.0329C23.2153 13.7177 23.2153 10.2823 20.8244 8.96712L7.2474 1.49853ZM3.45835 5.48239C2.99873 3.81649 4.76927 2.41796 6.28345 3.25089L19.8605 10.7195C20.0016 10.7971 20.123 10.8923 20.2247 11H4.98064L3.45835 5.48239ZM4.98064 13L3.45835 18.5176C2.99873 20.1835 4.76927 21.5821 6.28345 20.7491L19.8605 13.2805C20.0016 13.2029 20.123 13.1078 20.2247 13H4.98064Z"
      fillRule="evenodd"
    />
  </svg>
);

const RepostThreadsIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path d="M4.51617 6.9986C6.13179 4.58593 8.88099 2.99979 11.9995 2.99979C15.7267 2.99979 18.9259 5.26459 20.2927 8.49676C20.5079 9.00543 21.0946 9.24341 21.6033 9.0283C22.1119 8.81318 22.3499 8.22644 22.1348 7.71777C20.466 3.7716 16.5582 0.999786 11.9995 0.999786C8.27776 0.999786 4.9897 2.84823 2.99988 5.67416V2.9986C2.99988 2.44631 2.55216 1.9986 1.9988 1.9986C1.44759 1.9986 0.999878 2.44631 0.999878 2.9986V7.9986C0.999878 8.55088 1.44759 8.9986 1.9988 8.9986H6.9988C7.55216 8.9986 7.99988 8.55088 7.99988 7.9986C7.99988 7.44631 7.55216 6.9986 6.9988 6.9986H4.51617Z" />
    <path d="M2.39572 14.9713C2.90439 14.7562 3.49113 14.9942 3.70625 15.5029C5.07309 18.735 8.27228 20.9998 11.9995 20.9998C15.118 20.9998 17.8672 19.4137 19.4828 17.001H16.9991C16.4468 17.001 15.9991 16.5533 15.9991 16.001C15.9991 15.4487 16.4468 15.001 16.9991 15.001H21.9991C22.5514 15.001 22.9991 15.4487 22.9991 16.001V21.001C22.9991 21.5533 22.5514 22.001 21.9991 22.001C21.4468 22.001 20.9991 21.5533 20.9991 21.001V18.3255C19.0093 21.1514 15.7212 22.9998 11.9995 22.9998C7.44077 22.9998 3.53298 20.228 1.86419 16.2818C1.64908 15.7732 1.88705 15.1864 2.39572 14.9713Z" />
  </svg>
);

import { Button } from "@/components/ui/button";
import { AvatarImage } from "@/features/output-preview/asset-status";
import type {
  CrawlComment,
  CrawlMediaAsset,
  CrawlPost,
  MemeTransitionConfig,
  VideoDraftDocument,
  VideoDraftScene,
  VideoPromotionSlot,
  VideoSpoilerRevealRegion,
  VideoThumbnailLayerId,
  VideoThumbnailLayerLayout,
  VideoThumbnailIntro,
} from "@/lib/api";
import { assetSources, formatNumber } from "@/lib/formatters";
import type { LocalVideoState } from "./selected-posts-panel";
import { splitSpoilerText } from "./spoiler-text";
import type { SelectedMemeEntry } from "./video-post-list-card-v2";

const VOICE_PLAYBACK_RATE = 1;
const DEFAULT_PREVIEW_NARRATION_GAIN = 1.9;
const DEFAULT_BACKGROUND_MUSIC_VOLUME = 0.24;
const DEFAULT_MEME_TRANSITION_MS = 1200;
const MIN_MEME_TRANSITION_MS = 1000;
const MAX_MEME_TRANSITION_MS = 2700;
const DEFAULT_COMMENT_PREVIEW_MEDIA_MAX_HEIGHT = 240;
const MAX_POST_PREVIEW_MEDIA_HEIGHT_RATIO = 1.09;
const ORIGINAL_IMAGE_ZOOM_DURATION_SECONDS = 2.5;
const ORIGINAL_IMAGE_ZOOM_MAX_SCALE = 1.045;
const DISPLAY_METRIC_MIN_BUMP = 100;
const DISPLAY_METRIC_MAX_BUMP = 200;
const DISPLAY_LIKE_MIN_BUMP = 103;
const DEFAULT_VIDEO_COMMENT_ID = "__default_monback_comment__";
const DEFAULT_POST_VIDEO_DURATION_MS = 5000;

function formatPreviewTimestamp(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

interface PreviewScene {
  comment?: CrawlComment;
  kind: "comment" | "post" | "post_video" | "promotion" | "thumbnail";
  promotion?: {
    slot: "midroll" | "outro";
    value: VideoPromotionSlot;
  };
  scene?: VideoDraftScene;
  text: string;
  thumbnailIntro?: VideoThumbnailIntro;
  timeline?: {
    end_ms: number;
    start_ms: number;
  };
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

export const VideoPreviewStage = ({
  draft,
  memeBySceneId,
  mode = "advanced",
  post,
  playPostVideoAfterCaption = false,
  thumbnailIntro,
  uploadedVideo,
  cardTheme,
}: {
  draft?: VideoDraftDocument | null;
  memeBySceneId?: Record<string, SelectedMemeEntry | null | undefined>;
  mode?: "automatic" | "advanced";
  post?: CrawlPost;
  playPostVideoAfterCaption?: boolean;
  thumbnailIntro?: VideoThumbnailIntro | null;
  uploadedVideo: LocalVideoState | null;
  cardTheme?: "light" | "dark";
}) => {
  const [sourceVideoDurationsMs, setSourceVideoDurationsMs] = useState<
    Record<string, number>
  >({});
  const handleSourceVideoDurationChange = useCallback(
    (mediaKey: string, durationSeconds: number) => {
      const durationMs = Math.round(durationSeconds * 1000);
      if (!mediaKey || !Number.isFinite(durationMs) || durationMs < 500) {
        return;
      }

      setSourceVideoDurationsMs((current) =>
        current[mediaKey] === durationMs
          ? current
          : { ...current, [mediaKey]: durationMs }
      );
    },
    []
  );
  const scenes = useMemo(
    () =>
      buildScenes(
        post,
        draft,
        thumbnailIntro,
        memeBySceneId,
        playPostVideoAfterCaption,
        sourceVideoDurationsMs
      ),
    [
      draft,
      memeBySceneId,
      playPostVideoAfterCaption,
      post,
      sourceVideoDurationsMs,
      thumbnailIntro,
    ]
  );
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [activeChunkIndex, setActiveChunkIndex] = useState(0);
  const [audioTimeSeconds, setAudioTimeSeconds] = useState(0);
  const [memeTimeSeconds, setMemeTimeSeconds] = useState(0);
  const memeTimeSecondsRef = useRef(0);
  const memeClockActiveRef = useRef(false);
  const [promotionTimeSeconds, setPromotionTimeSeconds] = useState(0);
  const [postVideoTimeSeconds, setPostVideoTimeSeconds] = useState(0);
  const [sceneMediaTimeSeconds, setSceneMediaTimeSeconds] = useState(0);
  const [sceneMediaSeekVersion, setSceneMediaSeekVersion] = useState(0);
  const [sceneHoldElapsedMs, setSceneHoldElapsedMs] = useState(0);
  const [scrubPercent, setScrubPercent] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [, setAudioBlocked] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMemeTransitionActive, setIsMemeTransitionActive] = useState(false);
  const [activeSceneMediaReadyKey, setActiveSceneMediaReadyKey] = useState("");
  const [memeVideoDurationMs, setMemeVideoDurationMs] = useState(0);
  const [memeSoundDurationMs, setMemeSoundDurationMs] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const backgroundAudioRef = useRef<HTMLAudioElement | null>(null);
  const memeAudioRef = useRef<HTMLMediaElement | null>(null);
  const memeVideoRef = useRef<HTMLVideoElement | null>(null);
  const promotionVideoRef = useRef<HTMLVideoElement | null>(null);
  const postVideoRef = useRef<HTMLVideoElement | null>(null);
  const expandedPromotionVideoRef = useRef<HTMLVideoElement | null>(null);
  const expandedVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewAudioContextRef = useRef<AudioContext | null>(null);
  const narrationSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const narrationSourceElementRef = useRef<HTMLAudioElement | null>(null);
  const narrationGainRef = useRef<GainNode | null>(null);
  const backgroundSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const backgroundSourceElementRef = useRef<HTMLAudioElement | null>(null);
  const backgroundGainRef = useRef<GainNode | null>(null);
  const audioGraphCleanupTimerRef = useRef<number | null>(null);
  const audioGraphMountedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sceneTransitionTimeoutRef = useRef<number | null>(null);
  const sceneHoldRef = useRef<{
    baseMs: number;
    durationMs: number;
    elapsedMs: number;
    sceneIndex: number;
  } | null>(null);
  const memeTransitionTimeoutRef = useRef<number | null>(null);
  const pendingSeekPercentRef = useRef<number | null>(null);
  const pendingPlaybackResumeRef = useRef<number | null>(null);
  const playbackIntentRef = useRef(false);
  const seekOperationIdRef = useRef(0);
  const isScrubbingRef = useRef(false);
  const scrubShouldResumeRef = useRef(false);
  const globalPointerReleaseRef = useRef<(() => void) | null>(null);
  const pendingAudioSeekTimeRef = useRef<number | null>(null);
  const suppressNextTimelineCommitRef = useRef(false);
  const completedMemeSceneIndexRef = useRef<number | null>(null);
  const isTrailingMemeActiveRef = useRef(false);
  const trailingMemeNextSceneIndexRef = useRef<number | null>(null);
  const activeMemePlaybackKeyRef = useRef<string | null>(null);
  memeTimeSecondsRef.current = memeTimeSeconds;
  const backgroundMusicUrl = draft?.background_music?.mediaUrl ?? "";
  const backgroundMusicVolume = normalizeBackgroundMusicVolume(
    draft?.background_music_volume
  );
  const narrationGainValue = normalizeNarrationGain(draft?.voice_volume);
  const currentPreviewScene = scenes[activeSceneIndex];
  const activeScene = scenes[activeSceneIndex];
  const activePostVideoDurationSeconds =
    activeScene?.kind === "post_video"
      ? resolvePreviewPostVideoPlaybackDurationMs(
          scenes,
          activeSceneIndex,
          post
        ) / 1000
      : undefined;
  const hidePostVideoDuringCaption = Boolean(
    playPostVideoAfterCaption &&
      activeScene &&
      isPreviewVideoAfterCaption(activeScene, scenes[activeSceneIndex + 1])
  );
  const activeSceneMedia =
    post && activeScene && activeScene.kind !== "thumbnail"
      ? pickScenePrimaryMedia(
          post,
          activeScene.comment,
          activeScene.scene,
          hidePostVideoDuringCaption
        )
      : null;
  const activeSceneMediaSourcesKey = activeSceneMedia?.sources.join("|") ?? "";
  const activeSceneMediaReadyToken = activeSceneMedia
    ? `${activeSceneMedia.key}|${activeSceneMediaSourcesKey}`
    : "";
  const sourceVideoPreloadItems = useMemo(() => {
    const sources = [
      ...(post ? [post] : []),
      ...(post?.top_comments ?? []),
    ].flatMap((source) =>
      source.media
        .filter(
          (media) =>
            media.type === "video" &&
            (Boolean(media.asset_path) || Boolean(media.remote_url))
        )
        .flatMap((media) => {
          const src = assetSources(media.asset_path, media.remote_url)[0];
          return src ? [{ key: getPreviewMediaKey(media), src }] : [];
        })
    );
    return Array.from(
      new Map(sources.map((source) => [source.key, source])).values()
    );
  }, [post]);
  const isActiveSceneMediaReady =
    activeSceneMedia?.type !== "image" ||
    activeSceneMediaReadyKey === activeSceneMediaReadyToken;
  const trailingMeme = getTrailingMemeTransition(
    scenes,
    activeSceneIndex,
    memeBySceneId,
    post
  );
  const currentMemeTransition =
    isTrailingMemeActiveRef.current && trailingMeme
      ? trailingMeme
      : getSceneMemeTransition(
          scenes,
          activeSceneIndex,
          memeBySceneId,
          draft,
          post,
          mode
        );
  const configuredMemeDurationMs = getPreviewMemeDurationMs(
    currentMemeTransition
  );
  const currentMemeVideoUrl =
    currentMemeTransition?.visualMode !== "sound_only" &&
    isVideoMemeAsset(currentMemeTransition?.image)
    ? resolveMemeAssetUrl(currentMemeTransition?.image)
    : "";
  const currentMemeSoundUrl = resolveMemeAssetUrl(currentMemeTransition?.audio);
  const configuredMemeVideoDurationMs =
    currentMemeTransition?.visualMode === "sound_only"
      ? 0
      : Number(currentMemeTransition?.image?.durationSeconds ?? 0) * 1000;
  const configuredMemeSoundDurationMs =
    Number(currentMemeTransition?.audio?.durationSeconds ?? 0) * 1000;
  const resolvedMemeVideoDurationMs = currentMemeVideoUrl
    ? Math.max(configuredMemeVideoDurationMs, memeVideoDurationMs)
    : 0;
  const resolvedMemeSoundDurationMs = currentMemeSoundUrl
    ? Math.max(configuredMemeSoundDurationMs, memeSoundDurationMs)
    : 0;
  const currentMemeSequenceDurationMs = currentMemeVideoUrl
    ? Math.max(
        MIN_MEME_TRANSITION_MS,
        Math.max(
          configuredMemeDurationMs,
          resolvedMemeVideoDurationMs > 0
            ? resolvedMemeVideoDurationMs + resolvedMemeSoundDurationMs
            : 0
        )
      )
    : configuredMemeDurationMs;
  const currentMemeDurationMs = currentMemeSequenceDurationMs;
  const currentMemePlaybackDurationMs =
    isTrailingMemeActiveRef.current &&
    currentPreviewScene &&
    currentMemeTransition?.visualMode !== "sound_only"
      ? getPreviewTrailingMemePlaybackDurationMs(
          currentPreviewScene,
          currentMemeDurationMs
        )
      : currentMemeDurationMs;
  const memePlaybackIdentity = getMemePlaybackIdentity(currentMemeTransition);
  const currentPreviewAudioUrl = getSceneAudioUrl(
    currentPreviewScene?.scene,
    activeChunkIndex
  );

  useEffect(() => {
    setMemeVideoDurationMs(0);
    setMemeSoundDurationMs(0);
  }, [memePlaybackIdentity]);

  const syncMemeSequenceTime = useCallback((targetSeconds: number) => {
    const video = memeVideoRef.current;
    const sound = memeAudioRef.current;
    const safeTargetSeconds = Math.max(0, targetSeconds);
    const videoDurationSeconds =
      resolvedMemeVideoDurationMs > 0
        ? resolvedMemeVideoDurationMs / 1000
        : video && Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : 0;
    const setMediaTime = (media: HTMLMediaElement | null, seconds: number) => {
      if (!media || !Number.isFinite(seconds)) return;
      try {
        media.currentTime = Math.max(0, seconds);
      } catch {
        // Metadata may not be ready yet; the loadedmetadata handler will retry.
      }
    };

    if (video && videoDurationSeconds > 0) {
      if (safeTargetSeconds < videoDurationSeconds - 0.03) {
        setMediaTime(video, safeTargetSeconds);
        setMediaTime(sound, 0);
      } else {
        setMediaTime(video, 0);
        setMediaTime(sound, safeTargetSeconds - videoDurationSeconds);
      }
      return;
    }

    setMediaTime(sound, safeTargetSeconds);
  }, [resolvedMemeVideoDurationMs]);

  const playMemeSequenceFrom = useCallback((targetSeconds: number) => {
    const video = memeVideoRef.current;
    const sound = memeAudioRef.current;
    const safeTargetSeconds = Math.max(0, targetSeconds);
    const videoDurationSeconds =
      resolvedMemeVideoDurationMs > 0
        ? resolvedMemeVideoDurationMs / 1000
        : video && Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : 0;

    if (video && videoDurationSeconds > 0) {
      if (safeTargetSeconds < videoDurationSeconds - 0.03) {
        sound?.pause();
        if (sound) {
          sound.currentTime = 0;
        }
        syncMemeSequenceTime(safeTargetSeconds);
        void video.play().catch(() => undefined);
        return;
      }

      video.pause();
      syncMemeSequenceTime(safeTargetSeconds);
      void sound?.play().catch(() => undefined);
      return;
    }

    if (sound) {
      syncMemeSequenceTime(safeTargetSeconds);
      void sound.play().catch(() => undefined);
    }
  }, [resolvedMemeVideoDurationMs, syncMemeSequenceTime]);

  const totalDurationMs = useMemo(
    () =>
      scenes.reduce(
        (max, scene) =>
          Math.max(max, getPreviewSceneTimeline(scene)?.end_ms ?? 0),
        0
      ),
    [scenes]
  );

  const startSceneHold = (durationMs: number, baseMs: number) => {
    if (durationMs <= 0) {
      sceneHoldRef.current = null;
      setSceneHoldElapsedMs(0);
      return;
    }

    sceneHoldRef.current = {
      baseMs,
      durationMs,
      elapsedMs: 0,
      sceneIndex: activeSceneIndex,
    };
    setSceneHoldElapsedMs(0);
  };

  const finishPromotionPreview = () => {
    const hadPlaybackIntent = playbackIntentRef.current;
    promotionVideoRef.current?.pause();
    if (!hadPlaybackIntent) {
      setIsPlaying(false);
      return;
    }
    setPromotionTimeSeconds(0);
    if (activeSceneIndex + 1 < scenes.length) {
      setActiveSceneIndex((current) => current + 1);
      return;
    }
    playbackIntentRef.current = false;
    setIsPlaying(false);
    setActiveSceneIndex(0);
  };

  const finishPostVideoPreview = () => {
    const hadPlaybackIntent = playbackIntentRef.current;
    postVideoRef.current?.pause();
    if (!hadPlaybackIntent) {
      setIsPlaying(false);
      return;
    }
    setPostVideoTimeSeconds(0);
    if (activeSceneIndex + 1 < scenes.length) {
      const currentEndMs =
        getPreviewSceneTimeline(scenes[activeSceneIndex])?.end_ms ?? 0;
      const nextStartMs =
        getPreviewSceneTimeline(scenes[activeSceneIndex + 1])?.start_ms ??
        currentEndMs;
      const transitionGapMs = Math.max(0, nextStartMs - currentEndMs);
      const moveToNextScene = () => {
        sceneTransitionTimeoutRef.current = null;
        if (!playbackIntentRef.current) {
          return;
        }
        setActiveSceneIndex((current) => current + 1);
      };
      if (transitionGapMs > 0) {
        startSceneHold(transitionGapMs, currentEndMs);
        sceneTransitionTimeoutRef.current = window.setTimeout(
          moveToNextScene,
          transitionGapMs
        );
      } else {
        moveToNextScene();
      }
      return;
    }
    playbackIntentRef.current = false;
    setIsPlaying(false);
    setActiveSceneIndex(0);
  };

  useEffect(() => {
    setActiveSceneIndex(0);
    setActiveChunkIndex(0);
    setIsPlaying(false);
    setAudioBlocked(false);
    setIsExpanded(false);
    setIsMemeTransitionActive(false);
    setMemeTimeSeconds(0);
    setPromotionTimeSeconds(0);
    setPostVideoTimeSeconds(0);
    setScrubPercent(null);
    playbackIntentRef.current = false;
    isTrailingMemeActiveRef.current = false;
    trailingMemeNextSceneIndexRef.current = null;
    activeMemePlaybackKeyRef.current = null;
    seekOperationIdRef.current += 1;
    isScrubbingRef.current = false;
    scrubShouldResumeRef.current = false;
    if (sceneTransitionTimeoutRef.current !== null) {
      window.clearTimeout(sceneTransitionTimeoutRef.current);
      sceneTransitionTimeoutRef.current = null;
    }
    if (memeTransitionTimeoutRef.current !== null) {
      window.clearTimeout(memeTransitionTimeoutRef.current);
      memeTransitionTimeoutRef.current = null;
    }
    if (pendingPlaybackResumeRef.current !== null) {
      window.clearTimeout(pendingPlaybackResumeRef.current);
      pendingPlaybackResumeRef.current = null;
    }
  }, [
    post?.post_id,
    draft?.draft_id,
    draft?.video_plan.voice_ready,
    draft?.promotion?.midroll?.enabled,
    draft?.promotion?.midroll?.video?.serverPath,
    draft?.promotion?.outro?.enabled,
    draft?.promotion?.outro?.video?.serverPath,
  ]);

  useEffect(() => {
    const media = activeSceneMedia;
    const readyToken = activeSceneMediaReadyToken;
    let cancelled = false;

    if (!media || media.type !== "image") {
      setActiveSceneMediaReadyKey(readyToken);
      return () => {
        cancelled = true;
      };
    }

    setActiveSceneMediaReadyKey("");

    const loadImage = (source: string) =>
      new Promise<boolean>((resolve) => {
        const image = new Image();
        let settled = false;
        const finish = (loaded: boolean) => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(loaded);
        };
        image.onload = () => finish(true);
        image.onerror = () => finish(false);
        image.referrerPolicy = "no-referrer";
        image.src = source;
        if (image.complete) {
          finish(image.naturalWidth > 0);
        }
      });

    void (async () => {
      for (const source of media.sources) {
        if (await loadImage(source)) {
          if (!cancelled) {
            setActiveSceneMediaReadyKey(readyToken);
          }
          return;
        }
      }

      // Do not block narration forever when every source is unavailable;
      // SceneMediaPreview will show a visible fallback instead of a white box.
      if (!cancelled) {
        setActiveSceneMediaReadyKey(readyToken);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeSceneMediaReadyToken,
    activeSceneMediaSourcesKey,
    activeSceneMedia?.type,
  ]);

  useEffect(() => {
    setSceneMediaTimeSeconds(0);
  }, [activeSceneIndex, activeSceneMedia?.key]);

  useEffect(() => {
    audioGraphMountedRef.current = true;
    if (audioGraphCleanupTimerRef.current !== null) {
      window.clearTimeout(audioGraphCleanupTimerRef.current);
      audioGraphCleanupTimerRef.current = null;
    }

    return () => {
      audioGraphMountedRef.current = false;
      audioGraphCleanupTimerRef.current = window.setTimeout(() => {
        if (audioGraphMountedRef.current) {
          return;
        }

        if (sceneTransitionTimeoutRef.current !== null) {
          window.clearTimeout(sceneTransitionTimeoutRef.current);
        }
        if (memeTransitionTimeoutRef.current !== null) {
          window.clearTimeout(memeTransitionTimeoutRef.current);
        }
        if (pendingPlaybackResumeRef.current !== null) {
          window.clearTimeout(pendingPlaybackResumeRef.current);
        }
        if (globalPointerReleaseRef.current) {
          window.removeEventListener(
            "pointerup",
            globalPointerReleaseRef.current
          );
          window.removeEventListener(
            "pointercancel",
            globalPointerReleaseRef.current
          );
          window.removeEventListener("blur", globalPointerReleaseRef.current);
        }
        narrationSourceRef.current?.disconnect();
        narrationGainRef.current?.disconnect();
        backgroundSourceRef.current?.disconnect();
        backgroundGainRef.current?.disconnect();
        narrationSourceRef.current = null;
        narrationSourceElementRef.current = null;
        narrationGainRef.current = null;
        backgroundSourceRef.current = null;
        backgroundSourceElementRef.current = null;
        backgroundGainRef.current = null;
        previewAudioContextRef.current?.close().catch(() => undefined);
        previewAudioContextRef.current = null;
        audioGraphCleanupTimerRef.current = null;
      }, 0);
    };
  }, []);

  useEffect(() => {
    const narrationAudio = audioRef.current;
    if (!narrationAudio || typeof window === "undefined") {
      return;
    }

    const audioContext =
      previewAudioContextRef.current ?? new window.AudioContext();
    previewAudioContextRef.current = audioContext;

    if (
      narrationSourceRef.current &&
      narrationGainRef.current &&
      narrationSourceElementRef.current === narrationAudio
    ) {
      narrationGainRef.current.gain.value = narrationGainValue;
      return;
    }

    narrationSourceRef.current?.disconnect();
    narrationGainRef.current?.disconnect();

    const narrationSource =
      audioContext.createMediaElementSource(narrationAudio);
    const narrationGain = audioContext.createGain();

    narrationGain.gain.value = narrationGainValue;

    narrationSource.connect(narrationGain);
    narrationGain.connect(audioContext.destination);

    narrationSourceRef.current = narrationSource;
    narrationSourceElementRef.current = narrationAudio;
    narrationGainRef.current = narrationGain;

    return undefined;
  }, [currentPreviewAudioUrl]);

  useEffect(() => {
    if (narrationGainRef.current) {
      narrationGainRef.current.gain.value = narrationGainValue;
    }
  }, [narrationGainValue]);

  useEffect(() => {
    const backgroundAudio = backgroundAudioRef.current;
    if (!backgroundAudio || typeof window === "undefined") {
      return;
    }

    const audioContext =
      previewAudioContextRef.current ?? new window.AudioContext();
    previewAudioContextRef.current = audioContext;

    if (
      backgroundSourceRef.current &&
      backgroundGainRef.current &&
      backgroundSourceElementRef.current === backgroundAudio
    ) {
      backgroundGainRef.current.gain.value = backgroundMusicVolume;
      return;
    }

    backgroundSourceRef.current?.disconnect();
    backgroundGainRef.current?.disconnect();

    const backgroundSource =
      audioContext.createMediaElementSource(backgroundAudio);
    const backgroundGain = audioContext.createGain();

    backgroundGain.gain.value = backgroundMusicVolume;
    backgroundSource.connect(backgroundGain);
    backgroundGain.connect(audioContext.destination);

    backgroundSourceRef.current = backgroundSource;
    backgroundSourceElementRef.current = backgroundAudio;
    backgroundGainRef.current = backgroundGain;

    return undefined;
  }, [backgroundMusicUrl]);

  useEffect(() => {
    if (backgroundGainRef.current) {
      backgroundGainRef.current.gain.value = backgroundMusicVolume;
    }
  }, [backgroundMusicVolume]);

  useEffect(() => {
    setActiveChunkIndex(0);
    setAudioTimeSeconds(0);
    setSceneHoldElapsedMs(0);
    sceneHoldRef.current = null;
    setMemeTimeSeconds(0);
    setPromotionTimeSeconds(0);
    setPostVideoTimeSeconds(0);
    if (completedMemeSceneIndexRef.current !== activeSceneIndex) {
      completedMemeSceneIndexRef.current = null;
    }
  }, [activeSceneIndex]);

  useEffect(() => {
    const hold = sceneHoldRef.current;
    if (!(hold && hold.sceneIndex === activeSceneIndex && isPlaying)) {
      return;
    }

    let lastFrameAt = performance.now();
    const updateSceneHoldClock = (now: number) => {
      const currentHold = sceneHoldRef.current;
      if (!currentHold || currentHold.sceneIndex !== activeSceneIndex) {
        return;
      }

      currentHold.elapsedMs = Math.min(
        currentHold.durationMs,
        currentHold.elapsedMs + Math.max(0, now - lastFrameAt)
      );
      lastFrameAt = now;
      setSceneHoldElapsedMs(currentHold.elapsedMs);
    };

    // A scene hold only drives a progress bar/transition. Updating it once per
    // animation frame needlessly re-renders the whole preview while media
    // elements already keep their own playback clock.
    const intervalId = window.setInterval(() => {
      updateSceneHoldClock(performance.now());
    }, 100);
    updateSceneHoldClock(performance.now());
    return () => {
      window.clearInterval(intervalId);
      const currentHold = sceneHoldRef.current;
      if (!currentHold || currentHold.sceneIndex !== activeSceneIndex) {
        return;
      }
      currentHold.elapsedMs = Math.min(
        currentHold.durationMs,
        currentHold.elapsedMs + Math.max(0, performance.now() - lastFrameAt)
      );
      setSceneHoldElapsedMs(currentHold.elapsedMs);
    };
  }, [activeSceneIndex, isPlaying]);

  useEffect(() => {
    if (memeTransitionTimeoutRef.current !== null) {
      window.clearTimeout(memeTransitionTimeoutRef.current);
      memeTransitionTimeoutRef.current = null;
    }

    if (isTrailingMemeActiveRef.current) {
      setIsMemeTransitionActive(true);
      return;
    }

    const hasMeme =
      (currentPreviewScene?.kind === "comment" ||
        currentPreviewScene?.kind === "post") &&
      !isTrailingMemePlacement(currentMemeTransition?.placement) &&
      hasPreviewMemePresentation(currentMemeTransition);
    const shouldShowMeme =
      hasMeme && completedMemeSceneIndexRef.current !== activeSceneIndex;
    setIsMemeTransitionActive(shouldShowMeme);
  }, [activeSceneIndex, currentMemeTransition, currentPreviewScene?.kind]);

  useEffect(() => {
    setAudioTimeSeconds(0);
  }, [activeChunkIndex, draft?.draft_id]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    const promotionVideo = promotionVideoRef.current;
    const postVideo = postVideoRef.current;

    if (isPlaying) {
      void resumePreviewAudioContext(previewAudioContextRef.current);
      if (currentPreviewScene?.kind === "promotion") {
        video?.pause();
        audio?.pause();
        backgroundAudioRef.current?.pause();
        postVideo?.pause();
        void promotionVideo?.play().catch(() => undefined);
        return;
      }
      if (currentPreviewScene?.kind === "post_video") {
        video?.pause();
        audio?.pause();
        backgroundAudioRef.current?.pause();
        promotionVideo?.pause();
        void postVideo?.play().catch(() => undefined);
        return;
      }
      postVideo?.pause();
      if (video && !video.ended) {
        void video.play().catch(() => undefined);
      }
      const backgroundAudio = backgroundAudioRef.current;
      if (backgroundAudio && backgroundMusicUrl) {
        void backgroundAudio.play().catch(() => undefined);
      }
      return;
    }

    video?.pause();
    audio?.pause();
    backgroundAudioRef.current?.pause();
    memeAudioRef.current?.pause();
    memeVideoRef.current?.pause();
    promotionVideo?.pause();
    postVideo?.pause();
  }, [
    backgroundMusicUrl,
    backgroundMusicVolume,
    currentPreviewScene?.kind,
    isPlaying,
  ]);

  useEffect(() => {
  const currentScene = scenes[activeSceneIndex];
    if (!(currentScene && isPlaying && playbackIntentRef.current)) {
      return;
    }

    if (currentScene.kind === "promotion") {
      setAudioBlocked(false);
      audioRef.current?.pause();
      backgroundAudioRef.current?.pause();
      const volume = Math.min(
        1,
        Math.max(0, Number(currentScene.promotion?.value.volume ?? 1))
      );
      const activePromotionVideo = promotionVideoRef.current;
      if (activePromotionVideo) {
        activePromotionVideo.volume = volume;
        void activePromotionVideo.play().catch(() => undefined);
      }
      return;
    }

    if (currentScene.kind === "post_video") {
      setAudioBlocked(false);
      audioRef.current?.pause();
      backgroundAudioRef.current?.pause();
      memeAudioRef.current?.pause();
      memeVideoRef.current?.pause();
      const activePostVideo = postVideoRef.current;
      if (activePostVideo) {
        activePostVideo.volume = 1;
        void activePostVideo.play().catch(() => undefined);
      }
      return;
    }

    if (currentScene.kind === "thumbnail") {
      const timeline = getPreviewSceneTimeline(currentScene);
      const durationMs = timeline
        ? Math.max(1, timeline.end_ms - timeline.start_ms)
        : 1;

      if (sceneTransitionTimeoutRef.current !== null) {
        window.clearTimeout(sceneTransitionTimeoutRef.current);
      }

      sceneTransitionTimeoutRef.current = window.setTimeout(() => {
        sceneTransitionTimeoutRef.current = null;
        if (!playbackIntentRef.current) {
          return;
        }

        if (activeSceneIndex + 1 < scenes.length) {
          setActiveChunkIndex(0);
          setActiveSceneIndex((current) => current + 1);
          return;
        }

        playbackIntentRef.current = false;
        setActiveChunkIndex(0);
        setIsPlaying(false);
        setActiveSceneIndex(0);
      }, durationMs);

      return () => {
        if (sceneTransitionTimeoutRef.current !== null) {
          window.clearTimeout(sceneTransitionTimeoutRef.current);
          sceneTransitionTimeoutRef.current = null;
        }
      };
    }

    const hasReadyAudio =
      currentScene.scene?.narration?.status === "ready" &&
      Boolean(getSceneAudioUrl(currentScene.scene, activeChunkIndex));
    if (
      (currentScene.kind === "comment" || currentScene.kind === "post") &&
      isMemeTransitionActive &&
      currentMemeTransition
    ) {
      activeMemePlaybackKeyRef.current = `${activeSceneIndex}:${isTrailingMemeActiveRef.current ? "trailing" : "lead"}:${memePlaybackIdentity}`;
      setAudioBlocked(false);
      if (memeVideoRef.current || memeAudioRef.current) {
        audioRef.current?.pause();
        audioRef.current && (audioRef.current.currentTime = 0);
        playMemeSequenceFrom(memeTimeSeconds);
      }
      memeTransitionTimeoutRef.current = window.setTimeout(
        () => {
          finishMemeTransition();
        },
        Math.max(
          0,
          currentMemePlaybackDurationMs - memeTimeSeconds * 1000
        )
      );
      return;
    }

    if (hasReadyAudio) {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }
      if (audio.readyState < 2) {
        return;
      }
      if (!audio.paused) {
        return;
      }
      audio.playbackRate = VOICE_PLAYBACK_RATE;
      setAudioBlocked(false);
      void audio
        .play()
        .then(() => setAudioBlocked(false))
        .catch((error) => {
          if (isIgnorableMediaPlaybackError(error)) {
            return;
          }
          setAudioBlocked(true);
        });
      return;
    }

    setAudioBlocked(false);
  }, [
    activeChunkIndex,
    activeSceneIndex,
    currentMemeDurationMs,
    currentMemePlaybackDurationMs,
    currentMemeTransition,
    activeSceneMedia?.type,
    isActiveSceneMediaReady,
    isMemeTransitionActive,
    isPlaying,
    memePlaybackIdentity,
    playMemeSequenceFrom,
    scenes,
    sceneMediaSeekVersion,
  ]);

  useEffect(() => {
    if (
      !isPlaying ||
      !playbackIntentRef.current ||
      !(activeScene?.kind === "comment" || activeScene?.kind === "post") ||
      !isMemeTransitionActive ||
      !currentMemeTransition
    ) {
      memeClockActiveRef.current = false;
      return;
    }

    memeClockActiveRef.current = true;
    const playbackKey = `${activeSceneIndex}:${isTrailingMemeActiveRef.current ? "trailing" : "lead"}:${memePlaybackIdentity}`;
    const startedAt = performance.now();
    const startingSeconds = Math.max(0, memeTimeSecondsRef.current);
    let clockSeconds = startingSeconds;
    let intervalId: number | null = null;

    const updateMemeClock = () => {
      if (
        !playbackIntentRef.current ||
        activeMemePlaybackKeyRef.current !== playbackKey
      ) {
        return;
      }

      const elapsedSeconds =
        startingSeconds + Math.max(0, performance.now() - startedAt) / 1000;
      const videoSeconds = memeVideoRef.current?.currentTime;
      const soundSeconds = memeAudioRef.current?.currentTime;
      const sequenceMediaSeconds =
        resolvedMemeVideoDurationMs > 0 &&
        Number.isFinite(videoSeconds) &&
        (memeVideoRef.current?.ended || Number(videoSeconds) >= resolvedMemeVideoDurationMs / 1000 - 0.03)
          ? resolvedMemeVideoDurationMs / 1000 +
            (Number.isFinite(soundSeconds) ? Math.max(0, soundSeconds ?? 0) : 0)
          : Number.isFinite(videoSeconds)
            ? Math.max(0, videoSeconds ?? 0)
            : Number.isFinite(soundSeconds)
              ? Math.max(0, soundSeconds ?? 0)
              : 0;
      const nextSeconds = Math.min(
        currentMemePlaybackDurationMs / 1000,
        Math.max(
          clockSeconds,
          elapsedSeconds,
          sequenceMediaSeconds
        )
      );
      clockSeconds = nextSeconds;
      memeTimeSecondsRef.current = nextSeconds;

      setMemeTimeSeconds((current) =>
        Math.abs(current - nextSeconds) > 0.03 ? nextSeconds : current
      );

      if (nextSeconds >= currentMemePlaybackDurationMs / 1000 - 0.02) {
        finishMemeTransition();
        return;
      }

    };

    // Meme transitions do not need a 60fps React state update. The media
    // element remains smooth; React only needs a small clock for overlay and
    // timeline state.
    updateMemeClock();
    intervalId = window.setInterval(updateMemeClock, 50);
    return () => {
      memeClockActiveRef.current = false;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [
    activeScene?.kind,
    activeSceneIndex,
    currentMemeDurationMs,
    currentMemePlaybackDurationMs,
    currentMemeTransition,
    isMemeTransitionActive,
    isPlaying,
    memePlaybackIdentity,
    resolvedMemeVideoDurationMs,
    sceneMediaSeekVersion,
  ]);

  if (!post) {
    return (
      <div className="flex min-h-[20rem] w-full items-center justify-center rounded-[1.5rem] border border-dashed bg-muted/20 px-4 text-center text-muted-foreground text-sm">
        Chọn một bài viết để xem preview video.
      </div>
    );
  }

  if (!activeScene) {
    return null;
  }
  const activeVisualScene = activeScene.scene?.dialogue_speaker
    ? ([...scenes.slice(0, activeSceneIndex)]
        .reverse()
        .find(
          (candidate) =>
            candidate.kind === "post" &&
            candidate.scene?.post_id === activeScene.scene?.post_id
        ) ?? activeScene)
    : activeScene;
  const isDialogueScene = Boolean(activeScene.scene?.dialogue_speaker);
  const hasVoiceAudio =
    activeScene.scene?.narration?.status === "ready" &&
    Boolean(getSceneAudioUrl(activeScene.scene, activeChunkIndex));
  const activeSceneAudioUrl = getSceneAudioUrl(
    activeScene.scene,
    activeChunkIndex
  );
  const activeSceneAudioKey = `${activeSceneIndex}:${activeChunkIndex}:${activeSceneAudioUrl ?? ""}`;
  const narrationAudioElement = audioRef.current;
  const narrationAudioSourceMatches =
    narrationAudioElement?.dataset.previewAudioKey === activeSceneAudioKey;
  const activeSceneChunkCount =
    activeScene.scene?.narration.chunks?.length ?? 0;
  const canPlayPreview =
    hasVoiceAudio ||
    Boolean(uploadedVideo?.previewUrl) ||
    activeSceneMedia?.type === "video" ||
    Boolean(activeScene.promotion?.value.video?.mediaUrl);
  const liveAudioTimeSeconds =
    !isMemeTransitionActive &&
    narrationAudioSourceMatches &&
    audioRef.current?.readyState !== undefined &&
    audioRef.current.readyState >= 1 &&
    Number.isFinite(audioRef.current.currentTime)
      ? audioRef.current.currentTime
      : audioTimeSeconds;
  const hasCompletedMemeLead =
    !isTrailingMemeActiveRef.current &&
    completedMemeSceneIndexRef.current === activeSceneIndex;
  const currentTimeMs = getPreviewCurrentTimeMs({
    activeChunkIndex,
    audioTimeSeconds: liveAudioTimeSeconds,
    currentMemeLeadMs:
      currentMemeTransition && hasCompletedMemeLead
        ? currentMemeDurationMs
        : 0,
    currentPreviewScene: activeScene,
    isMemeTransitionActive,
    isTrailingMemeActive: isTrailingMemeActiveRef.current,
    memeTimeSeconds,
    postVideoTimeSeconds,
    promotionTimeSeconds,
    sceneHoldBaseMs:
      sceneHoldRef.current?.sceneIndex === activeSceneIndex
        ? sceneHoldRef.current.baseMs
        : null,
    sceneHoldElapsedMs:
      sceneHoldRef.current?.sceneIndex === activeSceneIndex
        ? sceneHoldElapsedMs
        : 0,
  });
  const progressPercent =
    totalDurationMs > 0
      ? Math.min(100, Math.max(0, (currentTimeMs / totalDurationMs) * 100))
      : 0;
  const timelinePercent = scrubPercent ?? progressPercent;
  const timelineTimeMs =
    scrubPercent !== null && totalDurationMs > 0
      ? (timelinePercent / 100) * totalDurationMs
      : currentTimeMs;
  const activeSceneElapsedSeconds = currentPreviewScene?.scene
    ? Math.max(
        0,
        (timelineTimeMs -
          (getPreviewSceneTimeline(currentPreviewScene)?.start_ms ?? 0)) /
          1000
      )
    : 0;
  const activeNarrationElapsedSeconds = getPreviewNarrationElapsedSeconds(
    activeScene?.scene,
    activeChunkIndex,
    audioTimeSeconds
  );
  const activeSceneKey = isDialogueScene
    ? (activeVisualScene.scene?.scene_id ??
      `dialogue-${activeScene.scene?.post_id ?? post.post_id}`)
    : (activeVisualScene.scene?.scene_id ??
      `${activeVisualScene.kind}-${activeVisualScene.comment?.comment_id ?? post.post_id}`);
  const threadPageSceneIds = activeScene.scene?.thread_page?.member_scene_ids ?? [];
  const threadPageScenes =
    threadPageSceneIds.length > 1
      ? threadPageSceneIds
          .map((sceneId) =>
            scenes.find((candidate) => candidate.scene?.scene_id === sceneId)
          )
          .filter((candidate): candidate is PreviewScene => Boolean(candidate))
      : [];
  const sceneCardKey =
    threadPageScenes.length > 1
      ? `thread-page-${threadPageSceneIds.join("-")}`
      : activeSceneKey;
  const sceneCardClass =
    activeVisualScene.kind === "comment"
      ? threadPageScenes.length > 1
        ? "w-[83.3333%]"
        : "w-[83.3333%] animate-in fade-in slide-in-from-bottom-16 duration-500 ease-out"
      : activeVisualScene.kind === "thumbnail"
        ? "absolute inset-0 h-full w-full"
        : "w-[83.3333%] animate-in fade-in zoom-in-95 duration-300 ease-out";
  const sceneContentClass =
    activeVisualScene.kind === "thumbnail"
      ? "absolute inset-0 flex flex-col justify-center"
      : "absolute inset-x-0 inset-y-0 flex flex-col justify-center";
  const sceneContentStyle =
    activeVisualScene.kind === "thumbnail"
      ? undefined
      : { paddingBottom: "10%" };
  const isTrailingMemePreview = Boolean(
    (activeScene.kind === "post" || activeScene.kind === "comment") &&
      isMemeTransitionActive &&
      isTrailingMemeActiveRef.current &&
      currentMemeTransition &&
      currentMemeTransition.placement !== "transition"
  );
  const isMediaRevealPreview = Boolean(
    isTrailingMemePreview &&
      currentMemeTransition?.placement === "media_reveal" &&
      activeSceneMedia
  );

  const finishMemeTransition = () => {
    if (!playbackIntentRef.current) {
      return;
    }
    const playbackKey = `${activeSceneIndex}:${isTrailingMemeActiveRef.current ? "trailing" : "lead"}:${memePlaybackIdentity}`;
    if (activeMemePlaybackKeyRef.current !== playbackKey) {
      return;
    }
    activeMemePlaybackKeyRef.current = null;

    if (memeTransitionTimeoutRef.current !== null) {
      window.clearTimeout(memeTransitionTimeoutRef.current);
      memeTransitionTimeoutRef.current = null;
    }

    const wasTrailingMeme = isTrailingMemeActiveRef.current;
    if (!wasTrailingMeme) {
      completedMemeSceneIndexRef.current = activeSceneIndex;
    }
    memeAudioRef.current?.pause();
    if (memeAudioRef.current) {
      memeAudioRef.current.currentTime = 0;
    }
    memeVideoRef.current?.pause();
    if (memeVideoRef.current) {
      memeVideoRef.current.currentTime = 0;
    }
    setMemeTimeSeconds(0);
    setAudioTimeSeconds(0);
    setIsMemeTransitionActive(false);

    if (!playbackIntentRef.current) {
      return;
    }

    if (wasTrailingMeme) {
      const nextSceneIndex = trailingMemeNextSceneIndexRef.current;
      trailingMemeNextSceneIndexRef.current = null;
      isTrailingMemeActiveRef.current = false;
      if (nextSceneIndex !== null && nextSceneIndex < scenes.length) {
        const currentEndMs =
          getPreviewSceneTimeline(scenes[activeSceneIndex])?.end_ms ?? 0;
        const nextStartMs =
          getPreviewSceneTimeline(scenes[nextSceneIndex])?.start_ms ??
          currentEndMs;
        const transitionGapMs =
          currentMemeTransition?.visualMode === "sound_only"
            ? 0
            : Math.max(0, nextStartMs - currentEndMs);
        const moveToNextScene = () => {
          sceneTransitionTimeoutRef.current = null;
          if (!playbackIntentRef.current) {
            return;
          }
          setActiveChunkIndex(0);
          setActiveSceneIndex(nextSceneIndex);
        };
        if (transitionGapMs > 0) {
          startSceneHold(transitionGapMs, currentEndMs);
          sceneTransitionTimeoutRef.current = window.setTimeout(
            moveToNextScene,
            transitionGapMs
          );
        } else {
          moveToNextScene();
        }
        return;
      }
      playbackIntentRef.current = false;
      setIsPlaying(false);
      setActiveChunkIndex(0);
      setActiveSceneIndex(0);
      return;
    }

    pendingPlaybackResumeRef.current = window.setTimeout(() => {
      pendingPlaybackResumeRef.current = null;
      if (!playbackIntentRef.current) {
        return;
      }
      void tryPlayPreviewNarration({
        audioRef,
        previewAudioContextRef,
        setAudioBlocked,
      });
    }, 0);
  };

  const resetPreviewPlaybackToStart = () => {
    seekOperationIdRef.current += 1;
    if (pendingPlaybackResumeRef.current !== null) {
      window.clearTimeout(pendingPlaybackResumeRef.current);
      pendingPlaybackResumeRef.current = null;
    }
    if (sceneTransitionTimeoutRef.current !== null) {
      window.clearTimeout(sceneTransitionTimeoutRef.current);
      sceneTransitionTimeoutRef.current = null;
    }
    if (memeTransitionTimeoutRef.current !== null) {
      window.clearTimeout(memeTransitionTimeoutRef.current);
      memeTransitionTimeoutRef.current = null;
    }

    const resetMedia = (media: HTMLMediaElement | null) => {
      if (!media) {
        return;
      }
      media.pause();
      try {
        media.currentTime = 0;
      } catch {
        // The media element may not have metadata yet.
      }
    };

    resetMedia(audioRef.current);
    resetMedia(backgroundAudioRef.current);
    resetMedia(memeAudioRef.current);
    resetMedia(memeVideoRef.current);
    resetMedia(videoRef.current);
    resetMedia(promotionVideoRef.current);
    resetMedia(postVideoRef.current);

    const firstSceneMeme = getSceneMemeTransition(
      scenes,
      0,
      memeBySceneId,
      draft,
      post,
      mode
    );
    const shouldStartWithMeme = Boolean(
      (scenes[0]?.kind === "comment" || scenes[0]?.kind === "post") &&
        !isTrailingMemePlacement(firstSceneMeme?.placement) &&
        hasPreviewMemePresentation(firstSceneMeme)
    );

    playbackIntentRef.current = true;
    activeMemePlaybackKeyRef.current = null;
    completedMemeSceneIndexRef.current = null;
    isTrailingMemeActiveRef.current = false;
    trailingMemeNextSceneIndexRef.current = null;
    sceneHoldRef.current = null;
    memeTimeSecondsRef.current = 0;
    setActiveSceneIndex(0);
    setActiveChunkIndex(0);
    setAudioTimeSeconds(0);
    setMemeTimeSeconds(0);
    setPromotionTimeSeconds(0);
    setPostVideoTimeSeconds(0);
    setSceneHoldElapsedMs(0);
    setSceneMediaTimeSeconds(0);
    setSceneMediaSeekVersion((current) => current + 1);
    setScrubPercent(null);
    setIsMemeTransitionActive(shouldStartWithMeme);
  };

  const startPlayback = async () => {
    const shouldRestartFromEnd =
      totalDurationMs > 0 && currentTimeMs >= totalDurationMs - 80;
    if (shouldRestartFromEnd) {
      resetPreviewPlaybackToStart();
      setAudioBlocked(false);
      setIsPlaying(true);
      return;
    }

    playbackIntentRef.current = true;
    if (
      sceneHoldRef.current &&
      (sceneHoldRef.current.sceneIndex !== activeSceneIndex ||
        sceneHoldRef.current.elapsedMs >= sceneHoldRef.current.durationMs)
    ) {
      sceneHoldRef.current = null;
      setSceneHoldElapsedMs(0);
    }
    try {
      await resumePreviewAudioContext(previewAudioContextRef.current);
      if (activeScene.kind === "promotion") {
        setAudioBlocked(false);
        setIsPlaying(true);
        await promotionVideoRef.current?.play().catch(() => undefined);
        return;
      }
      if (activeScene.kind === "post_video") {
        setAudioBlocked(false);
        setIsPlaying(true);
        await postVideoRef.current?.play().catch(() => undefined);
        return;
      }
      const backgroundAudio = backgroundAudioRef.current;
      if (backgroundAudio && backgroundMusicUrl) {
        if (backgroundAudio.ended) {
          backgroundAudio.currentTime = 0;
        }
        await backgroundAudio.play().catch(() => undefined);
      }
      setAudioBlocked(false);
      setIsPlaying(true);
      if (videoRef.current && !videoRef.current.ended) {
        await videoRef.current.play().catch(() => undefined);
      }
      if (!hasVoiceAudio) {
        return;
      }

      if (activeSceneMedia?.type === "image" && !isActiveSceneMediaReady) {
        return;
      }

      const audio = audioRef.current;
      if (!audio) {
        setAudioBlocked(true);
        return;
      }
      audio.playbackRate = VOICE_PLAYBACK_RATE;
      if (audio.ended) {
        audio.currentTime = 0;
      }
      if (
        !(
          (activeScene.kind === "comment" || activeScene.kind === "post") &&
          isMemeTransitionActive &&
          currentMemeTransition
        )
      ) {
        await audio.play();
      }
      setAudioBlocked(false);
    } catch (error) {
      if (isIgnorableMediaPlaybackError(error)) {
        return;
      }
      setAudioBlocked(true);
    }
  };

  const togglePlayback = () => {
    if (isPlaying) {
      playbackIntentRef.current = false;
      pausePreviewPlaybackImmediately();
      return;
    }

    void startPlayback();
  };

  const pausePreviewPlaybackImmediately = () => {
    seekOperationIdRef.current += 1;
    if (pendingPlaybackResumeRef.current !== null) {
      window.clearTimeout(pendingPlaybackResumeRef.current);
      pendingPlaybackResumeRef.current = null;
    }
    if (sceneTransitionTimeoutRef.current !== null) {
      window.clearTimeout(sceneTransitionTimeoutRef.current);
      sceneTransitionTimeoutRef.current = null;
    }
    if (memeTransitionTimeoutRef.current !== null) {
      window.clearTimeout(memeTransitionTimeoutRef.current);
      memeTransitionTimeoutRef.current = null;
    }
    setIsPlaying(false);
    setAudioBlocked(false);
    audioRef.current?.pause();
    backgroundAudioRef.current?.pause();
    memeAudioRef.current?.pause();
    memeVideoRef.current?.pause();
    videoRef.current?.pause();
    promotionVideoRef.current?.pause();
    postVideoRef.current?.pause();
  };

  const pausePreviewForScrubbing = () => {
    seekOperationIdRef.current += 1;
    if (pendingPlaybackResumeRef.current !== null) {
      window.clearTimeout(pendingPlaybackResumeRef.current);
      pendingPlaybackResumeRef.current = null;
    }
    if (sceneTransitionTimeoutRef.current !== null) {
      window.clearTimeout(sceneTransitionTimeoutRef.current);
      sceneTransitionTimeoutRef.current = null;
    }
    if (memeTransitionTimeoutRef.current !== null) {
      window.clearTimeout(memeTransitionTimeoutRef.current);
      memeTransitionTimeoutRef.current = null;
    }
    isTrailingMemeActiveRef.current = false;
    trailingMemeNextSceneIndexRef.current = null;
    setIsPlaying(false);
    setAudioBlocked(false);
    audioRef.current?.pause();
    backgroundAudioRef.current?.pause();
    memeAudioRef.current?.pause();
    memeVideoRef.current?.pause();
    videoRef.current?.pause();
    promotionVideoRef.current?.pause();
    postVideoRef.current?.pause();
  };

  const syncFiniteMediaTime = (
    media: HTMLMediaElement | null,
    targetSeconds: number
  ) => {
    if (!(media && Number.isFinite(targetSeconds))) {
      return;
    }

    const duration = media.duration;
    const resolvedSeconds =
      Number.isFinite(duration) && duration > 0
        ? Math.min(Math.max(0, targetSeconds), duration)
        : Math.max(0, targetSeconds);

    try {
      if (Math.abs(media.currentTime - resolvedSeconds) > 0.05) {
        media.currentTime = resolvedSeconds;
      }
    } catch {
      return;
    }
  };

  const syncLoopingMediaTime = (
    media: HTMLMediaElement | null,
    targetSeconds: number
  ) => {
    if (!(media && Number.isFinite(targetSeconds))) {
      return;
    }

    const duration = media.duration;
    const resolvedSeconds =
      Number.isFinite(duration) && duration > 0
        ? ((targetSeconds % duration) + duration) % duration
        : Math.max(0, targetSeconds);

    try {
      if (Math.abs(media.currentTime - resolvedSeconds) > 0.05) {
        media.currentTime = resolvedSeconds;
      }
    } catch {
      return;
    }
  };

  const resumePreviewPlaybackAfterSeek = ({
    hasNarration,
    shouldPlayMeme,
  }: {
    hasNarration: boolean;
    shouldPlayMeme: boolean;
  }) => {
    if (!playbackIntentRef.current) {
      return;
    }

    setIsPlaying(true);
    void resumePreviewAudioContext(previewAudioContextRef.current);
    if (activeScene?.kind === "post_video") {
      videoRef.current?.pause();
      backgroundAudioRef.current?.pause();
      void postVideoRef.current?.play().catch(() => undefined);
      return;
    }
    void videoRef.current?.play().catch(() => undefined);

    const backgroundAudio = backgroundAudioRef.current;
    if (backgroundAudio && backgroundMusicUrl) {
      void backgroundAudio.play().catch(() => undefined);
    }

    if (shouldPlayMeme && (memeVideoRef.current || memeAudioRef.current)) {
      playMemeSequenceFrom(memeTimeSecondsRef.current);
      return;
    }

    if (!hasNarration) {
      return;
    }

    if (activeSceneMedia?.type === "image" && !isActiveSceneMediaReady) {
      return;
    }

    const audio = audioRef.current;
    if (audio && audio.readyState >= 2) {
      void tryPlayPreviewNarration({
        audioRef,
        previewAudioContextRef,
        setAudioBlocked,
      });
    }
  };

  const seekToPercent = (nextPercent: number, updateAudioElement = false) => {
    if (!totalDurationMs || scenes.length === 0) {
      return;
    }

    const normalizedPercent = Math.min(100, Math.max(0, nextPercent));
    sceneHoldRef.current = null;
    setSceneHoldElapsedMs(0);
    const targetMs = (normalizedPercent / 100) * totalDurationMs;
    const targetSeconds = targetMs / 1000;
    syncFiniteMediaTime(videoRef.current, targetSeconds);
    syncLoopingMediaTime(backgroundAudioRef.current, targetSeconds);
    const resolvedSceneIndex = resolvePreviewSceneIndexAtTime(scenes, targetMs);
    const targetScene = scenes[resolvedSceneIndex];
    const targetSceneData = targetScene?.scene;

    if (!targetScene) {
      return;
    }

    const requestSceneMediaSeek = (seconds: number) => {
      setSceneMediaTimeSeconds(Math.max(0, seconds));
      setSceneMediaSeekVersion((current) => current + 1);
    };

    const operationId = seekOperationIdRef.current + 1;
    const shouldResume = playbackIntentRef.current;

    seekOperationIdRef.current = operationId;
    const sceneStartMs = getPreviewSceneTimeline(targetScene)?.start_ms ?? 0;
    const sceneOffsetMs = Math.max(0, targetMs - sceneStartMs);
    if (targetScene.kind === "promotion") {
      requestSceneMediaSeek(0);
      setActiveSceneIndex(resolvedSceneIndex);
      setActiveChunkIndex(0);
      setAudioTimeSeconds(0);
      setMemeTimeSeconds(0);
      setPromotionTimeSeconds(sceneOffsetMs / 1000);
      setIsMemeTransitionActive(false);
      pendingPlaybackResumeRef.current = window.setTimeout(() => {
        pendingPlaybackResumeRef.current = null;
        const video = promotionVideoRef.current;
        if (video) {
          try {
            video.currentTime = sceneOffsetMs / 1000;
          } catch {
            // The browser can reject a seek before metadata is ready.
          }
        }
        if (shouldResume && playbackIntentRef.current) {
          void promotionVideoRef.current?.play().catch(() => undefined);
        }
      }, 0);
      return;
    }

    if (targetScene.kind === "post_video") {
      requestSceneMediaSeek(sceneOffsetMs / 1000);
      setActiveSceneIndex(resolvedSceneIndex);
      setActiveChunkIndex(0);
      setAudioTimeSeconds(0);
      setMemeTimeSeconds(0);
      setPostVideoTimeSeconds(sceneOffsetMs / 1000);
      setIsMemeTransitionActive(false);
      pendingPlaybackResumeRef.current = window.setTimeout(() => {
        pendingPlaybackResumeRef.current = null;
        if (seekOperationIdRef.current !== operationId) {
          return;
        }
        const video = postVideoRef.current;
        if (video) {
          try {
            video.currentTime = sceneOffsetMs / 1000;
          } catch {
            // The browser can reject a seek before metadata is ready.
          }
        }
        if (shouldResume && playbackIntentRef.current) {
          void postVideoRef.current?.play().catch(() => undefined);
        }
      }, 0);
      return;
    }

    if (targetScene.kind === "thumbnail") {
      requestSceneMediaSeek(0);
      setActiveSceneIndex(resolvedSceneIndex);
      setActiveChunkIndex(0);
      setAudioTimeSeconds(0);
      setMemeTimeSeconds(0);
      setIsMemeTransitionActive(false);
      if (updateAudioElement && shouldResume) {
        pendingPlaybackResumeRef.current = window.setTimeout(() => {
          pendingPlaybackResumeRef.current = null;
          if (seekOperationIdRef.current !== operationId) {
            return;
          }
          resumePreviewPlaybackAfterSeek({
            hasNarration: false,
            shouldPlayMeme: false,
          });
        }, 0);
      }
      return;
    }

    if (!targetSceneData) {
      return;
    }
    const targetMemeTransition = getSceneMemeTransition(
      scenes,
      resolvedSceneIndex,
      memeBySceneId,
      draft,
      post,
      mode
    );
    const targetTrailingMeme = getTrailingMemeTransition(
      scenes,
      resolvedSceneIndex,
      memeBySceneId,
      post
    );
    const targetTrailingDurationMs = getPreviewMemeDurationMs(
      targetTrailingMeme
    );
    const targetTimeline = getPreviewSceneTimeline(targetScene);
    const targetSceneDurationMs = targetTimeline
      ? Math.max(0, targetTimeline.end_ms - targetTimeline.start_ms)
      : 0;
    const trailingMemeStartMs = targetTrailingMeme && targetTimeline
      ? Math.max(
          0,
          getPreviewTrailingMemeStartMs(
            targetScene,
            targetTimeline,
            targetTrailingDurationMs
          ) - targetTimeline.start_ms
        )
      : Math.max(0, targetSceneDurationMs - targetTrailingDurationMs);
    const shouldPlayTrailingMeme =
      (targetScene.kind === "post" || targetScene.kind === "comment") &&
      targetTrailingDurationMs > 0 &&
      sceneOffsetMs >= trailingMemeStartMs;

    if (shouldPlayTrailingMeme) {
      requestSceneMediaSeek(sceneOffsetMs / 1000);
      isTrailingMemeActiveRef.current = true;
      trailingMemeNextSceneIndexRef.current =
        resolvedSceneIndex + 1 < scenes.length
          ? resolvedSceneIndex + 1
          : null;
      setActiveSceneIndex(resolvedSceneIndex);
      setActiveChunkIndex(0);
      setAudioTimeSeconds(0);
      setMemeTimeSeconds((sceneOffsetMs - trailingMemeStartMs) / 1000);
      setIsMemeTransitionActive(true);

      if (updateAudioElement) {
        pendingPlaybackResumeRef.current = window.setTimeout(() => {
          pendingPlaybackResumeRef.current = null;
          if (seekOperationIdRef.current !== operationId) {
            return;
          }
          syncMemeSequenceTime(
            (sceneOffsetMs - trailingMemeStartMs) / 1000
          );
          if (shouldResume && playbackIntentRef.current) {
            resumePreviewPlaybackAfterSeek({
              hasNarration: false,
              shouldPlayMeme: true,
            });
          }
        }, 0);
      }
      return;
    }

    isTrailingMemeActiveRef.current = false;
    trailingMemeNextSceneIndexRef.current = null;
    const targetMemeDurationMs = getPreviewMemeDurationMs(
      targetMemeTransition
    );
    const memeLeadMs =
      targetScene.kind === "comment" && targetMemeTransition
        ? targetMemeDurationMs
        : 0;

    const shouldPlayMeme =
      targetScene.kind === "comment" &&
      memeLeadMs > 0 &&
      sceneOffsetMs < memeLeadMs;

    if (shouldPlayMeme) {
      requestSceneMediaSeek(0);
      setActiveSceneIndex(resolvedSceneIndex);
      setActiveChunkIndex(0);
      setAudioTimeSeconds(0);
      setMemeTimeSeconds(sceneOffsetMs / 1000);
      setIsMemeTransitionActive(true);

      if (updateAudioElement) {
        pendingPlaybackResumeRef.current = window.setTimeout(() => {
          pendingPlaybackResumeRef.current = null;
          if (seekOperationIdRef.current !== operationId) {
            return;
          }
          syncMemeSequenceTime(sceneOffsetMs / 1000);
          if (shouldResume && playbackIntentRef.current) {
            resumePreviewPlaybackAfterSeek({
              hasNarration: false,
              shouldPlayMeme: true,
            });
          }
        }, 0);
      }
      return;
    }

    const narrationOffsetMs = Math.max(0, sceneOffsetMs - memeLeadMs);
    requestSceneMediaSeek(narrationOffsetMs / 1000);
    const chunkPosition = resolveChunkPosition(
      targetSceneData,
      narrationOffsetMs
    );
    const hasNarration =
      targetSceneData.narration?.status === "ready" &&
      Boolean(getSceneAudioUrl(targetSceneData, chunkPosition.chunkIndex));

    setActiveSceneIndex(resolvedSceneIndex);
    setActiveChunkIndex(chunkPosition.chunkIndex);
    setAudioTimeSeconds(chunkPosition.chunkTimeSeconds);
    setMemeTimeSeconds(0);
    setIsMemeTransitionActive(false);

    if (updateAudioElement) {
      pendingAudioSeekTimeRef.current = chunkPosition.chunkTimeSeconds;
      pendingPlaybackResumeRef.current = window.setTimeout(() => {
        pendingPlaybackResumeRef.current = null;
        if (seekOperationIdRef.current !== operationId) {
          return;
        }
        if (audioRef.current && audioRef.current.readyState >= 1) {
          try {
            audioRef.current.currentTime = chunkPosition.chunkTimeSeconds;
            pendingAudioSeekTimeRef.current = null;
          } catch (e) {
            console.warn("Failed to set audio.currentTime immediately:", e);
          }
        }
        if (shouldResume && playbackIntentRef.current) {
          resumePreviewPlaybackAfterSeek({
            hasNarration,
            shouldPlayMeme: false,
          });
        }
      }, 0);
    }
  };

  const startScrubbing = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (isScrubbingRef.current) {
      return;
    }
    isScrubbingRef.current = true;
    const hasActivePreviewPlayback = Boolean(
      playbackIntentRef.current ||
        isPlaying ||
        (audioRef.current && !audioRef.current.paused) ||
        (memeAudioRef.current && !memeAudioRef.current.paused) ||
        (videoRef.current && !videoRef.current.paused)
    );
    scrubShouldResumeRef.current = hasActivePreviewPlayback;
    playbackIntentRef.current = false;
    pausePreviewForScrubbing();
    updateScrubbing(resolveTimelinePercentFromPointer(event));

    const handleGlobalPointerRelease = () => {
      finishScrubbing();
    };

    globalPointerReleaseRef.current = handleGlobalPointerRelease;
    window.addEventListener("pointerup", handleGlobalPointerRelease);
    window.addEventListener("pointercancel", handleGlobalPointerRelease);
    window.addEventListener("blur", handleGlobalPointerRelease);
  };

  const updateScrubbing = (nextPercent: number) => {
    const normalizedPercent = Math.min(100, Math.max(0, nextPercent));
    pendingSeekPercentRef.current = normalizedPercent;
    setScrubPercent(normalizedPercent);
    seekToPercent(normalizedPercent, false);
  };

  const resolveTimelinePercentFromPointer = (
    event: ReactPointerEvent<HTMLInputElement>
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return Number(event.currentTarget.value);
    }

    const ratio = (event.clientX - rect.left) / rect.width;
    return Math.min(100, Math.max(0, ratio * 100));
  };

  const commitSeekFromPercent = (targetPercent: number) => {
    const wasPlaying = Boolean(
      scrubShouldResumeRef.current ||
        playbackIntentRef.current ||
        isPlaying ||
        (audioRef.current && !audioRef.current.paused) ||
        (memeAudioRef.current && !memeAudioRef.current.paused) ||
        (videoRef.current && !videoRef.current.paused)
    );

    playbackIntentRef.current = wasPlaying;
    scrubShouldResumeRef.current = false;
    seekToPercent(targetPercent, true);
  };

  const finishScrubbing = (explicitPercent?: number) => {
    if (globalPointerReleaseRef.current) {
      window.removeEventListener("pointerup", globalPointerReleaseRef.current);
      window.removeEventListener(
        "pointercancel",
        globalPointerReleaseRef.current
      );
      window.removeEventListener("blur", globalPointerReleaseRef.current);
      globalPointerReleaseRef.current = null;
    }

    const targetPercent =
      explicitPercent ??
      pendingSeekPercentRef.current ??
      scrubPercent ??
      progressPercent;
    pendingSeekPercentRef.current = null;
    setScrubPercent(null);

    if (!isScrubbingRef.current) {
      commitSeekFromPercent(targetPercent);
      return;
    }

    isScrubbingRef.current = false;
    suppressNextTimelineCommitRef.current = true;
    commitSeekFromPercent(targetPercent);
  };

  const handleTimelineCommit = (nextPercent: number) => {
    const normalizedPercent = Math.min(100, Math.max(0, nextPercent));

    if (isScrubbingRef.current) {
      return;
    }

    if (suppressNextTimelineCommitRef.current) {
      suppressNextTimelineCommitRef.current = false;
      return;
    }

    pendingSeekPercentRef.current = normalizedPercent;
    commitSeekFromPercent(normalizedPercent);
  };

  const openExpanded = () => setIsExpanded(true);
  const closeExpanded = () => setIsExpanded(false);

  // Core video frame content (reused in both normal and expanded views)
  const videoFrameContent = (
    <>
      {sourceVideoPreloadItems.map((source) => (
        <video
          aria-hidden="true"
          className="pointer-events-none absolute h-px w-px opacity-0"
          key={source.key}
          muted
          onDurationChange={(event) =>
            handleSourceVideoDurationChange(
              source.key,
              event.currentTarget.duration
            )
          }
          playsInline
          preload="metadata"
          src={source.src}
        />
      ))}
      {uploadedVideo ? (
        <video
          className="absolute inset-0 h-full w-full object-cover"
          muted
          playsInline
          preload="metadata"
          ref={videoRef}
          src={uploadedVideo.previewUrl}
        />
      ) : (
        <PreviewBackdrop />
      )}

      {activeScene.kind === "promotion" &&
      activeScene.promotion?.value.video?.mediaUrl ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center px-3 py-4 sm:px-5 sm:py-6">
          <div className="relative h-[84%] w-[78%] overflow-hidden rounded-[1.5rem] bg-black shadow-[0_24px_60px_rgba(0,0,0,0.65)]">
            <video
              className={`absolute inset-0 h-full w-full ${
                activeScene.promotion.value.fitMode === "contain"
                  ? "object-contain"
                  : "object-cover"
              }`}
              key={`${activeSceneKey}-promotion`}
              muted={false}
              onCanPlay={(event) => {
                event.currentTarget.muted = false;
                if (playbackIntentRef.current) {
                  void event.currentTarget.play().catch(() => undefined);
                }
              }}
              onEnded={finishPromotionPreview}
              onLoadedMetadata={(event) => {
                event.currentTarget.volume = Math.min(
                  1,
                  Math.max(0, Number(activeScene.promotion?.value.volume ?? 1))
                );
                if (promotionTimeSeconds > 0) {
                  event.currentTarget.currentTime = promotionTimeSeconds;
                }
              }}
              onTimeUpdate={(event) => {
                setPromotionTimeSeconds(event.currentTarget.currentTime);
              }}
              playsInline
              preload="auto"
              ref={promotionVideoRef}
              src={activeScene.promotion.value.video.mediaUrl}
            />
          </div>
        </div>
      ) : null}

      {activeScene.kind === "promotion" ? null : (
        <>
          <div className="absolute inset-0 bg-gradient-to-b from-black/16 via-black/10 to-black/38" />
          <div className={sceneContentClass} style={sceneContentStyle}>
            <MemeTransitionOverlay
              identity={memePlaybackIdentity}
              isPlaying={isPlaying}
              meme={currentMemeTransition}
              visible={isMemeTransitionActive}
              trailing={isTrailingMemePreview}
            />
            {isMediaRevealPreview ? (
              <MediaRevealOverlay
                durationMs={currentMemePlaybackDurationMs}
                elapsedSeconds={memeTimeSeconds}
                identity={memePlaybackIdentity}
                media={activeSceneMedia!}
              />
            ) : null}
            {!isMemeTransitionActive ||
            (isTrailingMemePreview && !isMediaRevealPreview) ? (
              <div className={`mx-auto ${sceneCardClass}`} key={sceneCardKey}>
                {activeScene.kind === "post_video" ? (
                  <ThreadsCard
                    audioTimeSeconds={0}
                    darkTheme={cardTheme === "dark"}
                    isMediaClockSource
                    isPlaying={isPlaying}
                    mediaSeekVersion={sceneMediaSeekVersion}
                    mediaTimeSeconds={postVideoTimeSeconds}
                    mediaPlaybackDurationSeconds={activePostVideoDurationSeconds}
                    onMediaTimeUpdate={setPostVideoTimeSeconds}
                    onPostVideoDurationChange={handleSourceVideoDurationChange}
                    onPostVideoEnded={finishPostVideoPreview}
                    playPostVideoWithAudio
                    comment={activeScene.comment}
                    post={post!}
                    postVideoRef={postVideoRef}
                    scene={activeScene.scene}
                    textOverride={activeScene.comment?.text ?? post?.text}
                  />
                ) : activeVisualScene.kind === "thumbnail" &&
                activeVisualScene.thumbnailIntro ? (
                  <ThumbnailPreviewSceneCard
                    config={activeVisualScene.thumbnailIntro}
                    mode={mode}
                  />
                ) : isDialogueScene ? (
                  <ThreadsCard
                    audioTimeSeconds={audioTimeSeconds}
                    narrationElapsedSeconds={activeNarrationElapsedSeconds}
                    sceneElapsedSeconds={activeSceneElapsedSeconds}
                    darkTheme={cardTheme === "dark"}
                    isMediaClockSource
                    isPlaying={isPlaying}
                    mediaSeekVersion={sceneMediaSeekVersion}
                    mediaTimeSeconds={sceneMediaTimeSeconds}
                    onMediaTimeUpdate={setSceneMediaTimeSeconds}
                    post={post}
                    scene={activeScene.scene}
                    hidePostVideoDuringCaption={hidePostVideoDuringCaption}
                  />
                ) : activeVisualScene.kind === "post" ? (
                  <ThreadsCard
                    audioTimeSeconds={audioTimeSeconds}
                    narrationElapsedSeconds={activeNarrationElapsedSeconds}
                    sceneElapsedSeconds={activeSceneElapsedSeconds}
                    darkTheme={cardTheme === "dark"}
                    isMediaClockSource
                    isPlaying={isPlaying}
                    mediaSeekVersion={sceneMediaSeekVersion}
                    mediaTimeSeconds={sceneMediaTimeSeconds}
                    onMediaTimeUpdate={setSceneMediaTimeSeconds}
                    post={post}
                    scene={activeVisualScene.scene}
                    textOverride={activeVisualScene.text}
                    hidePostVideoDuringCaption={hidePostVideoDuringCaption}
                  />
                ) : threadPageScenes.length > 1 ? (
                  <ThreadPage
                    activeSceneId={activeScene.scene?.scene_id ?? ""}
                    darkTheme={cardTheme === "dark"}
                    post={post}
                    scenes={threadPageScenes}
                  />
                ) : activeVisualScene.comment ? (
                  <ThreadsCard
                    audioTimeSeconds={audioTimeSeconds}
                    narrationElapsedSeconds={activeNarrationElapsedSeconds}
                    sceneElapsedSeconds={activeSceneElapsedSeconds}
                    comment={activeVisualScene.comment}
                    darkTheme={cardTheme === "dark"}
                    isMediaClockSource
                    isPlaying={isPlaying}
                    mediaSeekVersion={sceneMediaSeekVersion}
                    mediaTimeSeconds={sceneMediaTimeSeconds}
                    onMediaTimeUpdate={setSceneMediaTimeSeconds}
                    post={post}
                    scene={activeVisualScene.scene}
                    textOverride={activeVisualScene.text}
                    hidePostVideoDuringCaption={hidePostVideoDuringCaption}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      )}

      <div className="absolute inset-x-0 bottom-0 z-30">
        <div className="bg-black/58 text-white backdrop-blur-md">
          <div className="flex items-center justify-between px-2.5 pt-1 font-medium text-[0.65rem] text-white/80 tabular-nums">
            <span aria-live="polite">
              {formatPreviewTimestamp(timelineTimeMs)}
            </span>
            <span>{formatPreviewTimestamp(totalDurationMs)}</span>
          </div>
          <div className="px-2.5 pt-0.5">
            <input
              aria-label="Timeline preview"
              className="h-[0.8rem] w-full cursor-pointer accent-white"
              disabled={totalDurationMs <= 0}
              max={100}
              min={0}
              onChange={(event) => {
                handleTimelineCommit(Number(event.currentTarget.value));
              }}
              onInput={(event) => {
                if (isScrubbingRef.current) {
                  updateScrubbing(Number(event.currentTarget.value));
                } else {
                  handleTimelineCommit(Number(event.currentTarget.value));
                }
              }}
              onPointerDown={startScrubbing}
              step={0.1}
              type="range"
              value={timelinePercent}
            />
          </div>
          <div className="flex h-6 items-center justify-between px-2.5 pb-0.5">
            <Button
              className="size-5 shrink-0 rounded-none bg-transparent p-0 text-white hover:bg-white/10"
              disabled={!canPlayPreview}
              onClick={togglePlayback}
              size="icon"
              type="button"
              variant="ghost"
            >
              {isPlaying ? (
                <Pause className="h-3 w-3" />
              ) : (
                <Play className="h-3 w-3" />
              )}
            </Button>

            <Button
              className="size-5 shrink-0 rounded-none bg-transparent p-0 text-white hover:bg-white/10"
              onClick={isExpanded ? closeExpanded : openExpanded}
              size="icon"
              type="button"
              variant="ghost"
            >
              {isExpanded ? (
                <Shrink className="h-3 w-3" />
              ) : (
                <Expand className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div
        className={
          isExpanded
            ? "fixed inset-0 z-[9999] flex items-center justify-center bg-black/82"
            : "flex h-full min-h-0 w-full items-center justify-center"
        }
        onClick={isExpanded ? closeExpanded : undefined}
      >
        <div
          className={
            isExpanded
              ? "contents"
              : "flex h-full min-h-0 w-full max-w-[22rem] items-center justify-center p-1.5"
          }
        >
          <div
            className={
              isExpanded
                ? "relative overflow-hidden bg-black shadow-[0_32px_80px_rgba(0,0,0,0.7)]"
                : "relative mx-auto aspect-[9/16] h-full max-h-full w-auto max-w-full overflow-hidden rounded-[1.5rem]"
            }
            onClick={
              isExpanded ? (event) => event.stopPropagation() : undefined
            }
            style={
              isExpanded
                ? {
                    aspectRatio: "9/16",
                    height: "min(96dvh, calc(54vw * 16 / 9))",
                    width: "auto",
                    maxWidth: "calc(96dvh * 9 / 16)",
                  }
                : undefined
            }
          >
            {videoFrameContent}

            {isExpanded ? (
              <button
                aria-label="Đóng preview phóng to"
                className="absolute top-5 right-5 z-40 flex size-9 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors hover:bg-black/55"
                onClick={closeExpanded}
                title="Đóng"
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            ) : null}

            {activeSceneAudioUrl &&
            activeScene.scene?.narration.status === "ready" ? (
              <audio
                className="hidden"
                data-preview-audio-key={activeSceneAudioKey}
                key={activeSceneAudioKey}
                onCanPlay={() => {
                  if (
                    playbackIntentRef.current &&
                    !isMemeTransitionActive &&
                    activeScene.scene?.narration.status === "ready" &&
                    isActiveSceneMediaReady
                  ) {
                    void tryPlayPreviewNarration({
                      audioRef,
                      previewAudioContextRef,
                      setAudioBlocked,
                    });
                  }
                }}
                onEnded={() =>
                  advanceAudio({
                    activeChunkIndex,
                    activeSceneIndex,
                    chunkCount: activeSceneChunkCount,
                    hasNextScene: activeSceneIndex + 1 < scenes.length,
                    currentScene: activeScene.scene,
                    currentSceneMemeLeadMs:
                      currentMemeTransition &&
                      (activeScene.kind === "comment" ||
                        activeScene.kind === "post")
                        ? currentMemeDurationMs
                        : 0,
                    nextScene: scenes[activeSceneIndex + 1]?.scene,
                    playbackIntentRef,
                    setAudioTimeSeconds,
                    setActiveChunkIndex,
                    setActiveSceneIndex,
                    setIsPlaying,
                    onSceneHoldStart: startSceneHold,
                    sceneTransitionTimeoutRef,
                    trailingMemeTransition: getTrailingMemeTransition(
                      scenes,
                      activeSceneIndex,
                      memeBySceneId,
                      post
                    ),
                    setIsMemeTransitionActive,
                    isTrailingMemeActiveRef,
                    trailingMemeNextSceneIndexRef,
                  })
                }
                onLoadedMetadata={(event) => {
                  event.currentTarget.playbackRate = VOICE_PLAYBACK_RATE;
                  if (pendingAudioSeekTimeRef.current === null) {
                    setAudioTimeSeconds(0);
                  } else {
                    try {
                      event.currentTarget.currentTime =
                        pendingAudioSeekTimeRef.current;
                    } catch (e) {
                      console.warn(
                        "Failed to set currentTime inside onLoadedMetadata:",
                        e
                      );
                    }
                    setAudioTimeSeconds(pendingAudioSeekTimeRef.current);
                    pendingAudioSeekTimeRef.current = null;
                  }
                  if (
                    playbackIntentRef.current &&
                    !isMemeTransitionActive &&
                    isActiveSceneMediaReady
                  ) {
                    void tryPlayPreviewNarration({
                      audioRef,
                      previewAudioContextRef,
                      setAudioBlocked,
                    });
                  }
                }}
                onTimeUpdate={(event) => {
                  setAudioTimeSeconds(event.currentTarget.currentTime);
                }}
                preload="auto"
                ref={audioRef}
                src={activeSceneAudioUrl}
              />
            ) : null}
            {backgroundMusicUrl ? (
              <audio
                className="hidden"
                key={backgroundMusicUrl}
                loop
                preload="auto"
                ref={backgroundAudioRef}
                src={backgroundMusicUrl}
              />
            ) : null}
            {currentMemeVideoUrl ? (
              <video
                aria-hidden="true"
                className="hidden"
                key={`${activeSceneKey}-${memePlaybackIdentity}-meme-video`}
                playsInline
                preload="auto"
                onLoadedMetadata={(event) => {
                  const duration = Number(event.currentTarget.duration);
                  if (Number.isFinite(duration) && duration > 0) {
                    setMemeVideoDurationMs(duration * 1000);
                  }
                }}
                onEnded={() => {
                  if (!playbackIntentRef.current || !isPlaying) return;
                  const sound = memeAudioRef.current;
                  if (!sound || !currentMemeSoundUrl) return;
                  sound.currentTime = 0;
                  void sound.play().catch(() => undefined);
                }}
                ref={memeVideoRef}
                src={currentMemeVideoUrl}
              />
            ) : null}
            {currentMemeSoundUrl ? (
              <audio
                className="hidden"
                key={`${activeSceneKey}-${memePlaybackIdentity}-meme-audio`}
                onLoadedMetadata={(event) => {
                  const duration = Number(event.currentTarget.duration);
                if (Number.isFinite(duration) && duration > 0) {
                    setMemeSoundDurationMs(duration * 1000);
                  }
                }}
                onEnded={() => {
                  if (
                    !playbackIntentRef.current ||
                    !isPlaying ||
                    currentMemeTransition?.visualMode !== "sound_only"
                  ) {
                    return;
                  }
                  finishMemeTransition();
                }}
                preload="auto"
                ref={memeAudioRef}
                src={currentMemeSoundUrl}
              />
            ) : null}
          </div>
        </div>
        {isExpanded ? (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-4 py-1.5 text-white/70 text-xs backdrop-blur-sm">
            Nhấn bên ngoài hoặc <span className="font-semibold text-white">×</span> để đóng
          </div>
        ) : null}
      </div>

      {/* Legacy portal retained as a disabled compatibility block. */}
      {false && isExpanded &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            onClick={closeExpanded}
            style={{
              background: "rgba(0,0,0,0.82)",
              backdropFilter: "blur(8px)",
            }}
          >
            {/* Close button */}
            <button
              className="absolute top-5 right-5 z-10 flex size-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
              onClick={closeExpanded}
              title="Đóng"
              type="button"
            >
              <X className="h-5 w-5" />
            </button>

            {/* 9:16 video frame - tỉ lệ khớp với video xuất (1080×1920) */}
            <div
              className="relative overflow-hidden bg-black shadow-[0_32px_80px_rgba(0,0,0,0.7)]"
              onClick={(e) => e.stopPropagation()}
              style={{
                aspectRatio: "9/16",
                height: "min(96dvh, calc(54vw * 16 / 9))",
                width: "auto",
                maxWidth: "calc(96dvh * 9 / 16)",
              }}
            >
              {uploadedVideo ? (
                <video
                  className="absolute inset-0 h-full w-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                  ref={expandedVideoRef}
                  src={uploadedVideo?.previewUrl ?? ""}
                />
              ) : (
                <PreviewBackdrop />
              )}

              {activeScene.kind === "promotion" &&
              activeScene.promotion?.value.video?.mediaUrl ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center px-4 py-5 sm:px-6 sm:py-8">
                  <div className="relative h-[84%] w-[78%] overflow-hidden rounded-[1.5rem] bg-black shadow-[0_24px_60px_rgba(0,0,0,0.65)]">
                    <video
                      className={`absolute inset-0 h-full w-full ${
                        activeScene.promotion?.value.fitMode === "contain"
                          ? "object-contain"
                          : "object-cover"
                      }`}
                      key={`${activeSceneKey}-promotion-expanded`}
                      muted={!isExpanded}
                      onCanPlay={(event) => {
                        event.currentTarget.muted = !isExpanded;
                        if (playbackIntentRef.current && isExpanded) {
                          void event.currentTarget
                            .play()
                            .catch(() => undefined);
                        }
                      }}
                      onEnded={finishPromotionPreview}
                      onLoadedMetadata={(event) => {
                        event.currentTarget.volume = Math.min(
                          1,
                          Math.max(
                            0,
                            Number(activeScene.promotion?.value.volume ?? 1)
                          )
                        );
                        if (promotionTimeSeconds > 0) {
                          event.currentTarget.currentTime =
                            promotionTimeSeconds;
                        }
                      }}
                      onTimeUpdate={(event) => {
                        setPromotionTimeSeconds(
                          event.currentTarget.currentTime
                        );
                      }}
                      playsInline
                      preload="auto"
                      ref={expandedPromotionVideoRef}
                      src={activeScene.promotion?.value.video?.mediaUrl ?? ""}
                    />
                  </div>
                </div>
              ) : null}
              {activeScene.kind === "promotion" ? null : (
                <div className="absolute inset-0 bg-gradient-to-b from-black/16 via-black/10 to-black/38" />
              )}

              {/* Card preview canh giữa để khớp video export thực tế. */}
              {activeScene.kind === "promotion" ? null : (
                <div className={sceneContentClass} style={sceneContentStyle}>
                    <MemeTransitionOverlay
                      identity={memePlaybackIdentity}
                      isPlaying={isPlaying}
                      meme={currentMemeTransition}
                      visible={isMemeTransitionActive}
                      trailing={isTrailingMemePreview}
                  />
                  {!isMemeTransitionActive || isTrailingMemePreview ? (
                    <div className={`mx-auto ${sceneCardClass}`} key={sceneCardKey}>
                      {activeVisualScene.kind === "thumbnail" &&
                      activeVisualScene.thumbnailIntro ? (
                        <ThumbnailPreviewSceneCard
                          config={activeVisualScene.thumbnailIntro!}
                          mode={mode}
                        />
                      ) : isDialogueScene ? (
                        <ThreadsCard
                          audioTimeSeconds={audioTimeSeconds}
                          narrationElapsedSeconds={activeNarrationElapsedSeconds}
                          sceneElapsedSeconds={activeSceneElapsedSeconds}
                          darkTheme={cardTheme === "dark"}
                          mediaSeekVersion={sceneMediaSeekVersion}
                          mediaTimeSeconds={sceneMediaTimeSeconds}
                          isPlaying={isPlaying}
                          onMediaTimeUpdate={setSceneMediaTimeSeconds}
                          post={post!}
                          scene={activeScene.scene}
                        />
                      ) : activeVisualScene.kind === "post" ? (
                        <ThreadsCard
                          audioTimeSeconds={audioTimeSeconds}
                          narrationElapsedSeconds={activeNarrationElapsedSeconds}
                          sceneElapsedSeconds={activeSceneElapsedSeconds}
                          darkTheme={cardTheme === "dark"}
                          mediaSeekVersion={sceneMediaSeekVersion}
                          mediaTimeSeconds={sceneMediaTimeSeconds}
                          isPlaying={isPlaying}
                          onMediaTimeUpdate={setSceneMediaTimeSeconds}
                          post={post!}
                          scene={activeVisualScene.scene}
                          textOverride={activeVisualScene.text}
                        />
                      ) : activeScene.kind === "post_video" ? (
                        <ThreadsCard
                          audioTimeSeconds={0}
                          darkTheme={cardTheme === "dark"}
                          isMediaClockSource
                          isPlaying={isPlaying}
                          mediaPlaybackDurationSeconds={activePostVideoDurationSeconds}
                          mediaSeekVersion={sceneMediaSeekVersion}
                          mediaTimeSeconds={postVideoTimeSeconds}
                          onMediaTimeUpdate={setPostVideoTimeSeconds}
                          onPostVideoDurationChange={handleSourceVideoDurationChange}
                          onPostVideoEnded={finishPostVideoPreview}
                          playPostVideoWithAudio
                          comment={activeScene.comment}
                          post={post!}
                          postVideoRef={postVideoRef}
                          scene={activeScene.scene}
                          textOverride={activeScene.comment?.text ?? post?.text}
                        />
                      ) : threadPageScenes.length > 1 ? (
                        <ThreadPage
                          activeSceneId={activeScene.scene?.scene_id ?? ""}
                          darkTheme={cardTheme === "dark"}
                          post={post!}
                          scenes={threadPageScenes}
                        />
                      ) : activeVisualScene.comment ? (
                        <ThreadsCard
                          audioTimeSeconds={audioTimeSeconds}
                          narrationElapsedSeconds={activeNarrationElapsedSeconds}
                          sceneElapsedSeconds={activeSceneElapsedSeconds}
                          comment={activeVisualScene.comment}
                          darkTheme={cardTheme === "dark"}
                          mediaSeekVersion={sceneMediaSeekVersion}
                          mediaTimeSeconds={sceneMediaTimeSeconds}
                          isPlaying={isPlaying}
                          onMediaTimeUpdate={setSceneMediaTimeSeconds}
                          post={post!}
                          scene={activeVisualScene.scene}
                          textOverride={activeVisualScene.text}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Player bar */}
              <div className="absolute inset-x-0 bottom-0 z-30">
                <div className="bg-black/58 text-white backdrop-blur-md">
                  <div className="flex items-center justify-between px-3.5 pt-1 font-medium text-[0.7rem] text-white/80 tabular-nums">
                    <span aria-live="polite">
                      {formatPreviewTimestamp(timelineTimeMs)}
                    </span>
                    <span>{formatPreviewTimestamp(totalDurationMs)}</span>
                  </div>
                  <div className="px-3.5 pt-1">
                    <input
                      aria-label="Timeline preview expanded"
                      className="h-[0.9rem] w-full cursor-pointer accent-white"
                      disabled={totalDurationMs <= 0}
                      max={100}
                      min={0}
                      onChange={(event) => {
                        handleTimelineCommit(Number(event.currentTarget.value));
                      }}
                      onInput={(event) => {
                        if (isScrubbingRef.current) {
                          updateScrubbing(Number(event.currentTarget.value));
                        } else {
                          handleTimelineCommit(
                            Number(event.currentTarget.value)
                          );
                        }
                      }}
                      onPointerDown={startScrubbing}
                      step={0.1}
                      type="range"
                      value={timelinePercent}
                    />
                  </div>
                  <div className="flex h-8 items-center justify-between px-3.5 pb-0.5">
                    <Button
                      className="size-6 shrink-0 rounded-none bg-transparent p-0 text-white hover:bg-white/10"
                      disabled={!canPlayPreview}
                      onClick={togglePlayback}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      {isPlaying ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      className="size-6 shrink-0 rounded-none bg-transparent p-0 text-white hover:bg-white/10"
                      onClick={closeExpanded}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Shrink className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Label */}
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-4 py-1.5 text-white/70 text-xs backdrop-blur-sm">
              Nhấn bên ngoài hoặc{" "}
              <span className="font-semibold text-white">✕</span> để đóng
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

const ThreadPage = ({
  activeSceneId,
  darkTheme,
  post,
  scenes,
}: {
  activeSceneId: string;
  darkTheme?: boolean;
  post: CrawlPost;
  scenes: PreviewScene[];
}) => {
  const activeSceneIndex = scenes.findIndex(
    (item) => item.scene?.scene_id === activeSceneId
  );
  const visibleScenes = scenes.slice(
    0,
    Math.max(0, activeSceneIndex) + 1
  );

  return (
    <div className="grid gap-3 py-3">
      {visibleScenes.map((item) => {
        const comment = item.comment;
        const username = comment?.username || post.username;
        const relativeTime = formatRelativeTime(
          resolveSceneCreatedAt(comment?.created_at, post.created_at)
        );
        const metrics = buildDisplayMetrics(
          comment?.comment_id ?? item.scene?.scene_id ?? username,
          {
            likes: comment?.like_count ?? 0,
            replies: comment?.reply_count ?? 0,
            reposts: comment?.repost_count ?? 0,
            shares: comment?.share_count ?? 0,
          }
        );
        return (
          <article
            className={`relative mx-auto w-[89%] rounded-[0.8rem] px-3 py-3 shadow-[0_10px_22px_rgba(0,0,0,0.18)] ${
              darkTheme ? "bg-slate-950/96 text-white" : "bg-white/96 text-slate-800"
            }`}
            key={item.scene?.scene_id ?? item.comment?.comment_id}
          >
            <div className="flex min-w-0 items-center gap-2">
              <AvatarImage
                alt={`@${username}`}
                assetPath={comment?.avatar_asset_path}
                className={`size-6 ${
                  darkTheme ? "ring-1 ring-white/10" : "ring-1 ring-slate-900/5"
                }`}
                remoteUrl={comment?.avatar_url}
              />
              <p className="min-w-0 truncate text-[0.68rem] font-semibold">
                @{username}
                {relativeTime ? (
                  <span
                    className={`ml-1.5 font-normal ${
                      darkTheme ? "text-white/48" : "text-slate-400"
                    }`}
                  >
                    {relativeTime}
                  </span>
                ) : null}
              </p>
              <MoreHorizontal
                className={`ml-auto h-3.5 w-3.5 shrink-0 ${
                  darkTheme ? "text-white/38" : "text-slate-300"
                }`}
              />
            </div>
            <p
              className={`mt-2 whitespace-pre-wrap text-[0.68rem] leading-[1.38] ${
                darkTheme ? "text-white/90" : "text-slate-800"
              }`}
            >
              {formatStructuredPreviewText(item.text || comment?.text || "")}
            </p>
            <div
              className={`mt-2 flex items-center gap-2 text-[0.58rem] ${
                darkTheme ? "text-white/68" : "text-slate-500"
              }`}
            >
              <span className="flex items-center gap-1">
                <Heart className="h-3 w-3" />
                {formatNumber(comment?.video_like_count ?? metrics.likes)}
              </span>
              <span className="flex items-center gap-1">
                <ReplyThreadsIcon className="h-3 w-3" />
                {formatNumber(comment?.video_reply_count ?? metrics.replies)}
              </span>
              <span className="flex items-center gap-1">
                <RepostThreadsIcon className="h-3 w-3" />
                {formatNumber(metrics.reposts)}
              </span>
              <span className="flex items-center gap-1">
                <ShareArrowIcon className="h-3 w-3" />
                {formatNumber(comment?.video_share_count ?? metrics.shares)}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
};

const ThreadsCard = ({
  comment,
  post,
  darkTheme,
  isMediaClockSource = false,
  isPlaying,
  hidePostVideoDuringCaption = false,
  mediaSeekVersion = 0,
  mediaTimeSeconds = 0,
  mediaPlaybackDurationSeconds,
  onMediaTimeUpdate,
  onPostVideoDurationChange,
  onPostVideoEnded,
  playPostVideoWithAudio = false,
  postVideoRef,
  textOverride,
  scene,
  audioTimeSeconds = 0,
  narrationElapsedSeconds = audioTimeSeconds,
  sceneElapsedSeconds = 0,
}: {
  comment?: CrawlComment;
  post: CrawlPost;
  darkTheme?: boolean;
  hidePostVideoDuringCaption?: boolean;
  isMediaClockSource?: boolean;
  isPlaying: boolean;
  mediaSeekVersion?: number;
  mediaTimeSeconds?: number;
  mediaPlaybackDurationSeconds?: number;
  onMediaTimeUpdate?: (seconds: number) => void;
  onPostVideoDurationChange?: (mediaKey: string, durationSeconds: number) => void;
  onPostVideoEnded?: () => void;
  playPostVideoWithAudio?: boolean;
  postVideoRef?: MutableRefObject<HTMLVideoElement | null>;
  textOverride?: string;
  scene?: VideoDraftScene;
  audioTimeSeconds?: number;
  narrationElapsedSeconds?: number;
  sceneElapsedSeconds?: number;
}) => {
  const username = comment?.username ?? post.username;
  const displayName = comment?.display_name || post.display_name || "Threads";
  const avatarAssetPath = comment?.avatar_asset_path ?? post.avatar_asset_path;
  const avatarUrl = comment?.avatar_url ?? post.avatar_url;

  const isDialogueScene = Boolean(scene?.dialogue_speaker);
  const isSpoiler =
    !(comment || isDialogueScene) && Boolean(post.is_spoiler ?? scene?.spoiler);
  const spoilerStyle =
    post.spoiler_style ?? scene?.spoiler?.spoiler_style ?? "blur";

  const rawRevealRegions =
    scene?.spoiler?.reveal_regions?.length
      ? scene.spoiler.reveal_regions
      : post.spoiler_reveal_regions ?? [];
  const hasImageOcrReveal = Boolean(
    rawRevealRegions.length > 0 &&
      post.media?.some((item) => item.type === "image")
  );
  const hasMediaSpoiler =
    Boolean(post.spoiler_media ?? scene?.spoiler?.has_media_spoiler) ||
    hasImageOcrReveal;
  const revealMediaOnly =
    Boolean(post.spoiler_reveal_media_only ?? scene?.spoiler?.reveal_media_only) ||
    hasImageOcrReveal;
  const sourceInitialText =
    post.spoiler_initial_text ?? scene?.spoiler?.text_initial ?? post.text;

  const sourceRevealText = revealMediaOnly
    ? ""
    : post.spoiler_reveal_text ??
      (scene?.spoiler
        ? scene.spoiler.text_full
            .slice((scene.spoiler.text_initial || "").length)
            .trim()
        : "");
  const autoSplitSpoiler =
    isSpoiler &&
    !revealMediaOnly &&
    !sourceRevealText.trim() &&
    (!sourceInitialText.trim() || sourceInitialText.trim() === post.text.trim())
      ? splitSpoilerText(post.text)
      : null;
  const initialText = autoSplitSpoiler?.initial ?? sourceInitialText;
  const revealText = autoSplitSpoiler?.reveal ?? sourceRevealText;

  const fallbackRevealLines = revealText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fallbackMediaRevealLines =
    fallbackRevealLines.length === 0 && rawRevealRegions.length > 0
      ? rawRevealRegions.length === 1
        ? String(rawRevealRegions[0]?.text ?? "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
        : rawRevealRegions.map((region) => String(region.text ?? "").trim())
      : [];
  const effectiveFallbackRevealLines =
    fallbackRevealLines.length > 0
      ? fallbackRevealLines
      : fallbackMediaRevealLines;
  const revealSegments =
    scene?.spoiler?.reveal_segments?.length
      ? scene.spoiler.reveal_segments
      : effectiveFallbackRevealLines.map((text, index, lines) => {
          const textBefore = [
            initialText.trim(),
            ...lines.slice(0, index),
          ].join(" ");
          const totalTextLength = [
            initialText.trim(),
            ...lines,
          ].join(" ").length;
          return {
            media_reveal_percent: Math.round(
              ((index + 1) / Math.max(1, lines.length)) * 100
            ),
            reveal_time_ms:
              totalTextLength > 0
                ? Math.round(
                    (textBefore.length / totalTextLength) *
                      (scene?.narration?.total_duration_ms ?? 3500)
                  )
                : 0,
            text,
          };
        });

  const revealRegions = splitSpoilerRevealRegions(
    rawRevealRegions,
    revealSegments.map((segment) => segment.text)
  );

  let visibleRevealCount = 0;
  let mediaRevealPercent = hasMediaSpoiler ? 0 : 100;

  if (isSpoiler) {
    const durationEst = scene?.narration?.total_duration_ms
      ? scene.narration.total_duration_ms / 1000
      : 3.5;
    const revealTimes = revealSegments.map((segment) =>
      Math.max(0.05, segment.reveal_time_ms / 1000)
    );
    const revealClockActive = narrationElapsedSeconds > 0;

    visibleRevealCount = revealClockActive
      ? revealTimes.filter(
          (time) =>
            narrationElapsedSeconds >= Math.max(0.05, time - 0.05)
        ).length
      : 0;

    if (revealSegments.length > 0) {
      const visibleSegments = revealSegments.slice(0, visibleRevealCount);
      mediaRevealPercent = visibleSegments.length
        ? Math.max(
            ...visibleSegments.map((segment) => segment.media_reveal_percent)
          )
        : 0;
    } else if (
      revealClockActive &&
      narrationElapsedSeconds >=
        Math.max(
          0.1,
          (scene?.spoiler?.media_reveal_time_ms
            ? scene.spoiler.media_reveal_time_ms / 1000
            : durationEst) - 0.05
        )
    ) {
      mediaRevealPercent = 100;
    }

    if (revealText.trim() && revealSegments.length === 0) {
      visibleRevealCount =
        revealClockActive &&
        narrationElapsedSeconds >=
          Math.max(
            0.1,
            (scene?.spoiler?.reveal_time_ms
              ? scene.spoiler.reveal_time_ms / 1000
              : durationEst * 0.7) - 0.05
          )
          ? 1
          : 0;
    }
  }

  const seed = comment
    ? comment.comment_id || comment.text || ""
    : post.post_id || post.text || "";
  const baseMetrics = comment
    ? {
        likes: comment.like_count ?? 0,
        replies: comment.reply_count ?? 0,
        reposts: comment.repost_count ?? 0,
        shares: comment.share_count ?? 0,
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
  const resolvedMetrics = comment
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

  const media = pickScenePrimaryMedia(
    post,
    comment,
    scene,
    hidePostVideoDuringCaption
  );
  const mediaSpoilerActive =
    isSpoiler && hasMediaSpoiler && mediaRevealPercent < 100;
  const hideMedia =
    mediaSpoilerActive &&
    spoilerStyle === "hide";
  const blurMedia = mediaSpoilerActive && spoilerStyle !== "hide";
  const relativeTime = formatRelativeTime(
    resolveSceneCreatedAt(comment?.created_at, post.created_at)
  );
  const cardStyle = {
    background: darkTheme ? "rgba(18,18,20,0.97)" : "rgba(255,255,255,0.98)",
    boxShadow: darkTheme
      ? "0 18px 44px rgba(0,0,0,0.32)"
      : "0 12px 28px rgba(15,23,42,0.08)",
    fontFamily: '"Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif',
  } as const;
  const borderColor = darkTheme
    ? "ring-1 ring-white/10"
    : "ring-1 ring-slate-900/5";
  const textPrimary = darkTheme ? "text-white/94" : "text-slate-800";
  const textSecondary = darkTheme ? "text-white/55" : "text-slate-400";
  const textContent = darkTheme ? "text-white/94" : "text-slate-800";
  const textMetrics = darkTheme ? "text-white/78" : "text-slate-600";
  const textChrome = darkTheme ? "text-white/42" : "text-slate-300";

  return (
    <div
      className={`relative overflow-hidden rounded-[1.35rem] border px-3 py-3 ${
        darkTheme ? "border-white/10" : "border-slate-200/80"
      }`}
      style={cardStyle}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <AvatarImage
            alt={`@${username}`}
            assetPath={avatarAssetPath}
            className={`size-7 ${borderColor}`}
            remoteUrl={avatarUrl}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p
                className={`truncate font-semibold text-[0.8rem] tracking-[-0.01em] ${textPrimary}`}
              >
                @{username}
              </p>
              {relativeTime ? (
                <span
                  className={`shrink-0 text-[0.78rem] leading-none ${textSecondary}`}
                >
                  {relativeTime}
                </span>
              ) : null}
            </div>
            <p className={`truncate text-[0.69rem] ${textSecondary}`}>
              {displayName}
            </p>
          </div>
        </div>
        <MoreHorizontal
          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${textChrome}`}
        />
      </div>

      <p
        className={`mt-2 whitespace-pre-wrap text-[0.72rem] leading-[1.38] tracking-[-0.01em] ${textContent}`}
      >
        {isSpoiler ? (
          <>
            {formatStructuredPreviewText(initialText)}
            {(revealMediaOnly ? [] : revealSegments).map((segment, index) => {
              const isVisible = index < visibleRevealCount;
              return (
                <span
                  className={
                    isVisible
                      ? "inline opacity-100 transition-all duration-300"
                      : spoilerStyle === "hide"
                        ? "invisible inline select-none opacity-0"
                        : "pointer-events-none inline select-none bg-slate-900/10 text-slate-900 opacity-95 [-webkit-box-decoration-break:clone] [box-decoration-break:clone] dark:bg-white/15 dark:text-white"
                  }
                  key={`${segment.text}-${index}`}
                  style={
                    !isVisible && spoilerStyle !== "hide"
                      ? {
                          filter: "blur(2.8px)",
                          WebkitFilter: "blur(2.8px)",
                          userSelect: "none",
                          display: "inline",
                        }
                      : isVisible
                        ? {
                            filter: "none",
                            WebkitFilter: "none",
                            display: "inline",
                          }
                        : { display: "inline" }
                  }
                >
                  {index === 0 ? " " : "\n"}
                  {formatStructuredPreviewText(segment.text)}
                </span>
              );
            })}
          </>
        ) : (
          formatStructuredPreviewText(
            textOverride ?? comment?.text ?? post.text
          )
        )}
      </p>

      {media ? (
        <div
          className="relative mt-2.5 overflow-hidden rounded-[0.9rem]"
        >
          <div
            className={`overflow-hidden rounded-[0.9rem] transition-all duration-300 ${
              hideMedia ? "invisible opacity-0" : "opacity-100"
            }`}
            style={
              blurMedia
                ? {
                    filter: "blur(8px)",
                    transform: "scale(1.04)",
                  }
                : undefined
            }
          >
            <SceneMediaPreview
              currentTimeSeconds={mediaTimeSeconds}
              playbackDurationSeconds={mediaPlaybackDurationSeconds}
              slideshowTimeSeconds={sceneElapsedSeconds}
              isClockSource={isMediaClockSource}
              isPlaying={isPlaying}
              media={media}
              seekVersion={mediaSeekVersion}
              onTimeUpdate={onMediaTimeUpdate}
              onVideoDurationChange={onPostVideoDurationChange}
              onVideoEnded={onPostVideoEnded}
              playWithAudio={playPostVideoWithAudio}
              videoRef={postVideoRef}
            />
          </div>
          {media.type === "image" && mediaRevealPercent > 0 ? (
            revealRegions.length > 0 && visibleRevealCount > 0 ? (
              (() => {
                const region = revealRegions[
                  Math.min(visibleRevealCount, revealRegions.length) - 1
                ];
                const sourceHeight = Math.max(1, region.image_height);
                const visibleHeight = Math.max(
                  0,
                  Math.min(
                    100,
                    ((region.bbox.y + region.bbox.height) / sourceHeight) *
                      100 +
                      2
                  )
                );
                return (
                  <div
                    className="pointer-events-none absolute inset-0 overflow-hidden rounded-[0.9rem] transition-[clip-path] duration-300 ease-out"
                    style={{ clipPath: `inset(0 0 ${100 - visibleHeight}% 0)` }}
                  >
                    <SceneMediaPreview
                      currentTimeSeconds={mediaTimeSeconds}
                      slideshowTimeSeconds={sceneElapsedSeconds}
                      isClockSource={false}
                      isPlaying={false}
                      media={media}
                      seekVersion={mediaSeekVersion}
                    />
                  </div>
                );
              })()
            ) : mediaRevealPercent < 100 ? (
              <div
                className="pointer-events-none absolute inset-0 overflow-hidden rounded-[0.9rem]"
                style={{
                  clipPath: `inset(0 0 ${100 - mediaRevealPercent}% 0)`,
                }}
              >
                <SceneMediaPreview
                  currentTimeSeconds={mediaTimeSeconds}
                  slideshowTimeSeconds={sceneElapsedSeconds}
                  isClockSource={false}
                  isPlaying={false}
                  media={media}
                  seekVersion={mediaSeekVersion}
                />
              </div>
            ) : null
          ) : null}
        </div>
      ) : null}

      <div
        className={`mt-2.5 grid grid-cols-4 items-center gap-x-1.5 text-[0.56rem] ${textMetrics}`}
      >
        <InlineMetric
          accent="text-red-500"
          icon={
            <Heart
              className="h-4 w-4 fill-red-500 text-red-500"
              strokeWidth={2}
            />
          }
          value={formatCompact(likeCount)}
        />
        <InlineMetric
          icon={<ReplyThreadsIcon className="h-4 w-4" />}
          value={formatCompact(replyCount)}
        />
        <InlineMetric
          icon={<RepostThreadsIcon className="h-4 w-4" />}
          value={formatCompact(repostCount)}
        />
        <InlineMetric
          icon={<ShareArrowIcon className="h-4 w-4" />}
          value={formatCompact(shareCount)}
        />
      </div>
    </div>
  );
};

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

interface SceneMediaViewModel {
  aspectRatio: number;
  fitMode: "contain" | "cover";
  key: string;
  maxHeightRatio?: number;
  slideshowDurationSeconds?: number;
  slideshowSources?: string[];
  sources: string[];
  src: string;
  type: "image" | "video";
}

function pickScenePrimaryMedia(
  post: CrawlPost,
  comment?: CrawlComment,
  scene?: VideoDraftScene,
  hidePostVideoDuringCaption = false
): SceneMediaViewModel | null {
  const sourceMedia = comment ? (comment.media ?? []) : (post.media ?? []);
  const items = sourceMedia.filter(
    (item) =>
      (scene?.kind !== "post_video" || item.type === "video") &&
      !(
        hidePostVideoDuringCaption &&
        scene?.kind !== "post_video" &&
        item.type === "video"
      ) &&
      assetSources(item.asset_path, item.remote_url).length > 0
  );
  const mediaItems = items.filter(
    (item) => assetSources(item.asset_path, item.remote_url).length > 0
  );
  const media = mediaItems[0];
  if (!media) {
    return null;
  }

  const sources = assetSources(media.asset_path, media.remote_url);
  const src = sources[0] ?? "";
  if (!src) {
    return null;
  }

  const aspectRatio = Math.max(
    0.1,
    (media.width || 1) / Math.max(1, media.height || 1)
  );
  const imageItems = items.filter((item) => item.type === "image");
  const slideshowSources =
    items.length > 1 && imageItems.length === items.length
      ? imageItems.flatMap((item) => assetSources(item.asset_path, item.remote_url))
      : [];
  const sceneDurationSeconds = scene?.timeline
    ? Math.max(
        0.1,
        (scene.timeline.end_ms - scene.timeline.start_ms) / 1000
      )
    : 1;

  return {
    aspectRatio,
    fitMode:
      comment?.comment_id === DEFAULT_VIDEO_COMMENT_ID ? "contain" : "cover",
    key: `${media.type}-${media.order}-${media.asset_path || media.remote_url}`,
    maxHeightRatio:
      !comment && media.type === "image"
        ? MAX_POST_PREVIEW_MEDIA_HEIGHT_RATIO
        : undefined,
    slideshowDurationSeconds:
      slideshowSources.length > 1 ? sceneDurationSeconds : undefined,
    slideshowSources:
      slideshowSources.length > 1 ? slideshowSources : undefined,
    src,
    sources,
    type: media.type,
  };
}

function SceneMediaPreview({
  currentTimeSeconds = 0,
  isClockSource = false,
  isPlaying,
  media,
  onTimeUpdate,
  onVideoDurationChange,
  onVideoEnded,
  playbackDurationSeconds,
  playWithAudio = false,
  seekVersion = 0,
  slideshowTimeSeconds = 0,
  videoRef,
}: {
  currentTimeSeconds?: number;
  isClockSource?: boolean;
  isPlaying: boolean;
  media: SceneMediaViewModel;
  onTimeUpdate?: (seconds: number) => void;
  onVideoDurationChange?: (mediaKey: string, durationSeconds: number) => void;
  onVideoEnded?: () => void;
  playbackDurationSeconds?: number;
  playWithAudio?: boolean;
  seekVersion?: number;
  slideshowTimeSeconds?: number;
  videoRef?: MutableRefObject<HTMLVideoElement | null>;
}) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const mediaSourcesKey = media.sources.join("|");

  useEffect(() => {
    setSourceIndex(0);
  }, [media.key, mediaSourcesKey]);

  const objectFitClass =
    media.fitMode === "contain" ? "object-contain" : "object-cover";
  const displayAspectRatio =
    media.type === "image" && media.maxHeightRatio
      ? Math.max(media.aspectRatio, 1 / media.maxHeightRatio)
      : media.aspectRatio;
  const wrapperStyle =
    media.type === "image"
      ? media.fitMode === "contain"
        ? {
            aspectRatio: `${displayAspectRatio} / 1`,
            marginLeft: "auto",
            marginRight: "auto",
            width: `min(100%, ${Math.round(
              DEFAULT_COMMENT_PREVIEW_MEDIA_MAX_HEIGHT *
                Math.max(0.25, Math.min(4, media.aspectRatio))
            )}px)`,
          }
        : { aspectRatio: `${displayAspectRatio} / 1` }
      : undefined;
  const slideshowIndex =
    media.slideshowSources?.length && media.slideshowDurationSeconds
      ? Math.min(
          media.slideshowSources.length - 1,
          Math.floor(
            (Math.max(0, slideshowTimeSeconds) /
              media.slideshowDurationSeconds) *
              media.slideshowSources.length
          )
        )
      : null;
  const currentSource =
    slideshowIndex !== null
      ? media.slideshowSources?.[slideshowIndex] ?? null
      : media.sources[sourceIndex] ?? null;
  const imageZoomProgress =
    media.type === "image"
      ? getOriginalImageZoomProgress(slideshowTimeSeconds)
      : 0;
  const imageZoomScale = getOriginalImageZoomScale(imageZoomProgress);
  if (media.type === "video") {
    const videoAspectRatio = Math.min(1.22, Math.max(0.9, media.aspectRatio));
    return (
      <div
        className="relative w-full overflow-hidden rounded-[1rem] bg-black"
        style={{ aspectRatio: `${videoAspectRatio} / 1` }}
      >
        <ControlledInlineVideo
          className={`h-full w-full ${objectFitClass}`}
          currentTimeSeconds={currentTimeSeconds}
          isClockSource={isClockSource}
          isPlaying={isPlaying}
          onEnded={onVideoEnded}
          playbackDurationSeconds={playbackDurationSeconds}
          onTimeUpdate={onTimeUpdate}
          onDurationChange={(durationSeconds) =>
            onVideoDurationChange?.(media.key, durationSeconds)
          }
          playWithAudio={playWithAudio}
          seekVersion={seekVersion}
          src={media.src}
          videoRef={videoRef}
        />
      </div>
    );
  }

  if (!currentSource) {
    return (
      <div
        className="flex w-full items-center justify-center bg-black/10 text-[0.62rem] text-slate-500 dark:bg-white/10 dark:text-white/55"
        style={wrapperStyle}
      >
        Image unavailable
      </div>
    );
  }

  return (
    <div
      className="w-full overflow-hidden rounded-[1rem] bg-transparent"
      style={
        media.type === "image"
          ? {
              ...wrapperStyle,
              transform: `scale(${imageZoomScale})`,
              transformOrigin: "center center",
              willChange:
                imageZoomProgress < 1 ? "transform" : undefined,
            }
          : wrapperStyle
      }
    >
      <img
        alt=""
        className={`h-full w-full ${objectFitClass}`}
        loading="eager"
        onError={() => setSourceIndex((current) => current + 1)}
        referrerPolicy="no-referrer"
        src={currentSource}
      />
    </div>
  );
}

function ControlledInlineVideo({
  className,
  currentTimeSeconds = 0,
  isClockSource = false,
  isPlaying,
  onEnded,
  onTimeUpdate,
  onDurationChange,
  playbackDurationSeconds,
  playWithAudio = false,
  seekVersion = 0,
  src,
  videoRef: externalVideoRef,
}: {
  className: string;
  currentTimeSeconds?: number;
  isClockSource?: boolean;
  isPlaying: boolean;
  onEnded?: () => void;
  onTimeUpdate?: (seconds: number) => void;
  onDurationChange?: (durationSeconds: number) => void;
  playbackDurationSeconds?: number;
  playWithAudio?: boolean;
  seekVersion?: number;
  src: string;
  videoRef?: MutableRefObject<HTMLVideoElement | null>;
}) {
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = externalVideoRef ?? internalVideoRef;
  const requestedSeekRef = useRef<{ seconds: number; version: number } | null>(
    null
  );
  const reachedPlaybackLimitRef = useRef(false);
  const resolvedPlaybackDurationSeconds =
    typeof playbackDurationSeconds === "number" &&
    Number.isFinite(playbackDurationSeconds) &&
    playbackDurationSeconds > 0
      ? playbackDurationSeconds
      : null;

  useEffect(() => {
    reachedPlaybackLimitRef.current = false;
  }, [resolvedPlaybackDurationSeconds, src]);

  const syncCurrentTime = (targetSeconds = currentTimeSeconds, force = false) => {
    const video = videoRef.current;
    if (
      !video ||
      !Number.isFinite(targetSeconds) ||
      video.readyState < 1
    ) {
      return false;
    }

    if (!force && isClockSource) {
      return false;
    }

    if (Math.abs(video.currentTime - targetSeconds) > 0.08) {
      try {
        video.currentTime = Math.max(0, targetSeconds);
      } catch {
        // The browser may reject a seek while the source is changing.
        return false;
      }
    }

    return true;
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (isPlaying) {
      void video.play().catch(() => undefined);
      return;
    }

    video.pause();
  }, [isPlaying, playWithAudio, src]);

  useEffect(() => {
    syncCurrentTime();
  }, [currentTimeSeconds, isClockSource, src]);

  useEffect(() => {
    if (!Number.isFinite(currentTimeSeconds)) {
      return;
    }

    requestedSeekRef.current = {
      seconds: Math.max(0, currentTimeSeconds),
      version: seekVersion,
    };
    syncCurrentTime(currentTimeSeconds, true);
  }, [seekVersion, src]);

  const reportDuration = (event: SyntheticEvent<HTMLVideoElement>) => {
    const durationSeconds = event.currentTarget.duration;
    if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
      onDurationChange?.(durationSeconds);
    }
  };

  const handleLoadedMetadata = (
    event: SyntheticEvent<HTMLVideoElement>
  ) => {
    reportDuration(event);
    const requestedSeek = requestedSeekRef.current;
    if (requestedSeek) {
      syncCurrentTime(requestedSeek.seconds, true);
      return;
    }

    syncCurrentTime();
  };

  const finishAtPlaybackLimit = (video: HTMLVideoElement): boolean => {
    if (
      resolvedPlaybackDurationSeconds === null ||
      reachedPlaybackLimitRef.current ||
      video.currentTime < resolvedPlaybackDurationSeconds - 0.04
    ) {
      return false;
    }

    reachedPlaybackLimitRef.current = true;
    video.pause();
    onEnded?.();
    return true;
  };

  return (
    <video
      className={className}
      loop={!playWithAudio}
      muted={!playWithAudio}
      onEnded={onEnded}
      onDurationChange={reportDuration}
      onTimeUpdate={(event) => {
        if (finishAtPlaybackLimit(event.currentTarget)) {
          return;
        }
        if (isClockSource) {
          onTimeUpdate?.(event.currentTarget.currentTime);
        }
      }}
      playsInline
      preload="metadata"
      onLoadedMetadata={handleLoadedMetadata}
      ref={videoRef}
      src={src}
    />
  );
}

const InlineMetric = ({
  accent,
  icon,
  value,
}: {
  accent?: string;
  icon: ReactNode;
  value: string;
}) => (
  <span
    className={`inline-flex min-w-0 items-center gap-1 overflow-hidden font-medium tracking-[-0.02em] ${accent ?? ""}`}
  >
    {icon}
    <span className={metricValueClassName(value)}>{value}</span>
  </span>
);

const PreviewBackdrop = () => (
  <div className="absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_top_left,_#7ec8ff_0%,_#2c203e_38%,_#140b16_65%,_#070707_100%)]">
    <div className="absolute inset-x-[-15%] bottom-[-10%] h-[58%] rotate-[-18deg] rounded-[3rem] bg-[linear-gradient(180deg,_rgba(255,127,57,0.95),_rgba(199,49,6,0.88))] blur-[2px]" />
    <div className="absolute top-[-2%] right-[-6%] h-[74%] w-[56%] rotate-[14deg] rounded-[3rem] bg-[linear-gradient(180deg,_rgba(36,12,23,0.88),_rgba(9,5,8,0.98))]" />
    <div className="absolute top-[8%] left-[8%] h-[40%] w-[40%] rotate-[-14deg] rounded-[2rem] bg-white/8" />
    <div className="absolute bottom-[18%] left-[4%] h-[22%] w-[30%] rounded-[2rem] bg-[linear-gradient(180deg,_rgba(255,168,48,0.92),_rgba(255,91,0,0.88))] blur-[1px]" />
  </div>
);

function getMemePlaybackIdentity(
  meme: SelectedMemeEntry | MemeTransitionConfig | null | undefined
): string {
  if (!meme) {
    return "none";
  }

  return [
    meme.emotion,
    meme.visualMode ?? "meme",
    meme.image?.serverPath ?? meme.image?.mediaUrl ?? "",
    meme.audio?.serverPath ?? meme.audio?.mediaUrl ?? "",
  ].join("|");
}

function resolveMemeAssetUrl(
  asset:
    | { mediaUrl?: string; serverPath?: string }
    | null
    | undefined
): string {
  return assetSources(asset?.serverPath, asset?.mediaUrl)[0] ?? "";
}

function getPreviewMemeDurationMs(
  meme: SelectedMemeEntry | MemeTransitionConfig | null | undefined
): number {
  const configuredDurationMs = Math.max(
    MIN_MEME_TRANSITION_MS,
    Math.min(
      MAX_MEME_TRANSITION_MS,
      meme?.durationMs ?? DEFAULT_MEME_TRANSITION_MS
    )
  );
  if (meme?.visualMode === "sound_only") {
    const soundDurationMs = Number(meme.audio?.durationSeconds ?? 0) * 1000;
    return soundDurationMs > 0
      ? Math.max(MIN_MEME_TRANSITION_MS, soundDurationMs)
      : configuredDurationMs;
  }
  const videoDurationMs = Number(meme?.image?.durationSeconds ?? 0) * 1000;
  if (!isVideoMemeAsset(meme?.image) || videoDurationMs <= 0) {
    return configuredDurationMs;
  }

  const soundDurationMs = Number(meme?.audio?.durationSeconds ?? 0) * 1000;
  return Math.max(
    MIN_MEME_TRANSITION_MS,
    configuredDurationMs,
    videoDurationMs + Math.max(0, soundDurationMs)
  );
}

function isVideoMemeAsset(
  asset:
    | { name?: string; serverPath?: string; type?: string }
    | null
    | undefined
): boolean {
  return Boolean(
    asset?.type?.startsWith("video/") ||
      [asset?.name, asset?.serverPath].some((value) =>
        /\.(?:mp4|m4v|webm|mov|avi|mkv)(?:$|[?#])/i.test(value ?? "")
      )
  );
}

function isTrailingMemePlacement(
  placement: SelectedMemeEntry["placement"] | undefined
): boolean {
  return placement === "after_comment" || placement === "media_reveal";
}

function hasPreviewMemePresentation(
  meme: SelectedMemeEntry | MemeTransitionConfig | null | undefined
): boolean {
  return Boolean(
    meme?.placement === "media_reveal" ||
      resolveMemeAssetUrl(meme?.image) ||
      resolveMemeAssetUrl(meme?.audio)
  );
}

const MemeTransitionOverlay = ({
  identity,
  isPlaying,
  meme,
  trailing,
  visible,
}: {
  identity: string;
  isPlaying: boolean;
  meme: SelectedMemeEntry | MemeTransitionConfig | null | undefined;
  trailing: boolean;
  visible: boolean;
}) => {
  const imageUrl = resolveMemeAssetUrl(meme?.image);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (visible && isPlaying) {
      void video.play().catch(() => undefined);
      return;
    }

    video.pause();
  }, [identity, isPlaying, visible]);

  if (
    !visible ||
    !imageUrl ||
    meme?.visualMode === "sound_only" ||
    meme?.placement === "media_reveal"
  ) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        className={[
          "absolute left-1/2 -translate-x-1/2 -translate-y-1/2",
          trailing
            ? "top-[73%] w-[42%]"
            : "top-1/2 w-[57.4074%]",
        ].join(" ")}
      >
        <div
          className="zoom-in-95 fade-in animate-in duration-500"
          key={`${identity}:${trailing ? "trailing" : "lead"}`}
        >
          {isVideoMemeAsset(meme?.image) ? (
            <video
              aria-label={meme?.emotion ?? "Meme"}
              autoPlay={isPlaying}
              className="block aspect-square w-full rounded-[8%] object-cover shadow-lg"
              key={`${identity}:${trailing ? "trailing" : "lead"}:video`}
              loop={false}
              muted
              playsInline
              preload="auto"
              ref={videoRef}
              src={imageUrl}
            />
          ) : (
            <img
              alt={meme?.emotion ?? "Meme"}
              className="block aspect-square w-full rounded-[8%] object-cover shadow-lg"
              src={imageUrl}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const MediaRevealOverlay = ({
  durationMs,
  elapsedSeconds,
  identity,
  media,
}: {
  durationMs: number;
  elapsedSeconds: number;
  identity: string;
  media: SceneMediaViewModel;
}) => {
  const sources = media.slideshowSources?.length
    ? media.slideshowSources
    : [media.src];
  const sourceIndex = Math.min(
    Math.max(0, sources.length - 1),
    Math.floor(
      (Math.max(0, elapsedSeconds) * 1000 * Math.max(1, sources.length)) /
        Math.max(1, durationMs)
    )
  );
  const source = sources[sourceIndex] ?? media.src;
  const imageZoomProgress = getOriginalImageZoomProgress(elapsedSeconds);
  if (!source) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-3">
      {media.type === "video" ? (
        <video
          autoPlay
          className="h-full w-full object-cover"
          key={`${identity}:video`}
          loop
          muted
          playsInline
          src={source}
        />
      ) : (
        <img
          alt="Ảnh gốc"
          className="h-full w-full animate-in object-contain fade-in duration-150"
          key={`${identity}:${sourceIndex}`}
          src={source}
          style={{
            transform: `scale(${getOriginalImageZoomScale(imageZoomProgress)})`,
            transformOrigin: "center center",
            willChange:
              imageZoomProgress < 1 ? "transform" : undefined,
          }}
        />
      )}
    </div>
  );
};

function getOriginalImageZoomProgress(elapsedSeconds: number): number {
  return Math.min(
    1,
    Math.max(0, Math.max(0, elapsedSeconds) / ORIGINAL_IMAGE_ZOOM_DURATION_SECONDS)
  );
}

function getOriginalImageZoomScale(progress: number): number {
  return 1 + progress * (ORIGINAL_IMAGE_ZOOM_MAX_SCALE - 1);
}

const DEFAULT_THUMBNAIL_LAYER_LAYOUT: Record<VideoThumbnailLayerId, VideoThumbnailLayerLayout> = {
  brand: { height: 24, width: 92, x: 50, y: 70 },
  channel: { height: 8, width: 72, x: 50, y: 25 },
  title: { height: 28, width: 84, x: 50, y: 34 },
  watermark: { height: 19, width: 19, x: 88, y: 10 },
};

const MIN_THUMBNAIL_LAYER_SIZE: Record<VideoThumbnailLayerId, { height: number; width: number }> = {
  brand: { height: 10, width: 20 },
  channel: { height: 6, width: 24 },
  title: { height: 16, width: 36 },
  watermark: { height: 8, width: 8 },
};

function resolveThumbnailPreviewLayout(config: VideoThumbnailIntro) {
  const defaultBrandWidth = Math.min(
    100,
    Math.max(
      30,
      [72, 78, 85].includes(Math.round(Number(config.brandImageSizePercent) || 92))
        ? 92
        : Math.round(Number(config.brandImageSizePercent) || 92)
    )
  );
  const defaults = {
    ...DEFAULT_THUMBNAIL_LAYER_LAYOUT,
    brand: { ...DEFAULT_THUMBNAIL_LAYER_LAYOUT.brand, width: defaultBrandWidth },
  };
  const getLayer = (id: VideoThumbnailLayerId) => {
    const resolved = {
      ...defaults[id],
      ...config.layout?.[id],
    };
    const minimum = MIN_THUMBNAIL_LAYER_SIZE[id];
    const sized = {
      ...resolved,
      height: Math.min(95, Math.max(minimum.height, resolved.height)),
      width: Math.min(95, Math.max(minimum.width, resolved.width)),
    };
    if (id === "watermark") {
      const size = Math.min(sized.width, sized.height);
      return { ...sized, height: size, width: size };
    }
    return sized;
  };
  const order = [
    ...(config.layout?.layerOrder ?? []),
    ...(["title", "channel", "brand", "watermark"] as VideoThumbnailLayerId[]),
  ].filter((id, index, list) => list.indexOf(id) === index);
  return {
    brand: getLayer("brand"),
    channel: getLayer("channel"),
    order,
    title: getLayer("title"),
    watermark: getLayer("watermark"),
  };
}

const ThumbnailPreviewSceneCard = ({
  config,
  mode,
}: {
  config: VideoThumbnailIntro;
  mode: "automatic" | "advanced";
}) => {
  const imageUrl = config.image?.mediaUrl
    ? config.image.mediaUrl
    : config.image?.serverPath
      ? `/media/${config.image.serverPath}`
      : "";
  const brandImageUrl = config.brandImage?.mediaUrl
    ? config.brandImage.mediaUrl
    : config.brandImage?.serverPath
      ? `/media/${config.brandImage.serverPath}`
      : "";

  const watermarkUrl = config.watermark?.mediaUrl
    ? config.watermark.mediaUrl
    : config.watermark?.serverPath
      ? "/media/" + config.watermark.serverPath
      : "";
  const backgroundUrl = config.background?.mediaUrl
    ? config.background.mediaUrl
    : config.background?.serverPath
      ? `/media/${config.background.serverPath}`
      : "";
  const layout = resolveThumbnailPreviewLayout(config);

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_top_left,_#7ec8ff_0%,_#2c203e_38%,_#140b16_65%,_#070707_100%)]"
      style={{ containerType: "inline-size" }}
    >
      {backgroundUrl ? (
        <img
          alt=""
          className="absolute inset-0 z-0 h-full w-full"
          src={backgroundUrl}
          style={{
            objectFit: "cover",
            objectPosition: `${config.backgroundPositionX ?? 50}% ${config.backgroundPositionY ?? 50}%`,
            transform: `scale(${config.backgroundZoom ?? 1})`,
          }}
        />
      ) : null}
      <div className="absolute inset-0 bg-black/10" />
      <div
        className="absolute z-10 flex items-center justify-center"
        style={{
          height: `${layout.title.height}%`,
          left: `${layout.title.x}%`,
          opacity: layout.title.visible === false ? 0 : 1,
          top: `${layout.title.y}%`,
          transform: `translate(-50%, -50%) rotate(${layout.title.rotation ?? 0}deg)`,
          width: `${layout.title.width}%`,
          zIndex: 10 + layout.order.indexOf("title"),
        }}
      >
        <div
          className={[
            "relative flex h-full w-full flex-col items-center justify-center overflow-hidden text-center",
            mode === "automatic"
              ? "text-emerald-800"
              : "text-pink-800",
          ].join(" ")}
          style={{
            padding: "6cqw",
          }}
        >
        {imageUrl ? (
          <img
            alt=""
            className="mx-auto w-full object-cover"
            height={320}
            src={imageUrl}
            style={{
              borderRadius: "3cqw",
              marginBottom: "4.5cqw",
              maxHeight: "45cqw",
            }}
            width={240}
          />
        ) : null}
        <div className="min-w-0">
          <div
            className="max-w-full whitespace-pre-wrap break-words leading-tight"
            style={{
              color: config.titleColor ?? "#741b1b",
              fontFamily: resolvePreviewTitleFont(config.titleFont),
              fontSize: `${Math.min(120, Math.max(28, config.titleFontSize ?? 42)) / 5}cqw`,
              fontStyle: config.titleItalic ? "italic" : "normal",
              fontWeight: config.titleBold === false ? 500 : 900,
            }}
          >
            {config.title || "Tiêu đề video"}
          </div>
          {config.subtitle ? (
            <div
              className={[
                mode === "automatic"
                  ? "text-emerald-950/70"
                  : "text-pink-950/70",
              ].join(" ")}
              style={{
                fontSize: "4.5cqw",
                marginTop: "3cqw",
              }}
            >
              {config.subtitle}
            </div>
          ) : null}
        </div>
        </div>
      </div>
      {config.channelName ? (
        <div
          className="absolute flex items-center justify-center truncate text-center font-semibold"
          style={{
            color: config.channelColor ?? (mode === "automatic" ? "#14532d" : "#831843"),
            fontFamily: resolvePreviewTitleFont(config.channelFont ?? "geist"),
            fontSize: `${Math.min(72, Math.max(16, config.channelFontSize ?? 36)) / 5}cqw`,
            fontStyle: config.channelItalic ? "italic" : "normal",
            height: `${layout.channel.height}%`,
            left: `${layout.channel.x}%`,
            opacity: layout.channel.visible === false ? 0 : 1,
            top: `${layout.channel.y}%`,
            transform: `translate(-50%, -50%) rotate(${layout.channel.rotation ?? 0}deg)`,
            width: `${layout.channel.width}%`,
            fontWeight: config.channelBold ? 700 : 500,
            zIndex: 10 + layout.order.indexOf("channel"),
          }}
        >
          {config.channelName}
        </div>
      ) : null}
      {brandImageUrl ? (
        <div
          className="absolute flex items-center justify-center"
          style={{
            height: `${layout.brand.height}%`,
            left: `${layout.brand.x}%`,
            opacity: layout.brand.visible === false ? 0 : 1,
            top: `${layout.brand.y}%`,
            transform: `translate(-50%, -50%) rotate(${layout.brand.rotation ?? 0}deg)`,
            width: `${layout.brand.width}%`,
            zIndex: 10 + layout.order.indexOf("brand"),
          }}
        >
          <img
            alt=""
            className="h-full w-full object-contain"
            draggable={false}
            src={brandImageUrl}
          />
        </div>
      ) : null}
      {watermarkUrl ? (
        <div
          className="absolute aspect-square overflow-hidden rounded-full"
          style={{
            clipPath: "circle(50% at 50% 50%)",
            height: `${Math.min(layout.watermark.width, layout.watermark.height) * 0.5625}%`,
            left: `${layout.watermark.x}%`,
            opacity: layout.watermark.visible === false ? 0 : 1,
            top: `${layout.watermark.y}%`,
            transform: `translate(-50%, -50%) rotate(${layout.watermark.rotation ?? 0}deg)`,
            width: `${Math.min(layout.watermark.width, layout.watermark.height)}%`,
            zIndex: 10 + layout.order.indexOf("watermark"),
          }}
        >
          <img
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
            src={watermarkUrl}
          />
        </div>
      ) : null}
    </div>
  );
};


function resolvePreviewTitleFont(
  font: VideoThumbnailIntro["titleFont"]
): string {
  switch (font) {
    case "beVietnam":
      return "Be Vietnam Pro, Geist, Arial, sans-serif";
    case "georgia":
      return "Georgia, serif";
    case "geist":
      return "Geist, Arial, sans-serif";
    case "mono":
      return "Courier New, monospace";
    case "montserrat":
      return "Montserrat, Segoe UI, Arial, sans-serif";
    case "notoSans":
      return "Noto Sans, Geist, Arial, sans-serif";
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

function buildScenes(
  post: CrawlPost | undefined,
  draft: VideoDraftDocument | null | undefined,
  liveThumbnailIntro?: VideoThumbnailIntro | null,
  memeBySceneId?: Record<string, SelectedMemeEntry | null | undefined>,
  playPostVideoAfterCaption = false,
  sourceVideoDurationsMs: Record<string, number> = {}
): PreviewScene[] {
  if (!post) {
    return [];
  }

  if (draft?.scenes.length) {
    const matchedScenes = draft.scenes
      .filter(
        (scene) => scene.post_id === post.post_id
      )
      .map((scene) => ({
        comment:
          (scene.kind === "comment" ||
            (scene.kind === "post_video" && Boolean(scene.comment_id))) &&
          !scene.dialogue_speaker
            ? post.top_comments.find(
                (item) => item.comment_id === scene.comment_id
              )
            : undefined,
        kind: scene.kind,
        scene,
        text: resolveCurrentPreviewSceneText({
          comment:
            (scene.kind === "comment" ||
              (scene.kind === "post_video" && Boolean(scene.comment_id))) &&
            !scene.dialogue_speaker
              ? post.top_comments.find(
                  (item) => item.comment_id === scene.comment_id
                )
              : undefined,
          post,
          scene,
        }),
      }));

    if (matchedScenes.length > 0) {
      const effectiveThumbnailIntro =
        liveThumbnailIntro ?? draft.thumbnail_intro;
      const rebasedScenes = rebasePreviewThumbnailDuration(
        syncPreviewPostVideoScenes(
          applyPreviewCommentDurationOverrides(matchedScenes, post),
          post,
          playPostVideoAfterCaption,
          sourceVideoDurationsMs
        ),
        draft.thumbnail_intro,
        effectiveThumbnailIntro
      );
      return prependThumbnailPreviewScene(
        insertPromotionPreviewScenes(
          applyPreviewMemeOverrides(rebasedScenes, memeBySceneId),
          draft
        ),
        effectiveThumbnailIntro
      );
    }
  }

  const scenes: PreviewScene[] = [];
  const postText = normalizeText(
    post.is_spoiler
      ? `${post.spoiler_initial_text || post.text}${post.spoiler_reveal_text || ""}`
      : post.text
  );
  if (postText) {
    scenes.push({ kind: "post", text: postText });
  }

  for (const comment of post.top_comments) {
    const commentText = normalizeText(
      comment.is_spoiler
        ? `${comment.spoiler_initial_text || comment.text}${comment.spoiler_reveal_text || ""}`
        : comment.text
    );
    if (!commentText) {
      continue;
    }
    scenes.push({
      comment,
      kind: "comment",
      text: commentText,
    });
  }

  return prependThumbnailPreviewScene(
    syncPreviewPostVideoScenes(
      scenes,
      post,
      playPostVideoAfterCaption,
      sourceVideoDurationsMs
    ),
    liveThumbnailIntro ?? draft?.thumbnail_intro
  );
}

function resolveCurrentPreviewSceneText({
  comment,
  post,
  scene,
}: {
  comment?: CrawlComment;
  post: CrawlPost;
  scene: VideoDraftScene;
}): string {
  if (scene.dialogue_speaker || scene.kind === "post_video") {
    return normalizeText(scene.text);
  }

  if (scene.kind === "post") {
    return normalizeText(
      post.is_spoiler
        ? `${post.spoiler_initial_text || post.text}${post.spoiler_reveal_text || ""}`
        : post.text
    );
  }

  if (comment) {
    return normalizeText(
      comment.is_spoiler
        ? `${comment.spoiler_initial_text || comment.text}${comment.spoiler_reveal_text || ""}`
        : comment.text
    );
  }

  return normalizeText(scene.text);
}

function syncPreviewPostVideoScenes(
  scenes: PreviewScene[],
  post: CrawlPost,
  enabled: boolean,
  sourceVideoDurationsMs: Record<string, number> = {}
): PreviewScene[] {
  let timelineShiftMs = 0;
  const nextScenes: PreviewScene[] = [];

  for (let index = 0; index < scenes.length; index += 1) {
    const current = scenes[index];
    if (!current) {
      continue;
    }

    const sourceTimeline = getPreviewSceneTimeline(current);
    const timelineDurationMs = sourceTimeline
      ? Math.max(1, sourceTimeline.end_ms - sourceTimeline.start_ms)
      : 0;
    const nextScene = scenes[index + 1];
    const sourceMedia = current.comment?.media ?? post.media;
    const sourceVideoDurationMs = resolveSourceVideoDurationMs(
      sourceMedia,
      sourceVideoDurationsMs
    );
    const sourceDurationMs = timelineDurationMs;
    const shouldTrimCaptionHold = Boolean(
      enabled &&
        (current.kind === "post" || current.kind === "comment") &&
        !current.scene?.dialogue_speaker &&
        sourceTimeline &&
        sourceMedia.some(
          (media) =>
            media.type === "video" &&
            (Boolean(media.asset_path) || Boolean(media.remote_url))
        )
    );
    const captionDurationMs = shouldTrimCaptionHold
      ? Math.max(
          1,
          current.scene
            ? getSceneNarrationDurationMs(current.scene)
            : sourceDurationMs
        )
      : sourceDurationMs;
    const sceneWithTrimmedCaptionHold =
      shouldTrimCaptionHold && sourceTimeline
        ? {
            ...current,
            scene: current.scene
              ? {
                  ...current.scene,
                  timeline: {
                    end_ms: sourceTimeline.start_ms + captionDurationMs,
                    start_ms: sourceTimeline.start_ms,
                  },
                }
              : current.scene,
            timeline: {
              end_ms: sourceTimeline.start_ms + captionDurationMs,
              start_ms: sourceTimeline.start_ms,
            },
          }
        : current;

    if (current.kind === "post_video") {
      if (!enabled) {
        timelineShiftMs -= sourceDurationMs;
        continue;
      }
      const postVideoSourceDurationMs =
        sourceVideoDurationMs ?? timelineDurationMs;
      const precedingScene = nextScenes.at(-1);
      const precedingTimeline = precedingScene
        ? getPreviewSceneTimeline(precedingScene)
        : undefined;
      const durationMs =
        precedingScene &&
        precedingTimeline &&
        isPreviewVideoAfterCaption(precedingScene, current)
          ? resolvePreviewPostVideoDurationWithinTotalMs({
              captionDurationMs: Math.max(
                0,
                precedingTimeline.end_ms - precedingTimeline.start_ms
              ),
              sourceDurationMs: postVideoSourceDurationMs,
              totalDurationMs: resolvePreviewConfiguredDurationMs(current, post),
            })
          : postVideoSourceDurationMs;
      const videoScene =
        sourceTimeline && durationMs !== timelineDurationMs
          ? {
              ...current,
              scene: current.scene
                ? {
                    ...current.scene,
                    timeline: {
                      end_ms: sourceTimeline.start_ms + durationMs,
                      start_ms: sourceTimeline.start_ms,
                    },
                  }
                : current.scene,
              timeline: {
                end_ms: sourceTimeline.start_ms + durationMs,
                start_ms: sourceTimeline.start_ms,
              },
            }
          : current;
      if (precedingScene && isPreviewVideoAfterCaption(precedingScene, current)) {
        const shiftedStartMs = (sourceTimeline?.start_ms ?? 0) + timelineShiftMs;
        if (precedingTimeline) {
          timelineShiftMs += precedingTimeline.end_ms - shiftedStartMs;
        }
      }
      nextScenes.push(shiftPreviewSceneTimeline(videoScene, timelineShiftMs));
      timelineShiftMs += durationMs - timelineDurationMs;
      continue;
    }

    const shiftedCurrent = shiftPreviewSceneTimeline(
      sceneWithTrimmedCaptionHold,
      timelineShiftMs
    );
    nextScenes.push(shiftedCurrent);

    if (shouldTrimCaptionHold) {
      timelineShiftMs += captionDurationMs - sourceDurationMs;
    }
    if (
      enabled &&
      (current.kind === "post" || current.kind === "comment") &&
      !current.scene?.dialogue_speaker &&
      sourceMedia.some(
        (media) =>
          media.type === "video" &&
          (Boolean(media.asset_path) || Boolean(media.remote_url))
      ) &&
      nextScene?.kind !== "post_video" &&
      sourceTimeline
    ) {
      const startMs = (shiftedCurrent.timeline?.end_ms ?? 0);
      const durationMs = resolvePreviewPostVideoDurationWithinTotalMs({
        captionDurationMs,
        sourceDurationMs: resolvePreviewPostVideoDurationMs(
          current.comment ?? post,
          sourceVideoDurationsMs
        ),
        totalDurationMs: resolvePreviewConfiguredDurationMs(current, post),
      });
      nextScenes.push(
        createPreviewPostVideoScene(
          post,
          current.comment,
          startMs,
          durationMs,
          nextScenes.length
        )
      );
      timelineShiftMs += durationMs;
    }
  }

  return nextScenes;
}

function isPreviewVideoAfterCaption(
  scene: PreviewScene,
  nextScene: PreviewScene | undefined
): boolean {
  return Boolean(
    (scene.kind === "post" ||
      (scene.kind === "comment" && !scene.scene?.dialogue_speaker)) &&
      nextScene?.kind === "post_video" &&
      nextScene.scene?.post_id === scene.scene?.post_id &&
      nextScene.scene?.comment_id === scene.scene?.comment_id
  );
}

function shiftPreviewSceneTimeline(
  scene: PreviewScene,
  shiftMs: number
): PreviewScene {
  const timeline = getPreviewSceneTimeline(scene);
  if (!timeline || shiftMs === 0) {
    return scene;
  }
  const shiftedTimeline = {
    end_ms: timeline.end_ms + shiftMs,
    start_ms: timeline.start_ms + shiftMs,
  };
  return {
    ...scene,
    scene: scene.scene
      ? { ...scene.scene, timeline: shiftedTimeline }
      : scene.scene,
    timeline: shiftedTimeline,
  };
}

function createPreviewPostVideoScene(
  post: CrawlPost,
  comment: CrawlComment | undefined,
  startMs: number,
  durationMs: number,
  order: number
): PreviewScene {
  const source = comment ?? post;
  const videoMedia = source.media.find(
    (media) =>
      media.type === "video" &&
      (Boolean(media.asset_path) || Boolean(media.remote_url))
  );
  const scene: VideoDraftScene = {
    has_media: true,
    kind: "post_video",
    narration: {
      audio_url: "",
      chunks: [],
      message: "Original post video",
      merged_audio_path: "",
      merged_audio_url: "",
      provider: "google_cloud",
      request_id: "",
      status: "idle",
      total_duration_ms: 0,
      voice_profile: null,
    },
    narration_text: "",
    order,
    post_id: post.post_id,
    comment_id: comment?.comment_id,
    scene_id: comment
      ? `${comment.comment_id}-comment-video-preview`
      : `${post.post_id}-post-video-preview`,
    source_text: "",
    template: "threads_card",
    text: "",
    title: `Video by @${source.username}`,
    video_media: videoMedia,
    timeline: {
      end_ms: startMs + durationMs,
      start_ms: startMs,
    },
  };
  return {
    comment,
    kind: "post_video",
    scene,
    text: "",
    timeline: scene.timeline,
  };
}

function resolvePreviewPostVideoDurationMs(
  source: Pick<CrawlPost, "media" | "video_duration_seconds">,
  sourceVideoDurationsMs: Record<string, number> = {}
): number {
  const mediaDurationMs = resolveSourceVideoDurationMs(
    source.media,
    sourceVideoDurationsMs
  );
  if (mediaDurationMs !== undefined) {
    return mediaDurationMs;
  }

  const configuredDurationMs = Number(source.video_duration_seconds ?? 0) * 1000;
  return Number.isFinite(configuredDurationMs) && configuredDurationMs > 0
    ? Math.min(120_000, Math.max(500, Math.round(configuredDurationMs)))
    : DEFAULT_POST_VIDEO_DURATION_MS;
}

function getPreviewMediaKey(media: CrawlMediaAsset): string {
  return `${media.type}-${media.order}-${media.asset_path || media.remote_url}`;
}

function resolveSourceVideoDurationMs(
  media: CrawlMediaAsset[],
  sourceVideoDurationsMs: Record<string, number>
): number | undefined {
  const video = media.find(
    (item) =>
      item.type === "video" &&
      (Boolean(item.asset_path) || Boolean(item.remote_url))
  );
  if (!video) {
    return undefined;
  }

  const declaredDurationMs = Number(video.duration_seconds ?? 0) * 1000;
  if (Number.isFinite(declaredDurationMs) && declaredDurationMs > 0) {
    return Math.min(120_000, Math.max(500, Math.round(declaredDurationMs)));
  }

  const durationMs = sourceVideoDurationsMs[getPreviewMediaKey(video)];
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : undefined;
}

function applyPreviewCommentDurationOverrides(
  scenes: PreviewScene[],
  post: CrawlPost
): PreviewScene[] {
  let accumulatedShiftMs = 0;

  return scenes.map((entry) => {
    const sourceTimeline = entry.scene?.timeline;
    if (!sourceTimeline) {
      return entry;
    }

    const configuredDurationMs =
      entry.kind === "post_video" ? 0 : resolvePreviewConfiguredDurationMs(entry, post);
    const sourceDurationMs = Math.max(
      1,
      sourceTimeline.end_ms - sourceTimeline.start_ms
    );
    const durationMs = Math.max(sourceDurationMs, configuredDurationMs);
    const shiftedTimeline = {
      start_ms: sourceTimeline.start_ms + accumulatedShiftMs,
      end_ms: sourceTimeline.start_ms + accumulatedShiftMs + durationMs,
    };
    accumulatedShiftMs += durationMs - sourceDurationMs;

    return {
      ...entry,
      scene: entry.scene
        ? { ...entry.scene, timeline: shiftedTimeline }
        : entry.scene,
      timeline: shiftedTimeline,
    };
  });
}

function resolvePreviewConfiguredDurationMs(
  entry: Pick<PreviewScene, "comment" | "kind">,
  post: CrawlPost
): number {
  const configuredSeconds =
    entry.kind === "post" || !entry.comment
      ? post.video_duration_seconds
      : entry.comment.video_duration_seconds;
  return typeof configuredSeconds === "number" &&
    Number.isFinite(configuredSeconds) &&
    configuredSeconds > 0
    ? Math.min(120_000, Math.max(500, Math.round(configuredSeconds * 1000)))
    : 0;
}

export function resolvePreviewPostVideoDurationWithinTotalMs(input: {
  captionDurationMs: number;
  sourceDurationMs: number;
  totalDurationMs?: number;
}): number {
  const sourceDurationMs = Math.max(500, Math.round(input.sourceDurationMs));
  const totalDurationMs = Number(input.totalDurationMs);
  if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0) {
    return sourceDurationMs;
  }

  return Math.min(
    sourceDurationMs,
    Math.max(500, Math.round(totalDurationMs - input.captionDurationMs))
  );
}

function resolvePreviewPostVideoPlaybackDurationMs(
  scenes: PreviewScene[],
  sceneIndex: number,
  post: CrawlPost | undefined
): number {
  const scene = scenes[sceneIndex];
  const timeline = getPreviewSceneTimeline(scene);
  const sourceDurationMs = timeline
    ? Math.max(1, timeline.end_ms - timeline.start_ms)
    : 0;
  const previousScene = scenes[sceneIndex - 1];
  const previousTimeline = getPreviewSceneTimeline(previousScene);

  if (
    post &&
    scene?.kind === "post_video" &&
    previousScene &&
    previousTimeline &&
    isPreviewVideoAfterCaption(previousScene, scene)
  ) {
    return resolvePreviewPostVideoDurationWithinTotalMs({
      captionDurationMs: Math.max(
        0,
        previousTimeline.end_ms - previousTimeline.start_ms
      ),
      sourceDurationMs,
      totalDurationMs: resolvePreviewConfiguredDurationMs(scene, post),
    });
  }

  return sourceDurationMs;
}

function applyPreviewMemeOverrides(
  scenes: PreviewScene[],
  memeBySceneId?: Record<string, SelectedMemeEntry | null | undefined>
): PreviewScene[] {
  if (!memeBySceneId || Object.keys(memeBySceneId).length === 0) {
    return scenes;
  }

  const hasSelection = (sceneId: string | undefined): boolean =>
    sceneId !== undefined &&
    Object.prototype.hasOwnProperty.call(memeBySceneId, sceneId);
  const getSourceKey = (scene: PreviewScene): string | undefined => {
    if (scene.scene?.dialogue_speaker || scene.kind === "post_video") {
      return undefined;
    }
    return (
      scene.scene?.comment_id ||
      scene.comment?.comment_id ||
      scene.scene?.post_id
    );
  };
  const getMemeAssetKey = (
    asset:
      | SelectedMemeEntry["image"]
      | MemeTransitionConfig["image"]
      | null
      | undefined
  ): string =>
    asset?.serverPath || asset?.mediaUrl || asset?.name || "";
  const getMemeKey = (
    meme: SelectedMemeEntry | MemeTransitionConfig | null | undefined
  ): string =>
    meme
      ? `${getMemeAssetKey(meme.image)}|${getMemeAssetKey(meme.audio)}|${meme.visualMode ?? "meme"}`
      : "";
  const selectedMemeKeys = new Set(
    Object.values(memeBySceneId)
      .filter((meme): meme is SelectedMemeEntry => Boolean(meme))
      .map(getMemeKey)
      .filter(Boolean)
  );
  const hasRelevantSelection = scenes.some((scene) =>
    hasSelection(getSourceKey(scene))
  );
  const isStaleSelectedMeme = (
    meme: SelectedMemeEntry | MemeTransitionConfig | null | undefined
  ): boolean => {
    const key = getMemeKey(meme);
    return Boolean(key && selectedMemeKeys.has(key));
  };
  const getDurationMs = (
    meme: SelectedMemeEntry | MemeTransitionConfig | null | undefined
  ): number =>
    meme ? getPreviewMemeDurationMs(meme) : 0;

  const affectedIndexes = new Set<number>();
  scenes.forEach((scene, index) => {
    const sourceKey = getSourceKey(scene);
    const previousScene = index > 0 ? scenes[index - 1] : undefined;
    const previousKey = previousScene ? getSourceKey(previousScene) : undefined;
    const hasCurrentSelection = hasSelection(sourceKey);
    const hasPreviousSelection = hasSelection(previousKey);
    const staleLead =
      !hasCurrentSelection &&
      !hasPreviousSelection &&
      isStaleSelectedMeme(scene.scene?.meme_transition);
    const staleTrailing =
      !hasCurrentSelection &&
      !hasPreviousSelection &&
      isStaleSelectedMeme(scene.scene?.trailing_meme_transition);

    if (
      hasRelevantSelection ||
      hasCurrentSelection ||
      hasPreviousSelection ||
      staleLead ||
      staleTrailing
    ) {
      affectedIndexes.add(index);
      if (hasCurrentSelection && index + 1 < scenes.length) {
        affectedIndexes.add(index + 1);
      }
    }
  });

  if (affectedIndexes.size === 0) {
    return scenes;
  }

  const nextScenes = scenes.map((previewScene, index) => {
    const sourceKey = getSourceKey(previewScene);
    const sourceSelection = hasSelection(sourceKey)
      ? memeBySceneId?.[sourceKey!]
      : undefined;
    const previousScene = index > 0 ? scenes[index - 1] : undefined;
    const previousKey = previousScene ? getSourceKey(previousScene) : undefined;
    const previousSelection = hasSelection(previousKey)
      ? memeBySceneId?.[previousKey!]
      : undefined;
    const hasCurrentSelection = hasSelection(sourceKey);
    const hasPreviousSelection = hasSelection(previousKey);
    const isAffected = affectedIndexes.has(index);

    if (!isAffected) {
      return previewScene;
    }

    if (previewScene.kind === "post_video") {
      return {
        ...previewScene,
        scene: previewScene.scene
          ? {
              ...previewScene.scene,
              meme_transition: null,
              trailing_meme_transition: undefined,
            }
          : undefined,
      };
    }

    const staleLead =
      !hasCurrentSelection &&
      !hasPreviousSelection &&
      isStaleSelectedMeme(previewScene.scene?.meme_transition);
    const staleTrailing =
      !hasCurrentSelection &&
      !hasPreviousSelection &&
      isStaleSelectedMeme(previewScene.scene?.trailing_meme_transition);
    const desiredLead =
      previousScene?.scene?.dialogue_speaker || previewScene.scene?.dialogue_speaker
        ? null
        : hasPreviousSelection
          ? previousSelection?.placement === "transition"
            ? previousSelection
            : null
          : hasCurrentSelection || hasRelevantSelection || staleLead
            ? null
            : previewScene.scene?.meme_transition;
    const desiredTrailing = hasSelection(sourceKey)
      ? isTrailingMemePlacement(sourceSelection?.placement) ||
        (sourceSelection?.placement === "transition" &&
          index === scenes.length - 1)
        ? sourceSelection
        : null
      : hasPreviousSelection || hasRelevantSelection || staleTrailing
        ? null
        : previewScene.scene?.trailing_meme_transition;

    const currentTimeline = previewScene.scene?.timeline;
    const currentDurationMs = currentTimeline
      ? Math.max(1, currentTimeline.end_ms - currentTimeline.start_ms)
      : 0;
    const baseDurationMs = Math.max(
      1,
      currentDurationMs -
        getDurationMs(previewScene.scene?.meme_transition) -
        getDurationMs(previewScene.scene?.trailing_meme_transition)
    );
    const hasImmediateSourceMeme =
      hasSelection(sourceKey) &&
      (isTrailingMemePlacement(sourceSelection?.placement) ||
        (sourceSelection?.placement === "transition" &&
          index + 1 < scenes.length &&
          !scenes[index + 1]?.scene?.dialogue_speaker));
    const nextDurationMs = currentTimeline
      ? hasImmediateSourceMeme && previewScene.scene
        ? getDurationMs(desiredLead) +
          getSceneNarrationDurationMs(previewScene.scene) +
          getDurationMs(desiredTrailing)
        : baseDurationMs +
          getDurationMs(desiredLead) +
          getDurationMs(desiredTrailing)
      : 0;

    return {
      ...previewScene,
      scene: previewScene.scene
        ? {
            ...previewScene.scene,
            meme_transition: desiredLead,
            trailing_meme_transition: desiredTrailing,
          }
        : undefined,
      timeline: currentTimeline
        ? {
            start_ms: currentTimeline.start_ms,
            end_ms: currentTimeline.start_ms + nextDurationMs,
          }
        : undefined,
    };
  });

  let cursor = nextScenes.find((scene) => scene.scene?.timeline)?.scene?.timeline
    ?.start_ms ?? 0;
  return nextScenes.map((previewScene) => {
    const timeline = previewScene.scene?.timeline;
    if (!timeline) {
      return previewScene;
    }

    const durationMs = Math.max(1, timeline.end_ms - timeline.start_ms);
    const nextTimeline = {
      start_ms: cursor,
      end_ms: cursor + durationMs,
    };
    cursor = nextTimeline.end_ms;
    return {
      ...previewScene,
      scene: previewScene.scene
        ? { ...previewScene.scene, timeline: nextTimeline }
        : undefined,
      timeline: nextTimeline,
    };
  });
}

function prependThumbnailPreviewScene(
  scenes: PreviewScene[],
  thumbnailIntro: VideoThumbnailIntro | null | undefined
): PreviewScene[] {
  if (!thumbnailIntro?.enabled || thumbnailIntro.durationMs <= 0) {
    return scenes;
  }

  return [
    {
      kind: "thumbnail",
      text: "",
      thumbnailIntro,
      timeline: {
        start_ms: 0,
        end_ms: thumbnailIntro.durationMs,
      },
    },
    ...scenes,
  ];
}

function rebasePreviewThumbnailDuration(
  scenes: PreviewScene[],
  previousThumbnailIntro: VideoThumbnailIntro | null | undefined,
  nextThumbnailIntro: VideoThumbnailIntro | null | undefined
): PreviewScene[] {
  const previousOffsetMs = previousThumbnailIntro?.enabled
    ? Math.max(0, previousThumbnailIntro.durationMs)
    : 0;
  const nextOffsetMs = nextThumbnailIntro?.enabled
    ? Math.max(0, nextThumbnailIntro.durationMs)
    : 0;
  const deltaMs = nextOffsetMs - previousOffsetMs;

  if (deltaMs === 0) {
    return scenes;
  }

  return scenes.map((previewScene) => {
    const draftScene = previewScene.scene;
    const timeline = draftScene?.timeline;
    if (!draftScene || !timeline) {
      return previewScene;
    }

    const startMs = Math.max(0, timeline.start_ms + deltaMs);
    const endMs = Math.max(startMs + 1, timeline.end_ms + deltaMs);
    return {
      ...previewScene,
      scene: {
        ...draftScene,
        timeline: {
          end_ms: endMs,
          start_ms: startMs,
        },
      },
    };
  });
}

function insertPromotionPreviewScenes(
  baseScenes: PreviewScene[],
  draft: VideoDraftDocument
): PreviewScene[] {
  const contentDurationMs = baseScenes.reduce(
    (maximum, scene) => Math.max(maximum, scene.scene?.timeline?.end_ms ?? 0),
    0
  );
  const midroll = draft.promotion?.midroll;
  const outro = draft.promotion?.outro;
  const midrollDurationMs = getPromotionDurationMs(midroll);
  const outroDurationMs = getPromotionDurationMs(outro);
  const middleTargetMs = contentDurationMs / 2;
  const middleBoundaries = baseScenes
    .slice(0, -1)
    .map((scene, index) => ({
      endMs: scene.scene?.timeline?.end_ms ?? 0,
      index,
    }))
    .filter(
      (boundary) =>
        boundary.endMs > 100 && boundary.endMs < contentDurationMs - 100
    );
  const midrollAfterIndex =
    midrollDurationMs > 0 && middleBoundaries.length > 0
      ? middleBoundaries.reduce((closest, candidate) =>
          Math.abs(candidate.endMs - middleTargetMs) <
          Math.abs(closest.endMs - middleTargetMs)
            ? candidate
            : closest
        ).index
      : -1;
  const result: PreviewScene[] = [];
  let insertedDurationMs = 0;

  baseScenes.forEach((scene, index) => {
    const sourceTimeline = scene.scene?.timeline;
    const shiftedTimeline = sourceTimeline
      ? {
          start_ms: sourceTimeline.start_ms + insertedDurationMs,
          end_ms: sourceTimeline.end_ms + insertedDurationMs,
        }
      : undefined;
    result.push({
      ...scene,
      scene: scene.scene
        ? { ...scene.scene, timeline: shiftedTimeline ?? scene.scene.timeline }
        : undefined,
      timeline: shiftedTimeline,
    });

    if (index !== midrollAfterIndex || !midroll || midrollDurationMs <= 0) {
      return;
    }

    const startMs = shiftedTimeline?.end_ms ?? contentDurationMs;
    result.push({
      kind: "promotion",
      promotion: { slot: "midroll", value: midroll },
      text: "",
      timeline: {
        start_ms: startMs,
        end_ms: startMs + midrollDurationMs,
      },
    });
    insertedDurationMs += midrollDurationMs;
  });

  if (outro && outroDurationMs > 0) {
    const startMs = contentDurationMs + insertedDurationMs;
    result.push({
      kind: "promotion",
      promotion: { slot: "outro", value: outro },
      text: "",
      timeline: {
        start_ms: startMs,
        end_ms: startMs + outroDurationMs,
      },
    });
  }

  return result;
}

function getPromotionDurationMs(
  slot: VideoPromotionSlot | null | undefined
): number {
  if (!(slot?.enabled && slot.video?.mediaUrl)) {
    return 0;
  }
  return Math.max(0, Number(slot.video.durationSeconds ?? 0) * 1000);
}

function getSceneMemeTransition(
  scenes: PreviewScene[],
  index: number,
  memeBySceneId:
    | Record<string, SelectedMemeEntry | null | undefined>
    | undefined,
  draft: VideoDraftDocument | null | undefined,
  post: CrawlPost | undefined,
  mode: "automatic" | "advanced" = "advanced"
): SelectedMemeEntry | MemeTransitionConfig | null {
  const currentPreviewScene = scenes[index];
  if (!currentPreviewScene) {
    return null;
  }
  if (currentPreviewScene.kind === "post_video") {
    return null;
  }

  const previousPreviewScene = index > 0 ? scenes[index - 1] : null;
  if (currentPreviewScene.scene?.dialogue_speaker) {
    return null;
  }
  const resolvedPreviousSceneKey =
    previousPreviewScene?.scene?.comment_id ||
    previousPreviewScene?.comment?.comment_id ||
    previousPreviewScene?.scene?.post_id ||
    (previousPreviewScene?.kind === "post" ? post?.post_id : undefined);

  const previousSelectedMeme =
    resolvedPreviousSceneKey !== undefined
      ? memeBySceneId?.[resolvedPreviousSceneKey]
      : undefined;
  if (
    previousPreviewScene?.scene?.trailing_meme_transition ||
    isTrailingMemePlacement(previousSelectedMeme?.placement)
  ) {
    return null;
  }

  const hasLocalMemeEdit =
    resolvedPreviousSceneKey !== undefined &&
    memeBySceneId &&
    resolvedPreviousSceneKey in memeBySceneId;
  if (hasLocalMemeEdit) {
    const selectedMeme = memeBySceneId[resolvedPreviousSceneKey!];
    return isTrailingMemePlacement(selectedMeme?.placement)
      ? null
      : selectedMeme ?? null;
  }

  const currentSceneKey =
    currentPreviewScene.scene?.comment_id ||
    currentPreviewScene.comment?.comment_id ||
    currentPreviewScene.scene?.post_id ||
    (currentPreviewScene.kind === "post" ? post?.post_id : undefined);
  if (
    mode === "automatic" &&
    currentSceneKey !== undefined &&
    memeBySceneId &&
    currentSceneKey in memeBySceneId
  ) {
    return null;
  }

  if (
    isTrailingMemePlacement(
      currentPreviewScene.scene?.meme_transition?.placement
    )
  ) {
    return null;
  }

  return (
    currentPreviewScene?.scene?.meme_transition ??
    (isFirstCommentPreviewScene(scenes, index) &&
    currentPreviewScene?.kind === "comment"
      ? (draft?.meme_transition ?? null)
      : null)
  );
}

/**
 * Returns the meme assigned to the CURRENT scene itself (trailing meme).
 * Used when the current scene is the last scene and needs to display its
 * meme AFTER narration finishes, not as a lead-in to a next scene.
 */
function getTrailingMemeTransition(
  scenes: PreviewScene[],
  index: number,
  memeBySceneId:
    | Record<string, SelectedMemeEntry | null | undefined>
    | undefined,
  post: CrawlPost | undefined
): SelectedMemeEntry | MemeTransitionConfig | null {
  const currentPreviewScene = scenes[index];
  if (!currentPreviewScene) {
    return null;
  }
  if (currentPreviewScene.kind === "post_video") {
    return null;
  }

  if (currentPreviewScene.scene?.dialogue_speaker) {
    const postId = currentPreviewScene.scene.post_id;
    let firstDialogueIndex = index;
    while (
      firstDialogueIndex > 0 &&
      scenes[firstDialogueIndex - 1]?.scene?.dialogue_speaker &&
      scenes[firstDialogueIndex - 1]?.scene?.post_id === postId
    ) {
      firstDialogueIndex -= 1;
    }

    let lastDialogueIndex = firstDialogueIndex;
    while (
      lastDialogueIndex + 1 < scenes.length &&
      scenes[lastDialogueIndex + 1]?.scene?.dialogue_speaker &&
      scenes[lastDialogueIndex + 1]?.scene?.post_id === postId
    ) {
      lastDialogueIndex += 1;
    }

    if (index < lastDialogueIndex) {
      return null;
    }

    if (currentPreviewScene.scene.trailing_meme_transition) {
      return currentPreviewScene.scene.trailing_meme_transition;
    }

    const firstDialogueScene = scenes[firstDialogueIndex];
    const previousScene = scenes[firstDialogueIndex - 1];
    const postKey =
      previousScene?.scene?.post_id ||
      (previousScene?.kind === "post" ? post?.post_id : undefined);
    if (postKey !== undefined && memeBySceneId && postKey in memeBySceneId) {
      const selectedMeme = memeBySceneId[postKey];
      return isTrailingMemePlacement(selectedMeme?.placement)
        ? selectedMeme ?? null
        : null;
    }

    const dialogueMeme = firstDialogueScene?.scene?.meme_transition;
    return isTrailingMemePlacement(dialogueMeme?.placement)
      ? dialogueMeme ?? null
      : null;
  }

  // A live local selection overrides any transition retained in an older draft.
  const currentSceneKey =
    currentPreviewScene.scene?.comment_id ||
    currentPreviewScene.comment?.comment_id ||
    currentPreviewScene.scene?.post_id ||
    (currentPreviewScene.kind === "post" ? post?.post_id : undefined);

    if (
      currentSceneKey !== undefined &&
      memeBySceneId &&
      currentSceneKey in memeBySceneId
  ) {
    const selectedMeme = memeBySceneId[currentSceneKey];
      if (isTrailingMemePlacement(selectedMeme?.placement)) {
        return selectedMeme ?? null;
      }

      if (
        selectedMeme?.placement === "transition" &&
        currentPreviewScene.scene?.trailing_meme_transition
      ) {
        return selectedMeme;
      }

      return null;
  }

  if (currentPreviewScene.scene?.trailing_meme_transition) {
    return currentPreviewScene.scene.trailing_meme_transition;
  }

  // Fall back to scene-level meme_transition
  return isTrailingMemePlacement(
    currentPreviewScene.scene?.meme_transition?.placement
  )
    ? currentPreviewScene.scene?.meme_transition ?? null
    : null;
}

function getPreviewSceneTimeline(
  scene: PreviewScene | undefined
): { end_ms: number; start_ms: number } | undefined {
  return scene?.timeline ?? scene?.scene?.timeline;
}

function getPreviewTrailingMemeStartMs(
  scene: PreviewScene,
  timeline: { end_ms: number; start_ms: number },
  trailingDurationMs: number
): number {
  const leadTransition = scene.scene?.meme_transition;
  const leadDurationMs =
    leadTransition?.placement === "transition"
      ? getPreviewMemeDurationMs(leadTransition)
      : 0;
  const narrationEndMs =
    timeline.start_ms +
    leadDurationMs +
    (scene.scene ? getSceneNarrationDurationMs(scene.scene) : 0);
  return Math.max(
    timeline.start_ms,
    Math.min(timeline.end_ms - trailingDurationMs, narrationEndMs)
  );
}

function getPreviewTrailingMemePlaybackDurationMs(
  scene: PreviewScene,
  configuredDurationMs: number
): number {
  const timeline = getPreviewSceneTimeline(scene);
  if (!timeline) {
    return configuredDurationMs;
  }

  const memeStartMs = getPreviewTrailingMemeStartMs(
    scene,
    timeline,
    configuredDurationMs
  );
  return Math.max(1, timeline.end_ms - memeStartMs);
}

function resolvePreviewSceneIndexAtTime(
  scenes: PreviewScene[],
  targetMs: number
): number {
  if (scenes.length === 0) {
    return 0;
  }

  const normalizedTargetMs = Math.max(0, targetMs);
  const lastIndex = scenes.length - 1;

  for (let index = 0; index < scenes.length; index += 1) {
    const timeline = getPreviewSceneTimeline(scenes[index]);
    if (!timeline) {
      continue;
    }

    const startMs = Math.max(0, timeline.start_ms);
    const endMs = Math.max(startMs + 1, timeline.end_ms);
    if (normalizedTargetMs < startMs) {
      return index;
    }
    if (normalizedTargetMs < endMs) {
      return index;
    }

    const nextTimeline = getPreviewSceneTimeline(scenes[index + 1]);
    if (
      nextTimeline &&
      normalizedTargetMs < Math.max(0, nextTimeline.start_ms)
    ) {
      // A transition gap belongs to the next scene for seeking purposes.
      return index + 1;
    }
  }

  return lastIndex;
}

function isFirstCommentPreviewScene(
  scenes: PreviewScene[],
  sceneIndex: number
): boolean {
  const scene = scenes[sceneIndex];
  if (scene?.kind !== "comment" || scene.scene?.dialogue_speaker) {
    return false;
  }

  for (let index = sceneIndex - 1; index >= 0; index -= 1) {
    const previousScene = scenes[index];
    if (!previousScene) {
      return false;
    }
    if (previousScene.scene?.post_id !== scene.scene?.post_id) {
      return false;
    }
    if (previousScene.scene?.dialogue_speaker) {
      continue;
    }
    return previousScene.kind === "post";
  }

  return false;
}

function normalizeText(value: string): string {
  return formatStructuredPreviewText(value);
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) {
    return `${trimZero((value / 1_000_000).toFixed(1))}M`;
  }
  if (value >= 1000) {
    return `${trimZero((value / 1000).toFixed(1))}K`;
  }
  return formatNumber(value);
}

function trimZero(value: string): string {
  return value.replace(/\.0$/, "");
}

function metricValueClassName(value: string): string {
  const length = String(value).trim().length;
  if (length >= 8) {
    return "whitespace-nowrap text-[0.39rem]";
  }
  if (length >= 7) {
    return "whitespace-nowrap text-[0.42rem]";
  }
  if (length >= 6) {
    return "whitespace-nowrap text-[0.46rem]";
  }
  if (length >= 5) {
    return "whitespace-nowrap text-[0.5rem]";
  }
  return "whitespace-nowrap text-[0.56rem]";
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

function getSceneAudioUrl(
  scene: VideoDraftScene | undefined,
  chunkIndex: number
): string {
  const chunks = scene?.narration?.chunks ?? [];
  return (
    chunks[chunkIndex]?.audio_url ||
    scene?.narration?.merged_audio_url ||
    scene?.narration?.audio_url ||
    ""
  );
}

function resolveSceneCreatedAt(
  commentCreatedAt: string | undefined,
  postCreatedAt: string | undefined
): string {
  return (
    String(commentCreatedAt ?? "").trim() || String(postCreatedAt ?? "").trim()
  );
}

function resolveChunkPosition(
  scene: VideoDraftScene,
  narrationOffsetMs: number
): { chunkIndex: number; chunkTimeSeconds: number } {
  const chunks = scene.narration.chunks ?? [];
  if (chunks.length === 0) {
    return { chunkIndex: 0, chunkTimeSeconds: 0 };
  }

  let remainingMs = Math.max(0, narrationOffsetMs);
  for (let index = 0; index < chunks.length; index++) {
    const chunkDurationMs = Math.max(0, chunks[index]?.duration_ms || 0);
    if (remainingMs <= chunkDurationMs || index === chunks.length - 1) {
      const clampedOffsetMs =
        chunkDurationMs > 0 ? Math.min(remainingMs, chunkDurationMs) : 0;
      return {
        chunkIndex: index,
        chunkTimeSeconds: clampedOffsetMs / 1000,
      };
    }
    remainingMs -= chunkDurationMs;
  }

  return { chunkIndex: 0, chunkTimeSeconds: 0 };
}

function getPreviewNarrationElapsedSeconds(
  scene: VideoDraftScene | undefined,
  activeChunkIndex: number,
  activeChunkTimeSeconds: number
): number {
  if (!scene) {
    return Math.max(0, activeChunkTimeSeconds);
  }

  const completedChunkSeconds = (scene.narration.chunks ?? [])
    .slice(0, activeChunkIndex)
    .reduce(
      (total, chunk) => total + Math.max(0, Number(chunk.duration_ms) || 0) / 1000,
      0
    );
  return completedChunkSeconds + Math.max(0, activeChunkTimeSeconds);
}

function getPreviewCurrentTimeMs({
  activeChunkIndex,
  audioTimeSeconds,
  currentMemeLeadMs,
  currentPreviewScene,
  isMemeTransitionActive,
  isTrailingMemeActive,
  memeTimeSeconds,
  postVideoTimeSeconds,
  promotionTimeSeconds,
  sceneHoldBaseMs,
  sceneHoldElapsedMs,
}: {
  activeChunkIndex: number;
  audioTimeSeconds: number;
  currentMemeLeadMs: number;
  currentPreviewScene: PreviewScene | undefined;
  isMemeTransitionActive: boolean;
  isTrailingMemeActive: boolean;
  memeTimeSeconds: number;
  postVideoTimeSeconds: number;
  promotionTimeSeconds: number;
  sceneHoldBaseMs: number | null;
  sceneHoldElapsedMs: number;
}): number {
  const timeline = getPreviewSceneTimeline(currentPreviewScene);
  if (!(currentPreviewScene && timeline)) {
    return 0;
  }

  const sceneStartMs = timeline.start_ms;
  const clampToSceneTimeline = (valueMs: number): number =>
    Math.min(
      timeline.end_ms,
      Math.max(sceneStartMs, Number.isFinite(valueMs) ? valueMs : sceneStartMs)
    );
  if (currentPreviewScene.kind === "promotion") {
    return clampToSceneTimeline(
      sceneStartMs + Math.max(0, promotionTimeSeconds * 1000)
    );
  }
  if (currentPreviewScene.kind === "post_video") {
    if (sceneHoldBaseMs !== null) {
      return Math.min(
        timeline.end_ms,
        sceneHoldBaseMs + Math.max(0, sceneHoldElapsedMs)
      );
    }
    return clampToSceneTimeline(
      sceneStartMs + Math.max(0, postVideoTimeSeconds * 1000)
    );
  }
  if (!currentPreviewScene.scene) {
    return sceneStartMs;
  }
  const memeLeadMs = Math.max(0, currentMemeLeadMs);

  if (isMemeTransitionActive) {
    const memeStartMs = isTrailingMemeActive
      ? getPreviewTrailingMemeStartMs(
          currentPreviewScene,
          timeline,
          memeLeadMs
        )
      : sceneStartMs;
    return clampToSceneTimeline(
      memeStartMs + Math.max(0, memeTimeSeconds * 1000)
    );
  }

  if (sceneHoldBaseMs !== null) {
    return Math.min(
      timeline.end_ms,
      sceneHoldBaseMs + Math.max(0, sceneHoldElapsedMs)
    );
  }

  const completedChunkMs = (currentPreviewScene.scene.narration.chunks ?? [])
    .slice(0, activeChunkIndex)
    .reduce((total, chunk) => total + Math.max(0, chunk.duration_ms || 0), 0);

  return clampToSceneTimeline(
    sceneStartMs +
      memeLeadMs +
      completedChunkMs +
      Math.max(0, audioTimeSeconds * 1000)
  );
}

function advanceAudio({
  activeChunkIndex,
  activeSceneIndex,
  chunkCount,
  currentScene,
  currentSceneMemeLeadMs,
  hasNextScene,
  nextScene,
  playbackIntentRef,
  sceneTransitionTimeoutRef,
  setAudioTimeSeconds,
  setActiveChunkIndex,
  setActiveSceneIndex,
  setIsPlaying,
  onSceneHoldStart,
  trailingMemeTransition,
  trailingMemeNextSceneIndexRef,
  setIsMemeTransitionActive,
  isTrailingMemeActiveRef,
}: {
  activeChunkIndex: number;
  activeSceneIndex: number;
  chunkCount: number;
  currentScene: VideoDraftScene | undefined;
  currentSceneMemeLeadMs: number;
  hasNextScene: boolean;
  nextScene: VideoDraftScene | undefined;
  playbackIntentRef: MutableRefObject<boolean>;
  sceneTransitionTimeoutRef: React.MutableRefObject<number | null>;
  setAudioTimeSeconds: React.Dispatch<React.SetStateAction<number>>;
  setActiveChunkIndex: React.Dispatch<React.SetStateAction<number>>;
  setActiveSceneIndex: React.Dispatch<React.SetStateAction<number>>;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  onSceneHoldStart?: (durationMs: number, baseMs: number) => void;
  trailingMemeTransition?: SelectedMemeEntry | MemeTransitionConfig | null;
  trailingMemeNextSceneIndexRef: MutableRefObject<number | null>;
  setIsMemeTransitionActive: React.Dispatch<React.SetStateAction<boolean>>;
  isTrailingMemeActiveRef: MutableRefObject<boolean>;
}): void {
  if (!playbackIntentRef.current) {
    return;
  }

  if (chunkCount > activeChunkIndex + 1) {
    setAudioTimeSeconds(0);
    setActiveChunkIndex((current) => current + 1);
    return;
  }

  if (sceneTransitionTimeoutRef.current !== null) {
    window.clearTimeout(sceneTransitionTimeoutRef.current);
  }

  const currentEndMs = currentScene?.timeline?.end_ms ?? 0;
  const currentStartMs = currentScene?.timeline?.start_ms ?? 0;
  const nextStartMs = nextScene?.timeline?.start_ms ?? currentEndMs;
  const narrationDurationMs = currentScene
    ? getSceneNarrationDurationMs(currentScene)
    : 0;
  const dialogueContinuation = Boolean(
    currentScene?.kind === "post" &&
      nextScene?.dialogue_speaker &&
      nextScene.post_id === currentScene.post_id
  );
  const audioDrivenEndMs =
    currentStartMs + currentSceneMemeLeadMs + narrationDurationMs;
  const effectiveCurrentEndMs = dialogueContinuation
    ? audioDrivenEndMs
    : currentEndMs;
  const totalSceneDurationMs = Math.max(
    0,
    effectiveCurrentEndMs - currentStartMs
  );
  const isPostSpoiler =
    currentScene?.kind === "post" && Boolean(currentScene?.spoiler);
  const hasSpoilerMedia = Boolean(currentScene?.spoiler?.has_media_spoiler);
  const minSpoilerHoldMs = isPostSpoiler ? (hasSpoilerMedia ? 1400 : 900) : 0;
  const remainingHoldMs = dialogueContinuation
    ? 0
    : Math.max(
        minSpoilerHoldMs,
        totalSceneDurationMs - currentSceneMemeLeadMs - narrationDurationMs
      );
  const rawGapMs = Math.max(0, nextStartMs - effectiveCurrentEndMs);
  const gapMs =
    currentScene?.dialogue_speaker || nextScene?.dialogue_speaker
      ? Math.min(rawGapMs, 180)
      : rawGapMs;
  const transitionDelayMs = remainingHoldMs + gapMs;
  const hasSourceTrailingMeme = Boolean(
    (currentScene?.kind === "post" || currentScene?.kind === "comment") &&
      hasPreviewMemePresentation(trailingMemeTransition)
  );
  if (hasSourceTrailingMeme) {
    const showTrailingMeme = () => {
      isTrailingMemeActiveRef.current = true;
      trailingMemeNextSceneIndexRef.current = hasNextScene
        ? activeSceneIndex + 1
        : null;
      setAudioTimeSeconds(0);
      setIsMemeTransitionActive(true);
      sceneTransitionTimeoutRef.current = null;
    };

    // An after-comment meme starts immediately after narration. Any remaining
    // scene duration is the meme itself, not an extra hold before it.
    showTrailingMeme();
    return;
  }

  const hasImmediateNextSceneMeme = Boolean(
    hasNextScene &&
      !nextScene?.dialogue_speaker &&
      nextScene?.meme_transition?.placement === "transition" &&
      hasPreviewMemePresentation(nextScene.meme_transition)
  );
  if (hasImmediateNextSceneMeme) {
    // A transition meme owns the handoff. Do not retain the post/comment hold
    // before switching to the next scene, otherwise preview stalls at narration end.
    setAudioTimeSeconds(0);
    setActiveChunkIndex(0);
    setActiveSceneIndex((current) => current + 1);
    return;
  }

  if (transitionDelayMs > 0) {
    onSceneHoldStart?.(
      transitionDelayMs,
      currentStartMs + currentSceneMemeLeadMs + narrationDurationMs
    );
  }

  sceneTransitionTimeoutRef.current = window.setTimeout(() => {
    if (!playbackIntentRef.current) {
      sceneTransitionTimeoutRef.current = null;
      return;
    }
    setAudioTimeSeconds(0);
    setActiveSceneIndex((current) => {
      if (!hasNextScene) {
        // If the last scene has a trailing meme, show it before stopping
        const hasTrailingMeme =
          hasPreviewMemePresentation(trailingMemeTransition);
        if (hasTrailingMeme) {
          isTrailingMemeActiveRef.current = true;
          setIsMemeTransitionActive(true);
          return current; // stay on last scene while meme plays
        }
        playbackIntentRef.current = false;
        setActiveChunkIndex(0);
        setIsPlaying(false);
        return 0;
      }
      setActiveChunkIndex(0);
      return current + 1;
    });
    sceneTransitionTimeoutRef.current = null;
  }, transitionDelayMs);
}

function getSceneNarrationDurationMs(scene: VideoDraftScene): number {
  if ((scene.narration.total_duration_ms ?? 0) > 0) {
    return Math.max(0, scene.narration.total_duration_ms || 0);
  }

  const chunks = scene.narration.chunks ?? [];
  const chunkDurationMs = chunks.reduce(
    (total, chunk) => total + Math.max(0, chunk.duration_ms || 0),
    0
  );
  return chunkDurationMs;
}

async function tryPlayPreviewNarration({
  audioRef,
  previewAudioContextRef,
  setAudioBlocked,
}: {
  audioRef: MutableRefObject<HTMLAudioElement | null>;
  previewAudioContextRef: MutableRefObject<AudioContext | null>;
  setAudioBlocked: Dispatch<SetStateAction<boolean>>;
}): Promise<void> {
  const audio = audioRef.current;
  if (!(audio && audio.paused)) {
    return;
  }

  try {
    await resumePreviewAudioContext(previewAudioContextRef.current);
    audio.playbackRate = VOICE_PLAYBACK_RATE;
    const durationSeconds = Number(audio.duration);
    if (
      audio.ended ||
      (Number.isFinite(durationSeconds) &&
        durationSeconds > 0 &&
        audio.currentTime >= durationSeconds - 0.05)
    ) {
      audio.currentTime = 0;
    }
    setAudioBlocked(false);
    await audio.play();
  } catch (error) {
    if (isIgnorableMediaPlaybackError(error)) {
      return;
    }
    setAudioBlocked(true);
  }
}

function isIgnorableMediaPlaybackError(error: unknown): boolean {
  const name =
    typeof error === "object" && error && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  return name === "AbortError";
}

async function resumePreviewAudioContext(
  audioContext: AudioContext | null
): Promise<void> {
  if (!audioContext || audioContext.state === "running") {
    return;
  }

  await audioContext.resume();
}

function normalizeNarrationGain(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PREVIEW_NARRATION_GAIN;
  }

  return Math.min(3, Math.max(0, value ?? DEFAULT_PREVIEW_NARRATION_GAIN));
}

function normalizeBackgroundMusicVolume(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_BACKGROUND_MUSIC_VOLUME;
  }
  return Math.min(1, Math.max(0, value ?? DEFAULT_BACKGROUND_MUSIC_VOLUME));
}
