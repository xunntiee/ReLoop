import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, RefreshCw } from "lucide-react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AppReadinessPanel,
  useAppReadiness,
} from "@/features/app-shell/app-readiness";
import {
  type CrawlComment,
  type CrawlPost,
  generateVideoTtsSuggestions,
  getCrawlOutputFile,
  getCrawlOutputs,
  getDefaultCommentAvatar,
  getMemeLibrary,
  getUploadedBackgroundMusic,
  getUploadedPromotionVideos,
  getUploadedVideoBackgrounds,
  getVivibeVoices,
  updateCrawlOutputPost,
  uploadCommentAsset,
  uploadDefaultCommentAvatar,
    type VideoDraftDocument,
    type VideoThumbnailIntro,
    type VideoTtsProcessingMeta,
} from "@/lib/api";
import { formatOutputDisplayLabel } from "@/lib/formatters";
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
  safeSessionStorageGetItem,
  safeSessionStorageSetItem,
} from "@/lib/safe-storage";
import {
  type LocalVideoState,
  SelectedPostsPanel,
} from "./selected-posts-panel";
import {
  type SelectedMemeEntry,
  VideoPostListCardV2,
} from "./video-post-list-card-v2";
import { VideoPreviewTabs } from "./video-preview-tabs";
import { VideoRenderJobsPanel } from "./video-render-job-list";

// --- V2-specific storage keys (completely separate from V1) ---
const VIDEO_WORKFLOW_V2_ACTIVE_FILE_KEY = "videoWorkflowV2.activeFile";
const VIDEO_WORKFLOW_V2_FILE_STATE_PREFIX = "videoWorkflowV2.fileState.";
const VIDEO_WORKFLOW_V2_MEME_STATE_PREFIX = "videoWorkflowV2.memeState.";
const OUTPUT_PREVIEW_STALE_TIME_MS = 5 * 60_000;
const outputFileQueryKey = (filename: string) =>
  ["crawl-output-file-v2", filename] as const;

interface StoredVideoWorkflowFileState {
  expandedPostId: string | null;
  postEditsById: Record<
    string,
    {
      commentOrder?: string[];
      text: string;
      tts_text?: string;
      is_spoiler?: boolean;
      spoiler_initial_text?: string;
      spoiler_reveal_text?: string;
      spoiler_media?: boolean;
      spoiler_style?: "blur" | "hide";
      topCommentsById: Record<
        string,
        {
          media?: CrawlComment["media"];
          selected_for_video: boolean;
          source_signature?: string;
          text: string;
          tts_text?: string;
          video_like_count?: number;
          video_reply_count?: number;
          video_share_count?: number;
          is_spoiler?: boolean;
          spoiler_initial_text?: string;
          spoiler_reveal_text?: string;
          spoiler_media?: boolean;
          spoiler_style?: "blur" | "hide";
        }
      >;
    }
  >;
  selectedPostIds: string[];
}

const DEFAULT_VIDEO_COMMENT_ID = "__default_monback_comment__";
const DEFAULT_VIDEO_COMMENT_USERNAME = "monback.app";
const DEFAULT_VIDEO_COMMENT_DISPLAY_NAME = "monback.app";
const DEFAULT_VIDEO_COMMENT_AVATAR_PATH =
  "data/processed/video_uploads/_comment_assets/default-monback-avatar.jpg";
const DEFAULT_VIDEO_COMMENT_AVATAR_URL =
  "/media/data/processed/video_uploads/_comment_assets/default-monback-avatar.jpg";
const DEFAULT_VIDEO_COMMENT_LIKE_COUNT = 12_847;
const DEFAULT_VIDEO_COMMENT_REPLY_COUNT = 986;
const DEFAULT_VIDEO_COMMENT_REPOST_COUNT = 0;
const DEFAULT_VIDEO_COMMENT_SHARE_COUNT = 0;

interface UploadedMediaDimensions {
  height: number;
  width: number;
}

export const VideoPageV2 = () => {
  const readiness = useAppReadiness();
  const queryClient = useQueryClient();
  const [selectedOutputFile, setSelectedOutputFile] = useState<string>(
    () =>
      safeLocalStorageGetItem(VIDEO_WORKFLOW_V2_ACTIVE_FILE_KEY) ??
      safeSessionStorageGetItem(VIDEO_WORKFLOW_V2_ACTIVE_FILE_KEY) ??
      ""
  );
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(
    new Set()
  );
  const [editablePosts, setEditablePosts] = useState<CrawlPost[]>([]);
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [savingPostId, setSavingPostId] = useState<string | null>(null);
  const [uploadingAssetKey, setUploadingAssetKey] = useState<string | null>(
    null
  );
  const [postStatusById, setPostStatusById] = useState<Record<string, string>>(
    {}
  );
  const [previewPost, setPreviewPost] = useState<CrawlPost | undefined>(
    undefined
  );
  const [previewDraft, setPreviewDraft] = useState<VideoDraftDocument | null>(
    null
  );
  const [previewVideo, setPreviewVideo] = useState<LocalVideoState | null>(
    null
  );
  const [playPostVideoAfterCaption, setPlayPostVideoAfterCaption] =
    useState(false);
  const [thumbnailIntro, setThumbnailIntro] = useState<VideoThumbnailIntro | null>(null);
  const [generatingTtsPostId, setGeneratingTtsPostId] = useState<string | null>(
    null
  );
  const [uploadingAvatarKey, setUploadingAvatarKey] = useState<boolean>(false);
  const [cardTheme, setCardTheme] = useState<"light" | "dark">(() => {
    const saved = safeLocalStorageGetItem("cardTheme");
    return saved === "dark" ? "dark" : "light";
  });
  // Per-scene meme selections (keyed by post_id or comment_id) – V2 only
  const [memeBySceneId, setMemeBySceneId] = useState<
    Record<string, SelectedMemeEntry | null>
  >((): Record<string, SelectedMemeEntry | null> => ({}));
  const hydratedFileStateKeyRef = useRef("");

  const outputFilesQuery = useQuery({
    gcTime: 30 * 60_000,
    queryFn: () => getCrawlOutputs({ includeRequestMeta: false }),
    queryKey: ["crawl-outputs", "summary"],
    staleTime: 30_000,
  });

  const uploadedVideosQuery = useQuery({
    gcTime: 30 * 60_000,
    queryFn: getUploadedVideoBackgrounds,
    queryKey: ["video-uploads"],
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });
  const uploadedMusicQuery = useQuery({
    gcTime: 30 * 60_000,
    queryFn: getUploadedBackgroundMusic,
    queryKey: ["music-uploads"],
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });
  const promotionVideosQuery = useQuery({
    gcTime: 30 * 60_000,
    queryFn: getUploadedPromotionVideos,
    queryKey: ["promotion-video-uploads"],
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });
  const vivibeVoicesQuery = useQuery({
    enabled: readiness.vivibeConfigured,
    queryFn: getVivibeVoices,
    queryKey: ["vivibe-voices"],
    refetchInterval: 10 * 60_000,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });

  const outputFiles = outputFilesQuery.data?.outputs ?? [];
  const availableMusic = uploadedMusicQuery.data?.tracks ?? [];
  const availableVideos = uploadedVideosQuery.data?.videos ?? [];
  const availablePromotionVideos = promotionVideosQuery.data?.videos ?? [];
  const memeLibraryQuery = useQuery({
    gcTime: 30 * 60_000,
    queryFn: getMemeLibrary,
    queryKey: ["meme-library"],
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });
  const defaultAvatarQuery = useQuery({
    gcTime: 30 * 60_000,
    queryFn: getDefaultCommentAvatar,
    queryKey: ["default-comment-avatar"],
    refetchOnWindowFocus: false,
    staleTime: 30 * 60_000,
  });
  const defaultAvatarData = defaultAvatarQuery.data?.avatar ?? null;
  const memeLibraryItems = memeLibraryQuery.data?.items ?? [];
  const selectedOutputMeta = outputFiles.find(
    (file) => file.filename === selectedOutputFile
  );

  const fileOutputQuery = useQuery({
    enabled: Boolean(selectedOutputFile),
    gcTime: 30 * 60_000,
    queryFn: () => getCrawlOutputFile(selectedOutputFile),
    queryKey: outputFileQueryKey(selectedOutputFile),
    refetchOnWindowFocus: false,
    staleTime: OUTPUT_PREVIEW_STALE_TIME_MS,
  });

  const previewData = fileOutputQuery.data;
  const topics = useMemo(
    () => previewData?.output ?? [],
    [previewData?.output]
  );
  const posts = editablePosts;
  const selectedPosts = useMemo(
    () =>
      posts
        .filter((post) => selectedPostIds.has(post.post_id))
        .map(filterPostForVideo),
    [posts, selectedPostIds]
  );
  const deferredSelectedPosts = useDeferredValue(selectedPosts);
  const hasPosts = posts.length > 0;
  const allPostsSelected = hasPosts && selectedPostIds.size === posts.length;
  const featuredPost =
    (previewPost &&
      posts.find((post) => post.post_id === previewPost.post_id)) ??
    selectedPosts[0] ??
    posts[0];
  const outputPath =
    previewData?.outputPath ?? selectedOutputMeta?.outputPath ?? "";

  // ─── Load persisted meme state when file changes ──────────────────────────
  useEffect(() => {
    if (!selectedOutputFile) {
      setMemeBySceneId({});
      return;
    }
    try {
      const key = `${VIDEO_WORKFLOW_V2_MEME_STATE_PREFIX}${selectedOutputFile}`;
      const raw =
        safeLocalStorageGetItem(key) ?? safeSessionStorageGetItem(key);
      setMemeBySceneId(
        raw ? (JSON.parse(raw) as Record<string, SelectedMemeEntry | null>) : {}
      );
    } catch {
      setMemeBySceneId({});
    }
  }, [selectedOutputFile]);

  useEffect(() => {
    if (!selectedOutputFile) {
      hydratedFileStateKeyRef.current = "";
      setEditablePosts([]);
      setSelectedPostIds(new Set());
      setExpandedPostId(null);
      return;
    }
    if (
      !previewData ||
      (previewData.file?.filename &&
        previewData.file.filename !== selectedOutputFile)
    ) {
      return;
    }

    const normalizedPosts = topics
      .flatMap((topic) => topic.posts)
      .map((post) => normalizeEditablePost(post, defaultAvatarData));
    const storedState = readStoredVideoWorkflowFileState(selectedOutputFile);
    const hydratedPosts = applyStoredVideoWorkflowState(
      normalizedPosts,
      storedState
    );

    setEditablePosts(hydratedPosts);
    setSelectedPostIds(
      new Set(
        (storedState?.selectedPostIds ?? []).filter((postId) =>
          hydratedPosts.some((post) => post.post_id === postId)
        )
      )
    );
    setExpandedPostId(
      storedState?.expandedPostId &&
        hydratedPosts.some(
          (post) => post.post_id === storedState.expandedPostId
        )
        ? storedState.expandedPostId
        : null
    );
    setPostStatusById({});
    setPreviewDraft(null);
    setPreviewPost(undefined);
    setPreviewVideo(null);
    hydratedFileStateKeyRef.current = selectedOutputFile;
  }, [defaultAvatarData, previewData, selectedOutputFile, topics]);

  useEffect(() => {
    safeLocalStorageSetItem(
      VIDEO_WORKFLOW_V2_ACTIVE_FILE_KEY,
      selectedOutputFile
    );
    safeSessionStorageSetItem(
      VIDEO_WORKFLOW_V2_ACTIVE_FILE_KEY,
      selectedOutputFile
    );
  }, [selectedOutputFile]);

  useEffect(() => {
    if (
      !selectedOutputFile ||
      hydratedFileStateKeyRef.current !== selectedOutputFile
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      writeStoredVideoWorkflowFileState(selectedOutputFile, {
        expandedPostId,
        postEditsById: buildStoredPostEdits(editablePosts),
        selectedPostIds: [...selectedPostIds],
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [editablePosts, expandedPostId, selectedOutputFile, selectedPostIds]);

  useEffect(() => {
    const handler = (event: Event) => {
      const theme = (event as CustomEvent<string>).detail;
      setCardTheme(theme === "dark" ? "dark" : "light");
    };
    window.addEventListener("cardThemeChange", handler);
    return () => window.removeEventListener("cardThemeChange", handler);
  }, []);

  const toggleSelectedPost = (postId: string) => {
    setSelectedPostIds((current) => {
      const next = new Set(current);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  };

  const toggleSelectAllPosts = () => {
    setSelectedPostIds((current) => {
      if (posts.length === 0) {
        return current;
      }
      if (current.size === posts.length) {
        return new Set();
      }
      return new Set(posts.map((post) => post.post_id));
    });
  };

  const updateEditablePost = (
    postId: string,
    updater: (post: CrawlPost) => CrawlPost
  ) => {
    setEditablePosts((current) =>
      current.map((post) => (post.post_id === postId ? updater(post) : post))
    );
    setPostStatusById((current) => ({
      ...current,
      [postId]: "Co thay doi chua luu.",
    }));
  };

  const handlePostTextChange = (postId: string, value: string) => {
    updateEditablePost(postId, (post) => ({
      ...post,
      text: value,
    }));
    setPreviewDraft(null);
  };

  const handlePostSpoilerFieldsChange = (
    postId: string,
    fields: {
      is_spoiler?: boolean;
      spoiler_initial_text?: string;
      spoiler_reveal_text?: string;
      spoiler_media?: boolean;
      spoiler_style?: "blur" | "hide";
      tts_text?: string;
    }
  ) => {
    updateEditablePost(postId, (post) => {
      const nextIsSpoiler = fields.is_spoiler ?? post.is_spoiler ?? false;
      const nextInitial = fields.spoiler_initial_text ?? post.spoiler_initial_text ?? post.text;
      const nextReveal = fields.spoiler_reveal_text ?? post.spoiler_reveal_text ?? "";
      const shouldRefreshSpoilerTts =
        fields.tts_text !== undefined ||
        fields.is_spoiler !== undefined ||
        fields.spoiler_initial_text !== undefined ||
        fields.spoiler_reveal_text !== undefined;
      const synthesizedTts = nextIsSpoiler
        ? shouldRefreshSpoilerTts
          ? (fields.tts_text ??
            `${nextInitial}${nextReveal ? "\n" + nextReveal : ""}`.trim())
          : (post.tts_text ??
            `${nextInitial}${nextReveal ? "\n" + nextReveal : ""}`.trim())
        : (fields.tts_text ?? post.tts_text);

      return {
        ...post,
        ...fields,
        is_spoiler: nextIsSpoiler,
        ...(nextIsSpoiler ? { spoiler_initial_text: nextInitial, tts_text: synthesizedTts } : {}),
      };
    });
    setPreviewDraft(null);
  };

  const handlePostTtsTextChange = (postId: string, value: string) => {
    updateEditablePost(postId, (post) => ({
      ...post,
      tts_text: value,
    }));
  };

  const handleCommentTextChange = (
    postId: string,
    commentId: string,
    value: string
  ) => {
    updateEditablePost(postId, (post) => ({
      ...post,
      top_comments: post.top_comments.map((comment) => {
        if (comment.comment_id !== commentId) {
          return comment;
        }
        return {
          ...comment,
          text: value,
        };
      }),
    }));
    setPreviewDraft(null);
  };

  const handleCommentTtsTextChange = (
    postId: string,
    commentId: string,
    value: string
  ) => {
    updateEditablePost(postId, (post) => ({
      ...post,
      top_comments: post.top_comments.map((comment) =>
        comment.comment_id === commentId
          ? { ...comment, tts_text: value }
          : comment
      ),
    }));
  };

  const handleCommentMetricsChange = (
    postId: string,
    commentId: string,
    fields: {
      video_like_count: number | null;
      video_reply_count: number | null;
      video_share_count: number | null;
    }
  ) => {
    updateEditablePost(postId, (post) => ({
      ...post,
      top_comments: post.top_comments.map((comment) =>
        comment.comment_id === commentId
          ? {
              ...comment,
              video_like_count: fields.video_like_count ?? undefined,
              video_reply_count: fields.video_reply_count ?? undefined,
              video_share_count: fields.video_share_count ?? undefined,
            }
          : comment
      ),
    }));
    setPreviewDraft(null);
  };

  const handleGenerateTtsSuggestions = async (postId: string) => {
    const post = editablePosts.find((item) => item.post_id === postId);
    if (!post) {
      return;
    }

    try {
      setGeneratingTtsPostId(postId);
      setPostStatusById((current) => ({
        ...current,
        [postId]: "Dang tao goi y TTS...",
      }));
      const response = await generateVideoTtsSuggestions({
        selectedPosts: [filterPostForVideo(post)],
        textProcessing: {
          mode: readiness.openAiConfigured ? "llm_assist" : "rules_only",
        },
      });
      const suggestedPost = response.selectedPosts[0];
      if (!suggestedPost) {
        throw new Error("Khong nhan duoc goi y TTS.");
      }
      updateEditablePost(postId, (currentPost) => ({
        ...currentPost,
        tts_text:
          suggestedPost.tts_text?.trim() || resolvePostTtsText(currentPost),
        top_comments: currentPost.top_comments.map((comment) => {
          const suggestedComment = suggestedPost.top_comments.find(
            (item) => item.comment_id === comment.comment_id
          );
          return suggestedComment
            ? {
                ...comment,
                tts_text:
                  suggestedComment.tts_text?.trim() ||
                  resolveCommentTtsText(comment),
              }
            : comment;
        }),
      }));
      const processingSummary = formatTtsProcessingSummary(suggestedPost);
      setPostStatusById((current) => ({
        ...current,
        [postId]: `${processingSummary} Bam luu de ghi vao file.`,
      }));
    } catch (error) {
      setPostStatusById((current) => ({
        ...current,
        [postId]:
          error instanceof Error ? error.message : "Khong tao duoc goi y TTS.",
      }));
    } finally {
      setGeneratingTtsPostId((current) =>
        current === postId ? null : current
      );
    }
  };

  const handleCommentSelectedChange = (
    postId: string,
    commentId: string,
    value: boolean
  ) => {
    updateEditablePost(postId, (post) => ({
      ...post,
      top_comments: post.top_comments.map((comment) =>
        comment.comment_id === commentId
          ? { ...comment, selected_for_video: value }
          : comment
      ),
    }));
  };

  const handleCommentReorder = (
    postId: string,
    draggedCommentId: string,
    targetCommentId: string
  ) => {
    if (
      !(draggedCommentId && targetCommentId) ||
      draggedCommentId === targetCommentId
    ) {
      return;
    }

    updateEditablePost(postId, (post) => {
      const currentIndex = post.top_comments.findIndex(
        (comment) => comment.comment_id === draggedCommentId
      );
      const targetIndex = post.top_comments.findIndex(
        (comment) => comment.comment_id === targetCommentId
      );
      if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) {
        return post;
      }

      const nextComments = [...post.top_comments];
      const [movedComment] = nextComments.splice(currentIndex, 1);
      if (!movedComment) {
        return post;
      }
      nextComments.splice(targetIndex, 0, movedComment);

      return { ...post, top_comments: nextComments };
    });
  };

  const handleDefaultCommentAvatarUpload = async (file: File) => {
    try {
      setUploadingAvatarKey(true);
      const result = await uploadDefaultCommentAvatar(file);
      if (result.avatar) {
        const cleanAssetPath = result.avatar.assetPath.split("?")[0];
        const mediaUrl = result.avatar.mediaUrl;

        setEditablePosts((current) =>
          current.map((post) => ({
            ...post,
            top_comments: post.top_comments.map((comment) =>
              comment.comment_id === DEFAULT_VIDEO_COMMENT_ID
                ? {
                    ...comment,
                    avatar_asset_path: cleanAssetPath,
                    avatar_url: mediaUrl,
                  }
                : comment
            ),
          }))
        );
        setPreviewDraft(null);
        queryClient.setQueryData(["default-comment-avatar"], result);
      }
    } catch (error) {
      console.error("Upload avatar that bai:", error);
    } finally {
      setUploadingAvatarKey(false);
    }
  };

  const handleCommentMediaUpload = async (
    postId: string,
    commentId: string,
    file: File
  ) => {
    const uploadKey = `${postId}:${commentId}:media`;
    try {
      setUploadingAssetKey(uploadKey);
      const dimensions = await readUploadedMediaDimensions(file);
      const comment = editablePosts
        .find((post) => post.post_id === postId)
        ?.top_comments.find((item) => item.comment_id === commentId);
      const commentName =
        comment?.username ||
        comment?.display_name ||
        DEFAULT_VIDEO_COMMENT_USERNAME;
      const result = await uploadCommentAsset(
        file,
        `comment-media-${commentName}`
      );
      const nextMedia = [
        {
          asset_path: result.asset.serverPath ?? "",
          height: dimensions.height,
          order: 1,
          remote_url: result.asset.mediaUrl ?? "",
          type: file.type.startsWith("video/")
            ? ("video" as const)
            : ("image" as const),
          width: dimensions.width,
        },
      ];
      const applyUploadedMedia = (post: CrawlPost): CrawlPost => ({
        ...post,
        top_comments: post.top_comments.map((comment) =>
          comment.comment_id === commentId
            ? { ...comment, media: nextMedia }
            : comment
        ),
      });

      updateEditablePost(postId, applyUploadedMedia);
      setPreviewPost((current) =>
        current?.post_id === postId ? applyUploadedMedia(current) : current
      );
      setPreviewDraft(null);
      setPostStatusById((current) => ({
        ...current,
        [postId]: "Đã cập nhật ảnh cho comment.",
      }));
    } catch (error) {
      setPostStatusById((current) => ({
        ...current,
        [postId]:
          error instanceof Error
            ? error.message
            : "Khong tai len duoc anh comment.",
      }));
    } finally {
      setUploadingAssetKey((current) =>
        current === uploadKey ? null : current
      );
    }
  };

  const handleCommentMediaRemove = (postId: string, commentId: string) => {
    const applyRemovedMedia = (post: CrawlPost): CrawlPost => ({
      ...post,
      top_comments: post.top_comments.map((comment) =>
        comment.comment_id === commentId ? { ...comment, media: [] } : comment
      ),
    });

    updateEditablePost(postId, applyRemovedMedia);
    setPreviewPost((current) =>
      current?.post_id === postId ? applyRemovedMedia(current) : current
    );
    setPreviewDraft(null);
    setPostStatusById((current) => ({
      ...current,
      [postId]: "Đã bỏ ảnh khỏi comment.",
    }));
  };

  const handleSavePost = async (postId: string) => {
    const post = editablePosts.find((item) => item.post_id === postId);
    if (!(post && selectedOutputFile)) {
      return;
    }

    const localStateBeforeSave: StoredVideoWorkflowFileState = {
      expandedPostId,
      postEditsById: buildStoredPostEdits(editablePosts),
      selectedPostIds: [...selectedPostIds],
    };

    try {
      setSavingPostId(postId);
      setPostStatusById((current) => ({
        ...current,
        [postId]: "Dang cap nhat bai viet...",
      }));

      const result = await updateCrawlOutputPost(selectedOutputFile, postId, {
        text: post.text,
        tts_text: post.tts_text ?? "",
        is_spoiler: post.is_spoiler,
        spoiler_initial_text: post.spoiler_initial_text,
        spoiler_reveal_text: post.spoiler_reveal_text,
        spoiler_media: post.spoiler_media,
        spoiler_style: post.spoiler_style,
        top_comments: post.top_comments.map((comment) => ({
          avatar_asset_path: comment.avatar_asset_path,
          avatar_url: comment.avatar_url,
          comment_id: comment.comment_id,
          created_at: comment.created_at,
          display_name: comment.display_name,
          like_count: comment.like_count,
          reply_count: comment.reply_count,
          repost_count: comment.repost_count,
          share_count: comment.share_count,
          video_like_count: comment.video_like_count ?? null,
          video_reply_count: comment.video_reply_count ?? null,
          video_share_count: comment.video_share_count ?? null,
          source_order: comment.source_order,
          selected_for_video: comment.selected_for_video !== false,
          text: comment.text,
          tts_text: resolveCommentTtsText(comment),
          media: comment.media,
          username: comment.username,
          is_spoiler: comment.is_spoiler,
          spoiler_initial_text: comment.spoiler_initial_text,
          spoiler_reveal_text: comment.spoiler_reveal_text,
          spoiler_media: comment.spoiler_media,
          spoiler_style: comment.spoiler_style,
        })),
      });

      setEditablePosts(
        applyStoredVideoWorkflowState(
          (result.output ?? [])
            .flatMap((topic) => topic.posts)
            .map((nextPost) =>
              normalizeEditablePost(nextPost, defaultAvatarData)
            ),
          localStateBeforeSave
        )
      );
      setPostStatusById((current) => ({
        ...current,
        [postId]: "Da cap nhat bai viet.",
      }));
      setExpandedPostId(null);
    } catch (error) {
      setPostStatusById((current) => ({
        ...current,
        [postId]:
          error instanceof Error ? error.message : "Khong luu duoc du lieu.",
      }));
    } finally {
      setSavingPostId((current) => (current === postId ? null : current));
    }
  };

  // V2 storageKey uses a dedicated prefix so it never collides with V1
  const v2StorageKey = selectedOutputFile ? `v2:${selectedOutputFile}` : "";

  const handleMemeChange = (
    sceneId: string,
    meme: SelectedMemeEntry | null
  ) => {
    setMemeBySceneId((current) => {
      const next = { ...current, [sceneId]: meme };
      if (!selectedOutputFile) {
        return next;
      }
      try {
        const key = `${VIDEO_WORKFLOW_V2_MEME_STATE_PREFIX}${selectedOutputFile}`;
        const serialized = JSON.stringify(next);
        safeLocalStorageSetItem(key, serialized);
        safeSessionStorageSetItem(key, serialized);
      } catch {
        // ignore storage errors
      }
      return next;
    });
    // Clear preview draft so the preview refreshes with the new meme
    setPreviewDraft(null);
  };

  const handleMemePlacementChange = (
    sceneId: string,
    placement: "after_comment" | "media_reveal" | "transition"
  ) => {
    setMemeBySceneId((current) => {
      const meme = current[sceneId];
      if (!meme) {
        return current;
      }

      const next = { ...current, [sceneId]: { ...meme, placement } };
      if (!selectedOutputFile) {
        return next;
      }
      try {
        const key = `${VIDEO_WORKFLOW_V2_MEME_STATE_PREFIX}${selectedOutputFile}`;
        const serialized = JSON.stringify(next);
        safeLocalStorageSetItem(key, serialized);
        safeSessionStorageSetItem(key, serialized);
      } catch {
        // ignore storage errors
      }
      return next;
    });
    setPreviewDraft(null);
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-1rem)] w-full max-w-[140rem] flex-col overflow-hidden px-3 py-3 sm:px-4 lg:px-5">
      <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.82fr)_minmax(19rem,0.64fr)] 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.86fr)_minmax(20rem,0.68fr)]">
        <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
          <AppReadinessPanel scope="video" state={readiness} />
          <div className="flex flex-col gap-1.5 rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">Chon file du lieu:</span>
              <Button
                className="size-8"
                onClick={() => void outputFilesQuery.refetch()}
                size="icon"
                variant="ghost"
              >
                {outputFilesQuery.isFetching ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
            <Select
              onValueChange={(value) => {
                setSelectedOutputFile(value);
                setPreviewDraft(null);
                setPreviewPost(undefined);
                setPreviewVideo(null);
              }}
              value={selectedOutputFile}
            >
              <SelectTrigger className="h-10 w-full min-w-0 text-sm">
                <SelectValue placeholder="-- Chon file --" />
              </SelectTrigger>
              <SelectContent>
                {outputFiles.map((file) => (
                  <SelectItem
                    key={file.filename}
                    value={file.filename}
                  >
                    {formatOutputDisplayLabel(file)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                {hasPosts
                  ? `${selectedPostIds.size}/${posts.length} bài đang được chọn`
                  : "Chưa có bài viết để chọn"}
              </p>
              <Button
                disabled={!hasPosts}
                onClick={toggleSelectAllPosts}
                size="sm"
                type="button"
                variant="outline"
              >
                {allPostsSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
              </Button>
            </div>
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
            {selectedOutputFile ? (
              fileOutputQuery.isPending ? (
                <div className="rounded-lg border bg-card px-4 py-8 text-center text-muted-foreground text-sm">
                  Đang tải dữ liệu...
                </div>
              ) : posts.length === 0 ? (
                <div className="rounded-lg border bg-card px-4 py-8 text-center text-muted-foreground text-sm">
                  File này không có bài viết nào.
                </div>
              ) : (
                <div className="grid gap-2">
                  {posts.map((post) => (
                    <VideoPostListCardV2
                      isEditorOpen={expandedPostId === post.post_id}
                      isGeneratingTts={generatingTtsPostId === post.post_id}
                      isSaving={savingPostId === post.post_id}
                      isSelected={selectedPostIds.has(post.post_id)}
                      key={post.post_id}
                      llmTextConfigured={readiness.openAiConfigured}
                      memeBySceneId={memeBySceneId}
                      memeLibraryItems={memeLibraryItems}
                      onCommentReorder={(draggedCommentId, targetCommentId) =>
                        handleCommentReorder(
                          post.post_id,
                          draggedCommentId,
                          targetCommentId
                        )
                      }
                      onCommentSelectedChange={(commentId, value) =>
                        handleCommentSelectedChange(
                          post.post_id,
                          commentId,
                          value
                        )
                      }
                      onCommentMetricsChange={(commentId, fields) =>
                        handleCommentMetricsChange(
                          post.post_id,
                          commentId,
                          fields
                        )
                      }
                      onCommentTextChange={(commentId, value) =>
                        handleCommentTextChange(post.post_id, commentId, value)
                      }
                      onCommentTtsTextChange={(commentId, value) =>
                        handleCommentTtsTextChange(
                          post.post_id,
                          commentId,
                          value
                        )
                      }
                      onPostSpoilerFieldsChange={(fields) =>
                        handlePostSpoilerFieldsChange(post.post_id, fields)
                      }
                      onDefaultCommentAvatarUpload={(file) =>
                        void handleDefaultCommentAvatarUpload(file)
                      }
                      onCommentMediaUpload={(commentId, file) =>
                        void handleCommentMediaUpload(
                          post.post_id,
                          commentId,
                          file
                        )
                      }
                      onCommentMediaRemove={(commentId) =>
                        handleCommentMediaRemove(post.post_id, commentId)
                      }
                      onGenerateTtsSuggestions={() =>
                        void handleGenerateTtsSuggestions(post.post_id)
                      }
                      onMemeChange={handleMemeChange}
                      onMemePlacementChange={handleMemePlacementChange}
                      onPostTextChange={(value) =>
                        handlePostTextChange(post.post_id, value)
                      }
                      onPostTtsTextChange={(value) =>
                        handlePostTtsTextChange(post.post_id, value)
                      }
                      onSaveEditor={() => void handleSavePost(post.post_id)}
                      onToggleEditor={() =>
                        setExpandedPostId((current) =>
                          current === post.post_id ? null : post.post_id
                        )
                      }
                      onToggleSelected={() => toggleSelectedPost(post.post_id)}
                      post={post}
                      saveMessage={postStatusById[post.post_id]}
                      uploadingAssetKey={uploadingAssetKey}
                      uploadingAvatar={uploadingAvatarKey}
                    />
                  ))}
                </div>
              )
            ) : (
              <div className="rounded-lg border bg-card px-4 py-8 text-center text-muted-foreground text-sm">
                Vui lòng chọn một file dữ liệu để xem.
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <SelectedPostsPanel
            ausynclabConfigured={readiness.ausynclabConfigured}
            availableMusic={availableMusic}
            availablePromotionVideos={availablePromotionVideos}
            availableVideos={availableVideos}
            fptConfigured={readiness.fptConfigured}
            googleConfigured={readiness.googleConfigured}
            hideGlobalMemePicker={true}
            isRefreshingMusic={uploadedMusicQuery.isFetching}
            isRefreshingPromotions={promotionVideosQuery.isFetching}
            isRefreshingVideos={uploadedVideosQuery.isFetching}
            llmTextConfigured={readiness.openAiConfigured}
            memeBySceneId={memeBySceneId}
            memeLibraryItems={memeLibraryItems}
            onPreviewSelectionChange={({
              draft,
              playPostVideoAfterCaption,
              post,
              uploadedVideo,
            }) => {
              setPreviewDraft(draft ?? null);
              setPlayPostVideoAfterCaption(
                Boolean(playPostVideoAfterCaption)
              );
              setPreviewPost(post);
              setPreviewVideo(uploadedVideo);
            }}
            onRefreshMusic={() => void uploadedMusicQuery.refetch()}
            onRefreshPromotions={() => void promotionVideosQuery.refetch()}
            onRefreshVideos={() => void uploadedVideosQuery.refetch()}
            outputPath={outputPath}
            selectedPosts={deferredSelectedPosts}
            storageKey={v2StorageKey}
            thumbnailIntro={thumbnailIntro}
            vivibeConfigured={readiness.vivibeConfigured}
            vivibeVoices={vivibeVoicesQuery.data?.voices ?? []}
            voiceConfigured={readiness.hasAnyVoiceProvider}
          />
        </div>

        <div className="grid min-h-0 min-w-0 gap-3 [grid-template-rows:minmax(0,1fr)_minmax(10rem,13rem)] xl:pr-1">
          <div className="min-h-0 min-w-0 overflow-hidden">
            <VideoPreviewTabs
              cardTheme={cardTheme}
              draft={previewDraft}
              memeBySceneId={memeBySceneId}
              mode="advanced"
              onThumbnailChange={setThumbnailIntro}
              post={featuredPost}
              thumbnailIntro={thumbnailIntro}
              thumbnailStorageKey={v2StorageKey}
              playPostVideoAfterCaption={playPostVideoAfterCaption}
              uploadedVideo={previewVideo}
            />
          </div>
          <div className="min-h-0 min-w-0 overflow-hidden">
            <VideoRenderJobsPanel />
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper functions (same logic as V1, uses V2-scoped storage keys)

function normalizeEditablePost(
  post: CrawlPost,
  avatarData?: { assetPath: string; mediaUrl: string } | null
): CrawlPost {
  const cleanAvatarAssetPath = avatarData?.assetPath.split("?")[0];
  const avatarMediaUrl = avatarData?.mediaUrl;

  const isSpoiler = !!post.is_spoiler;
  const initial = post.spoiler_initial_text || post.text;
  const reveal = post.spoiler_reveal_text || "";
  const synthesizedTts = isSpoiler
    ? `${initial}${reveal ? " " + reveal : ""}`.trim()
    : resolvePostTtsText(post);

  const normalizedComments = post.top_comments.map((comment) => ({
    ...comment,
    selected_for_video: comment.selected_for_video !== false,
    tts_text: resolveCommentTtsText(comment),
  }));

  const baseNormalizedPost: CrawlPost = {
    ...post,
    is_spoiler: isSpoiler,
    spoiler_initial_text: isSpoiler ? initial : post.spoiler_initial_text,
    tts_text: isSpoiler
      ? (post.tts_text?.trim() || synthesizedTts)
      : resolvePostTtsText(post),
  };

  if (
    normalizedComments.some(
      (comment) => comment.comment_id === DEFAULT_VIDEO_COMMENT_ID
    )
  ) {
    return {
      ...baseNormalizedPost,
      top_comments: normalizedComments.map((comment) =>
        comment.comment_id === DEFAULT_VIDEO_COMMENT_ID
          ? {
              ...comment,
              repost_count: DEFAULT_VIDEO_COMMENT_REPOST_COUNT,
              share_count: DEFAULT_VIDEO_COMMENT_SHARE_COUNT,
              ...(cleanAvatarAssetPath
                ? {
                    avatar_asset_path: cleanAvatarAssetPath,
                    avatar_url: avatarMediaUrl ?? comment.avatar_url,
                  }
                : {}),
            }
          : comment
      ),
    };
  }

  const defaultComment = createDefaultVideoComment(post);
  defaultComment.tts_text = resolveCommentTtsText(defaultComment);
  if (cleanAvatarAssetPath) {
    defaultComment.avatar_asset_path = cleanAvatarAssetPath;
    defaultComment.avatar_url = avatarMediaUrl ?? defaultComment.avatar_url;
  }

  return {
    ...baseNormalizedPost,
    top_comments: [...normalizedComments, defaultComment],
  };
}

function resolvePostTtsText(
  post: Pick<CrawlPost, "text" | "tts_text">
): string {
  return post.tts_text?.trim() || post.text.trim();
}

function resolveCommentTtsText(
  comment: Pick<CrawlComment, "text" | "tts_text">
): string {
  return comment.tts_text?.trim() || comment.text.trim();
}

function filterPostForVideo(post: CrawlPost): CrawlPost {
  return {
    ...post,
    top_comments: post.top_comments.filter(
      (comment: CrawlComment) => comment.selected_for_video !== false
    ),
  };
}

function formatTtsProcessingSummary(post: CrawlPost): string {
  const processingItems = [
    post.tts_processing,
    ...post.top_comments.map((comment) => comment.tts_processing),
  ].filter(isTtsProcessingMeta);

  if (processingItems.length === 0) {
    return "Da tao goi y TTS.";
  }

  const usedLlmCount = processingItems.filter((item) => item.usedLlm).length;
  const requestedLlmCount = processingItems.filter(
    (item) => item.requestedMode === "llm_assist"
  ).length;
  const fallbackCount = processingItems.filter(
    (item) => item.requestedMode === "llm_assist" && !item.usedLlm
  ).length;
  const firstWarning = processingItems
    .flatMap((item) => item.warnings)
    .find(Boolean);

  if (usedLlmCount > 0) {
    return fallbackCount > 0
      ? `Da dung LLM cho ${usedLlmCount}/${processingItems.length} doan TTS, ${fallbackCount} doan fallback rules.`
      : `Da dung LLM cho ${usedLlmCount}/${processingItems.length} doan TTS.`;
  }

  if (requestedLlmCount > 0) {
    return firstWarning
      ? `LLM khong chay, da fallback rules: ${firstWarning}`
      : "LLM khong chay, da fallback rules.";
  }

  return "Da tao goi y TTS bang rules.";
}

function isTtsProcessingMeta(
  value: VideoTtsProcessingMeta | undefined
): value is VideoTtsProcessingMeta {
  return Boolean(value);
}

function readStoredVideoWorkflowFileState(
  selectedOutputFile: string
): StoredVideoWorkflowFileState | null {
  if (!selectedOutputFile) {
    return null;
  }

  try {
    const storageKey = `${VIDEO_WORKFLOW_V2_FILE_STATE_PREFIX}${selectedOutputFile}`;
    const raw =
      safeLocalStorageGetItem(storageKey) ??
      safeSessionStorageGetItem(storageKey);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as StoredVideoWorkflowFileState;
  } catch {
    return null;
  }
}

function writeStoredVideoWorkflowFileState(
  selectedOutputFile: string,
  state: StoredVideoWorkflowFileState
): void {
  try {
    const storageKey = `${VIDEO_WORKFLOW_V2_FILE_STATE_PREFIX}${selectedOutputFile}`;
    const serialized = JSON.stringify(state);
    safeSessionStorageSetItem(storageKey, serialized);
    safeLocalStorageSetItem(storageKey, serialized);
  } catch {
    return;
  }
}

function applyStoredVideoWorkflowState(
  posts: CrawlPost[],
  state: StoredVideoWorkflowFileState | null
): CrawlPost[] {
  if (!state) {
    return posts;
  }

  return posts.map((post) => {
    const savedPost = state.postEditsById[post.post_id];
    if (!savedPost) {
      return post;
    }

    const hydratedComments = post.top_comments.map((comment) => {
      const savedComment = savedPost.topCommentsById[comment.comment_id];
      if (!savedComment) {
        return comment;
      }

      const sourceSignature = commentSourceSignature(comment);
      const isDefaultComment = comment.comment_id === DEFAULT_VIDEO_COMMENT_ID;
      if (
        !savedComment.source_signature ||
        savedComment.source_signature !== sourceSignature
      ) {
        return {
          ...comment,
          ...(isDefaultComment
            ? { media: savedComment.media ?? comment.media }
            : {}),
          selected_for_video: savedComment.selected_for_video,
          ...(isDefaultComment ? { text: savedComment.text } : {}),
          tts_text: resolveCommentTtsText({
            text: isDefaultComment ? savedComment.text ?? comment.text : comment.text,
            tts_text: savedComment.tts_text || comment.tts_text,
          }),
          video_like_count: savedComment.video_like_count,
          video_reply_count: savedComment.video_reply_count,
          video_share_count: savedComment.video_share_count,
          is_spoiler: savedComment.is_spoiler,
          spoiler_initial_text: savedComment.spoiler_initial_text,
          spoiler_reveal_text: savedComment.spoiler_reveal_text,
          spoiler_media: savedComment.spoiler_media,
          spoiler_style: savedComment.spoiler_style,
        };
      }

      return {
        ...comment,
        media: savedComment.media ?? comment.media,
        selected_for_video: savedComment.selected_for_video,
        text: savedComment.text,
        tts_text: resolveCommentTtsText({
          text: savedComment.text,
          tts_text: savedComment.tts_text || comment.tts_text,
        }),
        video_like_count: savedComment.video_like_count,
        video_reply_count: savedComment.video_reply_count,
        video_share_count: savedComment.video_share_count,
        is_spoiler: savedComment.is_spoiler,
        spoiler_initial_text: savedComment.spoiler_initial_text,
        spoiler_reveal_text: savedComment.spoiler_reveal_text,
        spoiler_media: savedComment.spoiler_media,
        spoiler_style: savedComment.spoiler_style,
      };
    });

    const commentOrder = savedPost.commentOrder ?? [];
    const hydratedCommentsById = new Map(
      hydratedComments.map((comment) => [comment.comment_id, comment] as const)
    );
    const orderedHydratedComments = [
      ...commentOrder
        .map((commentId) => hydratedCommentsById.get(commentId))
        .filter((comment): comment is CrawlComment => Boolean(comment)),
      ...hydratedComments.filter(
        (comment) => !commentOrder.includes(comment.comment_id)
      ),
    ];

    const isSpoiler = savedPost.is_spoiler ?? post.is_spoiler ?? false;
    const initialText = savedPost.spoiler_initial_text || post.spoiler_initial_text || post.text;

    return {
      ...post,
      text: savedPost.text,
      tts_text: resolvePostTtsText({
        text: savedPost.text,
        tts_text: savedPost.tts_text || post.tts_text,
      }),
      is_spoiler: isSpoiler,
      spoiler_initial_text: isSpoiler ? initialText : savedPost.spoiler_initial_text,
      spoiler_reveal_text: savedPost.spoiler_reveal_text,
      spoiler_media: savedPost.spoiler_media,
      spoiler_style: savedPost.spoiler_style,
      top_comments: orderedHydratedComments,
    };
  });
}

function commentSourceSignature(comment: CrawlComment): string {
  return JSON.stringify([
    comment.comment_id,
    comment.username,
    comment.display_name,
    comment.avatar_url,
    comment.avatar_asset_path,
    comment.like_count,
    comment.reply_count,
    comment.created_at,
  ]);
}

function buildStoredPostEdits(
  posts: CrawlPost[]
): StoredVideoWorkflowFileState["postEditsById"] {
  return Object.fromEntries(
    posts.map((post) => [
      post.post_id,
      {
        commentOrder: post.top_comments.map((comment) => comment.comment_id),
        text: post.text,
        tts_text: resolvePostTtsText(post),
        is_spoiler: post.is_spoiler,
        spoiler_initial_text: post.spoiler_initial_text,
        spoiler_reveal_text: post.spoiler_reveal_text,
        spoiler_media: post.spoiler_media,
        spoiler_style: post.spoiler_style,
        topCommentsById: Object.fromEntries(
          post.top_comments.map((comment) => [
            comment.comment_id,
            {
              media: comment.media,
              selected_for_video: comment.selected_for_video !== false,
              source_signature: commentSourceSignature(comment),
              text: comment.text,
              tts_text: resolveCommentTtsText(comment),
              video_like_count: comment.video_like_count,
              video_reply_count: comment.video_reply_count,
              video_share_count: comment.video_share_count,
              is_spoiler: comment.is_spoiler,
              spoiler_initial_text: comment.spoiler_initial_text,
              spoiler_reveal_text: comment.spoiler_reveal_text,
              spoiler_media: comment.spoiler_media,
              spoiler_style: comment.spoiler_style,
            },
          ])
        ),
      },
    ])
  );
}

function createDefaultVideoComment(post: CrawlPost): CrawlComment {
  return {
    avatar_asset_path: DEFAULT_VIDEO_COMMENT_AVATAR_PATH,
    avatar_url: DEFAULT_VIDEO_COMMENT_AVATAR_URL,
    comment_id: DEFAULT_VIDEO_COMMENT_ID,
    created_at: post.created_at || new Date().toISOString(),
    display_name: DEFAULT_VIDEO_COMMENT_DISPLAY_NAME,
    like_count: DEFAULT_VIDEO_COMMENT_LIKE_COUNT,
    media: [],
    repost_count: DEFAULT_VIDEO_COMMENT_REPOST_COUNT,
    reply_count: DEFAULT_VIDEO_COMMENT_REPLY_COUNT,
    selected_for_video: true,
    share_count: DEFAULT_VIDEO_COMMENT_SHARE_COUNT,
    source_order: Number.MAX_SAFE_INTEGER,
    text: "Them comment mac dinh cua ban tai day.",
    username: DEFAULT_VIDEO_COMMENT_USERNAME,
  };
}

async function readUploadedMediaDimensions(
  file: File
): Promise<UploadedMediaDimensions> {
  if (file.type.startsWith("video/")) {
    return readVideoDimensions(file);
  }
  return readImageDimensions(file);
}

function readImageDimensions(file: File): Promise<UploadedMediaDimensions> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        height: image.naturalHeight || 0,
        width: image.naturalWidth || 0,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ height: 0, width: 0 });
    };
    image.src = objectUrl;
  });
}

function readVideoDimensions(file: File): Promise<UploadedMediaDimensions> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        height: video.videoHeight || 0,
        width: video.videoWidth || 0,
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ height: 0, width: 0 });
    };
    video.src = objectUrl;
  });
}
