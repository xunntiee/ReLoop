import { z } from "zod";
import type { ToolConfig } from "@tool-base/config/schema";
import { Hono } from "hono";
import { VideoDraftService } from "./service.js";
import type { VideoDraftPayload } from "./types.js";
import {
  mergeVivibeVoices,
  PREFERRED_VIVIBE_ADAM_VOICE_ID,
} from "./vivibe-voice-presets.js";
import { VivibeTtsClient } from "./vivibe-tts.js";
import { importAbbreviationDictionaryFromUrl } from "./abbreviation-dictionary.js";
import { suggestDialogueLineTexts } from "./tts-text-preprocessor.js";

export interface VideoRoutesOptions {
  config: ToolConfig;
  configPath: string;
  service?: VideoDraftService;
}

const uploadedVideoSchema = z
  .object({
    durationSeconds: z.number().nullable().optional(),
    lastModified: z.string(),
    mediaUrl: z.string().optional(),
    name: z.string().min(1),
    purpose: z.enum(["background", "promotion"]).optional(),
    serverPath: z.string().optional(),
    sizeBytes: z.number().nonnegative(),
    type: z.string().default("video/*"),
  })
  .nullable()
  .optional();

const uploadedAudioSchema = z
  .object({
    durationSeconds: z.number().nullable().optional(),
    lastModified: z.string(),
    mediaUrl: z.string().optional(),
    name: z.string().min(1),
    serverPath: z.string().optional(),
    sizeBytes: z.number().nonnegative(),
    type: z.string().default("audio/*"),
  })
  .nullable()
  .optional();

const uploadedAudioItemSchema = z.object({
  durationSeconds: z.number().nullable().optional(),
  lastModified: z.string(),
  mediaUrl: z.string().optional(),
  name: z.string().min(1),
  serverPath: z.string().optional(),
  sizeBytes: z.number().nonnegative(),
  type: z.string().default("audio/*"),
});

const uploadedImageSchema = z
  .object({
    durationSeconds: z.number().nullable().optional(),
    lastModified: z.string(),
    mediaUrl: z.string().optional(),
    name: z.string().min(1),
    serverPath: z.string().optional(),
    sizeBytes: z.number().nonnegative(),
    type: z.string().default("image/*"),
  })
  .nullable()
  .optional();

const uploadedImageItemSchema = z.object({
  durationSeconds: z.number().nullable().optional(),
  lastModified: z.string(),
  mediaUrl: z.string().optional(),
  name: z.string().min(1),
  serverPath: z.string().optional(),
  sizeBytes: z.number().nonnegative(),
  type: z.string().default("image/*"),
});

const thumbnailLayerSchema = z.object({
  height: z.number().min(1).max(100),
  locked: z.boolean().optional(),
  rotation: z.number().min(-180).max(180).optional(),
  visible: z.boolean().optional(),
  width: z.number().min(1).max(100),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
});

const mediaSchema = z.object({
  asset_path: z.string().default(""),
  duration_seconds: z.number().positive().max(120).optional(),
  height: z.number().default(0),
  order: z.number().default(0),
  remote_url: z.string().default(""),
  type: z.enum(["image", "video"]).default("image"),
  width: z.number().default(0),
});

const spoilerRevealRegionSchema = z.object({
  bbox: z.object({
    height: z.number().nonnegative(),
    width: z.number().nonnegative(),
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
  }),
  image_height: z.number().positive(),
  image_width: z.number().positive(),
  text: z.string(),
});

const commentSchema = z.object({
  avatar_asset_path: z.string().default(""),
  avatar_url: z.string().default(""),
  comment_id: z.string().default(""),
  created_at: z.string().default(""),
  display_name: z.string().default(""),
  like_count: z.number().default(0),
  media: z.array(mediaSchema).default([]),
  repost_count: z.number().default(0),
  reply_count: z.number().default(0),
  share_count: z.number().default(0),
  text: z.string().default(""),
  tts_text: z.string().optional(),
  username: z.string().default(""),
  video_duration_seconds: z.number().nullable().optional(),
  video_like_count: z.number().int().min(0).optional(),
  video_reply_count: z.number().int().min(0).optional(),
  video_share_count: z.number().int().min(0).optional(),
  is_spoiler: z.boolean().optional(),
  spoiler_initial_text: z.string().optional(),
  spoiler_reveal_text: z.string().optional(),
  spoiler_media: z.boolean().optional(),
  spoiler_style: z.enum(["blur", "hide"]).optional(),
  spoiler_reveal_regions: z.array(spoilerRevealRegionSchema).optional(),
  spoiler_reveal_media_only: z.boolean().optional(),
});

const postSchema = z.object({
  avatar_asset_path: z.string().default(""),
  avatar_url: z.string().default(""),
  created_at: z.string().default(""),
  display_name: z.string().default(""),
  language: z.string().default("vi"),
  like_count: z.number().default(0),
  media: z.array(mediaSchema).default([]),
  post_id: z.string().min(1),
  reply_count: z.number().default(0),
  repost_count: z.number().default(0),
  share_count: z.number().default(0),
  text: z.string().default(""),
  tts_text: z.string().optional(),
  top_comments: z.array(commentSchema).default([]),
  url: z.string().default(""),
  username: z.string().default(""),
  view_count: z.number().default(0),
  video_duration_seconds: z.number().nullable().optional(),
  is_spoiler: z.boolean().optional(),
  spoiler_initial_text: z.string().optional(),
  spoiler_reveal_text: z.string().optional(),
  spoiler_media: z.boolean().optional(),
  spoiler_style: z.enum(["blur", "hide"]).optional(),
  spoiler_reveal_regions: z.array(spoilerRevealRegionSchema).optional(),
  spoiler_reveal_media_only: z.boolean().optional(),
});

const dialogueLineSchema = z.object({
  bbox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  confidence: z.number().min(0).max(100),
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  speaker: z.enum(['A', 'B', 'unknown']),
  text: z.string(),
});

const dialogueSchema = z.object({
  confirmed: z.boolean().default(false),
  imagePath: z.string().min(1),
  lines: z.array(dialogueLineSchema).default([]),
  pauseMs: z.number().int().min(150).max(250).default(180),
  speakers: z.object({
    A: z.object({
      provider: z.enum(['google_cloud', 'fpt_ai', 'ausynclab', 'vivibe']),
      languageCode: z.string().min(2),
      pitch: z.number(),
      speakingRate: z.number(),
      ssmlGender: z.enum(['FEMALE', 'MALE', 'NEUTRAL', 'SSML_VOICE_GENDER_UNSPECIFIED']),
      voiceName: z.string().min(1),
    }),
    B: z.object({
      provider: z.enum(['google_cloud', 'fpt_ai', 'ausynclab', 'vivibe']),
      languageCode: z.string().min(2),
      pitch: z.number(),
      speakingRate: z.number(),
      ssmlGender: z.enum(['FEMALE', 'MALE', 'NEUTRAL', 'SSML_VOICE_GENDER_UNSPECIFIED']),
      voiceName: z.string().min(1),
    }),
  }),
});

const suggestTtsTextSchema = z.object({
  abbreviations: z.record(z.string(), z.string()).optional(),
  selectedPosts: z.array(postSchema).min(1),
  textProcessing: z
    .object({
      mode: z.enum(["off", "rules_only", "llm_assist"]).default("rules_only"),
    })
    .optional(),
});


const memeConfigSchema = z
  .object({
    audio: uploadedAudioSchema,
    audios: z.array(uploadedAudioItemSchema).optional(),
    durationMs: z.number().int().positive().optional(),
    emotion: z.string().min(1),
    label: z.string().trim().min(1).max(80).optional(),
    image: uploadedImageSchema,
    images: z.array(uploadedImageItemSchema).optional(),
    placement: z.enum(["after_comment", "media_reveal", "transition"]).optional(),
    visualMode: z.enum(["meme", "sound_only"]).optional(),
  })
  .nullable()
  .optional();
const suggestDialogueTextSchema = z.object({
  abbreviations: z.record(z.string(), z.string()).optional(),
  contextText: z.string().max(5000).optional(),
  lines: z.array(z.object({
    id: z.string().min(1).max(200),
    speaker: z.enum(["A", "B", "unknown"]),
    text: z.string().min(1).max(2000),
  })).min(1).max(50),
});

const createDraftSchema = z.object({
  dialogue: dialogueSchema.nullable().optional(),
  backgroundMusic: uploadedAudioSchema,
  backgroundMusicVolume: z.number().min(0).max(1).optional(),
  voiceVolume: z.number().min(0).max(3).optional(),
  cardTheme: z.enum(["light", "dark"]).optional(),
  commentVoiceMode: z.enum(["fixed", "emotion"]).default("fixed"),
  existingDraft: z.unknown().nullable().optional(),
  memeTransition: memeConfigSchema,
  memeBySceneId: z.record(z.string(), memeConfigSchema).nullable().optional(),
  outputPath: z.string().default(""),
  playPostVideoAfterCaption: z.boolean().default(false),
  promotion: z
    .object({
      midroll: z
        .object({
          enabled: z.boolean().default(false),
          fitMode: z.enum(["contain", "cover"]).default("cover"),
          video: uploadedVideoSchema,
          volume: z.number().min(0).max(1).default(1),
        })
        .nullable()
        .optional(),
      minMidrollContentSeconds: z.number().min(0).max(300).default(0),
      outro: z
        .object({
          enabled: z.boolean().default(false),
          fitMode: z.enum(["contain", "cover"]).default("cover"),
          video: uploadedVideoSchema,
          volume: z.number().min(0).max(1).default(1),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  thumbnailIntro: z
    .object({
      background: uploadedImageSchema,
      backgroundFit: z.enum(["cover", "contain"]).default("cover"),
      backgroundPositionX: z.number().min(0).max(100).default(50),
      backgroundPositionY: z.number().min(0).max(100).default(50),
      backgroundZoom: z.number().min(1).max(3).default(1),
      brandImage: uploadedImageSchema,
      brandImageSizePercent: z.number().int().min(30).max(100).default(92),
      watermarkSizePercent: z.number().int().min(6).max(30).default(19),
      channelName: z.string().trim().max(80).optional(),
      channelColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      channelFont: z
        .enum([
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
        ])
        .optional(),
      channelBold: z.boolean().optional(),
      channelItalic: z.boolean().optional(),
      channelFontSize: z.number().int().min(16).max(72).default(36),
      durationMs: z.number().int().min(100).max(5000),
      enabled: z.boolean().default(false),
      image: uploadedImageSchema,
      mode: z.enum(["automatic", "advanced"]).default("advanced"),
      subtitle: z.string().trim().max(120).optional(),
      title: z.string().max(160).default(""),
      titleOverridesByPostId: z.record(z.string(), z.string().max(160)).optional(),
      titleColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#741b1b"),
      titleBold: z.boolean().optional(),
      titleItalic: z.boolean().optional(),
      titleFont: z
        .enum([
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
        ])
        .default("poppins"),
      titleFontSize: z.number().int().min(28).max(120).default(42),
      watermark: uploadedImageSchema,
      watermarkPosition: z
        .enum(["top-left", "top-right", "bottom-left", "bottom-right", "center"])
        .default("top-right"),
      layout: z
        .object({
          brand: thumbnailLayerSchema.optional(),
          channel: thumbnailLayerSchema.optional(),
          layerOrder: z
            .array(z.enum(["title", "channel", "brand", "watermark"]))
            .max(4)
            .optional(),
          title: thumbnailLayerSchema.optional(),
          watermark: thumbnailLayerSchema.optional(),
        })
        .optional(),
    })
    .nullable()
    .optional(),
  selectedPosts: z.array(postSchema).min(1),
  uploadedVideo: uploadedVideoSchema,
  videoMode: z.string().default("single_post_recap"),
  voiceSettings: z
    .object({
      provider: z
        .enum(["google_cloud", "fpt_ai", "ausynclab", "vivibe"])
        .default("google_cloud"),
      languageCode: z.string().min(2),
      pitch: z.number(),
      speakingRate: z.number(),
      ssmlGender: z.enum([
        "FEMALE",
        "MALE",
        "NEUTRAL",
        "SSML_VOICE_GENDER_UNSPECIFIED",
      ]),
      voiceName: z.string().min(1),
    })
    .nullable()
    .optional(),
  abbreviations: z.record(z.string(), z.string()).optional(),
  textProcessing: z
    .object({
      mode: z.enum(["off", "rules_only", "llm_assist"]).default("rules_only"),
    })
    .optional(),
});

const abbreviationDictionarySchema = z.object({
  abbreviations: z.record(z.string(), z.string()).default({}),
});

const abbreviationImportUrlSchema = z.object({
  url: z.string().url(),
  merge: z.boolean().default(true),
});

const memeEmotionSchema = z.object({
  emotion: z.string().min(1),
});

const createMemeEmotionSchema = z.object({
  emotion: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(80),
});

export const createVideoRoutes = (options: VideoRoutesOptions): Hono => {
  const routes = new Hono();
  const service = options.service ?? new VideoDraftService(options);

  routes.get("/config", (c) =>
    c.json({
      video: {
        audioDir: options.config.video.audioDir,
        draftsDir: options.config.video.draftsDir,
        enabled: options.config.video.enabled,
        fptAiBaseUrl: options.config.video.fptAiBaseUrl,
        fptAiVoiceName: options.config.video.fptAiVoiceName,
        googleCloudAudioEncoding: options.config.video.googleCloudAudioEncoding,
        googleCloudLanguageCode: options.config.video.googleCloudLanguageCode,
        googleCloudVoiceName: options.config.video.googleCloudVoiceName,
        maxCommentsPerPost: options.config.video.maxCommentsPerPost,
        rendersDir: options.config.video.rendersDir,
        uploadsDir: options.config.video.uploadsDir,
        vivibeBaseUrl: options.config.video.vivibeBaseUrl,
      },
    })
  );

  routes.get("/abbreviations", async (c) => {
    try {
      return c.json(await service.getAbbreviationDictionary());
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.put("/abbreviations", async (c) => {
    try {
      const payload = abbreviationDictionarySchema.parse(await c.req.json());
      return c.json(await service.saveAbbreviationDictionary(payload.abbreviations));
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.post("/abbreviations/import-url", async (c) => {
    try {
      const payload = abbreviationImportUrlSchema.parse(await c.req.json());
      const imported = await importAbbreviationDictionaryFromUrl(payload.url);
      const current = payload.merge
        ? (await service.getAbbreviationDictionary()).abbreviations
        : {};
      return c.json(await service.saveAbbreviationDictionary({ ...current, ...imported }));
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.get("/vivibe/voices", async (c) => {
    try {
      const client = new VivibeTtsClient(options.config.video);
      const voices = mergeVivibeVoices(await client.listVoices()).sort((left, right) =>
        scoreVivibeVoiceForList(right) - scoreVivibeVoiceForList(left)
      );
      return c.json({
        fetchedAt: new Date().toISOString(),
        total: voices.length,
        voices: voices.map((voice) => ({
          avatarUrl: voice.avatarUrl,
          previewUrl:
            voice.previewUrl ??
            voice.previewAudioUrl ??
            voice.audioUrl ??
            voice.sampleUrl ??
            voice.sampleAsset?.cdnUrl,
          previewText: voice.previewText,
          createdAt: voice.createdAt,
          description: voice.description,
          favorited: Boolean(voice.favorited),
          id: String(voice.id ?? "").trim(),
          isActive: Boolean(voice.isActive),
          isPublic: voice.isPublic !== false,
          isVerified: Boolean(voice.isVerified),
          model: voice.model,
          name: String(voice.name ?? "").trim() || String(voice.id ?? "").trim(),
          score: Number.isFinite(Number(voice.score)) ? Number(voice.score) : 0,
          slug: voice.slug,
          tags: Array.isArray(voice.tags) ? voice.tags : [],
        })),
      });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.post("/tts-suggestions", async (c) => {
    try {
      const payload = suggestTtsTextSchema.parse(await c.req.json());
      const selectedPosts = await service.suggestNarrationTexts({
        abbreviations: payload.abbreviations,
        selectedPosts: payload.selectedPosts as VideoDraftPayload["selectedPosts"],
        textProcessing: payload.textProcessing,
      });
      return c.json({ selectedPosts });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.post("/uploads", async (c) => {
    try {
      const form = await c.req.raw.formData();
      const file = form.get("file");
      if (!isUploadedFormFile(file)) {
        return c.json({ error: "Thiếu file video tải lên." }, 400);
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      const result = await service.saveUploadedVideo({
        bytes,
        displayName:
          String(form.get("displayName") ?? "").trim() ||
          String(form.get("name") ?? "").trim() ||
          file.name ||
          "background-video.mp4",
        lastModified:
          String(form.get("lastModified") ?? "").trim() ||
          new Date().toISOString(),
        originalName:
          String(form.get("originalName") ?? "").trim() ||
          file.name ||
          "background-video.mp4",
        purpose: "background",
        type:
          String(form.get("type") ?? "").trim() ||
          file.type ||
          "video/*",
      });
      return c.json({ video: result }, 201);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.post("/promotion-uploads", async (c) => {
    try {
      const form = await c.req.raw.formData();
      const file = form.get("file");
      if (!isUploadedFormFile(file)) {
        return c.json({ error: "Thiếu file video quảng bá tải lên." }, 400);
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      const result = await service.saveUploadedVideo({
        bytes,
        displayName:
          String(form.get("displayName") ?? "").trim() ||
          String(form.get("name") ?? "").trim() ||
          file.name ||
          "promotion-video.mp4",
        lastModified:
          String(form.get("lastModified") ?? "").trim() ||
          new Date().toISOString(),
        originalName:
          String(form.get("originalName") ?? "").trim() ||
          file.name ||
          "promotion-video.mp4",
        purpose: "promotion",
        type:
          String(form.get("type") ?? "").trim() ||
          file.type ||
          "video/*",
      });
      return c.json({ video: result }, 201);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.post("/music-uploads", async (c) => {
    try {
      const form = await c.req.raw.formData();
      const file = form.get("file");
      if (!isUploadedFormFile(file)) {
        return c.json({ error: "Thieu file nhac tai len." }, 400);
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      const result = await service.saveUploadedMusic({
        bytes,
        displayName:
          String(form.get("displayName") ?? "").trim() ||
          String(form.get("name") ?? "").trim() ||
          file.name ||
          "background-music.mp3",
        lastModified:
          String(form.get("lastModified") ?? "").trim() ||
          new Date().toISOString(),
        originalName:
          String(form.get("originalName") ?? "").trim() ||
          file.name ||
          "background-music.mp3",
        type:
          String(form.get("type") ?? "").trim() ||
          file.type ||
          "audio/*",
      });
      return c.json({ audio: result }, 201);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.get("/default-comment-avatar", async (c) => {
    try {
      const result = await service.getDefaultCommentAvatar();
      return c.json({ avatar: result });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400
      );
    }
  });

  routes.put("/default-comment-avatar", async (c) => {
    try {
      const form = await c.req.raw.formData();
      const file = form.get("file");
      if (!isUploadedFormFile(file)) {
        return c.json({ error: "Thieu file avatar de tai len." }, 400);
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      const result = await service.saveDefaultCommentAvatar({
        bytes,
        name:
          String(form.get("name") ?? "").trim() ||
          file.name ||
          "default-comment-avatar.jpg",
        type:
          String(form.get("type") ?? "").trim() ||
          file.type ||
          "image/*",
      });
      return c.json({ avatar: result }, 200);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400
      );
    }
  });

  routes.post("/comment-assets", async (c) => {
    try {
      const form = await c.req.raw.formData();
      const file = form.get("file");
      if (!isUploadedFormFile(file)) {
        return c.json({ error: "Thieu file asset cho comment." }, 400);
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      const result = await service.saveUploadedCommentAsset({
        bytes,
        lastModified:
          String(form.get("lastModified") ?? "").trim() ||
          new Date().toISOString(),
        name:
          String(form.get("name") ?? "").trim() ||
          file.name ||
          "comment-asset.png",
        type:
          String(form.get("type") ?? "").trim() ||
          file.type ||
          "image/*",
        removeBackground: String(form.get("removeBackground") ?? "") === "true",
      });
      return c.json({ asset: result }, 201);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.get("/uploads", async (c) => {
    try {
      const videos = await service.listUploadedVideos("background");
      return c.json({ videos });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.get("/promotion-uploads", async (c) => {
    try {
      const videos = await service.listUploadedVideos("promotion");
      return c.json({ videos });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.get("/music-uploads", async (c) => {
    try {
      const tracks = await service.listUploadedMusic();
      return c.json({ tracks });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.get("/meme-library", async (c) => {
    try {
      return c.json({ items: await service.listMemeLibrary() });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.patch("/meme-library/emotion", async (c) => {
    try {
      const payload = z
        .object({
          emotion: z.string().trim().min(1),
          label: z.string().trim().min(1).max(80),
        })
        .parse(await readJsonBody(c.req));
      const label = await service.updateMemeEmotionLabel(
        payload.emotion,
        payload.label
      );
      return c.json({ emotion: payload.emotion, label });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400
      );
    }
  });

  routes.post("/meme-library/emotion", async (c) => {
    try {
      const payload = createMemeEmotionSchema.parse(await readJsonBody(c.req));
      return c.json(
        await service.createMemeEmotion(payload.emotion, payload.label),
        201
      );
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400
      );
    }
  });

  routes.delete("/meme-library/emotion", async (c) => {
    try {
      const { emotion } = memeEmotionSchema.parse({
        emotion: String(c.req.query("emotion") ?? "").trim(),
      });
      await service.deleteMemeEmotion(emotion);
      return c.json({ ok: true });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400
      );
    }
  });

  routes.post("/meme-library/image", async (c) => {
    try {
      const form = await c.req.raw.formData();
      const file = form.get("file");
      if (!isUploadedFormFile(file)) {
        return c.json({ error: "Thieu file anh meme tai len." }, 400);
      }

      const { emotion } = memeEmotionSchema.parse({
        emotion: String(form.get("emotion") ?? "").trim(),
      });
      const bytes = Buffer.from(await file.arrayBuffer());
      const image = await service.saveMemeImage({
        bytes,
        emotion,
        lastModified:
          String(form.get("lastModified") ?? "").trim() ||
          new Date().toISOString(),
        name: String(form.get("name") ?? "").trim() || file.name || "meme-image.png",
        type: String(form.get("type") ?? "").trim() || file.type || "image/*",
      });
      return c.json({ image }, 201);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.post("/meme-library/audio", async (c) => {
    try {
      const form = await c.req.raw.formData();
      const file = form.get("file");
      if (!isUploadedFormFile(file)) {
        return c.json({ error: "Thieu file sound meme tai len." }, 400);
      }

      const { emotion } = memeEmotionSchema.parse({
        emotion: String(form.get("emotion") ?? "").trim(),
      });
      const bytes = Buffer.from(await file.arrayBuffer());
      const audio = await service.saveMemeAudio({
        bytes,
        emotion,
        lastModified:
          String(form.get("lastModified") ?? "").trim() ||
          new Date().toISOString(),
        name: String(form.get("name") ?? "").trim() || file.name || "meme-sound.mp3",
        type: String(form.get("type") ?? "").trim() || file.type || "audio/*",
      });
      return c.json({ audio }, 201);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.get("/render-jobs", async (c) =>
    c.json({
      jobs: await service.listRenderJobs(),
    })
  );

  routes.delete("/uploads", async (c) => {
    try {
      const serverPath = String(c.req.query("path") ?? "").trim();
      await service.deleteUploadedVideo(serverPath);
      return c.json({ ok: true });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.delete("/promotion-uploads", async (c) => {
    try {
      const serverPath = String(c.req.query("path") ?? "").trim();
      await service.deleteUploadedVideo(serverPath);
      return c.json({ ok: true });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.delete("/music-uploads", async (c) => {
    try {
      const serverPath = String(c.req.query("path") ?? "").trim();
      await service.deleteUploadedMusic(serverPath);
      return c.json({ ok: true });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.delete("/meme-library/image", async (c) => {
    try {
      const { emotion } = memeEmotionSchema.parse({
        emotion: String(c.req.query("emotion") ?? "").trim(),
      });
      await service.deleteMemeImage(
        emotion,
        String(c.req.query("path") ?? "").trim() || undefined
      );
      return c.json({ ok: true });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.delete("/meme-library/audio", async (c) => {
    try {
      const { emotion } = memeEmotionSchema.parse({
        emotion: String(c.req.query("emotion") ?? "").trim(),
      });
      await service.deleteMemeAudio(
        emotion,
        String(c.req.query("path") ?? "").trim() || undefined
      );
      return c.json({ ok: true });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.post("/projects", async (c) => {
    const parsed = createDraftSchema.safeParse(await readJsonBody(c.req));
    if (!parsed.success) {
      return c.json(
        {
          error: "Payload lưu dự án video không hợp lệ.",
          issues: parsed.error.issues,
        },
        400
      );
    }

    try {
      const result = await service.createProjectDraft(
        toVideoDraftPayload(parsed.data)
      );
      return c.json(result, 201);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.post("/voices", async (c) => {
    const parsed = createDraftSchema.safeParse(await readJsonBody(c.req));
    if (!parsed.success) {
      return c.json(
        {
          error: "Payload tạo voice không hợp lệ.",
          issues: parsed.error.issues,
        },
        400
      );
    }

    try {
      const result = await service.createVoiceDraft(
        toVideoDraftPayload(parsed.data)
      );
      return c.json(result, 201);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.post("/render", async (c) => {
    const parsed = createDraftSchema.safeParse(await readJsonBody(c.req));
    if (!parsed.success) {
      return c.json(
        {
          error: "Payload render video không hợp lệ.",
          issues: parsed.error.issues,
        },
        400
      );
    }

    try {
      const result = await service.queueRenderVideo(
        toVideoDraftPayload(parsed.data)
      );
      return c.json(result, 202);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.post('/ocr-dialogue', async (c) => {
    const parsed = z.object({ imagePath: z.string().min(1) }).safeParse(await readJsonBody(c.req));
    if (!parsed.success) return c.json({ error: 'Đường dẫn ảnh OCR không hợp lệ.' }, 400);
    try {
      const result = await ocrDialogueImage({
        baseDir: dirname(options.configPath),
        config: options.config,
        imagePath: parsed.data.imagePath,
      });
      return c.json(result, 200);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  routes.post("/dialogue-text-suggestions", async (c) => {
    try {
      const payload = suggestDialogueTextSchema.parse(await c.req.json());
      const stored = await service.getAbbreviationDictionary().catch(
        () => ({ abbreviations: {} as Record<string, string> }),
      );
      const lines = await suggestDialogueLineTexts({
        abbreviations: {
          ...stored.abbreviations,
          ...(payload.abbreviations ?? {}),
        },
        config: options.config.video,
        contextText: payload.contextText,
        lines: payload.lines,
      });
      return c.json({ lines });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  return routes;
};

function scoreVivibeVoiceForList(voice: {
  favorited?: boolean;
  id?: string;
  isVerified?: boolean;
  name?: string;
  score?: number;
  tags?: string[];
}): number {
  const voiceId = String(voice.id ?? "").trim();
  const voiceName = String(voice.name ?? "");
  const haystack = `${voiceName} ${voiceId} ${(voice.tags ?? []).join(" ")}`.toLowerCase();
  let score = Number.isFinite(Number(voice.score)) ? Number(voice.score) : 0;

  if (voiceId === PREFERRED_VIVIBE_ADAM_VOICE_ID) score += 100;
  if (/^\s*adam(?:\s|$)/i.test(voiceName)) score += 80;
  if (voice.isVerified) score += 500;
  if (voice.favorited) score += 250;
  if (/(tiktok|review|vlog|qu[aả]ng c[aá]o|tin t[uứ]c|k[eể] chuy[eệ]n)/.test(haystack)) score += 75;

  return score;
}

function toVideoDraftPayload(
  value: z.infer<typeof createDraftSchema>
): VideoDraftPayload {
  return {
    ...value,
    existingDraft: (value.existingDraft ?? null) as VideoDraftPayload["existingDraft"],
    memeBySceneId: (value.memeBySceneId ?? undefined) as VideoDraftPayload["memeBySceneId"],
    selectedPosts: value.selectedPosts as VideoDraftPayload["selectedPosts"],
  };
}

async function readJsonBody(request: {
  json: () => Promise<unknown>;
}): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function isUploadedFormFile(value: unknown): value is {
  arrayBuffer: () => Promise<ArrayBuffer>;
  name?: string;
  type?: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function"
  );
}
import { ocrDialogueImage } from './ocr-dialogue.js';
import { dirname } from 'node:path';
