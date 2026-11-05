import { useEffect, useRef, useState } from "react";
import {
  getVideoThumbnailSettings,
  updateVideoThumbnailSettings,
  type VideoThumbnailIntro,
} from "@/lib/api";
import type {
  CrawlPost,
  VideoDraftDocument,
} from "@/lib/api";
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
  safeSessionStorageGetItem,
  safeSessionStorageSetItem,
} from "@/lib/safe-storage";
import type { LocalVideoState } from "./selected-posts-panel";
import type { SelectedMemeEntry } from "./video-post-list-card-v2";
import { VideoPreviewStage } from "./video-preview-stage";
import {
  DEFAULT_THUMBNAIL_INTRO,
  getSavedThumbnailChannelName,
  resolveThumbnailIntroForPost,
  VideoThumbnailEditor,
} from "./video-thumbnail-editor";

const VIDEO_THUMBNAIL_STATE_PREFIX = "videoWorkflow.thumbnailIntro.";

export const VideoPreviewTabs = ({
  cardTheme,
  draft,
  memeBySceneId,
  mode = "advanced",
  onThumbnailChange,
  playPostVideoAfterCaption = false,
  post,
  thumbnailIntro,
  thumbnailStorageKey,
  uploadedVideo,
}: {
  cardTheme?: "light" | "dark";
  draft?: VideoDraftDocument | null;
  memeBySceneId?: Record<string, SelectedMemeEntry | null | undefined>;
  mode?: "automatic" | "advanced";
  onThumbnailChange: (value: VideoThumbnailIntro | null) => void;
  playPostVideoAfterCaption?: boolean;
  post?: CrawlPost;
  thumbnailIntro: VideoThumbnailIntro | null;
  thumbnailStorageKey?: string;
  uploadedVideo: LocalVideoState | null;
}) => {
  const [tab, setTab] = useState<"thumbnail" | "video">("video");
  const accentBorderClass =
    mode === "automatic"
      ? "border-emerald-500/45"
      : "border-pink-500/45";
  const accentActiveClass =
    mode === "automatic" ? "bg-emerald-600" : "bg-pink-600";
  // Keep a separate template per selected crawl file. The post overrides are
  // stored inside this snapshot, so changing posts does not discard edits.
  const normalizedStorageScope = thumbnailStorageKey?.trim() || "shared";
  const storageKey = `${VIDEO_THUMBNAIL_STATE_PREFIX}${mode}.${encodeURIComponent(
    normalizedStorageScope
  )}`;
  const legacySharedStorageKey = `${VIDEO_THUMBNAIL_STATE_PREFIX}${mode}.shared`;
  const legacyStorageKey = thumbnailStorageKey
    ? VIDEO_THUMBNAIL_STATE_PREFIX + thumbnailStorageKey
    : "";
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const [loadedServerMode, setLoadedServerMode] = useState<string | null>(null);
  const serverSaveTimerRef = useRef<number | null>(null);
  const serverSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestThumbnailRef = useRef<VideoThumbnailIntro | null>(thumbnailIntro);
  const serverModeRef = useRef<string | null>(null);
  const hasLocalThumbnailRef = useRef(false);
  // Keep the non-post-specific template as the source of truth while the
  // editor displays a post-specific title.
  const sharedThumbnailIntroRef = useRef<VideoThumbnailIntro | null>(
    thumbnailIntro
  );
  const persistLocalThumbnailIntro = (value: VideoThumbnailIntro | null) => {
    if (!storageKey || !value) {
      return;
    }

    const serialized = JSON.stringify(value);
    safeLocalStorageSetItem(storageKey, serialized);
    safeSessionStorageSetItem(storageKey, serialized);
  };
  const queueServerThumbnailSave = (snapshot: VideoThumbnailIntro) => {
    serverSaveQueueRef.current = serverSaveQueueRef.current
      .catch(() => undefined)
      .then(() =>
        updateVideoThumbnailSettings({
          mode,
          thumbnailIntro: snapshot,
        }).then(() => undefined),
      )
      .catch(() => undefined);
  };
  const thumbnailIntroForPost = resolveThumbnailIntroForPost(thumbnailIntro, post);
  const handleThumbnailChange = (value: VideoThumbnailIntro | null) => {
    if (!value || !post) {
      sharedThumbnailIntroRef.current = value;
      persistLocalThumbnailIntro(value);
      onThumbnailChange(value);
      return;
    }

    const sharedThumbnailIntro =
      sharedThumbnailIntroRef.current ?? thumbnailIntro ?? value;
    const {
      postOverridesByPostId: _nestedPostOverrides,
      titleOverridesByPostId: _postTitleOverrides,
      ...postOverride
    } = value;
    const nextThumbnailIntro = {
      ...sharedThumbnailIntro,
      ...value,
      postOverridesByPostId: {
        ...sharedThumbnailIntro.postOverridesByPostId,
        [post.post_id]: postOverride,
      },
      titleOverridesByPostId: {
        ...sharedThumbnailIntro.titleOverridesByPostId,
        ...value.titleOverridesByPostId,
        [post.post_id]: value.title,
      },
    };
    sharedThumbnailIntroRef.current = nextThumbnailIntro;
    persistLocalThumbnailIntro(nextThumbnailIntro);
    onThumbnailChange(nextThumbnailIntro);
  };

  useEffect(() => {
    sharedThumbnailIntroRef.current = thumbnailIntro;
    latestThumbnailRef.current = thumbnailIntro;
  }, [thumbnailIntro]);

  useEffect(() => {
    serverModeRef.current = loadedServerMode;
  }, [loadedServerMode]);

  useEffect(() => {
    if (!storageKey) {
      if (loadedStorageKey !== null) {
        setLoadedStorageKey(null);
      }
      return;
    }

    if (loadedStorageKey === storageKey) {
      return;
    }

    hasLocalThumbnailRef.current = false;
    const storageCandidates = [
      storageKey,
      legacyStorageKey,
      legacySharedStorageKey,
    ].filter(
      (candidate, index, candidates) =>
        Boolean(candidate) && candidates.indexOf(candidate) === index,
    );
    let raw: string | null = null;
    let sourceStorageKey = "";
    for (const candidate of storageCandidates) {
      const localValue = safeLocalStorageGetItem(candidate);
      const sessionValue =
        localValue ?? safeSessionStorageGetItem(candidate);
      if (sessionValue !== null) {
        raw = sessionValue;
        sourceStorageKey = candidate;
        break;
      }
    }
    let storedThumbnail: VideoThumbnailIntro | null = null;
    if (raw) {
      try {
        storedThumbnail = JSON.parse(raw) as VideoThumbnailIntro;
        hasLocalThumbnailRef.current = Boolean(storedThumbnail);
      } catch {
        storedThumbnail = null;
      }
    }
    if (!storedThumbnail && draft?.thumbnail_intro) {
      storedThumbnail = draft.thumbnail_intro;
      hasLocalThumbnailRef.current = true;
    }
    if (storedThumbnail && sourceStorageKey !== storageKey) {
      persistLocalThumbnailIntro(storedThumbnail);
    }
    onThumbnailChange(storedThumbnail);
    setLoadedStorageKey(storageKey);
  }, [
    draft,
    legacySharedStorageKey,
    legacyStorageKey,
    loadedStorageKey,
    onThumbnailChange,
    storageKey,
  ]);

  useEffect(() => {
    let cancelled = false;
    setLoadedServerMode(null);

    void getVideoThumbnailSettings(mode)
      .then((response) => {
        if (cancelled) {
          return;
        }
        // A file-scoped local/draft snapshot is newer than the global server
        // template. Do not let a stale server response erase that edit.
        if (response.thumbnailIntro && !hasLocalThumbnailRef.current) {
          persistLocalThumbnailIntro(response.thumbnailIntro);
          onThumbnailChange(response.thumbnailIntro);
        }
        setLoadedServerMode(mode);
      })
      .catch(() => {
        // Keep localStorage/draft fallback usable when running an older server.
        if (!cancelled) {
          setLoadedServerMode(mode);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mode, onThumbnailChange, storageKey]);

  useEffect(() => {
    if (loadedServerMode !== mode || !thumbnailIntro) {
      return;
    }

    if (serverSaveTimerRef.current !== null) {
      window.clearTimeout(serverSaveTimerRef.current);
    }

    const snapshot = thumbnailIntro;
    serverSaveTimerRef.current = window.setTimeout(() => {
      serverSaveTimerRef.current = null;
      queueServerThumbnailSave(snapshot);
    }, 250);

    return () => {
      if (serverSaveTimerRef.current !== null) {
        window.clearTimeout(serverSaveTimerRef.current);
        serverSaveTimerRef.current = null;
      }
    };
  }, [loadedServerMode, mode, thumbnailIntro]);

  useEffect(
    () => () => {
      if (serverSaveTimerRef.current !== null) {
        window.clearTimeout(serverSaveTimerRef.current);
        serverSaveTimerRef.current = null;
      }
      const latestThumbnail = latestThumbnailRef.current;
      if (serverModeRef.current === mode && latestThumbnail) {
        queueServerThumbnailSave(latestThumbnail);
      }
    },
    [mode],
  );

  useEffect(() => {
    if (!(storageKey && loadedStorageKey === storageKey && thumbnailIntro)) {
      return;
    }

    const serialized = JSON.stringify(thumbnailIntro);
    safeLocalStorageSetItem(storageKey, serialized);
    safeSessionStorageSetItem(storageKey, serialized);
  }, [loadedStorageKey, storageKey, thumbnailIntro]);

  useEffect(() => {
    if (
      (!storageKey || loadedStorageKey === storageKey) &&
      !thumbnailIntro &&
      post
    ) {
      onThumbnailChange({
        ...DEFAULT_THUMBNAIL_INTRO,
        channelName: getSavedThumbnailChannelName() || undefined,
        mode,
        title: post.text.slice(0, 160),
      });
    }
  }, [
    loadedStorageKey,
    mode,
    onThumbnailChange,
    post,
    storageKey,
    thumbnailIntro,
  ]);

  useEffect(() => {
    if (thumbnailIntro && thumbnailIntro.mode !== mode) {
      onThumbnailChange({ ...thumbnailIntro, mode });
    }
  }, [mode, onThumbnailChange, thumbnailIntro]);

  useEffect(() => {
    if (
      thumbnailIntro?.brandImageSizePercent === 72 ||
      thumbnailIntro?.brandImageSizePercent === 78 ||
      thumbnailIntro?.brandImageSizePercent === 85
    ) {
      onThumbnailChange({ ...thumbnailIntro, brandImageSizePercent: 92 });
    }
  }, [onThumbnailChange, thumbnailIntro]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
      <div
        className={[
          "grid shrink-0 grid-cols-2 gap-1 rounded-xl border bg-card p-1",
          accentBorderClass,
        ].join(" ")}
      >
        <button
          className={[
            "rounded-lg px-3 py-2 font-semibold text-xs transition-colors",
            tab === "thumbnail"
              ? accentActiveClass + " text-white"
              : "text-muted-foreground hover:bg-muted",
          ].join(" ")}
          onClick={() => setTab("thumbnail")}
          type="button"
        >
          Thumbnail
        </button>
        <button
          className={[
            "rounded-lg px-3 py-2 font-semibold text-xs transition-colors",
            tab === "video"
              ? accentActiveClass + " text-white"
              : "text-muted-foreground hover:bg-muted",
          ].join(" ")}
          onClick={() => setTab("video")}
          type="button"
        >
          Preview video
        </button>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <div
          className={[
            "h-full min-h-0 min-w-0",
            tab === "thumbnail" ? "block" : "hidden",
          ].join(" ")}
        >
          <VideoThumbnailEditor
            key={post?.post_id ?? "no-post"}
            mode={mode}
            onChange={handleThumbnailChange}
            post={post}
            value={thumbnailIntroForPost}
          />
        </div>
        <div
          className={[
            "h-full min-h-0 min-w-0",
            tab === "video" ? "block" : "hidden",
          ].join(" ")}
        >
          <VideoPreviewStage
            cardTheme={cardTheme}
            draft={draft}
            memeBySceneId={memeBySceneId}
            mode={mode}
            post={post}
            playPostVideoAfterCaption={playPostVideoAfterCaption}
            thumbnailIntro={thumbnailIntroForPost}
            uploadedVideo={uploadedVideo}
          />
        </div>
      </div>
    </div>
  );
};
