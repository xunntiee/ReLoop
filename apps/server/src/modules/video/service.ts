import type { VideoDialogueConfig } from './types.js';
import { createHash } from "node:crypto";
import { existsSync, type Dirent } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type { ToolConfig } from "@tool-base/config/schema";
import {
  readAbbreviationDictionary,
  writeAbbreviationDictionary,
} from "./abbreviation-dictionary.js";
import {
  mergeAudioChunks,
  probeDurationMs,
  probeVideoDurationMs,
  retimeAudioFile,
} from "./audio-tools.js";
import { ensureFfmpegReady, formatVideoRenderErrorMessage } from "./ffmpeg.js";
import { hasRecognizedDialogue } from "./ocr-dialogue.js";
import { stopVideoRuntimeProcesses } from "./runtime-processes.js";
import { chunkNarrationText } from "./text-chunker.js";
import {
  removeTtsEmoticons,
  replaceSpelledTtsCommas,
} from "./text-normalizer.js";
import type { TextToSpeechProvider } from "./tts-provider.js";
import { createTtsProviderRegistry } from "./tts-registry.js";
import {
  type NarrationTextContext,
  prepareNarrationText,
} from "./tts-text-preprocessor.js";
import type {
  MemeLibraryEntry,
  MemeTransitionConfig,
  NarrationAudio,
  NarrationChunk,
  UploadedAudioFile,
  UploadedCommentAssetFile,
  UploadedImageFile,
  UploadedVideoFile,
  VideoDraftDocument,
  VideoDraftPayload,
  VideoDraftScene,
  VideoPromotionConfig,
  VideoRenderJob,
  VideoRenderResult,
  VideoThumbnailLayerId,
  VideoThumbnailLayerLayout,
  VideoThumbnailFont,
  VideoThumbnailIntro,
  VideoSpoilerRevealRegion,
  VideoVoiceSettings,
} from "./types.js";
import {
  assertVideoDraftAssets,
  renderVideoDraft,
} from "./video-renderer.js";
import { VivibeTtsClient, type VivibeVoiceItem } from "./vivibe-tts.js";
import { mergeVivibeVoices } from "./vivibe-voice-presets.js";
import { resolveSceneVoiceProfile } from "./voice-strategy.js";
import sharp from "sharp";

let lastTimestampSeed = "";
let timestampSequence = 0;
const NARRATION_PIPELINE_VERSION = 31;
const NARRATION_PIPELINE_TAG = `[pipeline:v${NARRATION_PIPELINE_VERSION}]`;
const POST_NARRATION_HOLD_MS = 450;
const COMMENT_NARRATION_HOLD_MS = 550;
const SHORT_COMMENT_MEDIA_EXTRA_HOLD_MS = 1200;
const MEDIUM_COMMENT_MEDIA_EXTRA_HOLD_MS = 700;
const DEFAULT_POST_VIDEO_DURATION_MS = 5000;
const MAX_POST_VIDEO_DURATION_MS = 120000;
const VIVIBE_VOICES_CACHE_TTL_MS = 10 * 60_000;
const VIVIBE_VOICES_ERROR_CACHE_TTL_MS = 30_000;

export interface VideoDraftServiceOptions {
  config: ToolConfig;
  configPath: string;
}

interface PlannedScene extends Omit<VideoDraftScene, "narration"> {
  commentText?: string;
}

interface PreparedSceneNarrationInput {
  abbreviations?: Record<string, string>;
  config: ToolConfig["video"];
  context?: NarrationTextContext;
  displayText: string;
  explicitNarrationText?: string;
  kind: "post" | "comment";
  language?: string;
  mode?: "off" | "rules_only" | "llm_assist";
}

interface PreparedSceneNarration {
  hasExplicitNarrationOverride: boolean;
  narrationText: string;
  sourceText: string;
  textProcessing: VideoDraftScene["text_processing"];
}

export class VideoDraftService {
  private readonly configBaseDir: string;
  private renderQueue: Promise<void> = Promise.resolve();
  private readonly renderJobs = new Map<string, VideoRenderJob>();
  private readonly memeImageDurationCache = new Map<
    string,
    { durationSeconds: number | null; mtimeMs: number }
  >();
  private readonly recentMemeSelectionHistory = new Map<string, string[]>();
  private shuttingDown = false;
  private vivibeVoicesCache: VivibeVoiceItem[] | null = null;
  private vivibeVoicesCacheExpiresAt = 0;

  constructor(private readonly options: VideoDraftServiceOptions) {
    this.configBaseDir = dirname(options.configPath);
  }

  async createProjectDraft(payload: VideoDraftPayload): Promise<{
    draft: VideoDraftDocument;
    draftPath: string;
  }> {
    return this.createDraft(payload, false);
  }

  async createVoiceDraft(payload: VideoDraftPayload): Promise<{
    draft: VideoDraftDocument;
    draftPath: string;
  }> {
    return this.createDraft(payload, true);
  }

  async getAbbreviationDictionary(): Promise<{
    abbreviations: Record<string, string>;
    csvPath: string;
  }> {
    const csvPath = this.getAbbreviationsCsvPath();
    return {
      abbreviations: await readAbbreviationDictionary(csvPath),
      csvPath: toUrlPath(relative(this.configBaseDir, csvPath)),
    };
  }

  async saveAbbreviationDictionary(
    abbreviations: Record<string, string>
  ): Promise<{
    abbreviations: Record<string, string>;
    csvPath: string;
  }> {
    const csvPath = this.getAbbreviationsCsvPath();
    return {
      abbreviations: await writeAbbreviationDictionary(csvPath, abbreviations),
      csvPath: toUrlPath(relative(this.configBaseDir, csvPath)),
    };
  }

  async suggestNarrationTexts({
    abbreviations,
    selectedPosts,
    textProcessing,
  }: Pick<
    VideoDraftPayload,
    "abbreviations" | "selectedPosts" | "textProcessing"
  >): Promise<VideoDraftPayload["selectedPosts"]> {
    const mode = textProcessing?.mode ?? "rules_only";
    const storedAbbreviations = await this.getAbbreviationDictionary().catch(
      () => ({ abbreviations: {} as Record<string, string> })
    );
    const effectiveAbbreviations = {
      ...storedAbbreviations.abbreviations,
      ...(abbreviations ?? {}),
    };
    const suggestedPosts: VideoDraftPayload["selectedPosts"] = [];

    for (const post of selectedPosts) {
      const preparedPost = await prepareSceneNarration({
        abbreviations: effectiveAbbreviations,
        config: this.options.config.video,
        context: {
          commentSnippets: post.top_comments
            .map((comment) => comment.text)
            .filter(Boolean)
            .slice(0, 4),
          titleHint: `Post by @${post.username}`,
          username: post.username,
        },
        displayText: post.text,
        kind: "post",
        language: post.language,
        mode,
      });

      const topComments: typeof post.top_comments = [];
      for (const comment of post.top_comments) {
        const preparedComment = await prepareSceneNarration({
          abbreviations: effectiveAbbreviations,
          config: this.options.config.video,
          context: {
            commentSnippets: post.top_comments
              .filter((item) => item.comment_id !== comment.comment_id)
              .map((item) => item.text)
              .filter(Boolean)
              .slice(0, 3),
            postText: post.text,
            titleHint: `Comment on post by @${post.username}`,
            username: comment.username,
          },
          displayText: comment.text,
          kind: "comment",
          language: post.language,
          mode,
        });
        topComments.push({
          ...comment,
          tts_processing: preparedComment.textProcessing,
          tts_text: preparedComment.narrationText || undefined,
        });
      }

      suggestedPosts.push({
        ...post,
        top_comments: topComments,
        tts_processing: preparedPost.textProcessing,
        tts_text: preparedPost.narrationText || undefined,
      });
    }

    return suggestedPosts;
  }

  async saveUploadedVideo({
    bytes,
    displayName,
    lastModified,
    originalName,
    purpose = "background",
    type,
  }: {
    bytes: Buffer;
    displayName: string;
    lastModified: string;
    originalName: string;
    purpose?: "background" | "promotion";
    type: string;
  }): Promise<UploadedVideoFile> {
    if (!this.options.config.video.enabled) {
      throw new Error("Video workflow is disabled in config.");
    }
    if (bytes.length === 0) {
      throw new Error("File video tải lên bị rỗng.");
    }

    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const normalizedDisplayName =
      displayName.trim() || originalName.trim() || "background-video";
    const extension = getVideoExtension(originalName, type);
    const filename = `${timestampId()}-${hash}-${safeFilename(
      stripExtension(normalizedDisplayName)
    )}.${extension}`;
    const uploadDir = resolve(
      this.configBaseDir,
      this.options.config.video.uploadsDir
    );
    const outputPath = resolve(uploadDir, filename);
    const metaPath = resolve(uploadDir, `${filename}.json`);
    await mkdir(uploadDir, { recursive: true });

    if (!(await fileExists(outputPath))) {
      await writeFile(outputPath, bytes);
    }
    const durationMs = await probeDurationMs(outputPath);
    const durationSeconds =
      typeof durationMs === "number" && durationMs > 0
        ? durationMs / 1000
        : null;
    await writeFile(
      metaPath,
      `${JSON.stringify(
        {
          lastModified,
          name: normalizedDisplayName,
          purpose,
          sizeBytes: bytes.length,
          type: type || "video/*",
          durationSeconds,
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const serverPath = toUrlPath(relative(this.configBaseDir, outputPath));
    return {
      lastModified,
      mediaUrl: `/media/${serverPath}`,
      name: normalizedDisplayName,
      purpose,
      serverPath,
      sizeBytes: bytes.length,
      type: type || "video/*",
      durationSeconds,
    };
  }

  async saveUploadedMusic({
    bytes,
    displayName,
    lastModified,
    originalName,
    type,
  }: {
    bytes: Buffer;
    displayName: string;
    lastModified: string;
    originalName: string;
    type: string;
  }): Promise<UploadedAudioFile> {
    if (!this.options.config.video.enabled) {
      throw new Error("Video workflow is disabled in config.");
    }
    if (bytes.length === 0) {
      throw new Error("File nhac tai len bi rong.");
    }

    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const normalizedDisplayName =
      displayName.trim() || originalName.trim() || "background-music";
    const extension = getAudioExtension(originalName, type);
    const filename = `${timestampId()}-${hash}-${safeFilename(
      stripExtension(normalizedDisplayName)
    )}.${extension}`;
    const uploadDir = this.getMusicUploadsDir();
    const outputPath = resolve(uploadDir, filename);
    const metaPath = resolve(uploadDir, `${filename}.json`);
    await mkdir(uploadDir, { recursive: true });

    if (!(await fileExists(outputPath))) {
      await writeFile(outputPath, bytes);
    }
    await writeFile(
      metaPath,
      `${JSON.stringify(
        {
          lastModified,
          name: normalizedDisplayName,
          sizeBytes: bytes.length,
          type: type || "audio/*",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const serverPath = toUrlPath(relative(this.configBaseDir, outputPath));
    return {
      lastModified,
      mediaUrl: `/media/${serverPath}`,
      name: normalizedDisplayName,
      serverPath,
      sizeBytes: bytes.length,
      type: type || "audio/*",
    };
  }

  async saveUploadedCommentAsset({
    bytes,
    lastModified,
    name,
    removeBackground = false,
    type,
  }: {
    bytes: Buffer;
    lastModified: string;
    name: string;
    removeBackground?: boolean;
    type: string;
  }): Promise<UploadedCommentAssetFile> {
    if (!this.options.config.video.enabled) {
      throw new Error("Video workflow is disabled in config.");
    }
    if (bytes.length === 0) {
      throw new Error("File tai len bi rong.");
    }

    let processed = { bytes, changed: false };
    if (removeBackground) {
      try {
        processed = await removeFlatImageBackground(bytes, type);
      } catch {
        processed = { bytes, changed: false };
      }
    }
    const assetBytes = processed.bytes;
    const assetName = processed.changed
      ? `${stripExtension(name)}.png`
      : name;
    const assetType = processed.changed ? "image/png" : type || "image/*";
    const hash = createHash("sha256")
      .update(assetBytes)
      .digest("hex")
      .slice(0, 16);
    const extension = getCommentAssetExtension(assetName, assetType);
    const filename = `${timestampId()}-${hash}-${safeFilename(
      stripExtension(assetName)
    )}.${extension}`;
    const uploadDir = resolve(
      this.configBaseDir,
      this.options.config.video.uploadsDir,
      "_comment_assets"
    );
    const outputPath = resolve(uploadDir, filename);
    const metaPath = resolve(uploadDir, `${filename}.json`);
    await mkdir(uploadDir, { recursive: true });

    if (!(await fileExists(outputPath))) {
      await writeFile(outputPath, assetBytes);
    }
    await writeFile(
      metaPath,
      `${JSON.stringify(
        {
          lastModified,
          name,
          sizeBytes: assetBytes.length,
          type: assetType,
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const serverPath = toUrlPath(relative(this.configBaseDir, outputPath));
    return {
      lastModified,
      mediaUrl: `/media/${serverPath}`,
      name,
      serverPath,
      sizeBytes: assetBytes.length,
      type: assetType,
    };
  }

  private getCommentAssetsDir(): string {
    return resolve(
      this.configBaseDir,
      this.options.config.video.uploadsDir,
      "_comment_assets"
    );
  }

  private getConfigAssetsDir(): string {
    return resolve(this.configBaseDir, "data", "config");
  }

  async getDefaultCommentAvatar(): Promise<{
    assetPath: string;
    mediaUrl: string;
  } | null> {
    // Priority 1: data/config/default-comment-avatar.* (local config file, tracked by git)
    const configDir = this.getConfigAssetsDir();
    const configAvatarPath = await findFirstFileMatching(
      configDir,
      /^default-comment-avatar\./i
    );
    if (configAvatarPath) {
      const serverPath = toUrlPath(
        relative(this.configBaseDir, configAvatarPath)
      );
      const info = await stat(configAvatarPath);
      const bust = info.mtimeMs.toString(36);
      return {
        assetPath: serverPath,
        mediaUrl: `/media/${serverPath}?v=${bust}`,
      };
    }

    // Priority 2: _comment_assets/default-comment-avatar.* (uploaded via UI)
    const uploadDir = this.getCommentAssetsDir();
    const uploadedPath = await findFirstFileMatching(
      uploadDir,
      /^default-comment-avatar\./i
    );
    if (!uploadedPath) {
      return null;
    }
    const serverPath = toUrlPath(relative(this.configBaseDir, uploadedPath));
    const info = await stat(uploadedPath);
    const bust = info.mtimeMs.toString(36);
    return {
      assetPath: serverPath,
      mediaUrl: `/media/${serverPath}?v=${bust}`,
    };
  }

  async saveDefaultCommentAvatar({
    bytes,
    name,
    type,
  }: {
    bytes: Buffer;
    name: string;
    type: string;
  }): Promise<{
    assetPath: string;
    mediaUrl: string;
  }> {
    if (!this.options.config.video.enabled) {
      throw new Error("Video workflow is disabled in config.");
    }
    if (bytes.length === 0) {
      throw new Error("File avatar bi rong.");
    }

    // Save to data/config/ (primary location, tracked by git)
    const dir = this.getConfigAssetsDir();
    await mkdir(dir, { recursive: true });

    // Xóa avatar cũ (nếu có)
    const existing = await findFirstFileMatching(
      dir,
      /^default-comment-avatar\./i
    );
    if (existing) {
      await rm(existing, { force: true });
    }

    const extension = getImageExtension(name, type);
    const outputPath = resolve(dir, `default-comment-avatar.${extension}`);
    await writeFile(outputPath, bytes);

    const serverPath = toUrlPath(relative(this.configBaseDir, outputPath));
    const info = await stat(outputPath);
    const bust = info.mtimeMs.toString(36);
    return {
      assetPath: serverPath,
      mediaUrl: `/media/${serverPath}?v=${bust}`,
    };
  }

  async listMemeLibrary(): Promise<MemeLibraryEntry[]> {
    const libraryDir = this.getMemeLibraryDir();
    await mkdir(libraryDir, { recursive: true });
    const entries = await readdir(libraryDir, { withFileTypes: true });
    const items: MemeLibraryEntry[] = (
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry): Promise<MemeLibraryEntry | null> => {
            const emotion = String(entry.name ?? "").trim();
            if (!emotion) {
              return null;
            }

            const emotionDir = resolve(libraryDir, emotion);
            const [images, audios, metadata] = await Promise.all([
              this.listStoredMemeImages(emotionDir),
              this.listStoredMemeAudios(emotionDir),
              readUploadMetadata(resolve(emotionDir, "emotion.json")),
            ]);
            return {
              audio: audios[0] ?? null,
              audios,
              emotion,
              ...(metadata?.label ? { label: metadata.label } : {}),
              image: images[0] ?? null,
              images,
            };
          })
      )
    ).filter((item): item is MemeLibraryEntry => item !== null);

    return items.sort((left, right) =>
      left.emotion.localeCompare(right.emotion)
    );
  }

  async updateMemeEmotionLabel(emotion: string, label: string): Promise<string> {
    const normalizedLabel = String(label ?? "").trim();
    if (!normalizedLabel) {
      throw new Error("Ten cam xuc meme khong duoc de trong.");
    }

    const emotionDir = this.getMemeEmotionDir(emotion);
    await mkdir(emotionDir, { recursive: true });
    await writeFile(
      resolve(emotionDir, "emotion.json"),
      `${JSON.stringify({ label: normalizedLabel }, null, 2)}\n`,
      "utf8"
    );
    return normalizedLabel;
  }

  async createMemeEmotion(
    emotion: string,
    label: string
  ): Promise<{ emotion: string; label: string }> {
    const normalizedEmotion = safeFilename(
      String(emotion ?? "").trim().toLowerCase()
    );
    const normalizedLabel = String(label ?? "").trim().slice(0, 80);
    if (!normalizedEmotion || !normalizedLabel) {
      throw new Error("Mã và tên cảm xúc meme không được để trống.");
    }

    await mkdir(this.getMemeLibraryDir(), { recursive: true });
    const emotionDir = this.getMemeEmotionDir(normalizedEmotion);
    try {
      await mkdir(emotionDir);
    } catch (cause) {
      if (
        cause instanceof Error &&
        "code" in cause &&
        (cause as Error & { code?: string }).code === "EEXIST"
      ) {
        throw new Error("Biểu cảm meme này đã tồn tại.");
      }
      throw cause;
    }

    await writeFile(
      resolve(emotionDir, "emotion.json"),
      `${JSON.stringify({ label: normalizedLabel }, null, 2)}\n`,
      "utf8"
    );
    return { emotion: normalizedEmotion, label: normalizedLabel };
  }

  async deleteMemeEmotion(emotion: string): Promise<void> {
    const emotionDir = this.getMemeEmotionDir(emotion);
    await rm(emotionDir, { force: true, recursive: true });
  }

  async saveMemeImage({
    bytes,
    emotion,
    lastModified,
    name,
    type,
  }: {
    bytes: Buffer;
    emotion: string;
    lastModified: string;
    name: string;
    type: string;
  }): Promise<UploadedImageFile> {
    if (bytes.length === 0) {
      throw new Error("File meme image tai len bi rong.");
    }

    const emotionDir = this.getMemeEmotionDir(emotion);
    const imageDir = this.getMemeAssetDir(emotion, "image");
    await mkdir(imageDir, { recursive: true });

    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const normalizedName = safeFilename(stripExtension(name));
    const duplicate = await this.findDuplicateMemeImage(
      emotionDir,
      normalizedName,
      hash
    );
    if (duplicate) {
      return duplicate;
    }

    const extension = getMemeAssetExtension(name, type);
    const filename = `${timestampId()}-${hash}-${normalizedName}.${extension}`;
    const outputPath = resolve(imageDir, filename);
    const metaPath = `${outputPath}.json`;
    await writeFile(outputPath, bytes);
    const durationMs = isVideoMemeFile(name, type)
      ? await probeDurationMs(outputPath)
      : null;
    await writeFile(
      metaPath,
      `${JSON.stringify(
        {
          durationSeconds: durationMs ? durationMs / 1000 : null,
          hash,
          lastModified,
          name,
          sizeBytes: bytes.length,
          type: type || "image/*",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    return this.buildStoredImagePayload(outputPath, {
      durationSeconds: durationMs ? durationMs / 1000 : null,
      lastModified,
      name,
      sizeBytes: bytes.length,
      type: type || "image/*",
    });
  }

  async saveMemeAudio({
    bytes,
    emotion,
    lastModified,
    name,
    type,
  }: {
    bytes: Buffer;
    emotion: string;
    lastModified: string;
    name: string;
    type: string;
  }): Promise<UploadedAudioFile> {
    if (bytes.length === 0) {
      throw new Error("File meme sound tai len bi rong.");
    }

    const emotionDir = this.getMemeEmotionDir(emotion);
    const audioDir = this.getMemeAssetDir(emotion, "audio");
    await mkdir(audioDir, { recursive: true });

    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const normalizedName = safeFilename(stripExtension(name));
    const duplicate = await this.findDuplicateMemeAudio(
      emotionDir,
      normalizedName,
      hash
    );
    if (duplicate) {
      return duplicate;
    }

    const extension = getAudioExtension(name, type);
    const filename = `${timestampId()}-${hash}-${normalizedName}.${extension}`;
    const outputPath = resolve(audioDir, filename);
    const metaPath = `${outputPath}.json`;
    await writeFile(outputPath, bytes);
    const durationMs = await probeDurationMs(outputPath);
    await writeFile(
      metaPath,
      `${JSON.stringify(
        {
          durationSeconds: durationMs ? durationMs / 1000 : null,
          hash,
          lastModified,
          name,
          sizeBytes: bytes.length,
          type: type || "audio/*",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    return this.buildStoredAudioPayload(outputPath, {
      durationSeconds: durationMs ? durationMs / 1000 : null,
      lastModified,
      name,
      sizeBytes: bytes.length,
      type: type || "audio/*",
    });
  }

  async deleteMemeImage(emotion: string, serverPath?: string): Promise<void> {
    const emotionDir = this.getMemeEmotionDir(emotion);
    if (serverPath) {
      await this.deleteMemeAssetFile(serverPath, emotionDir, "image");
      return;
    }
    await this.deleteMemeAssetFiles(emotionDir, "image");
  }

  async deleteMemeAudio(emotion: string, serverPath?: string): Promise<void> {
    const emotionDir = this.getMemeEmotionDir(emotion);
    if (serverPath) {
      await this.deleteMemeAssetFile(serverPath, emotionDir, "audio");
      return;
    }
    await this.deleteMemeAssetFiles(emotionDir, "audio");
  }

  async listUploadedVideos(
    purpose: "background" | "promotion" = "background"
  ): Promise<UploadedVideoFile[]> {
    const uploadDir = resolve(
      this.configBaseDir,
      this.options.config.video.uploadsDir
    );
    await mkdir(uploadDir, { recursive: true });
    const entries = await readdir(uploadDir, { withFileTypes: true });
    const videos: Array<UploadedVideoFile & { sortTime: number }> = [];

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      if (entry.name.endsWith(".json")) {
        continue;
      }

      const filePath = resolve(uploadDir, entry.name);
      const fileStat = await stat(filePath);
      const metaPath = resolve(uploadDir, `${entry.name}.json`);
      const metadata = await readUploadMetadata(metaPath);
      const storedPurpose = metadata?.purpose ?? "background";
      if (storedPurpose !== purpose) {
        continue;
      }
      const serverPath = toUrlPath(relative(this.configBaseDir, filePath));

      videos.push({
        durationSeconds: metadata?.durationSeconds ?? null,
        lastModified: metadata?.lastModified || fileStat.mtime.toISOString(),
        mediaUrl: `/media/${serverPath}`,
        name: metadata?.name || entry.name,
        purpose: storedPurpose,
        serverPath,
        sizeBytes: metadata?.sizeBytes ?? fileStat.size,
        sortTime: fileStat.mtimeMs,
        type: metadata?.type || inferVideoMimeType(entry.name),
      });
    }

    return videos
      .sort((a, b) => b.sortTime - a.sortTime)
      .map(({ sortTime: _sortTime, ...video }) => video);
  }

  async listUploadedMusic(): Promise<UploadedAudioFile[]> {
    const uploadDir = this.getMusicUploadsDir();
    await mkdir(uploadDir, { recursive: true });
    const entries = await readdir(uploadDir, { withFileTypes: true });
    const tracks: Array<UploadedAudioFile & { sortTime: number }> = [];

    for (const entry of entries) {
      if (!entry.isFile() || entry.name.endsWith(".json")) {
        continue;
      }

      const filePath = resolve(uploadDir, entry.name);
      const fileStat = await stat(filePath);
      const metaPath = resolve(uploadDir, `${entry.name}.json`);
      const metadata = await readUploadMetadata(metaPath);
      const serverPath = toUrlPath(relative(this.configBaseDir, filePath));

      tracks.push({
        lastModified: metadata?.lastModified || fileStat.mtime.toISOString(),
        mediaUrl: `/media/${serverPath}`,
        name: metadata?.name || entry.name,
        serverPath,
        sizeBytes: metadata?.sizeBytes ?? fileStat.size,
        sortTime: fileStat.mtimeMs,
        type: metadata?.type || inferAudioMimeType(entry.name),
      });
    }

    return tracks
      .sort((a, b) => b.sortTime - a.sortTime)
      .map(({ sortTime: _sortTime, ...track }) => track);
  }

  async deleteUploadedVideo(serverPath: string): Promise<void> {
    const normalized = String(serverPath ?? "").trim();
    if (!normalized) {
      throw new Error("Thiếu đường dẫn video cần xóa.");
    }

    const uploadDir = resolve(
      this.configBaseDir,
      this.options.config.video.uploadsDir
    );
    const absoluteUploadDir = ensureTrailingSep(resolve(uploadDir));
    const targetPath = resolve(this.configBaseDir, normalized);
    if (!targetPath.startsWith(absoluteUploadDir)) {
      throw new Error("Đường dẫn video không hợp lệ.");
    }

    const metaPath = `${targetPath}.json`;
    if (await fileExists(targetPath)) {
      await rm(targetPath, { force: true });
    }
    if (await fileExists(metaPath)) {
      await rm(metaPath, { force: true });
    }
  }

  async deleteUploadedMusic(serverPath: string): Promise<void> {
    const normalized = String(serverPath ?? "").trim();
    if (!normalized) {
      throw new Error("Thiếu đường dẫn nhạc cần xóa.");
    }

    const uploadDir = this.getMusicUploadsDir();
    const absoluteUploadDir = ensureTrailingSep(resolve(uploadDir));
    const targetPath = resolve(this.configBaseDir, normalized);
    if (!targetPath.startsWith(absoluteUploadDir)) {
      throw new Error("Đường dẫn nhạc không hợp lệ.");
    }

    const metaPath = `${targetPath}.json`;
    if (await fileExists(targetPath)) {
      await rm(targetPath, { force: true });
    }
    if (await fileExists(metaPath)) {
      await rm(metaPath, { force: true });
    }
  }

  async renderVideo(payload: VideoDraftPayload): Promise<{
    draft: VideoDraftDocument;
    draftPath: string;
    render: VideoRenderResult;
  }> {
    await ensureFfmpegReady(
      this.options.config.video.ffmpegPath,
      this.configBaseDir
    );
    const { draft, draftPath } = await this.createRenderableDraft(payload);
    assertVideoDraftAssets(draft, this.configBaseDir);
    const render = await renderVideoDraft(draft, {
      baseDir: this.configBaseDir,
      config: this.options.config.video,
    });
    return { draft, draftPath, render };
  }

  async queueRenderVideo(payload: VideoDraftPayload): Promise<{
    draft: VideoDraftDocument;
    draftPath: string;
    job: VideoRenderJob;
  }> {
    if (this.shuttingDown) {
      throw new Error("Tool đang dừng. Không thể nhận thêm video để render.");
    }
    await ensureFfmpegReady(
      this.options.config.video.ffmpegPath,
      this.configBaseDir
    );
    const { draft, draftPath } = await this.createRenderableDraft(payload);
    // Reject stale localStorage/draft paths before creating a queued job.
    assertVideoDraftAssets(draft, this.configBaseDir);
    const queuedAt = new Date().toISOString();
    const job: VideoRenderJob = {
      created_at: queuedAt,
      draft_id: draft.draft_id,
      post_count: draft.selected_posts.length,
      status: "queued",
      title: draft.video_plan.title,
      updated_at: queuedAt,
      username: draft.selected_posts[0]?.username || "threads",
    };
    this.renderJobs.set(draft.draft_id, job);

    this.renderQueue = this.renderQueue
      .then(async () => {
        if (this.shuttingDown) {
          this.updateRenderJob(draft.draft_id, {
            error: "Tool đã dừng trước khi video bắt đầu render.",
            finished_at: new Date().toISOString(),
            status: "failed",
          });
          return;
        }
        this.updateRenderJob(draft.draft_id, {
          started_at: new Date().toISOString(),
          status: "running",
        });
        try {
          const render = await renderVideoDraft(draft, {
            baseDir: this.configBaseDir,
            config: this.options.config.video,
          });
          this.updateRenderJob(draft.draft_id, {
            error: undefined,
            finished_at: new Date().toISOString(),
            render,
            status: "completed",
          });
        } catch (error) {
          this.updateRenderJob(draft.draft_id, {
            error: formatVideoRenderErrorMessage(error),
            finished_at: new Date().toISOString(),
            status: "failed",
          });
          throw error;
        }
      })
      .catch((error) => {
        console.error(
          `[video] Failed to render queued draft ${draft.draft_id}:`,
          error
        );
      });

    return {
      draft,
      draftPath,
      job: this.renderJobs.get(draft.draft_id)!,
    };
  }

  async shutdown(timeoutMs = 10_000): Promise<void> {
    if (!this.shuttingDown) {
      this.shuttingDown = true;
      for (const job of this.renderJobs.values()) {
        if (job.status === "queued") {
          this.updateRenderJob(job.draft_id, {
            error: "Tool đã dừng trước khi video bắt đầu render.",
            finished_at: new Date().toISOString(),
            status: "failed",
          });
        }
      }
    }

    await stopVideoRuntimeProcesses(Math.min(4000, timeoutMs));
    await Promise.race([
      this.renderQueue,
      new Promise<void>((resolvePromise) => {
        setTimeout(resolvePromise, Math.max(500, timeoutMs));
      }),
    ]);

    for (const job of this.renderJobs.values()) {
      if (job.status === "running") {
        this.updateRenderJob(job.draft_id, {
          error: "Render đã dừng an toàn khi đóng tool. Hãy render lại video.",
          finished_at: new Date().toISOString(),
          status: "failed",
        });
      }
    }
  }

  async listRenderJobs(): Promise<VideoRenderJob[]> {
    const jobs = await Promise.all(
      [...this.renderJobs.values()].map((job) =>
        this.ensureRenderJobDownloadable(job)
      )
    );
    return jobs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  private async createRenderableDraft(payload: VideoDraftPayload): Promise<{
    draft: VideoDraftDocument;
    draftPath: string;
  }> {
    const reusableDraft = await this.reuseExistingRenderDraft(payload);
    if (reusableDraft) {
      return this.persistDraftDocument(reusableDraft);
    }

    return this.createDraft(payload, true);
  }

  private async resolveAbbreviations(
    customAbbreviations?: Record<string, string>
  ): Promise<Record<string, string>> {
    const stored = await readAbbreviationDictionary(
      this.getAbbreviationsCsvPath()
    );
    return {
      ...stored,
      ...normalizeAbbreviationRecord(customAbbreviations),
    };
  }

  private getAbbreviationsCsvPath(): string {
    return resolve(
      this.configBaseDir,
      this.options.config.video.abbreviationsCsvPath
    );
  }

  private getMusicUploadsDir(): string {
    return resolve(
      this.configBaseDir,
      this.options.config.video.uploadsDir,
      "_music"
    );
  }

  private getMemeLibraryDir(): string {
    return resolve(
      this.configBaseDir,
      this.options.config.video.uploadsDir,
      "_meme_library"
    );
  }

  private getMemeEmotionDir(emotion: string): string {
    const normalized = safeFilename(
      String(emotion ?? "")
        .trim()
        .toLowerCase()
    );
    if (!normalized) {
      throw new Error("Cảm xúc meme không hợp lệ.");
    }
    return resolve(this.getMemeLibraryDir(), normalized);
  }

  private getMemeAssetDir(emotion: string, kind: "audio" | "image"): string {
    return resolve(
      this.getMemeEmotionDir(emotion),
      kind === "image" ? "images" : "audio"
    );
  }

  private async readStoredMemeImage(
    emotionDir: string
  ): Promise<UploadedImageFile | null> {
    const images = await this.listStoredMemeImages(emotionDir);
    return images[0] ?? null;
  }

  private async readStoredMemeAudio(
    emotionDir: string
  ): Promise<UploadedAudioFile | null> {
    const audios = await this.listStoredMemeAudios(emotionDir);
    return audios[0] ?? null;
  }

  private async listStoredMemeImages(
    emotionDir: string
  ): Promise<UploadedImageFile[]> {
    const items: Array<UploadedImageFile & { sortTime: number }> = [];
    const imageDir = resolve(emotionDir, "images");
    await this.collectStoredMemeImagesFromDir(imageDir, items);

    const legacyImagePath = await findFirstFileMatching(
      emotionDir,
      /^meme-image\./i
    );
    if (legacyImagePath) {
      const metadata = await readUploadMetadata(
        resolve(emotionDir, "image.json")
      );
      const info = await stat(legacyImagePath);
      const durationSeconds = await this.resolveStoredMemeImageDuration({
        durationSeconds: metadata?.durationSeconds,
        mediaPath: legacyImagePath,
        mtimeMs: info.mtimeMs,
        name: metadata?.name || legacyImagePath,
        type: metadata?.type || "",
      });
      items.push({
        ...this.buildStoredImagePayload(legacyImagePath, {
          durationSeconds,
          lastModified: metadata?.lastModified || info.mtime.toISOString(),
          name:
            metadata?.name ||
            stripExtension(legacyImagePath.split(sep).pop() || "meme-image"),
          sizeBytes: metadata?.sizeBytes ?? info.size,
          type: metadata?.type || inferImageMimeType(legacyImagePath),
        }),
        sortTime: info.mtimeMs,
      });
    }

    return items
      .sort((a, b) => b.sortTime - a.sortTime)
      .map(({ sortTime: _sortTime, ...item }) => item);
  }

  private async listStoredMemeAudios(
    emotionDir: string
  ): Promise<UploadedAudioFile[]> {
    const items: Array<UploadedAudioFile & { sortTime: number }> = [];
    const audioDir = resolve(emotionDir, "audio");
    await this.collectStoredMemeAudiosFromDir(audioDir, items);

    const legacyAudioPath = await findFirstFileMatching(
      emotionDir,
      /^meme-sound\./i
    );
    if (legacyAudioPath) {
      const metadata = await readUploadMetadata(
        resolve(emotionDir, "audio.json")
      );
      const info = await stat(legacyAudioPath);
      items.push({
        ...this.buildStoredAudioPayload(legacyAudioPath, {
          durationSeconds:
            typeof metadata?.durationSeconds === "number"
              ? metadata.durationSeconds
              : ((await probeDurationMs(legacyAudioPath)) ?? 0) / 1000 || null,
          lastModified: metadata?.lastModified || info.mtime.toISOString(),
          name:
            metadata?.name ||
            stripExtension(legacyAudioPath.split(sep).pop() || "meme-sound"),
          sizeBytes: metadata?.sizeBytes ?? info.size,
          type: metadata?.type || inferAudioMimeType(legacyAudioPath),
        }),
        sortTime: info.mtimeMs,
      });
    }

    return items
      .sort((a, b) => b.sortTime - a.sortTime)
      .map(({ sortTime: _sortTime, ...item }) => item);
  }

  private async findDuplicateMemeImage(
    emotionDir: string,
    normalizedName: string,
    hash: string
  ): Promise<UploadedImageFile | null> {
    const images = await this.listStoredMemeImages(emotionDir);
    return this.findDuplicateMemeAsset(images, normalizedName, hash);
  }

  private async findDuplicateMemeAudio(
    emotionDir: string,
    normalizedName: string,
    hash: string
  ): Promise<UploadedAudioFile | null> {
    const audios = await this.listStoredMemeAudios(emotionDir);
    return this.findDuplicateMemeAsset(audios, normalizedName, hash);
  }

  private async findDuplicateMemeAsset<
    TAsset extends { name: string; serverPath?: string },
  >(
    assets: TAsset[],
    normalizedName: string,
    hash: string
  ): Promise<TAsset | null> {
    for (const asset of assets) {
      const assetName = safeFilename(stripExtension(asset.name));
      if (assetName === normalizedName) {
        return asset;
      }

      if (!asset.serverPath) {
        continue;
      }

      const assetPath = resolve(this.configBaseDir, asset.serverPath);
      const metadata = await readUploadMetadata(`${assetPath}.json`);
      const existingHash =
        metadata?.hash || (await computeFileHash(assetPath).catch(() => ""));
      if (existingHash && existingHash === hash) {
        return asset;
      }
    }

    return null;
  }

  private async collectStoredMemeImagesFromDir(
    directoryPath: string,
    items: Array<UploadedImageFile & { sortTime: number }>
  ): Promise<void> {
    const entries = await safeReadDirWithFileTypes(directoryPath);
    const collected = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && !entry.name.endsWith(".json"))
        .map(async (entry) => {
          const mediaPath = resolve(directoryPath, entry.name);
          const info = await stat(mediaPath);
          const metadata = await readUploadMetadata(`${mediaPath}.json`);
          const durationSeconds = await this.resolveStoredMemeImageDuration({
            durationSeconds: metadata?.durationSeconds,
            mediaPath,
            mtimeMs: info.mtimeMs,
            name: entry.name,
            type: metadata?.type || "",
          });
          return {
            ...this.buildStoredImagePayload(mediaPath, {
              durationSeconds,
              lastModified: metadata?.lastModified || info.mtime.toISOString(),
              name: metadata?.name || stripExtension(entry.name),
              sizeBytes: metadata?.sizeBytes ?? info.size,
              type: metadata?.type || inferImageMimeType(entry.name),
            }),
            sortTime: info.mtimeMs,
          };
        })
    );
    items.push(...collected);
  }

  private async collectStoredMemeAudiosFromDir(
    directoryPath: string,
    items: Array<UploadedAudioFile & { sortTime: number }>
  ): Promise<void> {
    const entries = await safeReadDirWithFileTypes(directoryPath);
    const collected = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && !entry.name.endsWith(".json"))
        .map(async (entry) => {
          const mediaPath = resolve(directoryPath, entry.name);
          const info = await stat(mediaPath);
          const metadata = await readUploadMetadata(`${mediaPath}.json`);
          return {
            ...this.buildStoredAudioPayload(mediaPath, {
              durationSeconds:
                typeof metadata?.durationSeconds === "number"
                  ? metadata.durationSeconds
                  : ((await probeDurationMs(mediaPath)) ?? 0) / 1000 || null,
              lastModified: metadata?.lastModified || info.mtime.toISOString(),
              name: metadata?.name || stripExtension(entry.name),
              sizeBytes: metadata?.sizeBytes ?? info.size,
              type: metadata?.type || inferAudioMimeType(entry.name),
            }),
            sortTime: info.mtimeMs,
          };
        })
    );
    items.push(...collected);
  }

  private async resolveStoredMemeImageDuration({
    durationSeconds,
    mediaPath,
    mtimeMs,
    name,
    type,
  }: {
    durationSeconds?: number | null;
    mediaPath: string;
    mtimeMs: number;
    name: string;
    type: string;
  }): Promise<number | null> {
    if (durationSeconds !== undefined) {
      return durationSeconds;
    }

    const cached = this.memeImageDurationCache.get(mediaPath);
    if (cached?.mtimeMs === mtimeMs) {
      return cached.durationSeconds;
    }

    const measuredDurationMs = isVideoMemeFile(name, type)
      ? await probeDurationMs(mediaPath)
      : null;
    const measuredDurationSeconds =
      measuredDurationMs && measuredDurationMs > 0
        ? measuredDurationMs / 1000
        : null;
    this.memeImageDurationCache.set(mediaPath, {
      durationSeconds: measuredDurationSeconds,
      mtimeMs,
    });
    if (measuredDurationSeconds !== null) {
      try {
        const metadata = await readUploadMetadata(`${mediaPath}.json`);
        await writeFile(
          `${mediaPath}.json`,
          `${JSON.stringify(
            { ...(metadata ?? {}), durationSeconds: measuredDurationSeconds },
            null,
            2
          )}\n`,
          "utf8"
        );
      } catch {
        // Duration is still available from the in-memory cache for this run.
      }
    }
    return measuredDurationSeconds;
  }

  private buildStoredImagePayload(
    outputPath: string,
    metadata: {
      durationSeconds?: number | null;
      lastModified: string;
      name: string;
      sizeBytes: number;
      type: string;
    }
  ): UploadedImageFile {
    const serverPath = toUrlPath(relative(this.configBaseDir, outputPath));
    return {
      durationSeconds: metadata.durationSeconds ?? null,
      lastModified: metadata.lastModified,
      mediaUrl: `/media/${serverPath}`,
      name: metadata.name,
      serverPath,
      sizeBytes: metadata.sizeBytes,
      type: metadata.type,
    };
  }

  private buildStoredAudioPayload(
    outputPath: string,
    metadata: {
      durationSeconds?: number | null;
      lastModified: string;
      name: string;
      sizeBytes: number;
      type: string;
    }
  ): UploadedAudioFile {
    const serverPath = toUrlPath(relative(this.configBaseDir, outputPath));
    return {
      durationSeconds: metadata.durationSeconds ?? null,
      lastModified: metadata.lastModified,
      mediaUrl: `/media/${serverPath}`,
      name: metadata.name,
      serverPath,
      sizeBytes: metadata.sizeBytes,
      type: metadata.type,
    };
  }

  private async deleteMemeAssetFiles(
    emotionDir: string,
    kind: "audio" | "image"
  ): Promise<void> {
    await mkdir(emotionDir, { recursive: true });
    const pattern = kind === "image" ? /^meme-image\./i : /^meme-sound\./i;
    const files = await readdir(emotionDir);
    const assetDir = resolve(emotionDir, kind === "image" ? "images" : "audio");
    await Promise.all(
      files
        .filter((file) => pattern.test(file) || file === `${kind}.json`)
        .map((file) => rm(resolve(emotionDir, file), { force: true }))
    );
    await rm(assetDir, { force: true, recursive: true });
  }

  private async deleteMemeAssetFile(
    serverPath: string,
    emotionDir: string,
    kind: "audio" | "image"
  ): Promise<void> {
    const normalized = String(serverPath ?? "").trim();
    if (!normalized) {
      throw new Error("Thiếu đường dẫn file meme cần xóa.");
    }

    const kindDir = resolve(emotionDir, kind === "image" ? "images" : "audio");
    const absoluteKindDir = ensureTrailingSep(resolve(kindDir));
    const absoluteEmotionDir = ensureTrailingSep(resolve(emotionDir));
    const targetPath = resolve(this.configBaseDir, normalized);

    const isLegacyFile =
      targetPath.startsWith(absoluteEmotionDir) &&
      (kind === "image"
        ? /^meme-image\./i.test(targetPath.split(sep).pop() || "")
        : /^meme-sound\./i.test(targetPath.split(sep).pop() || ""));

    if (!(targetPath.startsWith(absoluteKindDir) || isLegacyFile)) {
      throw new Error("Đường dẫn file meme không hợp lệ.");
    }

    await rm(targetPath, { force: true });
    await rm(`${targetPath}.json`, { force: true });
    if (isLegacyFile) {
      await rm(resolve(emotionDir, `${kind}.json`), { force: true });
    }
  }

  private resolveMemeTransitionSelection(
    memeTransition: MemeTransitionConfig | null,
    playbackSpeed?: number
  ): MemeTransitionConfig | null {
    if (!memeTransition) {
      return null;
    }

    const imagePool = dedupeUploadedFiles(
      [
        ...(memeTransition.images ?? []),
        ...(memeTransition.image ? [memeTransition.image] : []),
      ],
      (item) => item.serverPath ?? `${item.name}:${item.lastModified}`
    );
    const audioPool = dedupeUploadedFiles(
      [
        ...(memeTransition.audios ?? []),
        ...(memeTransition.audio ? [memeTransition.audio] : []),
      ],
      (item) => item.serverPath ?? `${item.name}:${item.lastModified}`
    );

    // `image` and `audio` represent the user's explicit choice. Do not
    // replace them with another member of the same emotion pool while
    // creating a draft; that made the preview/export show a different meme
    // than the one selected in the UI. Random selection is only a fallback
    // for legacy/global configs that contain a pool without a chosen asset.
    const selectedImage =
      memeTransition.visualMode === "sound_only"
        ? null
        : memeTransition.image ??
          this.pickRandomMemeAsset(
            imagePool,
            `${memeTransition.emotion}:image`,
            (item) => item.serverPath ?? `${item.name}:${item.lastModified}`
          );
    const selectedAudio =
      memeTransition.audio ??
      this.pickRandomMemeAsset(
        audioPool,
        `${memeTransition.emotion}:audio`,
        (item) => item.serverPath ?? `${item.name}:${item.lastModified}`
      );

    if (!(selectedImage || selectedAudio)) {
      return null;
    }

    return {
      audio: selectedAudio ?? null,
      audios: audioPool,
      durationMs: resolveMemeTransitionDurationMs({
        audioDurationSeconds: selectedAudio?.durationSeconds ?? null,
        fallbackDurationMs: memeTransition.durationMs,
        imageDurationSeconds: selectedImage?.durationSeconds ?? null,
        playbackSpeed,
        visualMode: memeTransition.visualMode,
      }),
      emotion: memeTransition.emotion,
      label: memeTransition.label,
      image: selectedImage ?? null,
      images: imagePool,
      placement: memeTransition.placement,
      visualMode: memeTransition.visualMode,
    };
  }

  private pickRandomMemeAsset<T>(
    items: T[],
    historyKey: string,
    getId: (item: T) => string
  ): T | null {
    if (items.length === 0) {
      return null;
    }
    if (items.length === 1) {
      this.rememberRecentMemeSelection(historyKey, getId(items[0]!));
      return items[0] ?? null;
    }

    const recentIds = this.recentMemeSelectionHistory.get(historyKey) ?? [];
    const freshCandidates = items.filter(
      (item) => !recentIds.includes(getId(item))
    );
    const candidatePool = freshCandidates.length > 0 ? freshCandidates : items;
    const picked =
      candidatePool[Math.floor(Math.random() * candidatePool.length)] ??
      items[0] ??
      null;

    if (picked) {
      this.rememberRecentMemeSelection(historyKey, getId(picked));
    }

    return picked;
  }

  private rememberRecentMemeSelection(
    historyKey: string,
    assetId: string
  ): void {
    const next = [
      assetId,
      ...(this.recentMemeSelectionHistory.get(historyKey) ?? []).filter(
        (value) => value !== assetId
      ),
    ].slice(0, 3);
    this.recentMemeSelectionHistory.set(historyKey, next);
  }

  private resolveScenesMemeTransitions(
    scenes: VideoDraftScene[],
    globalMemePool: MemeTransitionConfig | null,
    playbackSpeed?: number
  ): VideoDraftScene[] {
    const resolvedMemes: (MemeTransitionConfig | null)[] = new Array(
      scenes.length
    ).fill(null);
    const memePlacementByIndex: (
      | "after_comment"
      | "media_reveal"
      | "transition"
      | undefined
    )[] = new Array(scenes.length).fill(undefined);
    const emotionGroupIndices: Record<string, number[]> = {};
    const emotionPools: Record<string, { images: any[]; audios: any[] }> = {};

    scenes.forEach((scene, index) => {
      let poolConfig: MemeTransitionConfig | null = null;
      if (scene.meme_transition !== undefined) {
        poolConfig = scene.meme_transition;
      } else if (isFirstCommentScene(scenes, index) && globalMemePool) {
        poolConfig = globalMemePool;
      }

      if (poolConfig && poolConfig.emotion) {
        memePlacementByIndex[index] = poolConfig.placement;
        const hasExplicitImage = Boolean(
          poolConfig.image?.serverPath || poolConfig.image?.mediaUrl
        );
        const hasExplicitAudio = Boolean(
          poolConfig.audio?.serverPath || poolConfig.audio?.mediaUrl
        );
        if (
          (scene.meme_transition !== undefined ||
            isFirstCommentScene(scenes, index)) &&
          (hasExplicitImage || hasExplicitAudio)
        ) {
          resolvedMemes[index] = {
            ...poolConfig,
            durationMs: resolveMemeTransitionDurationMs({
              audioDurationSeconds: poolConfig.audio?.durationSeconds ?? null,
              fallbackDurationMs: poolConfig.durationMs,
              imageDurationSeconds:
                poolConfig.visualMode === "sound_only"
                  ? null
                  : poolConfig.image?.durationSeconds ?? null,
              playbackSpeed,
              visualMode: poolConfig.visualMode,
            }),
          };
          return;
        }

        const emotion = poolConfig.emotion;
        if (!emotionGroupIndices[emotion]) {
          emotionGroupIndices[emotion] = [];
        }
        emotionGroupIndices[emotion].push(index);

        if (!emotionPools[emotion]) {
          const imagePool = dedupeUploadedFiles(
            [
              ...(poolConfig.images ?? []),
              ...(poolConfig.image ? [poolConfig.image] : []),
            ],
            (item) => item.serverPath ?? `${item.name}:${item.lastModified}`
          );
          const audioPool = dedupeUploadedFiles(
            [
              ...(poolConfig.audios ?? []),
              ...(poolConfig.audio ? [poolConfig.audio] : []),
            ],
            (item) => item.serverPath ?? `${item.name}:${item.lastModified}`
          );
          emotionPools[emotion] = { images: imagePool, audios: audioPool };
        }
      }
    });

    for (const [emotion, indices] of Object.entries(emotionGroupIndices)) {
      const pool = emotionPools[emotion];
      if (!pool || indices.length === 0) {
        continue;
      }

      const shuffledImages = shuffleArray([...pool.images]);
      const shuffledAudios = shuffleArray([...pool.audios]);

      indices.forEach((sceneIndex, drawIndex) => {
        const imageIndex = drawIndex % (shuffledImages.length || 1);
        const selectedImage = shuffledImages[imageIndex] || null;

        const audioIndex = drawIndex % (shuffledAudios.length || 1);
        const selectedAudio = shuffledAudios[audioIndex] || null;

        if (!(selectedImage || selectedAudio)) {
          resolvedMemes[sceneIndex] = null;
          return;
        }

        const durationMs = resolveMemeTransitionDurationMs({
          audioDurationSeconds: selectedAudio?.durationSeconds ?? null,
          fallbackDurationMs:
            scenes[sceneIndex]?.meme_transition?.durationMs ??
            globalMemePool?.durationMs,
          imageDurationSeconds: selectedImage?.durationSeconds ?? null,
          playbackSpeed,
        });

        resolvedMemes[sceneIndex] = {
          audio: selectedAudio,
          audios: pool.audios,
          durationMs,
          emotion,
          image: selectedImage,
          images: pool.images,
          placement: memePlacementByIndex[sceneIndex],
        };
      });
    }

    return scenes.map((scene, index) => {
      const resolvedMeme = resolvedMemes[index];
      return {
        ...scene,
        meme_transition: resolvedMeme,
      };
    });
  }

  private async createDraft(
    payload: VideoDraftPayload,
    includeNarration: boolean
  ): Promise<{
    draft: VideoDraftDocument;
    draftPath: string;
  }> {
    if (!this.options.config.video.enabled) {
      throw new Error("Video workflow is disabled in config.");
    }
    if (payload.selectedPosts.length === 0) {
      throw new Error('At least one selected post is required.');
    }
    if (payload.dialogue) {
      if (!payload.dialogue.confirmed) {
        throw new Error('Vui lòng kiểm tra nội dung hội thoại trong ảnh trước khi tạo voice.');
      }
      if (payload.dialogue.lines.some((line) => line.speaker === 'unknown')) {
        throw new Error('Hãy chọn người nói A hoặc B cho mọi dòng hội thoại.');
      }
    }
    if (payload.dialogue && !hasRecognizedDialogue(payload.dialogue.lines)) {
      throw new Error(
        "Chế độ hội thoại cần ít nhất hai câu của cả A và B. Ảnh thường hãy dùng Một giọng kể chuyện."
      );
    }
    const requestedVoice = this.resolveRequestedVoiceProfile(
      payload.voiceSettings ?? null
    );
    const resolvedMemeTransition = this.resolveMemeTransitionSelection(
      payload.memeTransition ?? null,
      payload.voiceSettings?.speakingRate
    );
    const effectiveAbbreviations = await this.resolveAbbreviations(
      payload.abbreviations
    );

    const createdAt = new Date().toISOString();
    const draftId = `video-draft-${timestampId()}`;
    const scenes = await this.buildScenes(
      payload.selectedPosts,
      includeNarration,
      requestedVoice,
      payload.commentVoiceMode ?? "fixed",
      effectiveAbbreviations,
      payload.textProcessing?.mode,
      payload.existingDraft ?? null,
      payload.memeBySceneId,
      payload.dialogue ?? null,
      payload.playPostVideoAfterCaption ?? false,
      payload.videoMode
    );
    const resolvedScenes = moveDialogueMemesAfterNarration(
      this.resolveScenesMemeTransitions(
      scenes,
      payload.memeTransition ?? null,
      payload.voiceSettings?.speakingRate
      )
    );
    const thumbnailIntro = normalizeThumbnailIntro(payload.thumbnailIntro);
    const scenesWithTimeline = applyThumbnailIntroOffset(
      assignSceneTimeline(
        resolvedScenes,
        this.options.config.video,
        resolvedMemeTransition?.durationMs
      ),
      thumbnailIntro
    );
    const durationMs = scenesWithTimeline.reduce(
      (max, scene) => Math.max(max, scene.timeline?.end_ms ?? 0),
      0
    );
    const promotion = normalizePromotionConfig(payload.promotion);
    const promotionDurationMs = estimatePromotionDurationMs(
      promotion,
      durationMs,
      scenesWithTimeline
    );

    const draft: VideoDraftDocument = {
      background_music: payload.backgroundMusic ?? null,
      background_music_volume: normalizeBackgroundMusicVolume(
        payload.backgroundMusicVolume
      ),
      voice_volume: normalizeVoiceVolume(payload.voiceVolume),
      created_at: createdAt,
      draft_id: draftId,
      scenes: scenesWithTimeline,
      selected_posts: payload.selectedPosts,
      source_output_path: payload.outputPath,
      uploaded_video: payload.uploadedVideo ?? null,
      promotion,
      thumbnail_intro: thumbnailIntro,
      video_plan: {
        aspect_ratio: "9:16",
        comments_sequential: true,
        duration_target_seconds: Math.ceil(
          (durationMs + promotionDurationMs) / 1000
        ),
        format: payload.videoMode,
        language: payload.selectedPosts[0]?.language || "vi",
        title:
          payload.selectedPosts.length === 1
            ? `Video from ${payload.selectedPosts[0]?.post_id ?? "selected post"}`
            : `Video from ${payload.selectedPosts.length} selected posts`,
        voice_ready: includeNarration,
      },
      abbreviations: effectiveAbbreviations,
      cardTheme: payload.cardTheme,
      dialogue: payload.dialogue ?? null,
      meme_transition: resolvedMemeTransition,
      play_post_video_after_caption: Boolean(
        payload.playPostVideoAfterCaption
      ),
    };

    const draftPath = resolve(
      this.configBaseDir,
      this.options.config.video.draftsDir,
      `${draftId}.json`
    );
    await mkdir(dirname(draftPath), { recursive: true });
    await writeFile(draftPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
    return { draft, draftPath };
  }

  private async reuseExistingRenderDraft(
    payload: VideoDraftPayload
  ): Promise<VideoDraftDocument | null> {
    const existingDraft = payload.existingDraft;
    if (
      !(
        existingDraft &&
        this.canReuseExistingRenderDraft(existingDraft, payload)
      )
    ) {
      return null;
    }

    const resolvedMemeTransition = this.resolveMemeTransitionSelection(
      payload.memeTransition ?? null,
      payload.voiceSettings?.speakingRate
    );
    const createdAt = new Date().toISOString();
    const draftId = `video-draft-${timestampId()}`;

    // Re-apply per-scene meme selections from the new payload (user may have
    // changed meme assignments even when reusing voice/narration). A meme
    // marked `after_comment` stays on its source scene; a transition meme is
    // attached to the following scene as a lead-in. A transition on the final
    // scene is kept as a trailing timeline segment because there is no next
    // scene to lead.
    const memeBySceneId = payload.memeBySceneId;
    const sortedScenes = await this.syncPostVideoScenes(
      [...existingDraft.scenes].sort((a, b) => a.order - b.order),
      payload.selectedPosts,
      Boolean(payload.playPostVideoAfterCaption)
    );
    const scenesWithCurrentDisplayText = sortedScenes.map((scene) =>
      syncSceneDisplayText(scene, payload.selectedPosts)
    );
    // A render can reuse an existing voice draft after the selected post data
    // has been refreshed. Keep the scene media flag in sync with that latest
    // payload; otherwise short comments with an image lose their media hold
    // time and advance as soon as narration ends.
    const scenesWithCurrentMedia = scenesWithCurrentDisplayText.map((scene) => ({
      ...scene,
      has_media: resolveSceneHasMedia(scene, payload.selectedPosts),
      display_duration_ms: resolveSceneDisplayDurationMs(
        scene,
        payload.selectedPosts
      ),
    }));
    // First pass: resolve each scene's own meme selection
    const ownMemes = scenesWithCurrentMedia.map((scene) =>
      scene.kind === "post_video" || !memeBySceneId
        ? undefined
        : memeBySceneId[
            scene.kind === "post" ? scene.post_id : (scene.comment_id ?? "")
          ]
    );
    const hasMemeSelection = (index: number): boolean => {
      if (!memeBySceneId || index < 0 || index >= scenesWithCurrentMedia.length) {
        return false;
      }
      const scene = scenesWithCurrentMedia[index];
      if (!scene || scene.kind === "post_video") {
        return false;
      }
      const sceneId =
        scene.kind === "post" ? scene.post_id : (scene.comment_id ?? "");
      return Object.prototype.hasOwnProperty.call(memeBySceneId, sceneId);
    };
    const hasRelevantMemeSelection = scenesWithCurrentMedia.some((_, index) =>
      hasMemeSelection(index)
    );
    // Second pass: source memes can trail their own scene; other memes keep
    // the existing lead-in behavior.
    const scenesWithMeme = scenesWithCurrentMedia.map((scene, i) => ({
      ...scene,
      ...(scene.kind === "post_video"
        ? {
            meme_transition: null,
            trailing_meme_transition: undefined,
          }
        : {}),
      // A selected meme is attached to the scene after its source post/comment
      // only when that source uses the transition placement.
      ...(scene.kind === "post_video"
        ? {}
        : {
            meme_transition:
              hasMemeSelection(i - 1)
                ? ownMemes[i - 1]?.placement === "transition"
                  ? ownMemes[i - 1]
                  : null
                : hasMemeSelection(i) || hasRelevantMemeSelection
                  ? null
                  : scene.meme_transition,
            trailing_meme_transition:
              hasMemeSelection(i)
                ? (scene.kind === "post" || scene.kind === "comment") &&
                    (ownMemes[i]?.placement === "after_comment" ||
                      ownMemes[i]?.placement === "media_reveal" ||
                      (ownMemes[i]?.placement === "transition" &&
                        i === sortedScenes.length - 1))
                  ? ownMemes[i]
                  : null
                : hasMemeSelection(i - 1) || hasRelevantMemeSelection
                  ? null
                  : scene.trailing_meme_transition,
          }),
    }));

    const resolvedScenes = moveDialogueMemesAfterNarration(
      this.resolveScenesMemeTransitions(
        scenesWithMeme,
        payload.memeTransition ?? null,
        payload.voiceSettings?.speakingRate
      )
    );

    const thumbnailIntro = normalizeThumbnailIntro(payload.thumbnailIntro);
    const scenes = applyThumbnailIntroOffset(
      assignSceneTimeline(
        resolvedScenes,
        this.options.config.video,
        resolvedMemeTransition?.durationMs
      ),
      thumbnailIntro
    );
    const durationMs = scenes.reduce(
      (max, scene) => Math.max(max, scene.timeline?.end_ms ?? 0),
      0
    );
    const promotion = normalizePromotionConfig(payload.promotion);
    const promotionDurationMs = estimatePromotionDurationMs(
      promotion,
      durationMs,
      scenes
    );
    return {
      ...existingDraft,
      background_music: payload.backgroundMusic ?? null,
      background_music_volume: normalizeBackgroundMusicVolume(
        payload.backgroundMusicVolume
      ),
      voice_volume: normalizeVoiceVolume(payload.voiceVolume),
      cardTheme: payload.cardTheme,
      created_at: createdAt,
      draft_id: draftId,
      meme_transition: resolvedMemeTransition,
      play_post_video_after_caption: Boolean(
        payload.playPostVideoAfterCaption
      ),
      scenes,
      selected_posts: payload.selectedPosts,
      source_output_path: payload.outputPath,
      uploaded_video: payload.uploadedVideo ?? null,
      promotion,
      thumbnail_intro: thumbnailIntro,
      video_plan: {
        ...existingDraft.video_plan,
        duration_target_seconds: Math.ceil(
          (durationMs + promotionDurationMs) / 1000
        ),
        voice_ready: true,
      },
    };
  }

  private canReuseExistingRenderDraft(
    draft: VideoDraftDocument,
    payload: VideoDraftPayload
  ): boolean {
    if (!draft.video_plan?.voice_ready) {
      return false;
    }
    if (!Array.isArray(draft.scenes) || draft.scenes.length === 0) {
      return false;
    }
    if (
      draft.scenes.some(
        (scene) =>
          scene.kind !== "post_video" &&
          (scene.narration?.status !== "ready" ||
            !scene.narration?.merged_audio_path ||
            !isSceneNarrationSynchronized(scene))
      )
    ) {
      return false;
    }

    const existingPosts = draft.selected_posts ?? [];
    const nextPosts = payload.selectedPosts ?? [];
    if (existingPosts.length !== nextPosts.length) {
      return false;
    }

    for (let index = 0; index < existingPosts.length; index += 1) {
      const existingPost = existingPosts[index];
      const nextPost = nextPosts[index];
      if (
        !(existingPost && nextPost) ||
        existingPost.post_id !== nextPost.post_id
      ) {
        return false;
      }
      if (
        !canReuseSceneNarrationText({
          existingDisplayText: existingPost.text,
          existingTtsText: existingPost.tts_text,
          nextDisplayText: nextPost.text,
          nextTtsText: nextPost.tts_text,
        })
      ) {
        return false;
      }
      if (
        Boolean(existingPost.is_spoiler) !== Boolean(nextPost.is_spoiler) ||
        (existingPost.spoiler_initial_text ?? "") !== (nextPost.spoiler_initial_text ?? "") ||
        (existingPost.spoiler_reveal_text ?? "") !== (nextPost.spoiler_reveal_text ?? "") ||
        Boolean(existingPost.spoiler_media) !== Boolean(nextPost.spoiler_media) ||
        (existingPost.spoiler_style ?? "blur") !==
          (nextPost.spoiler_style ?? "blur") ||
        JSON.stringify(existingPost.spoiler_reveal_regions ?? []) !==
          JSON.stringify(nextPost.spoiler_reveal_regions ?? []) ||
        Boolean(existingPost.spoiler_reveal_media_only) !==
          Boolean(nextPost.spoiler_reveal_media_only)
      ) {
        return false;
      }

      const existingComments = existingPost.top_comments ?? [];
      const nextComments = nextPost.top_comments ?? [];
      if (existingComments.length !== nextComments.length) {
        return false;
      }

      for (
        let commentIndex = 0;
        commentIndex < existingComments.length;
        commentIndex += 1
      ) {
        const existingComment = existingComments[commentIndex];
        const nextComment = nextComments[commentIndex];
        if (
          !(existingComment && nextComment) ||
          existingComment.comment_id !== nextComment.comment_id ||
          !canReuseSceneNarrationText({
            existingDisplayText: existingComment.text,
            existingTtsText: existingComment.tts_text,
            nextDisplayText: nextComment.text,
            nextTtsText: nextComment.tts_text,
          }) ||
          Boolean(existingComment.is_spoiler) !==
            Boolean(nextComment.is_spoiler) ||
          (existingComment.spoiler_initial_text ?? "") !==
            (nextComment.spoiler_initial_text ?? "") ||
          (existingComment.spoiler_reveal_text ?? "") !==
            (nextComment.spoiler_reveal_text ?? "") ||
          Boolean(existingComment.spoiler_media) !==
            Boolean(nextComment.spoiler_media) ||
          (existingComment.spoiler_style ?? "blur") !==
            (nextComment.spoiler_style ?? "blur") ||
          JSON.stringify(existingComment.spoiler_reveal_regions ?? []) !==
            JSON.stringify(nextComment.spoiler_reveal_regions ?? []) ||
          Boolean(existingComment.spoiler_reveal_media_only) !==
            Boolean(nextComment.spoiler_reveal_media_only)
        ) {
          return false;
        }
      }
    }

    return true;
  }

  private async persistDraftDocument(
    draft: VideoDraftDocument
  ): Promise<{ draft: VideoDraftDocument; draftPath: string }> {
    const draftPath = resolve(
      this.configBaseDir,
      this.options.config.video.draftsDir,
      `${draft.draft_id}.json`
    );
    await mkdir(dirname(draftPath), { recursive: true });
    await writeFile(draftPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
    return { draft, draftPath };
  }

  private async buildScenes(
    posts: VideoDraftPayload["selectedPosts"],
    includeNarration: boolean,
    requestedVoice: VideoVoiceSettings | null,
    commentVoiceMode: "emotion" | "fixed",
    abbreviations?: Record<string, string>,
    textProcessingMode?: "off" | "rules_only" | "llm_assist",
        existingDraft?: VideoDraftDocument | null,
    memeBySceneId?: Record<string, MemeTransitionConfig | null>,
    dialogue?: VideoDialogueConfig | null,
    playPostVideoAfterCaption = false,
    videoMode = "single_post_recap"
  ): Promise<VideoDraftScene[]> {
    const existingScenesById = indexScenesById(existingDraft?.scenes);
    const plannedScenes: PlannedScene[] = [];
    let order = 1;

    for (const post of posts) {
      const postSceneId = `${post.post_id}-post`;
      const postRevealMediaOnly = Boolean(
        post.spoiler_reveal_media_only || post.spoiler_reveal_regions?.length
      );
      const postSpoilerText = resolveSpoilerTextParts({
        initial: post.spoiler_initial_text,
        isSpoiler: post.is_spoiler,
        reveal: post.spoiler_reveal_text,
        revealMediaOnly: postRevealMediaOnly,
        text: post.text,
      });
      const postInitial = postSpoilerText.initial;
      const postReveal = postSpoilerText.reveal;
      const explicitPostTts = String(post.tts_text ?? "").trim();
      const hasDialogueLines = Boolean(
        dialogue?.lines.some((line) => line.text.trim())
      );
      const dialogueOwnsPostSpoiler =
        hasDialogueLines && post === posts[0] && post.is_spoiler;
      const effectivePostTts = dialogueOwnsPostSpoiler
        ? isAutoSpoilerNarration(explicitPostTts, postInitial, postReveal)
          ? postInitial
          : explicitPostTts || postInitial
        : explicitPostTts;

      const preparedPostText = await prepareSceneNarration({
        abbreviations,
        config: this.options.config.video,
        context: {
          commentSnippets: post.top_comments
            .map((comment) => comment.text)
            .filter(Boolean)
            .slice(0, 4),
          titleHint: `Post by @${post.username}`,
          username: post.username,
        },
        displayText: post.is_spoiler
          ? `${postInitial}${postReveal ? " " + postReveal : ""}`.trim()
          : post.text,
        explicitNarrationText: effectivePostTts || undefined,
        kind: "post",
        language: post.language,
        mode: textProcessingMode,
      });
      if (preparedPostText.narrationText) {
        const displayText = preparedPostText.sourceText;
        const narrationText = preparedPostText.hasExplicitNarrationOverride
          ? preparedPostText.narrationText
          : resolveSceneNarrationText({
              currentDisplayText: displayText,
              defaultNarrationText: preparedPostText.narrationText,
              existingScene: existingScenesById.get(postSceneId),
            });
        plannedScenes.push({
          display_duration_ms: normalizeCommentDisplayDurationMs(
            post.video_duration_seconds
          ),
          commentText: undefined,
          has_media: Array.isArray(post.media) && post.media.length > 0,
          kind: "post",
          order,
          post_id: post.post_id,
          narration_text: narrationText,
          scene_id: postSceneId,
          source_text: preparedPostText.sourceText,
          template: "threads_card",
          text: displayText,
          text_processing: preparedPostText.textProcessing,
          title: `Post by @${post.username}`,
          is_spoiler: post.is_spoiler,
          spoiler_initial_text: postInitial,
          spoiler_reveal_text: postReveal,
          spoiler_media: post.spoiler_media,
          spoiler_reveal_regions: post.spoiler_reveal_regions,
          spoiler_reveal_media_only: postRevealMediaOnly,
        });
        order += 1;
      }

      if (
        preparedPostText.narrationText &&
        playPostVideoAfterCaption &&
        post.media?.some(
          (media) =>
            media.type === "video" &&
            (Boolean(media.asset_path) || Boolean(media.remote_url))
        )
      ) {
        plannedScenes.push({
          display_duration_ms: await resolvePostVideoDurationMs(
            post,
            this.configBaseDir
          ),
          has_media: true,
          kind: "post_video",
          order,
          post_id: post.post_id,
          scene_id: `${post.post_id}-post-video`,
          source_text: "",
          template: "threads_card",
          text: "",
          title: `Video by @${post.username}`,
          video_media: post.media.find((media) => media.type === "video"),
        });
        order += 1;
      }

      if (dialogue && post === posts[0]) {
        for (const line of [...dialogue.lines].sort((a, b) => a.order - b.order)) {
          if (!line.text.trim()) continue;
          plannedScenes.push({
            commentText: undefined,
            dialogue_speaker: line.speaker,
            has_media: false,
            kind: 'comment',
            narration_text: line.text.trim(),
            order,
            post_id: post.post_id,
            scene_id: post.post_id + '-dialogue-' + line.id,
            source_text: line.text.trim(),
            template: 'threads_card',
            text: line.text.trim(),
            title: 'Dialogue ' + line.speaker,
          });
          order += 1;
        }
      }

      for (const comment of post.top_comments) {
        const commentSceneId = `${post.post_id}-comment-${comment.comment_id || order}`;
        const commentRevealMediaOnly = Boolean(
          comment.spoiler_reveal_media_only || comment.spoiler_reveal_regions?.length
        );
        const commentSpoilerText = resolveSpoilerTextParts({
          initial: comment.spoiler_initial_text,
          isSpoiler: comment.is_spoiler,
          reveal: comment.spoiler_reveal_text,
          revealMediaOnly: commentRevealMediaOnly,
          text: comment.text,
        });
        const preparedCommentText = await prepareSceneNarration({
          abbreviations,
          config: this.options.config.video,
          context: {
            commentSnippets: post.top_comments
              .filter((item) => item.comment_id !== comment.comment_id)
              .map((item) => item.text)
              .filter(Boolean)
              .slice(0, 3),
            postText: post.text,
            titleHint: `Comment on post by @${post.username}`,
            username: comment.username,
          },
          displayText: comment.is_spoiler
            ? `${commentSpoilerText.initial}${commentSpoilerText.reveal ? "\n" + commentSpoilerText.reveal : ""}`.trim()
            : comment.text,
          explicitNarrationText: comment.tts_text,
          kind: "comment",
          language: post.language,
          mode: textProcessingMode,
        });
        if (!preparedCommentText.narrationText) {
          continue;
        }
        const displayText = preparedCommentText.sourceText;
        const narrationText = preparedCommentText.hasExplicitNarrationOverride
          ? preparedCommentText.narrationText
          : resolveSceneNarrationText({
              currentDisplayText: displayText,
              defaultNarrationText: preparedCommentText.narrationText,
              existingScene: existingScenesById.get(commentSceneId),
            });
        plannedScenes.push({
          comment_id: comment.comment_id,
          display_duration_ms: normalizeCommentDisplayDurationMs(
            comment.video_duration_seconds
          ),
          commentText: narrationText,
          has_media: Array.isArray(comment.media) && comment.media.length > 0,
          kind: "comment",
          narration_text: narrationText,
          order,
          post_id: post.post_id,
          scene_id: commentSceneId,
          source_text: preparedCommentText.sourceText,
          template: "threads_card",
          text: displayText,
          text_processing: preparedCommentText.textProcessing,
          title: `Comment by @${comment.username}`,
          is_spoiler: comment.is_spoiler,
          spoiler_initial_text: commentSpoilerText.initial,
          spoiler_reveal_text: commentSpoilerText.reveal,
          spoiler_media: comment.spoiler_media,
          spoiler_reveal_regions: comment.spoiler_reveal_regions,
          spoiler_reveal_media_only: commentRevealMediaOnly,
        });
        order += 1;
        if (
          playPostVideoAfterCaption &&
          comment.media?.some(
            (media) =>
              media.type === "video" &&
              (Boolean(media.asset_path) || Boolean(media.remote_url))
          )
        ) {
          plannedScenes.push({
            comment_id: comment.comment_id,
            display_duration_ms: await resolvePostVideoDurationMs(
              comment,
              this.configBaseDir
            ),
            has_media: true,
            kind: "post_video",
            order,
            post_id: post.post_id,
            scene_id: `${comment.comment_id}-comment-video`,
            source_text: "",
            template: "threads_card",
            text: "",
            title: `Video by @${comment.username}`,
            video_media: comment.media.find((media) => media.type === "video"),
          });
          order += 1;
        }
      }
    }

    const vivibeVoices =
      requestedVoice?.provider === "vivibe"
        ? await this.getVivibeVoicesForEmotionMode()
        : [];

    const rawScenes: VideoDraftScene[] = [];
    let commentSequenceIndex = 0;
    let previousCommentGender: VideoVoiceSettings["ssmlGender"] | null = null;
    let previousCommentVoiceName: string | null = null;
    let previousSceneKind: "comment" | "post" | null = null;
    for (const [plannedSceneIndex, { commentText, ...scene }] of plannedScenes.entries()) {
      if (scene.kind === "post_video") {
        rawScenes.push({
          ...scene,
          narration: idleNarration(requestedVoice),
          meme_transition: null,
          trailing_meme_transition: undefined,
        });
        continue;
      }
      let voiceProfile = resolveSceneVoiceProfile({
        commentText,
        commentSequenceIndex:
          scene.kind === "comment" ? commentSequenceIndex : undefined,
        commentVoiceMode,
        config: this.options.config.video,
        kind: scene.kind,
        previousCommentGender,
        previousCommentVoiceName,
        previousSceneKind,
        requestedVoice,
        sceneId: scene.scene_id,
        vivibeVoices,
      });

      if (
        scene.dialogue_speaker &&
        scene.dialogue_speaker !== "unknown" &&
        dialogue
      ) {
        voiceProfile = dialogue.speakers[scene.dialogue_speaker];
      }

      if (scene.kind === "post" || scene.kind === "comment") {
        previousCommentGender =
          voiceProfile.ssmlGender === "MALE" ||
          voiceProfile.ssmlGender === "FEMALE"
            ? voiceProfile.ssmlGender
            : previousCommentGender;
        previousCommentVoiceName =
          voiceProfile.voiceName?.trim() || previousCommentVoiceName;
        if (scene.kind === "comment") {
          commentSequenceIndex += 1;
        }
      }
      previousSceneKind = scene.kind;

      // A meme can either lead the next scene or trail its source scene.
      const ownMeme = memeBySceneId
        ? memeBySceneId[
            scene.kind === "post" ? scene.post_id : (scene.comment_id ?? "")
          ]
        : undefined;
      const isAfterSourceMeme =
        (scene.kind === "post" || scene.kind === "comment") &&
        (ownMeme?.placement === "after_comment" ||
          ownMeme?.placement === "media_reveal");
      const isFinalTransitionMeme =
        (scene.kind === "post" || scene.kind === "comment") &&
        ownMeme?.placement === "transition" &&
        plannedSceneIndex === plannedScenes.length - 1;
      const isTrailingSourceMeme =
        isAfterSourceMeme || isFinalTransitionMeme;

      const rawNarrationText = getSceneNarrationText(scene);
      const isSpoiler = !!scene.is_spoiler;
      const cleanNarrationText = rawNarrationText;

      const narration = includeNarration
        ? await this.narrate({
            sceneId: scene.scene_id,
            text: cleanNarrationText,
            voiceProfile,
          })
        : idleNarration(voiceProfile);

      let spoilerConfig = null;
      if (isSpoiler) {
        const initialTextNormal = (scene.spoiler_initial_text || scene.text || "").trim();
        const revealTextNormal = (scene.spoiler_reveal_text || "").trim();
        const fullTextNormal = `${initialTextNormal}${revealTextNormal ? " " + revealTextNormal : ""}`.trim();

        const totalNarrationDurationMs = narration?.total_duration_ms || 3000;

        const revealLines = revealTextNormal
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const spoilerRegions = scene.spoiler_reveal_regions ?? [];
        const mediaRevealLines =
          revealLines.length === 0 && spoilerRegions.length > 0
            ? spoilerRegions.length === 1
              ? String(spoilerRegions[0]?.text ?? "")
                  .split(/\r?\n/)
                  .map((line) => line.trim())
                  .filter(Boolean)
              : spoilerRegions.map((region) => String(region.text ?? "").trim())
            : [];
        const effectiveRevealLines =
          revealLines.length > 0 ? revealLines : mediaRevealLines;
        const configuredSpoilerTextLength = [
          initialTextNormal,
          ...effectiveRevealLines,
        ]
          .join(" ")
          .trim().length;
        const narrationChunks = narration?.chunks ?? [];
        const revealSegments = effectiveRevealLines.map((line, index) => {
          const precedingRevealText = effectiveRevealLines
            .slice(0, index)
            .join("\n");
          const precedingSpoilerTextLength = [
            initialTextNormal,
            ...effectiveRevealLines.slice(0, index),
          ]
            .join(" ")
            .trim().length;
          const lineStartInNarration = cleanNarrationText.indexOf(
            line,
            Math.max(0, initialTextNormal.length + precedingRevealText.length)
          );
          const fallbackOffset = Math.min(
            cleanNarrationText.length,
            initialTextNormal.length +
              precedingRevealText.length +
              (index ? 1 : 0)
          );
          const revealOffset =
            lineStartInNarration >= 0 ? lineStartInNarration : fallbackOffset;
          const revealTimeMs =
            revealLines.length > 0
              ? resolveSpoilerRevealTimeMs({
                  chunks: narrationChunks,
                  narrationText: cleanNarrationText,
                  targetOffset: revealOffset,
                  totalDurationMs: totalNarrationDurationMs,
                  fallbackRatio:
                    configuredSpoilerTextLength > 0
                      ? precedingSpoilerTextLength / configuredSpoilerTextLength
                      : undefined,
                })
              : Math.round(
                  (totalNarrationDurationMs * (index + 1)) /
                    Math.max(1, effectiveRevealLines.length)
                );
          return {
            text: line,
            // Reveal a fraction before the voice reaches the line so the
            // bubble is visible as it is spoken, not after it has finished.
            reveal_time_ms: Math.max(0, revealTimeMs - 140),
            media_reveal_percent: Math.round(
              ((index + 1) / Math.max(1, effectiveRevealLines.length)) * 100
            ),
          };
        });
        const reveal_time_ms = revealSegments[0]?.reveal_time_ms ?? 0;

        // Đọc xong toàn bộ text thì ảnh spoiler hiển thị ra
        const media_reveal_time_ms = totalNarrationDurationMs;
        const spoiler_style = scene.spoiler_style ?? "blur";

        spoilerConfig = {
          reveal_time_ms,
          media_reveal_time_ms,
          text_initial: initialTextNormal,
          text_full: fullTextNormal,
          has_media_spoiler: Boolean(
            scene.spoiler_media || scene.spoiler_reveal_regions?.length
          ),
          reveal_segments: revealSegments,
          reveal_regions: normalizeSpoilerRevealRegions(
            scene.spoiler_reveal_regions ?? [],
            revealSegments.map((segment) => segment.text),
          ),
          reveal_media_only: scene.spoiler_reveal_media_only ?? false,
          spoiler_style,
        };
      }

      rawScenes.push({
        ...scene,
        is_spoiler: isSpoiler,
        spoiler_initial_text: scene.spoiler_initial_text,
        spoiler_reveal_text: scene.spoiler_reveal_text,
        spoiler_media: scene.spoiler_media,
        spoiler_reveal_regions: scene.spoiler_reveal_regions,
        spoiler_reveal_media_only: scene.spoiler_reveal_media_only,
        spoiler_style: scene.spoiler_style ?? "blur",
        // `null` explicitly disables the automatic/global lead-in fallback.
        // The selected meme is rendered by `trailing_meme_transition` instead.
        meme_transition: isTrailingSourceMeme ? null : ownMeme,
        narration,
        spoiler: spoilerConfig,
        trailing_meme_transition: isTrailingSourceMeme ? ownMeme : undefined,
      });
    }

    // Shift meme_transition: meme selected for scene[i] should play BEFORE scene[i+1]
    // (i.e. it appears AFTER scene[i]'s narration finishes, as a transition).
    // scene[i+1].meme_transition = scene[i]'s selected meme.
    // scene[0] never has a meme lead (nothing before it).
    if (memeBySceneId) {
      for (let i = rawScenes.length - 1; i >= 0; i--) {
        const prevScene = i > 0 ? rawScenes[i - 1]! : null;
        // The lead-in for scene[i] comes from scene[i - 1]'s transition meme.
        // A trailing meme belongs only to its own comment and must not leak
        // into the next scene. Keep an explicit null for the first comment
        // when its own meme is trailing so the global fallback cannot bring
        // back a lead-in before it.
        const previousMeme = prevScene?.meme_transition;
        const previousMemeIsTrailing = Boolean(
          prevScene?.trailing_meme_transition
        );
        const currentSceneId =
          rawScenes[i]!.kind === "post"
            ? rawScenes[i]!.post_id
            : (rawScenes[i]!.comment_id ?? "");
        const hasCurrentMemeSelection = Boolean(
          memeBySceneId &&
            Object.prototype.hasOwnProperty.call(memeBySceneId, currentSceneId)
        );
        const suppressFirstCommentLead =
          isFirstCommentScene(rawScenes, i) &&
          (Boolean(rawScenes[i]!.trailing_meme_transition) ||
            hasCurrentMemeSelection);
        rawScenes[i]!.meme_transition = prevScene
          ? previousMemeIsTrailing
            ? null
            : previousMeme
          : suppressFirstCommentLead
            ? null
            : undefined;
      }

      // Once a post/comment has an explicit per-scene meme selection, do not
      // let the legacy/global meme pool fill an unselected caption. That
      // fallback made a comment's transition meme appear on the post card.
      const hasRelevantMemeSelection = rawScenes.some((scene) => {
        const sceneId =
          scene.kind === "post" ? scene.post_id : (scene.comment_id ?? "");
        return Object.prototype.hasOwnProperty.call(memeBySceneId, sceneId);
      });
      if (hasRelevantMemeSelection) {
        for (const scene of rawScenes) {
          if (scene.meme_transition === undefined) {
            scene.meme_transition = null;
          }
        }
      }
    }

    return applyThreadPageLayout(
      rawScenes.sort((a, b) => a.order - b.order),
      videoMode === "thread_pages"
    );
  }

  private async syncPostVideoScenes(
    scenes: VideoDraftScene[],
    posts: VideoDraftPayload["selectedPosts"],
    enabled: boolean
  ): Promise<VideoDraftScene[]> {
    const withoutPostVideo = scenes.filter(
      (scene) => scene.kind !== "post_video"
    );
    if (!enabled) {
      return withoutPostVideo.map((scene, index) => ({
        ...scene,
        order: index + 1,
      }));
    }

    const nextScenes: VideoDraftScene[] = [];
    for (const scene of withoutPostVideo) {
      nextScenes.push(scene);
      if (
        scene.kind !== "post" &&
        (scene.kind !== "comment" || scene.dialogue_speaker)
      ) {
        continue;
      }

      const post = posts.find((item) => item.post_id === scene.post_id);
      const comment =
        scene.kind === "comment"
          ? post?.top_comments.find(
              (item) => item.comment_id === scene.comment_id
            )
          : undefined;
      const source = comment ?? post;
      const videoMedia = source?.media?.find(
        (media) =>
          media.type === "video" &&
          (Boolean(media.asset_path) || Boolean(media.remote_url))
      );
      if (!post || !source || !videoMedia) {
        continue;
      }

      nextScenes.push({
        comment_id: comment?.comment_id,
        display_duration_ms: await resolvePostVideoDurationMs(source, this.configBaseDir),
        has_media: true,
        kind: "post_video",
        narration: idleNarration(null),
        narration_text: "",
        order: nextScenes.length + 1,
        post_id: post.post_id,
        scene_id: comment
          ? `${comment.comment_id}-comment-video`
          : `${post.post_id}-post-video`,
        source_text: "",
        template: "threads_card",
        text: "",
        title: `Video by @${source.username}`,
        video_media: videoMedia,
      });
    }

    return nextScenes.map((scene, index) => ({
      ...scene,
      order: index + 1,
    }));
  }

  private async narrate({
    sceneId,
    text,
    voiceProfile,
  }: {
    sceneId: string;
    text: string;
    voiceProfile: VideoVoiceSettings;
  }): Promise<NarrationAudio> {
    try {
      return await this.narrateWithVoiceProfile({
        sceneId,
        text,
        voiceProfile,
      });
    } catch (error) {
      const fallbackVoiceProfile =
        this.resolveFallbackVoiceProfile(voiceProfile);
      if (!fallbackVoiceProfile) {
        throw error;
      }

      console.warn(
        `[video] Falling back from ${voiceProfile.provider} to ${fallbackVoiceProfile.provider} for scene ${sceneId}:`,
        error
      );

      return this.narrateWithVoiceProfile({
        sceneId,
        text,
        voiceProfile: fallbackVoiceProfile,
      });
    }
  }

  private async narrateWithVoiceProfile({
    sceneId,
    text,
    voiceProfile,
  }: {
    sceneId: string;
    text: string;
    voiceProfile: VideoVoiceSettings;
  }): Promise<NarrationAudio> {
    const reusableNarration = await this.findReusableNarration({
      text,
      voiceProfile,
    });
    if (reusableNarration) {
      return reusableNarration;
    }

    const chunkOptions = resolveNarrationChunkOptions(
      this.options.config.video,
      voiceProfile
    );
    const chunks = chunkNarrationText(text, chunkOptions);
    const chunkResults: NarrationChunk[] = [];
    const chunkPaths: string[] = [];
    const cacheKey = createNarrationCacheKey({
      chunkMaxChars: this.options.config.video.chunkMaxChars,
      chunkTargetChars: this.options.config.video.chunkTargetChars,
      effectiveChunkMaxChars: chunkOptions.maxChars,
      effectiveChunkTargetChars: chunkOptions.targetChars,
      encoding: this.options.config.video.googleCloudAudioEncoding,
      text,
      voiceProfile,
    });
    const sceneDir = resolve(
      this.configBaseDir,
      this.options.config.video.audioDir,
      "_cache",
      cacheKey.slice(0, 2),
      cacheKey
    );
    await mkdir(sceneDir, { recursive: true });

    let generatedChunks = 0;
    for (const chunk of chunks) {
      const audioExtension = audioFileExtensionForVoiceProvider(
        voiceProfile,
        this.options.config.video.googleCloudAudioEncoding
      );
      const chunkPath = resolve(
        sceneDir,
        `chunk-${String(chunk.order).padStart(2, "0")}.${audioExtension}`
      );

      if (!(await fileExists(chunkPath))) {
        const provider = this.resolveTtsProvider(voiceProfile);
        const result = await provider.synthesize(chunk.text, voiceProfile);
        await writeFile(chunkPath, result.audioBytes);
        if (shouldRetimeGeneratedAudio(voiceProfile)) {
          const retimedChunkPath = resolve(
            sceneDir,
            `chunk-${String(chunk.order).padStart(2, "0")}.retimed.${audioExtension}`
          );
          await retimeAudioFile({
            forceTranscode: shouldForceAudioNormalization(voiceProfile),
            inputPath: chunkPath,
            outputPath: retimedChunkPath,
            speakingRate: resolvePostSynthesisPlaybackRate(voiceProfile),
          });
          await copyFile(retimedChunkPath, chunkPath);
        }
        generatedChunks += 1;
      }

      chunkPaths.push(chunkPath);

      const durationMs =
        (await probeDurationMs(chunkPath)) ?? estimateDurationMs(chunk.text);
      chunkResults.push({
        audio_path: toUrlPath(relative(this.configBaseDir, chunkPath)),
        audio_url: `/media/${toUrlPath(relative(this.configBaseDir, chunkPath))}`,
        chunk_id: `${sceneId}-chunk-${chunk.order}`,
        duration_ms: durationMs,
        order: chunk.order,
        status: "ready",
        text: chunk.text,
      });
    }

    const mergedPath = resolve(
      sceneDir,
      `merged.${audioFileExtensionForVoiceProvider(
        voiceProfile,
        this.options.config.video.googleCloudAudioEncoding
      )}`
    );
    const estimatedDurationMs = chunkResults.reduce(
      (total, chunk) => total + chunk.duration_ms,
      0
    );
    const cachedMergedDurationMs = (await fileExists(mergedPath))
      ? await probeDurationMs(mergedPath)
      : null;
    const hasHealthyMergedCache =
      generatedChunks === 0 &&
      isHealthyMergedDuration({
        chunkDurationMs: estimatedDurationMs,
        mergedDurationMs: cachedMergedDurationMs,
      });
    const mergeResult = hasHealthyMergedCache
      ? {
          durationMs: cachedMergedDurationMs ?? estimatedDurationMs,
          method: "cache" as const,
        }
      : await mergeAudioChunks({
          chunkPaths,
          estimatedDurationMs,
          outputPath: mergedPath,
        });
    const mergedUrl = `/media/${toUrlPath(relative(this.configBaseDir, mergedPath))}`;
    const message =
      mergeResult.method === "cache"
        ? "Scene audio loaded from cache."
        : generatedChunks === 0
          ? "Scene audio chunks loaded from cache and merged."
          : mergeResult.method === "ffmpeg_concat"
            ? "Scene audio generated and merged with ffmpeg."
            : "Scene audio generated and merged with fallback concatenation.";

    return {
      audio_url: mergedUrl,
      chunks: chunkResults,
      merged_audio_path: toUrlPath(relative(this.configBaseDir, mergedPath)),
      merged_audio_url: mergedUrl,
      message: appendNarrationPipelineTag(message),
      provider: voiceProfile.provider,
      request_id: "",
      status: "ready",
      total_duration_ms: mergeResult.durationMs,
      voice_profile: voiceProfile,
    };
  }

  private resolveFallbackVoiceProfile(
    failedVoiceProfile: VideoVoiceSettings
  ): VideoVoiceSettings | null {
    if (failedVoiceProfile.provider !== "ausynclab") {
      return null;
    }

    const hasFpt = this.options.config.video.fptAiApiKey.trim().length > 0;
    const hasVivibe = this.options.config.video.vivibeApiKey.trim().length > 0;
    if (hasFpt) {
      return {
        languageCode: "vi-VN",
        pitch: 0,
        provider: "fpt_ai",
        speakingRate: 1,
        ssmlGender: "FEMALE",
        voiceName: this.options.config.video.fptAiVoiceName || "banmai",
      };
    }

    const hasGoogle =
      this.options.config.video.googleCloudApiKey.trim().length > 0;
    if (hasGoogle) {
      return {
        languageCode: this.options.config.video.googleCloudLanguageCode,
        pitch: this.options.config.video.googleCloudPitch,
        provider: "google_cloud",
        speakingRate: this.options.config.video.googleCloudSpeakingRate,
        ssmlGender: this.options.config.video.googleCloudSsmlGender,
        voiceName: this.options.config.video.googleCloudVoiceName,
      };
    }

    return null;
  }

  private async findReusableNarration({
    text,
    voiceProfile,
  }: {
    text: string;
    voiceProfile: VideoVoiceSettings;
  }): Promise<NarrationAudio | null> {
    if (voiceProfile.provider === "vivibe") {
      return null;
    }

    const draftsDir = resolve(
      this.configBaseDir,
      this.options.config.video.draftsDir
    );
    let entries: string[];
    try {
      entries = await readdir(draftsDir);
    } catch {
      return null;
    }

    const draftFiles = entries
      .filter((name) => name.endsWith(".json"))
      .sort((a, b) => b.localeCompare(a));

    for (const filename of draftFiles) {
      try {
        const raw = await readFile(resolve(draftsDir, filename), "utf8");
        const draft = JSON.parse(raw) as Partial<VideoDraftDocument>;
        const scenes = Array.isArray(draft.scenes) ? draft.scenes : [];

        for (const scene of scenes) {
          const sceneNarrationText = getSceneNarrationText(scene);
          if (
            sceneNarrationText !== text ||
            scene.narration?.status !== "ready" ||
            !sameVoiceProfile(scene.narration.voice_profile, voiceProfile) ||
            !isNarrationPipelineCompatible(scene.narration)
          ) {
            continue;
          }

          if (
            !(await narrationFilesExist(scene.narration, this.configBaseDir))
          ) {
            continue;
          }

          const narrationDurationMs = await resolveNarrationAudioDurationMs(
            scene.narration,
            this.configBaseDir
          );
          const chunkDurationMs = (scene.narration.chunks ?? []).reduce(
            (total, chunk) => total + Math.max(0, chunk.duration_ms || 0),
            0
          );
          if (
            !isHealthyMergedDuration({
              chunkDurationMs,
              mergedDurationMs: narrationDurationMs,
            })
          ) {
            continue;
          }

          return {
            ...scene.narration,
            message: appendNarrationPipelineTag(
              "Scene audio loaded from previous draft cache."
            ),
            total_duration_ms:
              narrationDurationMs ??
              getNarrationDurationMs(scene.narration, sceneNarrationText),
            voice_profile: voiceProfile,
          };
        }
      } catch {}
    }

    return null;
  }

  private resolveTtsProvider(
    voiceProfile: VideoVoiceSettings
  ): TextToSpeechProvider {
    return createTtsProviderRegistry(this.options.config.video)[
      voiceProfile.provider
    ];
  }

  private resolveRequestedVoiceProfile(
    requestedVoice: VideoVoiceSettings | null
  ): VideoVoiceSettings | null {
    const hasGoogle =
      this.options.config.video.googleCloudApiKey.trim().length > 0;
    const hasAusynclab = Boolean(
      this.options.config.video.ausynclabApiKey?.trim().length
    );
    const hasFpt = this.options.config.video.fptAiApiKey.trim().length > 0;
    const hasVivibe = this.options.config.video.vivibeApiKey.trim().length > 0;

    if (!(hasGoogle || hasFpt || hasAusynclab || hasVivibe)) {
      throw new Error(
        "Chưa có API voice khả dụng. Hãy cấu hình FPT Voice, Google Voice, hoặc AuSyncLab trong Cài đặt."
      );
    }

    if (!requestedVoice) {
      return null;
    }

    if (requestedVoice.provider === "ausynclab" && hasAusynclab) {
      return requestedVoice;
    }

    if (requestedVoice.provider === "google_cloud" && hasGoogle) {
      return requestedVoice;
    }

    if (requestedVoice.provider === "fpt_ai" && hasFpt) {
      return requestedVoice;
    }

    if (requestedVoice.provider === "vivibe" && hasVivibe) {
      if (!requestedVoice.voiceName.trim()) {
        throw new Error("ViVibe can voiceId hop le de tao audio.");
      }
      return requestedVoice;
    }

    if (hasAusynclab) {
      return {
        languageCode: "vi-VN",
        pitch: 0,
        provider: "ausynclab",
        speakingRate: 1.0,
        ssmlGender: "MALE",
        voiceName: "1927315",
      };
    }

    if (hasFpt) {
      return {
        languageCode: "vi-VN",
        pitch: 0,
        provider: "fpt_ai",
        speakingRate: 1,
        ssmlGender: "FEMALE",
        voiceName: this.options.config.video.fptAiVoiceName || "banmai",
      };
    }

    if (hasVivibe) {
      throw new Error(
        "Đã có ViVibe API key. Hãy chọn một giọng ViVibe trong phần Tạo video trước khi tạo voice."
      );
    }

    return {
      languageCode: this.options.config.video.googleCloudLanguageCode,
      pitch: this.options.config.video.googleCloudPitch,
      provider: "google_cloud",
      speakingRate: this.options.config.video.googleCloudSpeakingRate,
      ssmlGender: this.options.config.video.googleCloudSsmlGender,
      voiceName: this.options.config.video.googleCloudVoiceName,
    };
  }

  private updateRenderJob(
    draftId: string,
    patch: Partial<VideoRenderJob>
  ): void {
    const current = this.renderJobs.get(draftId);
    if (!current) {
      return;
    }

    this.renderJobs.set(draftId, {
      ...current,
      ...patch,
      updated_at: new Date().toISOString(),
    });
  }

  private async ensureRenderJobDownloadable(
    job: VideoRenderJob
  ): Promise<VideoRenderJob> {
    if (job.status !== "completed" || !job.render?.outputPath) {
      return job;
    }

    const expectedOutputPath = resolve(
      this.configBaseDir,
      job.render.outputPath
    );
    try {
      const info = await stat(expectedOutputPath);
      if (job.render.sizeBytes !== info.size) {
        const nextJob = {
          ...job,
          render: {
            ...job.render,
            sizeBytes: info.size,
          },
        };
        this.renderJobs.set(job.draft_id, nextJob);
        return nextJob;
      }
      return job;
    } catch {
      const renderDirOutputPath = resolve(
        this.configBaseDir,
        this.options.config.video.rendersDir,
        job.draft_id,
        `${job.draft_id}.mp4`
      );

      try {
        await stat(renderDirOutputPath);
      } catch {
        const failedJob: VideoRenderJob = {
          ...job,
          error:
            "File video render đã bị mất hoặc không còn tồn tại để tải xuống.",
          finished_at: job.finished_at ?? new Date().toISOString(),
          status: "failed",
          updated_at: new Date().toISOString(),
        };
        this.renderJobs.set(job.draft_id, failedJob);
        return failedJob;
      }

      await mkdir(dirname(expectedOutputPath), { recursive: true });
      await copyFile(renderDirOutputPath, expectedOutputPath);
      const repairedInfo = await stat(expectedOutputPath);
      const repairedJob: VideoRenderJob = {
        ...job,
        render: {
          ...job.render,
          sizeBytes: repairedInfo.size,
        },
        updated_at: new Date().toISOString(),
      };
      this.renderJobs.set(job.draft_id, repairedJob);
      return repairedJob;
    }
  }

  private async getVivibeVoicesForEmotionMode(): Promise<VivibeVoiceItem[]> {
    if (
      this.vivibeVoicesCache &&
      Date.now() < this.vivibeVoicesCacheExpiresAt
    ) {
      return this.vivibeVoicesCache;
    }

    try {
      const client = new VivibeTtsClient(this.options.config.video);
      this.vivibeVoicesCache = mergeVivibeVoices(await client.listVoices());
      this.vivibeVoicesCacheExpiresAt = Date.now() + VIVIBE_VOICES_CACHE_TTL_MS;
      return this.vivibeVoicesCache;
    } catch (error) {
      console.warn(
        "[video] Failed to load ViVibe voices for emotion mode:",
        error
      );
      this.vivibeVoicesCache = mergeVivibeVoices([]);
      this.vivibeVoicesCacheExpiresAt =
        Date.now() + VIVIBE_VOICES_ERROR_CACHE_TTL_MS;
      return this.vivibeVoicesCache;
    }
  }
}

export function applyThreadPageLayout(
  scenes: VideoDraftScene[],
  enabled: boolean
): VideoDraftScene[] {
  if (!enabled) {
    return scenes;
  }

  const pageMembersBySceneId = new Map<string, string[]>();
  let pending: VideoDraftScene[] = [];
  let pendingTextLength = 0;

  const flush = () => {
    if (pending.length > 1) {
      const memberSceneIds = pending.map((scene) => scene.scene_id);
      for (const scene of pending) {
        pageMembersBySceneId.set(scene.scene_id, memberSceneIds);
      }
    }
    pending = [];
    pendingTextLength = 0;
  };

  for (const scene of scenes) {
    const textLength = normalizeSceneText(
      scene.source_text || scene.text
    ).length;
    const canSharePage =
      scene.kind === "comment" &&
      !scene.dialogue_speaker &&
      !scene.has_media &&
      !scene.spoiler &&
      !scene.is_spoiler &&
      !scene.meme_transition &&
      !scene.trailing_meme_transition &&
      textLength > 0 &&
      textLength <= 220;
    const sharesPost = pending[0]?.post_id === scene.post_id;
    const fitsPage =
      pending.length < 3 && pendingTextLength + textLength <= 420;

    if (!canSharePage || (pending.length > 0 && (!sharesPost || !fitsPage))) {
      flush();
    }
    if (!canSharePage) {
      continue;
    }

    pending.push(scene);
    pendingTextLength += textLength;
  }
  flush();

  return scenes.map((scene) => {
    const memberSceneIds = pageMembersBySceneId.get(scene.scene_id);
    return memberSceneIds
      ? { ...scene, thread_page: { member_scene_ids: memberSceneIds } }
      : scene;
  });
}

function idleNarration(
  voiceProfile: VideoVoiceSettings | null
): NarrationAudio {
  return {
    audio_url: "",
    chunks: [],
    merged_audio_path: "",
    merged_audio_url: "",
    message: "Voice has not been generated yet.",
    provider: voiceProfile?.provider ?? "google_cloud",
    request_id: "",
    status: "idle",
    total_duration_ms: 0,
    voice_profile: voiceProfile,
  };
}

function indexScenesById(
  scenes: VideoDraftScene[] | null | undefined
): Map<string, VideoDraftScene> {
  return new Map(
    (scenes ?? [])
      .filter(
        (scene) => typeof scene?.scene_id === "string" && scene.scene_id.trim()
      )
      .map((scene) => [scene.scene_id, scene] as const)
  );
}

function resolveSceneNarrationText({
  currentDisplayText,
  defaultNarrationText,
  existingScene,
}: {
  currentDisplayText: string;
  defaultNarrationText: string;
  existingScene?: VideoDraftScene;
}): string {
  const normalizedDefaultText = normalizeSceneText(defaultNarrationText);
  if (!existingScene) {
    return normalizedDefaultText;
  }

  if (
    getSceneDisplayText(existingScene) !==
    normalizeSceneText(currentDisplayText)
  ) {
    return normalizedDefaultText;
  }

  return getSceneNarrationText(existingScene) || normalizedDefaultText;
}

async function prepareSceneNarration(
  input: PreparedSceneNarrationInput
): Promise<PreparedSceneNarration> {
  const sourceText = normalizeSceneText(input.displayText);
  const explicitNarrationText = normalizeSceneText(
    replaceSpelledTtsCommas(removeTtsEmoticons(input.explicitNarrationText ?? ""))
  );
  if (explicitNarrationText) {
    return {
      hasExplicitNarrationOverride: true,
      narrationText: explicitNarrationText,
      sourceText,
      textProcessing: {
        appliedMode: "off",
        requestedMode: input.mode ?? "rules_only",
        usedLlm: false,
        warnings: [],
      },
    };
  }

  const prepared = await prepareNarrationText({
    abbreviations: input.abbreviations,
    config: input.config,
    context: input.context,
    kind: input.kind,
    language: input.language,
    mode: input.mode,
    text: sourceText,
  });

  return {
    hasExplicitNarrationOverride: false,
    narrationText: normalizeSceneText(prepared.finalText),
    sourceText: normalizeSceneText(prepared.sourceText),
    textProcessing: {
      appliedMode: prepared.appliedMode,
      requestedMode: prepared.requestedMode,
      usedLlm: prepared.usedLlm,
      warnings: prepared.warnings,
    },
  };
}

function resolveSceneHasMedia(
  scene: VideoDraftScene,
  posts: VideoDraftPayload["selectedPosts"]
): boolean {
  if (scene.kind === "post_video") {
    return true;
  }
  const post = posts.find((item) => item.post_id === scene.post_id);
  if (!post) {
    return Boolean(scene.has_media);
  }

  if (scene.kind === "post") {
    return Array.isArray(post.media) && post.media.length > 0;
  }

  if (scene.dialogue_speaker) {
    return false;
  }

  const comment = post.top_comments.find(
    (item) => item.comment_id === scene.comment_id
  );
  return Array.isArray(comment?.media) && comment.media.length > 0;
}

function normalizeCommentDisplayDurationMs(
  value: number | undefined
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(120_000, Math.max(500, Math.round(value * 1000)));
}

async function resolvePostVideoDurationMs(
  source: Pick<
    VideoDraftPayload["selectedPosts"][number],
    "media" | "video_duration_seconds"
  >,
  baseDir: string
): Promise<number> {
  const configuredDurationMs = normalizeCommentDisplayDurationMs(
    source.video_duration_seconds
  );
  const media = source.media?.find(
    (item) =>
      item.type === "video" &&
      (Boolean(item.asset_path) || Boolean(item.remote_url))
  );
  if (!media) {
    return DEFAULT_POST_VIDEO_DURATION_MS;
  }

  const declaredDurationMs = normalizeMediaDurationMs(media.duration_seconds);
  if (declaredDurationMs) {
    return configuredDurationMs
      ? Math.min(declaredDurationMs, configuredDurationMs)
      : declaredDurationMs;
  }

  const localCandidates = [
    media.asset_path,
    media.remote_url.startsWith("/media/")
      ? media.remote_url.slice("/media/".length).split("?")[0]
      : "",
  ]
    .map((path) => String(path ?? "").trim())
    .filter(Boolean)
    .map((path) => resolve(baseDir, path));

  for (const localPath of localCandidates) {
    if (!existsSync(localPath)) {
      continue;
    }
    const durationMs = await probeVideoDurationMs(localPath);
    if (durationMs && durationMs > 0) {
      const sourceDurationMs = Math.min(
        MAX_POST_VIDEO_DURATION_MS,
        Math.max(500, durationMs)
      );
      return configuredDurationMs
        ? Math.min(sourceDurationMs, configuredDurationMs)
        : sourceDurationMs;
    }
  }

  if (configuredDurationMs) {
    return configuredDurationMs;
  }

  return DEFAULT_POST_VIDEO_DURATION_MS;
}

function normalizeMediaDurationMs(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(120_000, Math.max(500, Math.round(value * 1000)));
}

function canReuseSceneNarrationText({
  existingDisplayText,
  existingTtsText,
  nextDisplayText,
  nextTtsText,
}: {
  existingDisplayText?: string;
  existingTtsText?: string;
  nextDisplayText?: string;
  nextTtsText?: string;
}): boolean {
  if ((existingTtsText ?? "") !== (nextTtsText ?? "")) {
    return false;
  }

  // An explicit TTS value owns the narration. The display text may change
  // without invalidating the already-generated audio. With an empty TTS value,
  // display text is the narration fallback and must remain unchanged.
  return Boolean(String(nextTtsText ?? "").trim()) ||
    (existingDisplayText ?? "") === (nextDisplayText ?? "");
}

function syncSceneDisplayText(
  scene: VideoDraftScene,
  posts: VideoDraftPayload["selectedPosts"]
): VideoDraftScene {
  if (scene.dialogue_speaker || scene.kind === "post_video") {
    return scene;
  }

  const post = posts.find((item) => item.post_id === scene.post_id);
  if (!post) {
    return scene;
  }

  if (scene.kind === "post") {
    const spoilerMediaOnly = Boolean(
      post.spoiler_reveal_media_only || post.spoiler_reveal_regions?.length
    );
    const spoilerText = resolveSpoilerTextParts({
      initial: post.spoiler_initial_text,
      isSpoiler: post.is_spoiler,
      reveal: post.spoiler_reveal_text,
      revealMediaOnly: spoilerMediaOnly,
      text: post.text,
    });
    const displayText = post.is_spoiler
      ? `${spoilerText.initial}${spoilerText.reveal ? " " + spoilerText.reveal : ""}`.trim()
      : post.text;
    return {
      ...scene,
      source_text: normalizeSceneText(displayText),
      text: normalizeSceneText(displayText),
      is_spoiler: post.is_spoiler,
      spoiler_initial_text: spoilerText.initial,
      spoiler_reveal_text: spoilerText.reveal,
      spoiler_media: post.spoiler_media,
      spoiler_reveal_regions: post.spoiler_reveal_regions,
      spoiler_reveal_media_only: post.spoiler_reveal_media_only,
    };
  }

  const comment = post.top_comments.find(
    (item) => item.comment_id === scene.comment_id
  );
  if (!comment) {
    return scene;
  }

  const spoilerMediaOnly = Boolean(
    comment.spoiler_reveal_media_only || comment.spoiler_reveal_regions?.length
  );
  const spoilerText = resolveSpoilerTextParts({
    initial: comment.spoiler_initial_text,
    isSpoiler: comment.is_spoiler,
    reveal: comment.spoiler_reveal_text,
    revealMediaOnly: spoilerMediaOnly,
    text: comment.text,
  });
  const displayText = comment.is_spoiler
    ? `${spoilerText.initial}${spoilerText.reveal ? "\n" + spoilerText.reveal : ""}`.trim()
    : comment.text;
  return {
    ...scene,
    source_text: normalizeSceneText(displayText),
    text: normalizeSceneText(displayText),
    is_spoiler: comment.is_spoiler,
    spoiler_initial_text: spoilerText.initial,
    spoiler_reveal_text: spoilerText.reveal,
    spoiler_media: comment.spoiler_media,
    spoiler_reveal_regions: comment.spoiler_reveal_regions,
    spoiler_reveal_media_only: comment.spoiler_reveal_media_only,
  };
}

function resolveSceneDisplayDurationMs(
  scene: VideoDraftScene,
  posts: VideoDraftPayload["selectedPosts"]
): number | undefined {
  if (scene.kind === "post_video") {
    return scene.display_duration_ms;
  }
  if (scene.dialogue_speaker) {
    return undefined;
  }
  const post = posts.find((item) => item.post_id === scene.post_id);
  if (scene.kind === "post") {
    return normalizeCommentDisplayDurationMs(post?.video_duration_seconds);
  }
  const comment = post?.top_comments.find(
    (item) => item.comment_id === scene.comment_id
  );
  return normalizeCommentDisplayDurationMs(comment?.video_duration_seconds);
}

function getSceneDisplayText(
  scene: Pick<VideoDraftScene, "source_text" | "text"> | null | undefined
): string {
  return normalizeSceneText(scene?.source_text || scene?.text || "");
}

function getSceneNarrationText(
  scene: Pick<VideoDraftScene, "narration_text" | "text"> | null | undefined
): string {
  return normalizeSceneText(scene?.narration_text || scene?.text || "");
}

function isSceneNarrationSynchronized(scene: VideoDraftScene): boolean {
  const expectedText = getSceneNarrationText(scene);
  const chunkText = normalizeSceneText(
    (scene.narration.chunks ?? []).map((chunk) => chunk.text).join(" ")
  );
  return (
    Boolean(expectedText) && Boolean(chunkText) && expectedText === chunkText
  );
}

function normalizeSceneText(value: string): string {
  return String(value ?? "")
    .replace(/[^\S\r\n]+/g, " ")
    .trim()
    .slice(0, 5000);
}

function resolveSpoilerRevealTimeMs({
  fallbackRatio,
  narrationText,
  chunks,
  targetOffset,
  totalDurationMs,
}: {
  chunks: Array<{ duration_ms?: number; text: string }>;
  fallbackRatio?: number;
  narrationText: string;
  targetOffset: number;
  totalDurationMs: number;
}): number {
  const safeTargetOffset = Math.max(
    0,
    Math.min(targetOffset, narrationText.length)
  );
  let currentOffset = 0;
  let elapsedMs = 0;

  for (const chunk of chunks) {
    const chunkText = String(chunk.text ?? "");
    const startIndex = narrationText.indexOf(chunkText, currentOffset);
    const durationMs = Math.max(0, Number(chunk.duration_ms) || 0);
    if (startIndex >= 0) {
      const endIndex = startIndex + chunkText.length;
      if (safeTargetOffset <= endIndex) {
        const ratio = chunkText.length
          ? Math.max(
              0,
              Math.min(1, (safeTargetOffset - startIndex) / chunkText.length)
            )
          : 0;
        return Math.round(
          Math.min(totalDurationMs, elapsedMs + durationMs * ratio)
        );
      }
      currentOffset = endIndex;
    }
    elapsedMs += durationMs;
  }

  const ratio =
    typeof fallbackRatio === "number" && Number.isFinite(fallbackRatio)
      ? Math.max(0, Math.min(1, fallbackRatio))
      : narrationText.length
        ? safeTargetOffset / narrationText.length
        : 0;
  return Math.round(
    Math.min(totalDurationMs, Math.max(0, ratio * totalDurationMs))
  );
}

export function normalizeSpoilerRevealRegions(
  regions: VideoSpoilerRevealRegion[],
  revealSegmentTexts: string[] = [],
): VideoSpoilerRevealRegion[] {
  if (regions.length === 0) return regions;

  const hasLegacyScaledCoordinates = regions.some((region) => {
    const sourceWidth = Math.max(1, Number(region.image_width) || 0);
    const sourceHeight = Math.max(1, Number(region.image_height) || 0);
    return (
      region.bbox.x + region.bbox.width > sourceWidth * 1.02 ||
      region.bbox.y + region.bbox.height > sourceHeight * 1.02
    );
  });
  const normalizedRegions = hasLegacyScaledCoordinates
    ? regions.map((region) => {
        const scale = Math.max(
          1,
          Number(region.image_width) || 0,
          Number(region.image_height) || 0,
        ) / 1600;
        return {
          ...region,
          bbox: {
            height: region.bbox.height * scale,
            width: region.bbox.width * scale,
            x: region.bbox.x * scale,
            y: region.bbox.y * scale,
          },
        };
      })
    : regions;

  if (normalizedRegions.length !== 1 || revealSegmentTexts.length < 2) {
    return normalizedRegions;
  }

  const region = normalizedRegions[0]!;
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

function normalizeThumbnailIntro(
  value: VideoThumbnailIntro | null | undefined
): VideoThumbnailIntro | null {
  if (!value?.enabled) {
    return null;
  }

  const defaultBrandImageSize = Math.min(
    100,
    Math.max(
      30,
      [72, 78, 85].includes(Math.round(Number(value.brandImageSizePercent) || 92))
        ? 92
        : Math.round(Number(value.brandImageSizePercent) || 92)
    )
  );
  const defaultLayers: Record<VideoThumbnailLayerId, VideoThumbnailLayerLayout> = {
    brand: { height: 24, locked: false, visible: true, width: defaultBrandImageSize, x: 50, y: 70 },
    channel: { height: 8, locked: false, visible: true, width: 72, x: 50, y: 25 },
    title: { height: 28, locked: false, visible: true, width: 84, x: 50, y: 34 },
    watermark: { height: 19, locked: false, visible: true, width: 19, x: 88, y: 10 },
  };
  const minimumLayerSize: Record<VideoThumbnailLayerId, { height: number; width: number }> = {
    brand: { height: 10, width: 20 },
    channel: { height: 6, width: 24 },
    title: { height: 16, width: 36 },
    watermark: { height: 8, width: 8 },
  };
  const normalizeLayer = (id: VideoThumbnailLayerId): VideoThumbnailLayerLayout => {
    const layer = { ...defaultLayers[id], ...value.layout?.[id] };
    const minimum = minimumLayerSize[id];
    return {
      height: Math.min(95, Math.max(minimum.height, Number(layer.height) || defaultLayers[id].height)),
      locked: layer.locked === true,
      rotation: Math.min(180, Math.max(-180, Number(layer.rotation) || 0)),
      visible: layer.visible !== false,
      width: Math.min(95, Math.max(minimum.width, Number(layer.width) || defaultLayers[id].width)),
      x: Math.min(100, Math.max(0, Number(layer.x) || defaultLayers[id].x)),
      y: Math.min(100, Math.max(0, Number(layer.y) || defaultLayers[id].y)),
    };
  };
  const layerOrder = [
    ...(value.layout?.layerOrder ?? []),
    ...(["title", "channel", "brand", "watermark"] as VideoThumbnailLayerId[]),
  ].filter((id, index, list) => list.indexOf(id) === index);
  const isThumbnailFont = (font: unknown): font is VideoThumbnailFont =>
    [
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
    ].includes(font as VideoThumbnailFont);
  const rawDurationMs = Math.round(Number(value.durationMs));
  const durationMs = [100, 250, 500, 1000].includes(rawDurationMs)
    ? rawDurationMs
    : 1000;
  const titleOverridesByPostId = Object.fromEntries(
    Object.entries(value.titleOverridesByPostId ?? {})
      .map(([postId, title]) => [
        postId.trim(),
        String(title ?? "").trim().slice(0, 160),
      ])
      .filter(([postId, title]) => Boolean(postId && title))
  );

  return {
    brandImage: value.brandImage?.serverPath ? value.brandImage : null,
    brandImageSizePercent: defaultBrandImageSize,
    watermarkSizePercent: Math.min(30, Math.max(6, Math.round(Number(value.watermarkSizePercent) || 19))),
    channelName: String(value.channelName ?? "").trim().slice(0, 80) || undefined,
    channelColor: /^#[0-9a-f]{6}$/i.test(value.channelColor ?? "")
      ? value.channelColor
      : undefined,
    channelFont: isThumbnailFont(value.channelFont)
      ? value.channelFont
      : "geist",
    channelBold: value.channelBold === true,
    channelItalic: value.channelItalic === true,
    channelFontSize: Math.min(
      72,
      Math.max(16, Math.round(Number(value.channelFontSize) || 36))
    ),
    durationMs,
    enabled: true,
    background: value.background?.serverPath ? value.background : null,
    backgroundFit: value.backgroundFit === "contain" ? "contain" : "cover",
    backgroundPositionX: Math.min(100, Math.max(0, Number(value.backgroundPositionX) || 50)),
    backgroundPositionY: Math.min(100, Math.max(0, Number(value.backgroundPositionY) || 50)),
    backgroundZoom: Math.min(3, Math.max(1, Number(value.backgroundZoom) || 1)),
    image: value.image?.serverPath ? value.image : null,
    mode: value.mode === "automatic" ? "automatic" : "advanced",
    subtitle: String(value.subtitle ?? "").trim().slice(0, 120) || undefined,
    title: String(value.title ?? "").trim().slice(0, 160),
    titleOverridesByPostId,
    titleColor: /^#[0-9a-f]{6}$/i.test(value.titleColor ?? "")
      ? value.titleColor
      : "#741b1b",
    titleBold: value.titleBold !== false,
    titleItalic: value.titleItalic === true,
    titleFont:
      isThumbnailFont(value.titleFont)
        ? value.titleFont
        : "poppins",
    titleFontSize: Math.min(
      120,
      Math.max(28, Math.round(Number(value.titleFontSize) || 42))
    ),
    layout: {
      brand: normalizeLayer("brand"),
      channel: normalizeLayer("channel"),
      layerOrder: layerOrder as VideoThumbnailLayerId[],
      title: normalizeLayer("title"),
      watermark: normalizeLayer("watermark"),
    },
    watermark: value.watermark?.serverPath ? value.watermark : null,
    watermarkPosition:
      value.watermarkPosition === "top-left" ||
      value.watermarkPosition === "bottom-left" ||
      value.watermarkPosition === "bottom-right" ||
      value.watermarkPosition === "center"
        ? value.watermarkPosition
        : "top-right",
  };
}

function applyThumbnailIntroOffset(
  scenes: VideoDraftScene[],
  thumbnailIntro: VideoThumbnailIntro | null
): VideoDraftScene[] {
  const offsetMs = thumbnailIntro?.enabled ? thumbnailIntro.durationMs : 0;
  if (offsetMs <= 0) {
    return scenes;
  }

  return scenes.map((scene) => ({
    ...scene,
    timeline: scene.timeline
      ? {
          end_ms: scene.timeline.end_ms + offsetMs,
          start_ms: scene.timeline.start_ms + offsetMs,
        }
      : scene.timeline,
  }));
}

function assignSceneTimeline(
  scenes: VideoDraftScene[],
  config: ToolConfig["video"],
  memeTransitionDurationMs?: number
): VideoDraftScene[] {
  let startMs = 0;
  const timedScenes: VideoDraftScene[] = [];
  for (const [index, scene] of scenes.entries()) {
    const narrationDurationMs = getNarrationDurationMs(
      scene.narration,
      getSceneNarrationText(scene)
    );
    let durationMs = getSceneDurationMs({
      config,
      memeTransitionDurationMs,
      narrationDurationMs,
      sceneIndex: index,
      scenes,
      scene,
    });
    const previousScene = scenes[index - 1];
    const previousTimeline = timedScenes[index - 1]?.timeline;
    if (
      scene.kind === "post_video" &&
      previousScene &&
      previousTimeline &&
      isVideoAfterCaption(previousScene, scene)
    ) {
      durationMs = resolvePostVideoDurationWithinTotalMs({
        captionDurationMs: Math.max(
          0,
          previousTimeline.end_ms - previousTimeline.start_ms
        ),
        sourceVideoDurationMs: durationMs,
        totalDurationMs: previousScene.display_duration_ms,
      });
    }
    const nextScene = {
      ...scene,
      ...(scene.kind === "post_video" ? { display_duration_ms: durationMs } : {}),
      timeline: {
        end_ms: startMs + durationMs,
        start_ms: startMs,
      },
    };
    startMs +=
      durationMs + getSceneTransitionGapMs(scene, config, scenes[index + 1]);
    timedScenes.push(nextScene);
  }

  // Dialogue lines only carry audio. Keep the preceding post card/media
  // alive until the complete dialogue block ends instead of rendering the
  // same post card once per line.
  for (let index = 0; index < timedScenes.length; index += 1) {
    const scene = timedScenes[index];
    if (!scene?.dialogue_speaker) continue;

    let postIndex: number | undefined;
    for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const candidate = timedScenes[candidateIndex];
      if (candidate?.kind === "post" && candidate.post_id === scene.post_id) {
        postIndex = candidateIndex;
        break;
      }
    }
    if (postIndex === undefined) continue;

    let dialogueEndMs = scene.timeline?.end_ms ?? 0;
    for (
      let dialogueIndex = index + 1;
      dialogueIndex < timedScenes.length;
      dialogueIndex += 1
    ) {
      const nextDialogue = timedScenes[dialogueIndex];
      if (
        !nextDialogue ||
        nextDialogue.post_id !== scene.post_id ||
        !nextDialogue.dialogue_speaker
      ) {
        break;
      }
      dialogueEndMs = Math.max(
        dialogueEndMs,
        nextDialogue.timeline?.end_ms ?? dialogueEndMs
      );
    }

    const postScene = timedScenes[postIndex];
    if (postScene?.timeline) {
      postScene.timeline = {
        ...postScene.timeline,
        end_ms: Math.max(postScene.timeline.end_ms, dialogueEndMs),
      };
    }
  }

  return timedScenes;
}

function moveDialogueMemesAfterNarration(
  scenes: VideoDraftScene[]
): VideoDraftScene[] {
  const nextScenes = scenes.map((scene) => ({ ...scene }));

  for (let index = 1; index < nextScenes.length; index += 1) {
    const firstDialogue = nextScenes[index];
    const previousScene = nextScenes[index - 1];
    if (
      !firstDialogue?.dialogue_speaker ||
      firstDialogue.meme_transition == null ||
      previousScene?.kind !== "post" ||
      previousScene.post_id !== firstDialogue.post_id
    ) {
      continue;
    }

    let lastDialogueIndex = index;
    while (
      lastDialogueIndex + 1 < nextScenes.length &&
      nextScenes[lastDialogueIndex + 1]?.dialogue_speaker &&
      nextScenes[lastDialogueIndex + 1]?.post_id === firstDialogue.post_id
    ) {
      lastDialogueIndex += 1;
    }

    nextScenes[index] = {
      ...firstDialogue,
      meme_transition: null,
    };
    const lastDialogue = nextScenes[lastDialogueIndex];
    if (!lastDialogue) {
      continue;
    }
    nextScenes[lastDialogueIndex] = {
      ...lastDialogue,
      trailing_meme_transition: firstDialogue.meme_transition,
    };
    index = lastDialogueIndex;
  }

  return nextScenes;
}

function getSceneDurationMs({
  config,
  memeTransitionDurationMs,
  narrationDurationMs,
  sceneIndex,
  scenes,
  scene,
}: {
  config: ToolConfig["video"];
  memeTransitionDurationMs?: number;
  narrationDurationMs: number;
  sceneIndex: number;
  scenes: VideoDraftScene[];
  scene: VideoDraftScene;
}): number {
  if (scene.kind === "post_video") {
    return Math.max(
      500,
      Number.isFinite(scene.display_duration_ms)
        ? Math.round(scene.display_duration_ms ?? 0)
        : DEFAULT_POST_VIDEO_DURATION_MS
    );
  }

  if (scene.dialogue_speaker) {
    const trailingMemeMs = scene.trailing_meme_transition
      ? getResolvedMemeTransitionDurationMs(scene.trailing_meme_transition, 720)
      : 0;
    return Math.max(0, narrationDurationMs + trailingMemeMs);
  }

  const memeLeadMs =
    scene.meme_transition === undefined
      ? isFirstCommentScene(scenes, sceneIndex)
        ? getMemeTransitionDurationMs(memeTransitionDurationMs)
        : 0
      : scene.meme_transition
        ? getResolvedMemeTransitionDurationMs(scene.meme_transition, 720)
        : 0;

  const trailingMemeMs = scene.trailing_meme_transition
    ? getResolvedMemeTransitionDurationMs(scene.trailing_meme_transition, 720)
    : 0;

  const nextScene = scenes[sceneIndex + 1];
  const playsPostVideoImmediatelyAfterCaption = isVideoAfterCaption(
    scene,
    nextScene
  );
  const hasImmediateTransitionMeme = Boolean(
    nextScene &&
      !nextScene.dialogue_speaker &&
      nextScene.meme_transition &&
      nextScene.meme_transition.placement === "transition" &&
      (nextScene.meme_transition.image?.serverPath ||
        nextScene.meme_transition.audio?.serverPath)
  );

  if (playsPostVideoImmediatelyAfterCaption) {
    return Math.max(0, memeLeadMs + narrationDurationMs + trailingMemeMs);
  }

  if (
    (scene.kind === "comment" || scene.kind === "post") &&
    typeof scene.display_duration_ms === "number" &&
    Number.isFinite(scene.display_duration_ms)
  ) {
    // Treat the custom value as a minimum for the complete scene. Narration
    // and a meme attached to this scene must still finish first.
    return Math.max(
      scene.display_duration_ms,
      memeLeadMs + narrationDurationMs + COMMENT_NARRATION_HOLD_MS + trailingMemeMs
    );
  }

  // An after-comment meme starts as soon as narration finishes. Its duration
  // is part of the scene timeline; do not insert the normal post/comment hold
  // before it, otherwise the exported video contains an unexplained pause.
  if (trailingMemeMs > 0) {
    return Math.max(0, memeLeadMs + narrationDurationMs + trailingMemeMs);
  }

  // A transition meme belongs between this scene and the next one. Start it
  // immediately after narration instead of leaving the old card hold before
  // the transition begins.
  if (hasImmediateTransitionMeme) {
    return Math.max(0, memeLeadMs + narrationDurationMs);
  }

  const hasDialogueContinuation = Boolean(
    scene.kind === "post" &&
      nextScene?.dialogue_speaker &&
      nextScene.post_id === scene.post_id
  );
  if (hasDialogueContinuation) {
    // The post card remains visible, but a post-trailing meme must play before
    // dialogue starts when the user selected "Ngay sau khi đọc".
    return Math.max(0, narrationDurationMs + trailingMemeMs);
  }

  if (scene.kind !== "comment") {
    let postHoldMs = POST_NARRATION_HOLD_MS;
    if (scene.spoiler || scene.is_spoiler) {
      const hasSpoilerMedia =
        !!scene.spoiler?.has_media_spoiler ||
        !!scene.spoiler_media ||
        !!scene.has_media;
      postHoldMs = hasSpoilerMedia ? 1300 : 900;
    }

    return (
      Math.max(
        narrationDurationMs + postHoldMs,
        config.minPostSceneMs + postHoldMs
      ) + memeLeadMs + trailingMemeMs
    );
  }

  const commentLength = getSpokenTextLength(getSceneNarrationText(scene));
  const mediaHoldMs = getCommentMediaExtraHoldMs(scene, commentLength);
  const isSpoilerComment = scene.spoiler || scene.is_spoiler;
  let spoilerExtraHoldMs = 0;
  if (isSpoilerComment) {
    const hasSpoilerMedia =
      !!scene.spoiler?.has_media_spoiler ||
      !!scene.spoiler_media ||
      !!scene.has_media;
    const spoilerRevealMs =
      scene.spoiler?.reveal_time_ms ?? Math.round(narrationDurationMs * 0.7);
    const postRevealNarrationMs = Math.max(
      0,
      narrationDurationMs - spoilerRevealMs
    );
    const minPostRevealHoldMs = hasSpoilerMedia ? 2600 : 1400;
    spoilerExtraHoldMs = Math.max(
      0,
      minPostRevealHoldMs - postRevealNarrationMs - COMMENT_NARRATION_HOLD_MS
    );
  }

  const effectiveMediaHoldMs = mediaHoldMs + spoilerExtraHoldMs;
  if (commentLength <= 28) {
    return (
      memeLeadMs +
      trailingMemeMs +
      Math.max(
        narrationDurationMs + COMMENT_NARRATION_HOLD_MS + effectiveMediaHoldMs,
        config.minCommentSceneMs + COMMENT_NARRATION_HOLD_MS + effectiveMediaHoldMs
      )
    );
  }

  if (commentLength <= 60) {
    return (
      memeLeadMs +
      Math.max(
        narrationDurationMs + COMMENT_NARRATION_HOLD_MS + effectiveMediaHoldMs,
        Math.max(1200, config.minCommentSceneMs - 200) +
          COMMENT_NARRATION_HOLD_MS +
          effectiveMediaHoldMs
      )
    );
  }

  if (commentLength <= 100) {
    return (
      memeLeadMs +
      Math.max(
        narrationDurationMs + COMMENT_NARRATION_HOLD_MS + effectiveMediaHoldMs,
        Math.max(1000, config.minCommentSceneMs - 400) +
          COMMENT_NARRATION_HOLD_MS +
          effectiveMediaHoldMs
      )
    );
  }

  return (
    memeLeadMs +
    narrationDurationMs +
    COMMENT_NARRATION_HOLD_MS +
    effectiveMediaHoldMs
  );
}

export function resolvePostVideoDurationWithinTotalMs(input: {
  captionDurationMs: number;
  sourceVideoDurationMs: number;
  totalDurationMs?: number;
}): number {
  const sourceVideoDurationMs = Math.max(
    500,
    Math.round(input.sourceVideoDurationMs)
  );
  const totalDurationMs = Number(input.totalDurationMs);
  if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0) {
    return sourceVideoDurationMs;
  }
  return Math.min(
    sourceVideoDurationMs,
    Math.max(500, Math.round(totalDurationMs - input.captionDurationMs))
  );
}

function getCommentMediaExtraHoldMs(
  scene: VideoDraftScene,
  commentLength: number
): number {
  if (scene.kind !== "comment" || !scene.has_media) {
    return 0;
  }

  if (commentLength <= 28) {
    return SHORT_COMMENT_MEDIA_EXTRA_HOLD_MS;
  }

  if (commentLength <= 60) {
    return MEDIUM_COMMENT_MEDIA_EXTRA_HOLD_MS;
  }

  return 0;
}

function getSceneTransitionGapMs(
  scene: VideoDraftScene,
  config: ToolConfig["video"],
  nextScene?: VideoDraftScene
): number {
  // Dialogue lines should flow as one conversation. Keep only a short,
  // natural pause between speakers instead of the normal scene transition.
  if (scene.dialogue_speaker) {
    return 180;
  }

  if (isVideoAfterCaption(scene, nextScene)) {
    return 0;
  }

  if (scene.kind !== "comment") {
    return config.sceneTransitionGapMs;
  }

  const commentLength = getSpokenTextLength(getSceneNarrationText(scene));
  if (commentLength <= 28) {
    return config.sceneTransitionGapMs;
  }

  if (commentLength <= 60) {
    return Math.min(config.sceneTransitionGapMs, 40);
  }

  if (commentLength <= 100) {
    return Math.min(config.sceneTransitionGapMs, 20);
  }

  return 0;
}

function isVideoAfterCaption(
  scene: VideoDraftScene,
  nextScene: VideoDraftScene | undefined
): boolean {
  return Boolean(
    (scene.kind === "post" ||
      (scene.kind === "comment" && !scene.dialogue_speaker)) &&
      nextScene?.kind === "post_video" &&
      nextScene.post_id === scene.post_id &&
      nextScene.comment_id === scene.comment_id
  );
}

function isFirstCommentScene(
  scenes: VideoDraftScene[],
  sceneIndex: number
): boolean {
  const scene = scenes[sceneIndex];
  if (scene?.kind !== "comment" || scene.dialogue_speaker) {
    return false;
  }

  // Dialogue lines belong to the post's visual hold. They must finish before
  // the first real comment transition/meme starts.
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

function getMemeTransitionDurationMs(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 1200;
  }

  return Math.min(2700, Math.max(1000, Math.round(value ?? 1200)));
}

function resolveMemeTransitionDurationMs({
  audioDurationSeconds,
  fallbackDurationMs,
  imageDurationSeconds,
  playbackSpeed,
  visualMode,
}: {
  audioDurationSeconds?: number | null;
  fallbackDurationMs?: number;
  imageDurationSeconds?: number | null;
  playbackSpeed?: number;
  visualMode?: MemeTransitionConfig["visualMode"];
}): number {
  if (
    visualMode === "sound_only" &&
    typeof audioDurationSeconds === "number" &&
    audioDurationSeconds > 0
  ) {
    return Math.max(1000, Math.round(audioDurationSeconds * 1000));
  }
  const imageDurationMs =
    typeof imageDurationSeconds === "number" && imageDurationSeconds > 0
      ? Math.round(imageDurationSeconds * 1000)
      : 0;
  if (imageDurationMs > 0) {
    const audioDurationMs =
      typeof audioDurationSeconds === "number" && audioDurationSeconds > 0
        ? Math.round(audioDurationSeconds * 1000)
        : 0;
    return Math.max(1000, imageDurationMs + audioDurationMs);
  }

  if (typeof audioDurationSeconds === "number" && audioDurationSeconds > 0) {
    const normalizedSpeed = Number.isFinite(playbackSpeed)
      ? Math.min(2, Math.max(0.5, playbackSpeed ?? 1))
      : 1;
    return getMemeTransitionDurationMs(
      Math.round((audioDurationSeconds * 1000) / normalizedSpeed)
    );
  }

  return getMemeTransitionDurationMs(fallbackDurationMs);
}

function getResolvedMemeTransitionDurationMs(
  transition: MemeTransitionConfig,
  fallbackDurationMs: number
): number {
  if (
    transition.visualMode === "sound_only" &&
    typeof transition.audio?.durationSeconds === "number" &&
    transition.audio.durationSeconds > 0
  ) {
    return Math.max(1000, Math.round(transition.audio.durationSeconds * 1000));
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
    return Math.max(1000, imageDurationMs + audioDurationMs);
  }

  const durationMs = transition.durationMs ?? fallbackDurationMs;
  return getMemeTransitionDurationMs(durationMs);
}

function getSpokenTextLength(text: string): number {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim().length;
}

function isAutoSpoilerNarration(
  narrationText: string,
  initialText: string,
  revealText: string
): boolean {
  const normalizedNarration = normalizeNarrationForCompare(narrationText);
  if (!normalizedNarration) return false;
  const initial = normalizeNarrationForCompare(initialText);
  const reveal = normalizeNarrationForCompare(revealText);
  if (!initial && !reveal) return false;
  return [
    `${initial} ${reveal}`.trim(),
    `${initial}\n${reveal}`.trim(),
  ].some((candidate) => candidate === normalizedNarration);
}

function normalizeNarrationForCompare(value: string): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function resolveSpoilerTextParts({
  initial,
  isSpoiler,
  reveal,
  revealMediaOnly,
  text,
}: {
  initial?: string;
  isSpoiler?: boolean;
  reveal?: string;
  revealMediaOnly?: boolean;
  text: string;
}): { initial: string; reveal: string } {
  const normalizedText = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  const normalizedInitial = String(initial ?? "").trim();
  const normalizedReveal = String(reveal ?? "").trim();
  const isUnsplitSpoiler =
    isSpoiler &&
    !revealMediaOnly &&
    !normalizedReveal &&
    (!normalizedInitial || normalizedInitial === normalizedText);

  if (!isUnsplitSpoiler) {
    return {
      initial: normalizedInitial || normalizedText,
      reveal: normalizedReveal,
    };
  }

  const lines = normalizedText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length >= 2) {
    const splitAt = Math.ceil(lines.length / 2);
    return {
      initial: lines.slice(0, splitAt).join("\n"),
      reveal: lines.slice(splitAt).join("\n"),
    };
  }

  const sentences = normalizedText.match(/[^.!?…]+[.!?…]?/g) ?? [];
  if (sentences.length >= 2) {
    const targetLength = normalizedText.length / 2;
    let splitAt = 1;
    let currentLength = sentences[0]?.length ?? 0;
    while (
      splitAt < sentences.length - 1 &&
      currentLength + (sentences[splitAt]?.length ?? 0) <= targetLength
    ) {
      currentLength += sentences[splitAt]?.length ?? 0;
      splitAt += 1;
    }
    return {
      initial: sentences.slice(0, splitAt).join("").trim(),
      reveal: sentences.slice(splitAt).join("").trim(),
    };
  }

  const words = normalizedText.split(/\s+/).filter(Boolean);
  if (words.length < 4) {
    return { initial: normalizedText, reveal: "" };
  }

  const splitAt = Math.ceil(words.length / 2);
  return {
    initial: words.slice(0, splitAt).join(" "),
    reveal: words.slice(splitAt).join(" "),
  };
}

function estimateDurationMs(text: string): number {
  return Math.max(3000, Math.ceil(String(text ?? "").length / 14) * 1000);
}

async function resolveNarrationAudioDurationMs(
  narration: NarrationAudio,
  baseDir: string
): Promise<number | null> {
  if (narration.merged_audio_path) {
    return probeDurationMs(resolve(baseDir, narration.merged_audio_path));
  }

  const chunkPaths = (narration.chunks ?? []).map((chunk) =>
    resolve(baseDir, chunk.audio_path)
  );
  if (chunkPaths.length === 0) {
    return null;
  }

  const durations = await Promise.all(
    chunkPaths.map((path) => probeDurationMs(path))
  );
  const totalDurationMs = durations.reduce<number>(
    (total, durationMs) => total + Math.max(0, durationMs ?? 0),
    0
  );
  return totalDurationMs > 0 ? totalDurationMs : null;
}

function isHealthyMergedDuration({
  chunkDurationMs,
  mergedDurationMs,
}: {
  chunkDurationMs: number;
  mergedDurationMs: number | null;
}): boolean {
  if (!mergedDurationMs || mergedDurationMs <= 0) {
    return false;
  }

  if (chunkDurationMs <= 0) {
    return true;
  }

  return mergedDurationMs >= Math.max(500, Math.round(chunkDurationMs * 0.85));
}

function normalizeAbbreviationRecord(
  abbreviations?: Record<string, string>
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(abbreviations ?? {})) {
    const key = String(rawKey ?? "")
      .trim()
      .toLowerCase();
    const value = String(rawValue ?? "").trim();
    if (!(key && value)) {
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function narrationFilesExist(
  narration: NarrationAudio,
  baseDir: string
): Promise<boolean> {
  const audioPaths = [
    ...(narration.chunks ?? []).map((chunk) => chunk.audio_path),
    narration.merged_audio_path,
  ].filter(Boolean);
  if (audioPaths.length === 0) {
    return false;
  }

  const checks = await Promise.all(
    audioPaths.map((path) => fileExists(resolve(baseDir, path)))
  );
  return checks.every(Boolean);
}

function sameVoiceProfile(
  current: VideoVoiceSettings | null | undefined,
  requested: VideoVoiceSettings
): boolean {
  if (!current) {
    return false;
  }

  return (
    (current.provider ?? "google_cloud") ===
      (requested.provider ?? "google_cloud") &&
    current.languageCode === requested.languageCode &&
    current.pitch === requested.pitch &&
    current.speakingRate === requested.speakingRate &&
    current.ssmlGender === requested.ssmlGender &&
    current.voiceName === requested.voiceName
  );
}

function createNarrationCacheKey({
  chunkMaxChars,
  chunkTargetChars,
  effectiveChunkMaxChars,
  effectiveChunkTargetChars,
  encoding,
  text,
  voiceProfile,
}: {
  chunkMaxChars: number;
  chunkTargetChars: number;
  effectiveChunkMaxChars: number;
  effectiveChunkTargetChars: number;
  encoding: ToolConfig["video"]["googleCloudAudioEncoding"];
  text: string;
  voiceProfile: VideoVoiceSettings;
}): string {
  const payload = JSON.stringify({
    chunkMaxChars,
    chunkTargetChars,
    effectiveChunkMaxChars,
    effectiveChunkTargetChars,
    encoding,
    provider: voiceProfile.provider,
    text,
    version: NARRATION_PIPELINE_VERSION,
    voice: {
      languageCode: voiceProfile.languageCode,
      pitch: voiceProfile.pitch,
      provider: voiceProfile.provider ?? "google_cloud",
      speakingRate: voiceProfile.speakingRate,
      ssmlGender: voiceProfile.ssmlGender,
      voiceName: voiceProfile.voiceName,
    },
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

function resolveNarrationChunkOptions(
  config: ToolConfig["video"],
  voiceProfile: VideoVoiceSettings
): { maxChars: number; targetChars: number } {
  if (voiceProfile.provider === "fpt_ai") {
    return {
      maxChars: Math.min(config.chunkMaxChars, 65),
      targetChars: Math.min(config.chunkTargetChars, 50),
    };
  }

  if (voiceProfile.provider === "vivibe") {
    return {
      maxChars: Math.min(Math.max(config.chunkMaxChars, 520), 900),
      targetChars: Math.min(Math.max(config.chunkTargetChars, 360), 700),
    };
  }

  return {
    maxChars: config.chunkMaxChars,
    targetChars: config.chunkTargetChars,
  };
}

function timestampId(): string {
  const date = new Date();
  const base = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  ]
    .map((part) => String(part).padStart(2, "0"))
    .join("");

  if (base === lastTimestampSeed) {
    timestampSequence += 1;
  } else {
    lastTimestampSeed = base;
    timestampSequence = 0;
  }

  return `${base}${String(timestampSequence).padStart(3, "0")}`;
}

function getNarrationDurationMs(
  narration: NarrationAudio,
  fallbackText: string
): number {
  if (narration.total_duration_ms > 0) {
    return narration.total_duration_ms;
  }

  const chunkDurationMs = (narration.chunks ?? []).reduce(
    (total, chunk) => total + Math.max(0, chunk.duration_ms || 0),
    0
  );
  if (chunkDurationMs > 0) {
    return chunkDurationMs;
  }

  return estimateDurationMs(fallbackText);
}

function normalizeVoiceVolume(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 1.9;
  }

  return Math.min(3, Math.max(0, value ?? 1.9));
}

function fileExtensionForEncoding(
  encoding: ToolConfig["video"]["googleCloudAudioEncoding"]
): string {
  switch (encoding) {
    case "LINEAR16":
      return "wav";
    case "OGG_OPUS":
      return "ogg";
    default:
      return "mp3";
  }
}

function audioFileExtensionForVoiceProvider(
  voiceProfile: VideoVoiceSettings,
  encoding: ToolConfig["video"]["googleCloudAudioEncoding"]
): string {
  return voiceProfile.provider === "fpt_ai"
    ? "mp3"
    : voiceProfile.provider === "vivibe"
      ? "wav"
      : fileExtensionForEncoding(encoding);
}

function shouldRetimeGeneratedAudio(voiceProfile: VideoVoiceSettings): boolean {
  return (
    shouldForceAudioNormalization(voiceProfile) ||
    Math.abs(resolvePostSynthesisPlaybackRate(voiceProfile) - 1) > 0.001
  );
}

function normalizePlaybackRate(rate: number | undefined): number {
  if (!Number.isFinite(rate)) {
    return 1;
  }

  return Math.min(2, Math.max(0.5, rate ?? 1));
}

function shouldForceAudioNormalization(
  voiceProfile: VideoVoiceSettings
): boolean {
  return voiceProfile.provider === "vivibe";
}

function resolvePostSynthesisPlaybackRate(
  voiceProfile: VideoVoiceSettings
): number {
  return normalizePlaybackRate(voiceProfile.speakingRate);
}

function appendNarrationPipelineTag(message: string): string {
  return `${message} ${NARRATION_PIPELINE_TAG}`.trim();
}

function isNarrationPipelineCompatible(narration: NarrationAudio): boolean {
  return String(narration.message ?? "").includes(NARRATION_PIPELINE_TAG);
}

function getVideoExtension(name: string, type: string): string {
  const fromName = name
    .split(".")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (
    fromName &&
    ["mp4", "mov", "webm", "mkv", "avi", "m4v"].includes(fromName)
  ) {
    return fromName;
  }
  if (type.includes("quicktime")) {
    return "mov";
  }
  if (type.includes("webm")) {
    return "webm";
  }
  if (type.includes("x-matroska")) {
    return "mkv";
  }
  if (type.includes("x-msvideo")) {
    return "avi";
  }
  if (type.includes("mp4") || type.includes("video/")) {
    return "mp4";
  }
  return "mp4";
}

function getAudioExtension(name: string, type: string): string {
  const fromName = name
    .split(".")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (
    fromName &&
    ["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(fromName)
  ) {
    return fromName;
  }
  if (type.includes("wav")) {
    return "wav";
  }
  if (type.includes("ogg")) {
    return "ogg";
  }
  if (type.includes("aac")) {
    return "aac";
  }
  if (type.includes("flac")) {
    return "flac";
  }
  if (type.includes("mp4") || type.includes("m4a")) {
    return "m4a";
  }
  return "mp3";
}

function getCommentAssetExtension(name: string, type: string): string {
  const fromName = name
    .split(".")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (
    fromName &&
    ["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "mov"].includes(
      fromName
    )
  ) {
    return fromName;
  }
  if (type.includes("png")) {
    return "png";
  }
  if (type.includes("webp")) {
    return "webp";
  }
  if (type.includes("gif")) {
    return "gif";
  }
  if (type.includes("jpeg") || type.includes("jpg")) {
    return "jpg";
  }
  if (type.includes("webm")) {
    return "webm";
  }
  if (type.includes("quicktime")) {
    return "mov";
  }
  if (type.includes("video")) {
    return "mp4";
  }
  return "png";
}

function getImageExtension(name: string, type: string): string {
  const fromName = name
    .split(".")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (
    fromName &&
    ["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(fromName)
  ) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }
  if (type.includes("bmp")) {
    return "bmp";
  }
  if (type.includes("png")) {
    return "png";
  }
  if (type.includes("webp")) {
    return "webp";
  }
  if (type.includes("gif")) {
    return "gif";
  }
  if (type.includes("jpeg") || type.includes("jpg")) {
    return "jpg";
  }
  return "png";
}

async function removeFlatImageBackground(
  bytes: Buffer,
  type: string
): Promise<{ bytes: Buffer; changed: boolean }> {
  if (!type.startsWith("image/") || type.includes("gif")) {
    return { bytes, changed: false };
  }

  const metadata = await sharp(bytes).metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.hasAlpha ||
    (metadata.pages ?? 1) > 1 ||
    !["bmp", "jpeg", "png", "tiff", "webp"].includes(metadata.format ?? "")
  ) {
    return { bytes, changed: false };
  }

  const decoded = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = decoded;
  if (info.channels < 4) {
    return { bytes, changed: false };
  }

  const width = info.width;
  const height = info.height;
  const pixelCount = width * height;
  const backgroundColors = [
    [0, 0],
    [Math.max(0, width - 1), 0],
    [0, Math.max(0, height - 1)],
    [Math.max(0, width - 1), Math.max(0, height - 1)],
  ].map(([x, y]) => {
    const safeX = x ?? 0;
    const safeY = y ?? 0;
    const offset = (safeY * width + safeX) * info.channels;
    return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0];
  });
  const isBackgroundPixel = (pixelIndex: number) => {
    const offset = pixelIndex * info.channels;
    const red = data[offset] ?? 0;
    const green = data[offset + 1] ?? 0;
    const blue = data[offset + 2] ?? 0;
    return backgroundColors.some(([backgroundRed, backgroundGreen, backgroundBlue]) => {
      const keyRed = backgroundRed ?? 0;
      const keyGreen = backgroundGreen ?? 0;
      const keyBlue = backgroundBlue ?? 0;
      const distance = Math.sqrt(
        (red - keyRed) ** 2 +
          (green - keyGreen) ** 2 +
          (blue - keyBlue) ** 2
      );
      return distance <= 42;
    });
  };

  const visited = new Uint8Array(pixelCount);
  const queue: number[] = [];
  const enqueue = (pixelIndex: number) => {
    if (visited[pixelIndex] || !isBackgroundPixel(pixelIndex)) {
      return;
    }
    visited[pixelIndex] = 1;
    queue.push(pixelIndex);
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pixelIndex = queue[cursor]!;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    if (x > 0) enqueue(pixelIndex - 1);
    if (x + 1 < width) enqueue(pixelIndex + 1);
    if (y > 0) enqueue(pixelIndex - width);
    if (y + 1 < height) enqueue(pixelIndex + width);
  }

  if (queue.length < pixelCount * 0.03 || queue.length > pixelCount * 0.92) {
    return { bytes, changed: false };
  }
  for (const pixelIndex of queue) {
    data[pixelIndex * info.channels + 3] = 0;
  }

  return {
    bytes: await sharp(data, {
      raw: { channels: info.channels, height, width },
    })
      .png()
      .toBuffer(),
    changed: true,
  };
}

function getMemeAssetExtension(name: string, type: string): string {
  const fromName = name
    .split(".")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const videoExtensions = ["mp4", "m4v", "webm", "mov", "avi", "mkv"];
  if (fromName && videoExtensions.includes(fromName)) {
    return fromName;
  }
  if (type.includes("webm")) {
    return "webm";
  }
  if (type.includes("quicktime")) {
    return "mov";
  }
  if (type.includes("x-msvideo")) {
    return "avi";
  }
  if (type.includes("x-matroska")) {
    return "mkv";
  }
  if (type.startsWith("video/") || type.includes("mp4")) {
    return "mp4";
  }
  return getImageExtension(name, type);
}

function isVideoMemeFile(name: string, type: string): boolean {
  return (
    type.startsWith("video/") ||
    /\.(?:mp4|m4v|webm|mov|avi|mkv)$/i.test(name)
  );
}

async function readUploadMetadata(metaPath: string): Promise<{
  label?: string;
  lastModified?: string;
  name?: string;
  sizeBytes?: number;
  type?: string;
  durationSeconds?: number | null;
  hash?: string;
  purpose?: "background" | "promotion";
} | null> {
  try {
    const raw = await readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw) as {
      label?: string;
      durationSeconds?: number | null;
      hash?: string;
      lastModified?: string;
      name?: string;
      purpose?: "background" | "promotion";
      sizeBytes?: number;
      type?: string;
    };
    return parsed;
  } catch {
    return null;
  }
}

function inferVideoMimeType(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "webm":
      return "video/webm";
    case "avi":
      return "video/x-msvideo";
    case "mkv":
      return "video/x-matroska";
    default:
      return "video/*";
  }
}

function inferAudioMimeType(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    case "m4a":
      return "audio/mp4";
    case "mp3":
    default:
      return "audio/mpeg";
  }
}

function inferImageMimeType(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "bmp":
      return "image/bmp";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "png":
    default:
      return "image/png";
  }
}

function normalizeBackgroundMusicVolume(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0.24;
  }
  return Math.min(1, Math.max(0, value ?? 0.24));
}

function normalizePromotionConfig(
  value: VideoPromotionConfig | null | undefined
): VideoPromotionConfig | null {
  if (!value) {
    return null;
  }

  const normalizeSlot = (
    slot: VideoPromotionConfig["midroll"]
  ): VideoPromotionConfig["midroll"] => {
    if (!(slot?.enabled && slot.video?.serverPath)) {
      return null;
    }
    return {
      enabled: true,
      fitMode: slot.fitMode === "contain" ? "contain" : "cover",
      video: slot.video,
      volume: Math.min(1, Math.max(0, Number(slot.volume ?? 1))),
    };
  };

  const midroll = normalizeSlot(value.midroll);
  const outro = midroll ? null : normalizeSlot(value.outro);
  if (!(midroll || outro)) {
    return null;
  }

  return {
    midroll,
    minMidrollContentSeconds: Math.min(
      300,
      Math.max(0, Number(value.minMidrollContentSeconds ?? 0))
    ),
    outro,
  };
}

function estimatePromotionDurationMs(
  promotion: VideoPromotionConfig | null,
  contentDurationMs: number,
  scenes: VideoDraftScene[]
): number {
  if (!promotion) {
    return 0;
  }

  const slotDurationMs = (
    slot: VideoPromotionConfig["midroll"] | VideoPromotionConfig["outro"]
  ) =>
    slot?.enabled
      ? Math.max(0, Number(slot.video?.durationSeconds ?? 0) * 1000)
      : 0;
  const hasMidrollBoundary = scenes.length >= 2;
  const midrollDurationMs =
    contentDurationMs > 0 && hasMidrollBoundary
      ? slotDurationMs(promotion.midroll)
      : 0;
  return midrollDurationMs + slotDurationMs(promotion.outro);
}

function ensureTrailingSep(value: string): string {
  return value.endsWith(sep) ? value : `${value}${sep}`;
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "video";
}

async function computeFileHash(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function dedupeUploadedFiles<T>(
  items: Array<T | null | undefined>,
  getId: (item: T) => string
): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    if (!item) {
      continue;
    }
    const id = getId(item);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push(item);
  }
  return deduped;
}

function safeFilename(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "video"
  );
}

function toUrlPath(value: string): string {
  return value.split(sep).join("/");
}

async function findFirstFileMatching(
  directoryPath: string,
  pattern: RegExp
): Promise<string | null> {
  try {
    const files = await readdir(directoryPath);
    const matched = files.find((file) => pattern.test(file));
    return matched ? resolve(directoryPath, matched) : null;
  } catch {
    return null;
  }
}

async function safeReadDirWithFileTypes(
  directoryPath: string
): Promise<Dirent[]> {
  try {
    return (await readdir(directoryPath, { withFileTypes: true })) as Dirent[];
  } catch {
    return [];
  }
}

function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = array[i] as T;
    array[i] = array[j] as T;
    array[j] = temp;
  }
  return array;
}
