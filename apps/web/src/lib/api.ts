import type { PublicToolConfig } from "@tool-base/config/schema";

export const LICENSE_INVALIDATED_EVENT = "tool-license-invalidated";

export interface ConfigResponse {
  config: PublicToolConfig;
  configPath: string;
  credentials: {
    ausynclabApiKeyConfigured: boolean;
    fptAiApiKeyConfigured: boolean;
    googleCloudApiKeyConfigured: boolean;
    openAiApiKeyConfigured: boolean;
    vivibeApiKeyConfigured: boolean;
  };
  exists: boolean;
  license: {
    checkedAt: string;
    configured: boolean;
    employeeName: string;
    expiresAt: string;
    keyPreview: string;
    message: string;
    reason: string;
    valid: boolean;
  };
  runtime: {
    threadsAuthStatePath: string;
    userDataRoot: string;
    userSettingsPath: string;
  };
}

export interface UpdateLicensePayload {
  licenseKey?: string;
  verifyUrl?: string;
  verifyUrls?: string[];
}

export interface UpdateConfigCredentialsPayload {
  ausynclabApiKey?: string;
  fptAiApiKey?: string;
  googleCloudApiKey?: string;
  openAiApiKey?: string;
  vivibeApiKey?: string;
}

export interface TestConfigCredentialPayload {
  ausynclabApiKey?: string;
  fptAiApiKey?: string;
  googleCloudApiKey?: string;
  openAiApiKey?: string;
  provider: "ausynclab" | "fpt" | "google" | "openai" | "vivibe";
  vivibeApiKey?: string;
}

export interface TestConfigCredentialResponse {
  message: string;
  ok: boolean;
  provider: "ausynclab" | "fpt" | "google" | "openai" | "vivibe";
}

export interface SampleItem {
  id: string;
  label: string;
}

export interface SampleResponse {
  description: string;
  enabled: boolean;
  items: SampleItem[];
  serverName: string;
}

export interface CrawlConfigResponse {
  crawl: PublicToolConfig["crawl"];
}

export interface ThreadsSession {
  accessState?: "unknown" | "ready" | "login_prompt" | "onboarding";
  accountDisplayName: string;
  accountLabel: string;
  accountUpdatedAt: string;
  accountUserId: string;
  accountUsername: string;
  authStatePath: string;
  cookieCount: number;
  exists: boolean;
  hasAuthCookie: boolean;
  lastError: string;
  lastModifiedAt: string;
  networkState?: "unknown" | "reachable" | "unreachable";
  profileId: string;
  status: "missing" | "needs_login" | "network_error" | "ready";
}

export interface ThreadsSessionResponse {
  session: ThreadsSession;
}

export type CrawlProgressStage =
  | "preparing"
  | "discovering"
  | "extracting_posts"
  | "extracting_comments"
  | "saving"
  | "completed";

export interface CrawlProgressSnapshot {
  baseline_comment_target?: number;
  baseline_committed_comments?: number;
  baseline_committed_posts?: number;
  baseline_target_output_posts?: number;
  candidate_count?: number;
  comment_completed?: number;
  comment_warning?: string;
  comment_target?: number;
  comments_scanned?: number;
  comments_selected?: number;
  committed_comments?: number;
  committed_posts?: number;
  current_post?: string;
  current_query?: string;
  current_url?: string;
  detail_completed?: number;
  detail_target?: number;
  discovered_posts?: number;
  effective_ranking?: Record<string, unknown>;
  effective_runtime?: Record<string, unknown>;
  finalist_completed?: number;
  finalist_target?: number;
  message?: string;
  pending_posts?: number;
  preview_only_posts?: number;
  queued_candidates?: number;
  ready_output_comments?: number;
  ready_output_posts?: number;
  resume_ready?: boolean;
  selected_posts?: number;
  stage: CrawlProgressStage;
  stage_durations_ms?: Partial<Record<CrawlProgressStage, number>>;
  stage_started_at?: string;
  summary_completed?: number;
  summary_posts?: number;
  summary_target?: number;
  target_inspect_posts?: number;
  target_output_posts?: number;
  updated_at: string;
}

export interface CrawlRun {
  cancelRequestedAt?: string;
  configPath: string;
  error?: string;
  finishedAt?: string;
  id: string;
  mode?: "direct_posts" | "seed_profiles" | "discover" | "hybrid" | "resume";
  outputPath?: string;
  progress?: CrawlProgressSnapshot;
  queuedAt: string;
  requestId?: string;
  resumedFromRunId?: string;
  resumedToRunId?: string;
  runningStartedAt?: string;
  startedAt: string;
  stats?: Record<string, number>;
  status:
    | "queued"
    | "running"
    | "stopping"
    | "stopped_partial"
    | "partial_results"
    | "completed"
    | "no_results"
    | "failed"
    | "cancelled";
  summaryLabel?: string;
  topics: string[];
}

export interface CrawlRunsResponse {
  runs: CrawlRun[];
}

export interface CrawlOutputFile {
  comments: number;
  filename: string;
  label: string;
  modifiedAt: string;
  outputPath: string;
  partial?: boolean;
  pendingResumeCount?: number;
  posts: number;
  previewPostCount?: number;
  requestMeta?: CrawlRequestMeta;
  resumeSeedCount?: number;
  sizeBytes: number;
  topics: number;
}

export interface CrawlOutputsResponse {
  outputRoot: string;
  outputs: CrawlOutputFile[];
}

export interface StartCrawlRunPayload {
  configPath?: string;
  overrides?: Record<string, unknown>;
  request?: CrawlRequestPayload;
  topics?: string[];
}

export interface CrawlRequestPayload {
  created_at: string;
  filters: CrawlFiltersPayload;
  notes: string;
  request_id: string;
  runtime_overrides?: Record<string, unknown>;
  ui_state?: Record<string, unknown>;
}

export interface CrawlFiltersPayload {
  date_range: {
    end_date: string;
    preset: string;
    start_date: string;
    timezone?: string;
  };
  exclude_commerce_content?: boolean;
  exclude_posts_with_links?: boolean;
  exclude_usernames: string[];
  global_excluded_keywords: string[];
  include_usernames: string[];
  languages: string[];
  max_posts_per_topic: number;
  max_text_length: number;
  min_comment_likes: number;
  min_comments: number;
  min_loaded_top_comments: number;
  min_post_likes: number;
  min_post_replies: number;
  min_post_reposts: number;
  min_post_score: number;
  min_post_shares: number;
  min_post_views: number;
  min_text_length: number;
  min_topic_match_score: number;
  ranking_mode: "sort_by" | "weighted";
  ranking_weights: CrawlRankingWeights;
  recency_half_life_hours: number;
  require_comments: boolean;
  require_metrics: boolean;
  require_repost_or_share: boolean;
  sort_by: string;
  source: string;
  text_contains_all: string[];
  text_contains_any: string[];
  text_excludes_any: string[];
  top_comments_per_post: number;
  topics: CrawlTopicPayload[];
}

export interface CrawlRankingWeights {
  comments: number;
  likes: number;
  recency: number;
  reposts: number;
  shares: number;
  topic_match: number;
  views: number;
}

export interface CrawlTopicPayload {
  category: string;
  excluded_keywords: string[];
  keywords: string[];
  lexicon: {
    abbreviations: string[];
    canonical: string[];
    no_diacritics: string[];
    teencode: string[];
  };
  query_variants: string[];
  required_keywords: string[];
  required_keywords_mode: "all" | "any";
  search_queries: string[];
  seed_post_urls: string[];
  topic_intent: string;
  topic_title: string;
  trend_search_urls?: string[];
}

export interface CrawlOutputResponse {
  file?: CrawlOutputFile;
  output: CrawlTopic[];
  outputPath?: string;
  post?: CrawlPost;
  requestMeta?: CrawlRequestMeta;
  run?: CrawlRun;
}

export interface CrawlRequestMeta {
  created_at: string;
  date_range: {
    end_date: string;
    preset: string;
    start_date: string;
    timezone?: string;
  };
  exclude_commerce_content?: boolean;
  exclude_posts_with_links?: boolean;
  global_excluded_keywords: string[];
  languages: string[];
  max_posts_per_topic: number;
  min_post_views?: number;
  notes: string;
  ranking_mode: "sort_by" | "weighted";
  ranking_weights: CrawlRankingWeights;
  recency_half_life_hours: number;
  request_id: string;
  runtime_overrides?: Record<string, unknown>;
  sort_by: string;
  text_excludes_any: string[];
  top_comments_per_post: number;
  topic: CrawlTopicPayload;
  ui_state?: Record<string, unknown>;
}

export interface CrawlTopic {
  crawl_audit?: Record<string, unknown>;
  crawled_at: string;
  keywords: string[];
  posts: CrawlPost[];
  request_meta?: CrawlRequestMeta;
  source: string;
  topic_id: string;
  topic_title: string;
}

export interface CrawlMediaAsset {
  asset_path: string;
  duration_seconds?: number;
  height: number;
  order: number;
  remote_url: string;
  type: "image" | "video";
  width: number;
}

export interface SpoilerRevealRegion {
  bbox: { x: number; y: number; width: number; height: number };
  image_height: number;
  image_width: number;
  text: string;
}

export interface CrawlPost {
  avatar_asset_path: string;
  avatar_url: string;
  crawled_at: string;
  created_at: string;
  discovery_source: string;
  discovery_window_end: string;
  discovery_window_start: string;
  display_name: string;
  language: string;
  like_count: number;
  matched_query: string;
  media: CrawlMediaAsset[];
  post_id: string;
  publish_time?: {
    date_key: string;
    detected_at: string;
    filter_end_date: string;
    filter_reason: string;
    filter_start_date: string;
    passed_date_filter: boolean;
    source: string;
    timezone: string;
  };
  quote_count: number;
  ranking: {
    breakdown: Record<string, number>;
    final_score: number;
    mode: "sort_by" | "weighted";
    sort_by: string;
  };
  reply_count: number;
  repost_count: number;
  share_count: number;
  source_url: string;
  text: string;
  top_comments: CrawlComment[];
  tts_processing?: VideoTtsProcessingMeta;
  tts_text?: string;
  url: string;
  username: string;
  view_count: number;
  is_spoiler?: boolean;
  spoiler_initial_text?: string;
  spoiler_reveal_text?: string;
  spoiler_media?: boolean;
  spoiler_style?: "blur" | "hide";
  spoiler_reveal_regions?: SpoilerRevealRegion[];
  spoiler_reveal_media_only?: boolean;
  video_duration_seconds?: number;
}

export interface CrawlComment {
  avatar_asset_path: string;
  avatar_url: string;
  comment_id: string;
  parent_comment_id?: string;
  depth?: number;
  is_reply?: boolean;
  is_author_reply?: boolean;
  created_at: string;
  display_name: string;
  like_count: number;
  media: CrawlMediaAsset[];
  reply_count: number;
  repost_count?: number;
  selected_for_video?: boolean;
  share_count?: number;
  source_order: number;
  text: string;
  video_like_count?: number;
  video_reply_count?: number;
  video_share_count?: number;
  tts_processing?: VideoTtsProcessingMeta;
  tts_text?: string;
  username: string;
  is_spoiler?: boolean;
  spoiler_initial_text?: string;
  spoiler_reveal_text?: string;
  spoiler_media?: boolean;
  spoiler_style?: "blur" | "hide";
  spoiler_reveal_regions?: SpoilerRevealRegion[];
  spoiler_reveal_media_only?: boolean;
  video_duration_seconds?: number;
}

export interface VideoTtsProcessingMeta {
  appliedMode: "off" | "rules_only" | "llm_assist";
  requestedMode: "off" | "rules_only" | "llm_assist";
  usedLlm: boolean;
  warnings: string[];
}

export interface UpdateCrawlOutputCommentPayload {
  avatar_asset_path?: string;
  avatar_url?: string;
  comment_id: string;
  parent_comment_id?: string;
  depth?: number;
  is_reply?: boolean;
  is_author_reply?: boolean;
  created_at?: string;
  display_name?: string;
  like_count?: number;
  media?: CrawlMediaAsset[];
  reply_count?: number;
  repost_count?: number;
  selected_for_video?: boolean;
  share_count?: number;
  source_order?: number;
  text?: string;
  tts_text?: string;
  video_duration_seconds?: number | null;
  video_like_count?: number | null;
  video_reply_count?: number | null;
  video_share_count?: number | null;
  username?: string;
  is_spoiler?: boolean;
  spoiler_initial_text?: string;
  spoiler_reveal_text?: string;
  spoiler_media?: boolean;
  spoiler_style?: "blur" | "hide";
  spoiler_reveal_regions?: SpoilerRevealRegion[];
  spoiler_reveal_media_only?: boolean;
}

export interface UpdateCrawlOutputPostPayload {
  text?: string;
  top_comments: UpdateCrawlOutputCommentPayload[];
  tts_text?: string;
  video_duration_seconds?: number | null;
  is_spoiler?: boolean;
  spoiler_initial_text?: string;
  spoiler_reveal_text?: string;
  spoiler_media?: boolean;
  spoiler_style?: "blur" | "hide";
  spoiler_reveal_regions?: SpoilerRevealRegion[];
  spoiler_reveal_media_only?: boolean;
}

export interface UploadedVideoPayload {
  durationSeconds?: number | null;
  lastModified: string;
  mediaUrl?: string;
  name: string;
  purpose?: "background" | "promotion";
  serverPath?: string;
  sizeBytes: number;
  type: string;
}

export interface VideoPromotionSlot {
  enabled: boolean;
  fitMode?: "contain" | "cover";
  video?: UploadedVideoPayload | null;
  volume?: number;
}

export interface VideoPromotionConfig {
  midroll?: VideoPromotionSlot | null;
  minMidrollContentSeconds?: number;
  outro?: VideoPromotionSlot | null;
}

export type VideoThumbnailMode = "automatic" | "advanced";

export type VideoThumbnailBackgroundFit = "cover" | "contain";
export type VideoThumbnailLayerId = "title" | "channel" | "brand" | "watermark";
export type VideoThumbnailFont =
  | "beVietnam"
  | "georgia"
  | "geist"
  | "mono"
  | "montserrat"
  | "notoSans"
  | "oswald"
  | "poppins"
  | "roboto"
  | "trebuchet"
  | "verdana";

export interface VideoThumbnailLayerLayout {
  height: number;
  locked?: boolean;
  rotation?: number;
  visible?: boolean;
  width: number;
  x: number;
  y: number;
}

export interface VideoThumbnailLayout {
  brand?: VideoThumbnailLayerLayout;
  channel?: VideoThumbnailLayerLayout;
  layerOrder?: VideoThumbnailLayerId[];
  title?: VideoThumbnailLayerLayout;
  watermark?: VideoThumbnailLayerLayout;
}

export type VideoThumbnailWatermarkPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "center";

export interface VideoThumbnailIntro {
  background?: UploadedImagePayload | null;
  backgroundFit?: VideoThumbnailBackgroundFit;
  backgroundPositionX?: number;
  backgroundPositionY?: number;
  backgroundZoom?: number;
  brandImage?: UploadedImagePayload | null;
  brandImageSizePercent?: number;
  watermarkSizePercent?: number;
  channelName?: string;
  channelColor?: string;
  channelFont?: VideoThumbnailFont;
  channelBold?: boolean;
  channelItalic?: boolean;
  channelFontSize?: number;
  durationMs: number;
  enabled: boolean;
  image?: UploadedImagePayload | null;
  mode?: VideoThumbnailMode;
  subtitle?: string;
  title: string;
  titleOverridesByPostId?: Record<string, string>;
  /**
   * Per-post thumbnail snapshots. The shared fields remain the fallback for
   * posts that have not been edited yet.
   */
  postOverridesByPostId?: Record<
    string,
    Partial<Omit<VideoThumbnailIntro, "postOverridesByPostId">>
  >;
  titleColor?: string;
  titleFont?: VideoThumbnailFont;
  titleBold?: boolean;
  titleItalic?: boolean;
  titleFontSize?: number;
  watermark?: UploadedImagePayload | null;
  watermarkPosition?: VideoThumbnailWatermarkPosition;
  layout?: VideoThumbnailLayout;
}

export interface VideoThumbnailSettingsResponse {
  mode: VideoThumbnailMode;
  thumbnailIntro: VideoThumbnailIntro | null;
}

export interface UploadedAudioPayload {
  durationSeconds?: number | null;
  lastModified: string;
  mediaUrl?: string;
  name: string;
  serverPath?: string;
  sizeBytes: number;
  type: string;
}

export interface UploadedCommentAssetPayload {
  lastModified: string;
  mediaUrl?: string;
  name: string;
  serverPath?: string;
  sizeBytes: number;
  type: string;
}

export interface UploadedImagePayload {
  durationSeconds?: number | null;
  lastModified: string;
  mediaUrl?: string;
  name: string;
  serverPath?: string;
  sizeBytes: number;
  type: string;
}

export interface MemeTransitionConfig {
  audio?: UploadedAudioPayload | null;
  audios?: UploadedAudioPayload[];
  durationMs?: number;
  emotion: string;
  image?: UploadedImagePayload | null;
  images?: UploadedImagePayload[];
  placement?: "after_comment" | "media_reveal" | "transition";
  visualMode?: "meme" | "sound_only";
}

export interface VideoVoiceSettings {
  languageCode: string;
  pitch: number;
  provider: "ausynclab" | "fpt_ai" | "google_cloud" | "vivibe";
  speakingRate: number;
  ssmlGender: "FEMALE" | "MALE" | "NEUTRAL" | "SSML_VOICE_GENDER_UNSPECIFIED";
  voiceName: string;
}

export type DialogueSpeaker = 'A' | 'B' | 'unknown';

export interface DialogueLine {
  id: string;
  order: number;
  text: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
  speaker: DialogueSpeaker;
}

export interface VideoDialogueConfig {
  confirmed: boolean;
  imagePath: string;
  lines: DialogueLine[];
  pauseMs?: number;
  speakers: { A: VideoVoiceSettings; B: VideoVoiceSettings };
}

export interface NarrationChunk {
  audio_path: string;
  audio_url: string;
  chunk_id: string;
  duration_ms: number;
  order: number;
  status: "ready" | "failed";
  text: string;
}

export interface VideoSpoilerRevealSegment {
  media_reveal_percent: number;
  reveal_time_ms: number;
  text: string;
}

export interface VideoThreadPage {
  member_scene_ids: string[];
}

export interface VideoSpoilerRevealRegion {
  bbox: { x: number; y: number; width: number; height: number };
  image_height: number;
  image_width: number;
  text: string;
}

export interface CreateVideoDraftPayload {

  dialogue?: VideoDialogueConfig | null;
  backgroundMusic?: UploadedAudioPayload | null;
  backgroundMusicVolume?: number;
  cardTheme?: "light" | "dark";
  commentVoiceMode?: "emotion" | "fixed";
  existingDraft?: VideoDraftDocument | null;
  memeBySceneId?: Record<string, MemeTransitionConfig | null>;
  memeTransition?: MemeTransitionConfig | null;
  outputPath: string;
  playPostVideoAfterCaption?: boolean;
  promotion?: VideoPromotionConfig | null;
  thumbnailIntro?: VideoThumbnailIntro | null;
  selectedPosts: CrawlPost[];
  textProcessing?: {
    mode?: "off" | "rules_only" | "llm_assist";
  };
  uploadedVideo?: UploadedVideoPayload | null;
  videoMode: string;
  voiceSettings?: VideoVoiceSettings | null;
  voiceVolume?: number;
}

export interface VideoDraftScene {
  comment_id?: string;
  display_duration_ms?: number;
  dialogue_speaker?: "A" | "B" | "unknown";
  has_media?: boolean;
  kind: "comment" | "post" | "post_video";
  meme_transition?: MemeTransitionConfig | null;
  trailing_meme_transition?: MemeTransitionConfig | null;
  narration: {
    audio_url: string;
    chunks?: NarrationChunk[];
    message: string;
    merged_audio_path?: string;
    merged_audio_url?: string;
    provider: "ausynclab" | "fpt_ai" | "google_cloud" | "vivibe";
    request_id: string;
    status: "idle" | "processing" | "ready";
    total_duration_ms?: number;
    voice_profile?: VideoVoiceSettings | null;
  };
  narration_text?: string;
  order: number;
  post_id: string;
  scene_id: string;
  source_text?: string;
  spoiler?: {
    reveal_time_ms: number;
    text_initial: string;
    text_full: string;
    has_media_spoiler: boolean;
    media_reveal_time_ms?: number;
    reveal_segments?: VideoSpoilerRevealSegment[];
    reveal_regions?: VideoSpoilerRevealRegion[];
    reveal_media_only?: boolean;
    spoiler_style?: "blur" | "hide";
  } | null;
  template: "threads_card";
  text: string;
  thread_page?: VideoThreadPage;
  text_processing?: {
    appliedMode: "off" | "rules_only" | "llm_assist";
    requestedMode: "off" | "rules_only" | "llm_assist";
    usedLlm: boolean;
    warnings: string[];
  };
  video_media?: CrawlMediaAsset;
  timeline?: {
    end_ms: number;
    start_ms: number;
  };
  title: string;
  is_spoiler?: boolean;
  spoiler_initial_text?: string;
  spoiler_reveal_text?: string;
  spoiler_media?: boolean;
  spoiler_style?: "blur" | "hide";
  spoiler_reveal_regions?: VideoSpoilerRevealRegion[];
  spoiler_reveal_media_only?: boolean;
}

export interface GenerateVideoTtsSuggestionsPayload {
  abbreviations?: Record<string, string>;
  selectedPosts: CrawlPost[];
  textProcessing?: {
    mode?: "off" | "rules_only" | "llm_assist";
  };
}

export interface GenerateVideoTtsSuggestionsResponse {
  selectedPosts: CrawlPost[];
}

export interface VideoDraftResponse {
  draft: {
    background_music?: UploadedAudioPayload | null;
    background_music_volume?: number;
    voice_volume?: number;
    created_at: string;
    draft_id: string;
    scenes: VideoDraftScene[];
    selected_posts: CrawlPost[];
    source_output_path: string;
    uploaded_video: UploadedVideoPayload | null;
    video_plan: {
      aspect_ratio: "9:16";
      comments_sequential: true;
      duration_target_seconds: number;
      format: string;
      language: string;
      title: string;
      voice_ready: boolean;
    };
    abbreviations?: Record<string, string>;
    cardTheme?: "light" | "dark";
    meme_transition?: MemeTransitionConfig | null;
    play_post_video_after_caption?: boolean;
    promotion?: VideoPromotionConfig | null;
    thumbnail_intro?: VideoThumbnailIntro | null;
  };
  draftPath: string;
}

export type VideoDraftDocument = VideoDraftResponse["draft"];

export interface VideoRenderResult {
  durationSeconds: number;
  filename: string;
  outputPath: string;
  sizeBytes: number;
  url: string;
}

export interface VideoRenderJob {
  created_at: string;
  draft_id: string;
  error?: string;
  finished_at?: string;
  post_count: number;
  render?: VideoRenderResult;
  started_at?: string;
  status: "queued" | "running" | "completed" | "failed";
  title: string;
  updated_at: string;
  username: string;
}

export interface VideoRenderResponse extends VideoDraftResponse {
  job: VideoRenderJob;
}

export interface VideoRenderJobsResponse {
  jobs: VideoRenderJob[];
}

export interface VideoUploadResponse {
  video: UploadedVideoPayload;
}

export interface VideoUploadsResponse {
  videos: UploadedVideoPayload[];
}

export interface AudioUploadResponse {
  audio: UploadedAudioPayload;
}

export interface CommentAssetUploadResponse {
  asset: UploadedCommentAssetPayload;
}

export interface AudioUploadsResponse {
  tracks: UploadedAudioPayload[];
}

export interface MemeLibraryEntry {
  audio?: UploadedAudioPayload | null;
  audios?: UploadedAudioPayload[];
  emotion: string;
  label?: string;
  image?: UploadedImagePayload | null;
  images?: UploadedImagePayload[];
}

export interface MemeLibraryResponse {
  items: MemeLibraryEntry[];
}

export interface MemeImageUploadResponse {
  image: UploadedImagePayload;
}

export interface MemeAudioUploadResponse {
  audio: UploadedAudioPayload;
}

export interface VivibeVoice {
  avatarUrl?: string;
  previewUrl?: string;
  createdAt?: string;
  description?: string;
  favorited?: boolean;
  id: string;
  isActive: boolean;
  isPublic?: boolean;
  isVerified?: boolean;
  model?: string;
  name: string;
  previewText?: string;
  language?: string;
  languageCode?: string;
  locale?: string;
  score?: number;
  slug?: string;
  tags?: string[];
}

export interface VivibeVoicesResponse {
  fetchedAt?: string;
  total?: number;
  voices: VivibeVoice[];
}

export interface PortableUpdateStatus {
  available: boolean;
  currentVersion: string;
  message: string;
  platform?: "windows" | "macos";
  portable: boolean;
}

export interface PortableUpdateImportResponse {
  currentVersion: string;
  message: string;
  ok: true;
}

export interface VideoAbbreviationsResponse {
  abbreviations: Record<string, string>;
  csvPath: string;
}

export interface ImportVideoAbbreviationsFromUrlPayload {
  merge?: boolean;
  url: string;
}

const requestJson = async <TResponse>(
  path: string,
  init?: RequestInit
): Promise<TResponse> => {
  const response = await fetch(path, init);

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const payload = (await response.json()) as {
        error?: string;
        issues?: Array<{
          path?: Array<string | number>;
          message?: string;
        }>;
        license?: ConfigResponse["license"];
      };
      if (payload?.error) {
        message = payload.error;
      }
      const issues = (payload.issues ?? [])
        .map((issue) => {
          const path = issue.path?.length ? `${issue.path.join(".")}: ` : "";
          return `${path}${issue.message ?? "Dữ liệu không hợp lệ"}`;
        })
        .filter(Boolean);
      if (issues.length > 0) {
        message = `${message} (${issues.join("; ")})`;
      }
      if (
        response.status === 403 &&
        payload?.license &&
        typeof window !== "undefined"
      ) {
        window.dispatchEvent(
          new CustomEvent(LICENSE_INVALIDATED_EVENT, {
            detail: payload.license,
          })
        );
      }
    } catch {
      message = `Request failed: ${response.status}`;
    }
    throw new Error(message);
  }

  return (await response.json()) as TResponse;
};

export const getConfig = (): Promise<ConfigResponse> =>
  requestJson<ConfigResponse>("/api/config");

export const getVideoThumbnailSettings = (
  mode: VideoThumbnailMode,
): Promise<VideoThumbnailSettingsResponse> =>
  requestJson<VideoThumbnailSettingsResponse>(
    `/api/video/thumbnail-settings?mode=${encodeURIComponent(mode)}`,
  );

export const updateVideoThumbnailSettings = (payload: {
  mode: VideoThumbnailMode;
  thumbnailIntro: VideoThumbnailIntro | null;
}): Promise<VideoThumbnailSettingsResponse> =>
  requestJson<VideoThumbnailSettingsResponse>("/api/video/thumbnail-settings", {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });

export const updateConfigCredentials = (
  payload: UpdateConfigCredentialsPayload
): Promise<ConfigResponse> =>
  requestJson<ConfigResponse>("/api/config/credentials", {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });

export const updateLicense = (
  payload: UpdateLicensePayload
): Promise<ConfigResponse> =>
  requestJson<ConfigResponse>("/api/config/license", {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });

export const testConfigCredential = (
  payload: TestConfigCredentialPayload
): Promise<TestConfigCredentialResponse> =>
  requestJson<TestConfigCredentialResponse>("/api/config/credentials/test", {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

export const getSample = (): Promise<SampleResponse> =>
  requestJson<SampleResponse>("/api/sample");

export const getCrawlConfig = (): Promise<CrawlConfigResponse> =>
  requestJson<CrawlConfigResponse>("/api/crawl/config");

export const getCrawlSession = (): Promise<ThreadsSessionResponse> =>
  requestJson<ThreadsSessionResponse>("/api/crawl/session");

export const loginCrawlSession = (): Promise<ThreadsSessionResponse> =>
  requestJson<ThreadsSessionResponse>("/api/crawl/session/login", {
    method: "POST",
  });

export const testCrawlSession = (): Promise<ThreadsSessionResponse> =>
  requestJson<ThreadsSessionResponse>("/api/crawl/session/test", {
    method: "POST",
  });

export const logoutCrawlSession = (): Promise<ThreadsSessionResponse> =>
  requestJson<ThreadsSessionResponse>("/api/crawl/session/logout", {
    method: "POST",
  });

export const getCrawlRuns = (): Promise<CrawlRunsResponse> =>
  requestJson<CrawlRunsResponse>("/api/crawl/runs");

export const getCrawlOutputs = (options?: {
  includeRequestMeta?: boolean;
}): Promise<CrawlOutputsResponse> => {
  const query = options?.includeRequestMeta ? "?includeRequestMeta=true" : "";
  return requestJson<CrawlOutputsResponse>(`/api/crawl/outputs${query}`);
};

export const startCrawlRun = (
  payload: StartCrawlRunPayload = {}
): Promise<{ run: CrawlRun }> =>
  requestJson<{ run: CrawlRun }>("/api/crawl/runs", {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

export const getCrawlOutput = (runId: string): Promise<CrawlOutputResponse> =>
  requestJson<CrawlOutputResponse>(`/api/crawl/runs/${runId}/output`);

export const getCrawlOutputFile = (
  filename: string
): Promise<CrawlOutputResponse> =>
  requestJson<CrawlOutputResponse>(
    `/api/crawl/outputs/${encodeURIComponent(filename)}`
  );

export const deleteCrawlOutputFile = (
  filename: string,
): Promise<{ filename: string; ok: true }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  return requestJson<{ filename: string; ok: true }>(
    `/api/crawl/outputs/${encodeURIComponent(filename)}`,
    {
      method: "DELETE",
      signal: controller.signal,
    },
  )
    .catch((error) => {
      if (controller.signal.aborted) {
        throw new Error("Xóa file đầu ra mất quá lâu. Hãy thử lại sau ít giây.");
      }
      throw error;
    })
    .finally(() => clearTimeout(timeout));
};

export const updateCrawlOutputPost = (
  filename: string,
  postId: string,
  payload: UpdateCrawlOutputPostPayload
): Promise<CrawlOutputResponse> =>
  requestJson<CrawlOutputResponse>(
    `/api/crawl/outputs/${encodeURIComponent(filename)}/posts/${encodeURIComponent(postId)}`,
    {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
      method: "PATCH",
    }
  );

export const cancelCrawlRun = (runId: string): Promise<{ run: CrawlRun }> =>
  requestJson<{ run: CrawlRun }>(`/api/crawl/runs/${runId}/cancel`, {
    method: "POST",
  });

export const resumeCrawlRun = (runId: string): Promise<{ run: CrawlRun }> =>
  requestJson<{ run: CrawlRun }>(`/api/crawl/runs/${runId}/resume`, {
    method: "POST",
  });

export const saveVideoProject = (
  payload: CreateVideoDraftPayload
): Promise<VideoDraftResponse> =>
  requestJson<VideoDraftResponse>("/api/video/projects", {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

export const createVideoVoice = (
  payload: CreateVideoDraftPayload
): Promise<VideoDraftResponse> =>
  requestJson<VideoDraftResponse>("/api/video/voices", {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

export const ocrVideoDialogue = (
  imagePath: string
): Promise<{ cached: boolean; height: number; imageHash: string; isDialogue: boolean; lines: DialogueLine[]; width: number }> =>
  requestJson('/api/video/ocr-dialogue', {
    body: JSON.stringify({ imagePath }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

export const suggestVideoDialogueText = (payload: {
  abbreviations?: Record<string, string>;
  contextText?: string;
  lines: Array<Pick<DialogueLine, "id" | "speaker" | "text">>;
}): Promise<{ lines: Array<Pick<DialogueLine, "id" | "speaker" | "text">> }> =>
  requestJson('/api/video/dialogue-text-suggestions', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

export const generateVideoTtsSuggestions = (
  payload: GenerateVideoTtsSuggestionsPayload
): Promise<GenerateVideoTtsSuggestionsResponse> =>
  requestJson<GenerateVideoTtsSuggestionsResponse>(
    "/api/video/tts-suggestions",
    {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  );

export const uploadVideoBackground = (
  file: File,
  customName?: string
): Promise<VideoUploadResponse> => {
  const form = new FormData();
  form.append("file", file);
  form.append("lastModified", new Date(file.lastModified).toISOString());
  form.append(
    "displayName",
    String(customName ?? file.name).trim() || file.name
  );
  form.append("originalName", file.name);
  form.append("type", file.type || "video/*");
  return requestJson<VideoUploadResponse>("/api/video/uploads", {
    body: form,
    method: "POST",
  });
};

export const getUploadedVideoBackgrounds = (): Promise<VideoUploadsResponse> =>
  requestJson<VideoUploadsResponse>("/api/video/uploads");

export const uploadPromotionVideo = (
  file: File,
  customName?: string
): Promise<VideoUploadResponse> => {
  const form = new FormData();
  form.append("file", file);
  form.append("lastModified", new Date(file.lastModified).toISOString());
  form.append(
    "displayName",
    String(customName ?? file.name).trim() || file.name
  );
  form.append("originalName", file.name);
  form.append("type", file.type || "video/*");
  return requestJson<VideoUploadResponse>("/api/video/promotion-uploads", {
    body: form,
    method: "POST",
  });
};

export const getUploadedPromotionVideos = (): Promise<VideoUploadsResponse> =>
  requestJson<VideoUploadsResponse>("/api/video/promotion-uploads");

export const getVideoAbbreviations = (): Promise<VideoAbbreviationsResponse> =>
  requestJson<VideoAbbreviationsResponse>("/api/video/abbreviations");

export const updateVideoAbbreviations = (
  abbreviations: Record<string, string>
): Promise<VideoAbbreviationsResponse> =>
  requestJson<VideoAbbreviationsResponse>("/api/video/abbreviations", {
    body: JSON.stringify({ abbreviations }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });

export const importVideoAbbreviationsFromUrl = (
  payload: ImportVideoAbbreviationsFromUrlPayload
): Promise<VideoAbbreviationsResponse> =>
  requestJson<VideoAbbreviationsResponse>(
    "/api/video/abbreviations/import-url",
    {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  );

export const uploadBackgroundMusic = (
  file: File,
  customName?: string
): Promise<AudioUploadResponse> => {
  const form = new FormData();
  form.append("file", file);
  form.append("lastModified", new Date(file.lastModified).toISOString());
  form.append(
    "displayName",
    String(customName ?? file.name).trim() || file.name
  );
  form.append("originalName", file.name);
  form.append("type", file.type || "audio/*");
  return requestJson<AudioUploadResponse>("/api/video/music-uploads", {
    body: form,
    method: "POST",
  });
};

export const getUploadedBackgroundMusic = (): Promise<AudioUploadsResponse> =>
  requestJson<AudioUploadsResponse>("/api/video/music-uploads");

export const getMemeLibrary = (): Promise<MemeLibraryResponse> =>
  requestJson<MemeLibraryResponse>("/api/video/meme-library");

export const createMemeEmotion = (
  emotion: string,
  label: string
): Promise<{ emotion: string; label: string }> =>
  requestJson<{ emotion: string; label: string }>(
    "/api/video/meme-library/emotion",
    {
      body: JSON.stringify({ emotion, label }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  );

export const deleteMemeEmotion = (emotion: string): Promise<{ ok: true }> =>
  requestJson<{ ok: true }>(
    `/api/video/meme-library/emotion?emotion=${encodeURIComponent(emotion)}`,
    {
      method: "DELETE",
    }
  );

export const updateMemeEmotionLabel = (
  emotion: string,
  label: string
): Promise<{ emotion: string; label: string }> =>
  requestJson<{ emotion: string; label: string }>(
    "/api/video/meme-library/emotion",
    {
      body: JSON.stringify({ emotion, label }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "PATCH",
    }
  );

export const uploadMemeImage = (
  emotion: string,
  file: File,
  customName?: string
): Promise<MemeImageUploadResponse> => {
  const form = new FormData();
  form.append("emotion", emotion);
  form.append("file", file);
  form.append("lastModified", new Date(file.lastModified).toISOString());
  form.append("name", String(customName ?? file.name).trim() || file.name);
  form.append("type", file.type || "image/*");
  return requestJson<MemeImageUploadResponse>("/api/video/meme-library/image", {
    body: form,
    method: "POST",
  });
};

export const uploadMemeAudio = (
  emotion: string,
  file: File,
  customName?: string
): Promise<MemeAudioUploadResponse> => {
  const form = new FormData();
  form.append("emotion", emotion);
  form.append("file", file);
  form.append("lastModified", new Date(file.lastModified).toISOString());
  form.append("name", String(customName ?? file.name).trim() || file.name);
  form.append("type", file.type || "audio/*");
  return requestJson<MemeAudioUploadResponse>("/api/video/meme-library/audio", {
    body: form,
    method: "POST",
  });
};

export interface DefaultCommentAvatarResponse {
  avatar: {
    assetPath: string;
    mediaUrl: string;
  } | null;
}

export const getDefaultCommentAvatar =
  (): Promise<DefaultCommentAvatarResponse> =>
    requestJson<DefaultCommentAvatarResponse>(
      "/api/video/default-comment-avatar"
    );

export const uploadDefaultCommentAvatar = (
  file: File
): Promise<DefaultCommentAvatarResponse> => {
  const form = new FormData();
  form.append("file", file);
  form.append("name", file.name);
  form.append("type", file.type || "image/*");
  return requestJson<DefaultCommentAvatarResponse>(
    "/api/video/default-comment-avatar",
    {
      body: form,
      method: "PUT",
    }
  );
};

export const uploadCommentAsset = (
  file: File,
  customName?: string,
  removeBackground = false
): Promise<CommentAssetUploadResponse> => {
  const form = new FormData();
  form.append("file", file);
  form.append("lastModified", new Date(file.lastModified).toISOString());
  form.append("name", String(customName ?? file.name).trim() || file.name);
  form.append("type", file.type || "image/*");
  form.append("removeBackground", String(removeBackground));
  return requestJson<CommentAssetUploadResponse>("/api/video/comment-assets", {
    body: form,
    method: "POST",
  });
};

export const deleteUploadedBackgroundMusic = (
  serverPath: string
): Promise<{ ok: true }> =>
  requestJson<{ ok: true }>(
    `/api/video/music-uploads?path=${encodeURIComponent(serverPath)}`,
    {
      method: "DELETE",
    }
  );

export const deleteMemeImage = (
  emotion: string,
  serverPath?: string
): Promise<{ ok: true }> =>
  requestJson<{ ok: true }>(
    `/api/video/meme-library/image?emotion=${encodeURIComponent(emotion)}${
      serverPath ? `&path=${encodeURIComponent(serverPath)}` : ""
    }`,
    {
      method: "DELETE",
    }
  );

export const deleteMemeAudio = (
  emotion: string,
  serverPath?: string
): Promise<{ ok: true }> =>
  requestJson<{ ok: true }>(
    `/api/video/meme-library/audio?emotion=${encodeURIComponent(emotion)}${
      serverPath ? `&path=${encodeURIComponent(serverPath)}` : ""
    }`,
    {
      method: "DELETE",
    }
  );

export const deleteUploadedVideoBackground = (
  serverPath: string
): Promise<{ ok: true }> =>
  requestJson<{ ok: true }>(
    `/api/video/uploads?path=${encodeURIComponent(serverPath)}`,
    {
      method: "DELETE",
    }
  );

export const deleteUploadedPromotionVideo = (
  serverPath: string
): Promise<{ ok: true }> =>
  requestJson<{ ok: true }>(
    `/api/video/promotion-uploads?path=${encodeURIComponent(serverPath)}`,
    {
      method: "DELETE",
    }
  );

export const renderVideo = (
  payload: CreateVideoDraftPayload
): Promise<VideoRenderResponse> =>
  requestJson<VideoRenderResponse>("/api/video/render", {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

export const getVideoRenderJobs = (): Promise<VideoRenderJobsResponse> =>
  requestJson<VideoRenderJobsResponse>("/api/video/render-jobs");

export const getVivibeVoices = (): Promise<VivibeVoicesResponse> =>
  requestJson<VivibeVoicesResponse>("/api/video/vivibe/voices");

export const getPortableUpdateStatus = (): Promise<PortableUpdateStatus> =>
  requestJson<PortableUpdateStatus>("/api/system/update/status");

export const importPortableUpdate = (
  file: File
): Promise<PortableUpdateImportResponse> => {
  const formData = new FormData();
  formData.append("file", file, file.name);
  return requestJson<PortableUpdateImportResponse>("/api/system/update/import", {
    body: formData,
    method: "POST",
  });
};
