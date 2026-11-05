export interface UploadedVideoFile {
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
  video?: UploadedVideoFile | null;
  volume?: number;
}

export interface VideoPromotionConfig {
  midroll?: VideoPromotionSlot | null;
  minMidrollContentSeconds?: number;
  outro?: VideoPromotionSlot | null;
}

export interface UploadedAudioFile {
  durationSeconds?: number | null;
  lastModified: string;
  mediaUrl?: string;
  name: string;
  serverPath?: string;
  sizeBytes: number;
  type: string;
}

export interface UploadedCommentAssetFile {
  lastModified: string;
  mediaUrl?: string;
  name: string;
  serverPath?: string;
  sizeBytes: number;
  type: string;
}

export interface UploadedImageFile {
  durationSeconds?: number | null;
  lastModified: string;
  mediaUrl?: string;
  name: string;
  serverPath?: string;
  sizeBytes: number;
  type: string;
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
  background?: UploadedImageFile | null;
  backgroundFit?: VideoThumbnailBackgroundFit;
  backgroundPositionX?: number;
  backgroundPositionY?: number;
  backgroundZoom?: number;
  brandImage?: UploadedImageFile | null;
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
  image?: UploadedImageFile | null;
  mode?: VideoThumbnailMode;
  subtitle?: string;
  title: string;
  titleOverridesByPostId?: Record<string, string>;
  titleColor?: string;
  titleFont?: VideoThumbnailFont;
  titleBold?: boolean;
  titleItalic?: boolean;
  titleFontSize?: number;
  watermark?: UploadedImageFile | null;
  watermarkPosition?: VideoThumbnailWatermarkPosition;
  layout?: VideoThumbnailLayout;
}

export interface MemeLibraryEntry {
  audio?: UploadedAudioFile | null;
  audios?: UploadedAudioFile[];
  emotion: string;
  label?: string;
  image?: UploadedImageFile | null;
  images?: UploadedImageFile[];
}

export interface MemeTransitionConfig {
  audio?: UploadedAudioFile | null;
  audios?: UploadedAudioFile[];
  durationMs?: number;
  emotion: string;
  label?: string;
  image?: UploadedImageFile | null;
  images?: UploadedImageFile[];
  placement?: "after_comment" | "media_reveal" | "transition";
  visualMode?: "meme" | "sound_only";
}

export interface VideoDraftMediaAsset {
  asset_path: string;
  duration_seconds?: number;
  height: number;
  order: number;
  remote_url: string;
  type: "image" | "video";
  width: number;
}

export type DialogueSpeaker = 'A' | 'B' | 'unknown';

export interface DialogueBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DialogueLine {
  id: string;
  order: number;
  text: string;
  confidence: number;
  bbox: DialogueBoundingBox;
  speaker: DialogueSpeaker;
}

export interface VideoSpoilerRevealRegion {
  bbox: DialogueBoundingBox;
  image_height: number;
  image_width: number;
  text: string;
}

export interface DialogueVoiceSettings {
  A: VideoVoiceSettings;
  B: VideoVoiceSettings;
}

export interface VideoDialogueConfig {
  confirmed: boolean;
  imagePath: string;
  lines: DialogueLine[];
  pauseMs?: number;
  speakers: DialogueVoiceSettings;
}

export interface VideoTtsProcessingMeta {
  appliedMode: "off" | "rules_only" | "llm_assist";
  requestedMode: "off" | "rules_only" | "llm_assist";
  usedLlm: boolean;
  warnings: string[];
}

export interface VideoDraftComment {
  avatar_asset_path: string;
  avatar_url: string;
  comment_id: string;
  created_at: string;
  display_name: string;
  like_count: number;
  media: VideoDraftMediaAsset[];
  reply_count: number;
  repost_count?: number;
  share_count?: number;
  video_like_count?: number;
  video_reply_count?: number;
  video_share_count?: number;
  text: string;
  tts_processing?: VideoTtsProcessingMeta;
  tts_text?: string;
  username: string;
  is_spoiler?: boolean;
  spoiler_initial_text?: string;
  spoiler_reveal_text?: string;
  spoiler_media?: boolean;
  spoiler_style?: "blur" | "hide";
  spoiler_reveal_regions?: VideoSpoilerRevealRegion[];
  spoiler_reveal_media_only?: boolean;
  video_duration_seconds?: number;
}

export interface VideoDraftPost {
  avatar_asset_path: string;
  avatar_url: string;
  created_at: string;
  display_name: string;
  language: string;
  like_count: number;
  media: VideoDraftMediaAsset[];
  post_id: string;
  reply_count: number;
  repost_count: number;
  share_count: number;
  text: string;
  top_comments: VideoDraftComment[];
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
  spoiler_reveal_regions?: VideoSpoilerRevealRegion[];
  spoiler_reveal_media_only?: boolean;
  video_duration_seconds?: number;
}

export interface VideoDraftPayload {
  abbreviations?: Record<string, string>;
  backgroundMusic?: UploadedAudioFile | null;
    backgroundMusicVolume?: number;
  cardTheme?: "light" | "dark";
  dialogue?: VideoDialogueConfig | null;
  commentVoiceMode?: "emotion" | "fixed";
  existingDraft?: VideoDraftDocument | null;
  memeBySceneId?: Record<string, MemeTransitionConfig | null>;
  memeTransition?: MemeTransitionConfig | null;
  outputPath: string;
  playPostVideoAfterCaption?: boolean;
  promotion?: VideoPromotionConfig | null;
  thumbnailIntro?: VideoThumbnailIntro | null;
  selectedPosts: VideoDraftPost[];
  textProcessing?: VideoTextProcessingOptions;
  uploadedVideo?: UploadedVideoFile | null;
  videoMode: string;
  voiceSettings?: VideoVoiceSettings | null;
  voiceVolume?: number;
}

export interface VideoTextProcessingOptions {
  mode?: "off" | "rules_only" | "llm_assist";
}

export interface VideoVoiceSettings {
  languageCode: string;
  pitch: number;
  provider: "ausynclab" | "fpt_ai" | "google_cloud" | "vivibe";
  speakingRate: number;
  ssmlGender: "FEMALE" | "MALE" | "NEUTRAL" | "SSML_VOICE_GENDER_UNSPECIFIED";
  voiceName: string;
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

export interface NarrationAudio {
  audio_url: string;
  chunks: NarrationChunk[];
  merged_audio_path: string;
  merged_audio_url: string;
  message: string;
  provider: "ausynclab" | "fpt_ai" | "google_cloud" | "vivibe";
  request_id: string;
  status: "idle" | "processing" | "ready";
  total_duration_ms: number;
  voice_profile: VideoVoiceSettings | null;
}

export interface VideoSpoilerRevealSegment {
  media_reveal_percent: number;
  reveal_time_ms: number;
  text: string;
}

export interface VideoThreadPage {
  member_scene_ids: string[];
}

export interface VideoDraftScene {
  comment_id?: string;
  display_duration_ms?: number;
  has_media?: boolean;
  kind: "comment" | "post" | "post_video";
  meme_transition?: MemeTransitionConfig | null;
  trailing_meme_transition?: MemeTransitionConfig | null;
  narration: NarrationAudio;
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
  video_media?: VideoDraftMediaAsset;
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
  dialogue_speaker?: DialogueSpeaker;
}

export interface VideoDraftDocument {
  abbreviations?: Record<string, string>;
  dialogue?: VideoDialogueConfig | null;
  background_music?: UploadedAudioFile | null;
  background_music_volume?: number;
  cardTheme?: "light" | "dark";
  created_at: string;
  draft_id: string;
  meme_transition?: MemeTransitionConfig | null;
  play_post_video_after_caption?: boolean;
  promotion?: VideoPromotionConfig | null;
  thumbnail_intro?: VideoThumbnailIntro | null;
  scenes: VideoDraftScene[];
  selected_posts: VideoDraftPost[];
  source_output_path: string;
  uploaded_video: UploadedVideoFile | null;
  video_plan: {
    aspect_ratio: "9:16";
    comments_sequential: true;
    duration_target_seconds: number;
    format: string;
    language: string;
    title: string;
    voice_ready: boolean;
  };
  voice_volume?: number;
}

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
