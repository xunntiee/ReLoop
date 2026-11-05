import { z } from "zod";

const defaultCrawlConfig = {
  authStatePath: "storage/auth/default/threads.storage_state.json",
  assetDir: "data/assets/threads",
  baseUrl: "https://www.threads.com",
  browserChannel: "chrome",
  cacheTtlMinutes: 1440,
  crawlAssets: true,
  defaultConfigPath: "",
  delayMs: 150,
  downloadAvatars: true,
  downloadAssets: true,
  enabled: true,
  executablePath: "",
  headless: true,
  homeScrollRounds: 0,
  includeCommentAssets: true,
  includeReplies: true,
  includeAuthorReplies: true,
  includeHomeFeed: false,
  commerceExcludedKeywords: [],
  excludeCommerceContentByDefault: false,
  excludePostsWithLinksByDefault: false,
  globalExcludedKeywords: [],
  maxCandidateLinks: 18,
  maxCollectedPostsPerTopic: 8,
  maxConcurrency: 1,
  maxMediaPerComment: 6,
  maxMediaPerPost: 4,
  maxReplyDepth: 1,
  maxSearchQueriesPerTopic: 4,
  outputDir: "data/processed/viral_topics",
  commentScrollRounds: 1,
  postScrollRounds: 0,
  rawCachePath: "data/raw/threads_posts_cache.json",
  searchScrollRounds: 2,
  timeoutMs: 10_000,
  validatePostUrls: true,
};

const defaultVideoConfig = {
  audioDir: "data/processed/video_audio",
  abbreviationsCsvPath: "data/processed/video_dictionaries/abbreviations.csv",
  ausynclabApiKey: "",
  chunkMaxChars: 280,
  chunkTargetChars: 180,
  draftsDir: "data/processed/video_drafts",
  enabled: true,
  ffmpegPath: "",
  fptAiApiKey: "",
  fptAiBaseUrl: "https://api.fpt.ai/hmi/tts/v5",
  fptAiVoiceName: "banmai",
  googleCloudApiKey: "",
  googleCloudAudioEncoding: "MP3" as const,
  googleCloudBaseUrl: "https://texttospeech.googleapis.com/v1/text:synthesize",
  googleCloudLanguageCode: "vi-VN",
  googleCloudPitch: 0,
  googleCloudSpeakingRate: 1,
  googleCloudSsmlGender: "FEMALE" as const,
  googleCloudVoiceName: "vi-VN-Neural2-A",
  maxCommentsPerPost: 5,
  mergeGapMs: 180,
  minCommentSceneMs: 1500,
  minPostSceneMs: 2800,
  openAiApiKey: "",
  openAiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  openAiModel: "gemini-3.1-pro-preview",
  rendersDir: "data/processed/video_renders",
  sceneTransitionGapMs: 60,
  uploadsDir: "data/processed/video_uploads",
  vivibeApiKey: "",
  vivibeBaseUrl: "https://api.lucylab.io/json-rpc",
};

export const PORTAL_LICENSE_VERIFY_URL =
  "https://portal.monback.app/api/v1/license/verify";

const defaultLicenseConfig = {
  appName: "Post to Video Tool",
  enabled: true,
  odooDatabase: "",
  scope: "threads",
  verifyUrls: [PORTAL_LICENSE_VERIFY_URL] as string[],
  verifyUrl: PORTAL_LICENSE_VERIFY_URL,
};

const crawlConfigSchema = z.object({
  authStatePath: z.string().default(defaultCrawlConfig.authStatePath),
  assetDir: z.string().min(1).default(defaultCrawlConfig.assetDir),
  baseUrl: z.string().url().default(defaultCrawlConfig.baseUrl),
  browserChannel: z.string().default(defaultCrawlConfig.browserChannel),
  cacheTtlMinutes: z
    .number()
    .int()
    .min(0)
    .default(defaultCrawlConfig.cacheTtlMinutes),
  crawlAssets: z.boolean().default(defaultCrawlConfig.crawlAssets),
  defaultConfigPath: z.string().default(defaultCrawlConfig.defaultConfigPath),
  delayMs: z.number().int().min(0).default(defaultCrawlConfig.delayMs),
  downloadAvatars: z.boolean().default(defaultCrawlConfig.downloadAvatars),
  downloadAssets: z.boolean().default(defaultCrawlConfig.downloadAssets),
  enabled: z.boolean().default(defaultCrawlConfig.enabled),
  executablePath: z.string().default(defaultCrawlConfig.executablePath),
  headless: z.boolean().default(defaultCrawlConfig.headless),
  homeScrollRounds: z
    .number()
    .int()
    .min(0)
    .default(defaultCrawlConfig.homeScrollRounds),
  includeCommentAssets: z
    .boolean()
    .default(defaultCrawlConfig.includeCommentAssets),
  includeReplies: z.boolean().default(defaultCrawlConfig.includeReplies),
  includeAuthorReplies: z
    .boolean()
    .default(defaultCrawlConfig.includeAuthorReplies),
  includeHomeFeed: z.boolean().default(defaultCrawlConfig.includeHomeFeed),
  commerceExcludedKeywords: z
    .array(z.string())
    .default(defaultCrawlConfig.commerceExcludedKeywords),
  excludeCommerceContentByDefault: z
    .boolean()
    .default(defaultCrawlConfig.excludeCommerceContentByDefault),
  excludePostsWithLinksByDefault: z
    .boolean()
    .default(defaultCrawlConfig.excludePostsWithLinksByDefault),
  globalExcludedKeywords: z.array(z.string()).default(defaultCrawlConfig.globalExcludedKeywords),
  maxCandidateLinks: z
    .number()
    .int()
    .min(1)
    .default(defaultCrawlConfig.maxCandidateLinks),
  maxCollectedPostsPerTopic: z
    .number()
    .int()
    .min(0)
    .default(defaultCrawlConfig.maxCollectedPostsPerTopic),
  maxConcurrency: z
    .number()
    .int()
    .min(1)
    .default(defaultCrawlConfig.maxConcurrency),
  maxMediaPerComment: z
    .number()
    .int()
    .min(0)
    .default(defaultCrawlConfig.maxMediaPerComment),
  maxMediaPerPost: z
    .number()
    .int()
    .min(0)
    .default(defaultCrawlConfig.maxMediaPerPost),
  maxReplyDepth: z
    .number()
    .int()
    .min(1)
    .max(3)
    .default(defaultCrawlConfig.maxReplyDepth),
  maxSearchQueriesPerTopic: z
    .number()
    .int()
    .min(0)
    .default(defaultCrawlConfig.maxSearchQueriesPerTopic),
  outputDir: z.string().min(1).default(defaultCrawlConfig.outputDir),
  commentScrollRounds: z
    .number()
    .int()
    .min(0)
    .default(defaultCrawlConfig.commentScrollRounds),
  postScrollRounds: z
    .number()
    .int()
    .min(0)
    .default(defaultCrawlConfig.postScrollRounds),
  rawCachePath: z.string().min(1).default(defaultCrawlConfig.rawCachePath),
  searchScrollRounds: z
    .number()
    .int()
    .min(0)
    .default(defaultCrawlConfig.searchScrollRounds),
  timeoutMs: z.number().int().min(1_000).default(defaultCrawlConfig.timeoutMs),
  validatePostUrls: z.boolean().default(defaultCrawlConfig.validatePostUrls),
});

const videoConfigSchema = z.object({
  audioDir: z.string().min(1).default(defaultVideoConfig.audioDir),
  abbreviationsCsvPath: z
    .string()
    .min(1)
    .default(defaultVideoConfig.abbreviationsCsvPath),
  ausynclabApiKey: z.string().default(
    process.env.AUSYNCLAB_API_KEY ?? defaultVideoConfig.ausynclabApiKey
  ),
  chunkMaxChars: z
    .number()
    .int()
    .min(80)
    .default(defaultVideoConfig.chunkMaxChars),
  chunkTargetChars: z
    .number()
    .int()
    .min(60)
    .default(defaultVideoConfig.chunkTargetChars),
  draftsDir: z.string().min(1).default(defaultVideoConfig.draftsDir),
  enabled: z.boolean().default(defaultVideoConfig.enabled),
  ffmpegPath: z.string().default(defaultVideoConfig.ffmpegPath),
  fptAiApiKey: z.string().default(
    process.env.FPT_AI_TTS_API_KEY ?? defaultVideoConfig.fptAiApiKey
  ),
  fptAiBaseUrl: z.string().url().default(defaultVideoConfig.fptAiBaseUrl),
  fptAiVoiceName: z.string().default(defaultVideoConfig.fptAiVoiceName),
  googleCloudApiKey: z.string().default(
    process.env.GOOGLE_CLOUD_TTS_API_KEY ??
      process.env.GOOGLE_API_KEY ??
      defaultVideoConfig.googleCloudApiKey
  ),
  googleCloudAudioEncoding: z
    .enum(["MP3", "LINEAR16", "OGG_OPUS"])
    .default(defaultVideoConfig.googleCloudAudioEncoding),
  googleCloudBaseUrl: z
    .string()
    .url()
    .default(defaultVideoConfig.googleCloudBaseUrl),
  googleCloudLanguageCode: z
    .string()
    .min(2)
    .default(defaultVideoConfig.googleCloudLanguageCode),
  googleCloudPitch: z
    .number()
    .min(-20)
    .max(20)
    .default(defaultVideoConfig.googleCloudPitch),
  googleCloudSpeakingRate: z
    .number()
    .min(0.25)
    .max(2)
    .default(defaultVideoConfig.googleCloudSpeakingRate),
  googleCloudSsmlGender: z
    .enum(["SSML_VOICE_GENDER_UNSPECIFIED", "MALE", "FEMALE", "NEUTRAL"])
    .default(defaultVideoConfig.googleCloudSsmlGender),
  googleCloudVoiceName: z
    .string()
    .default(defaultVideoConfig.googleCloudVoiceName),
  maxCommentsPerPost: z
    .number()
    .int()
    .min(0)
    .default(defaultVideoConfig.maxCommentsPerPost),
  mergeGapMs: z
    .number()
    .int()
    .min(0)
    .default(defaultVideoConfig.mergeGapMs),
  minCommentSceneMs: z
    .number()
    .int()
    .min(500)
    .default(defaultVideoConfig.minCommentSceneMs),
  minPostSceneMs: z
    .number()
    .int()
    .min(500)
    .default(defaultVideoConfig.minPostSceneMs),
  openAiApiKey: z.string().default(
    process.env.OPENAI_API_KEY ?? defaultVideoConfig.openAiApiKey
  ),
  openAiBaseUrl: z.string().url().default(defaultVideoConfig.openAiBaseUrl),
  openAiModel: z.string().min(1).default(defaultVideoConfig.openAiModel),
  rendersDir: z.string().min(1).default(defaultVideoConfig.rendersDir),
  sceneTransitionGapMs: z
    .number()
    .int()
    .min(0)
    .default(defaultVideoConfig.sceneTransitionGapMs),
  uploadsDir: z.string().min(1).default(defaultVideoConfig.uploadsDir),
  vivibeApiKey: z.string().default(
    process.env.VIVIBE_API_KEY ?? defaultVideoConfig.vivibeApiKey
  ),
  vivibeBaseUrl: z.string().url().default(defaultVideoConfig.vivibeBaseUrl),
});

const licenseConfigSchema = z.object({
  appName: z.string().min(1).default(defaultLicenseConfig.appName),
  enabled: z.boolean().default(defaultLicenseConfig.enabled),
  odooDatabase: z.string().default(defaultLicenseConfig.odooDatabase),
  scope: z.string().default(defaultLicenseConfig.scope),
  verifyUrls: z
    .array(z.string().url())
    .max(20)
    .default(defaultLicenseConfig.verifyUrls),
  verifyUrl: z.string().url().default(defaultLicenseConfig.verifyUrl),
});

const defaultFeaturesConfig = {
  sampleApi: true,
};

const defaultServerConfig = {
  name: "tool-base",
  port: 34577,
};

const defaultWebConfig = {
  title: "Tool Base",
};

export const toolConfigSchema = z.object({
  crawl: crawlConfigSchema.default(defaultCrawlConfig),
  features: z
    .object({
      sampleApi: z.boolean().default(defaultFeaturesConfig.sampleApi),
    })
    .default(defaultFeaturesConfig),
  license: licenseConfigSchema.default(defaultLicenseConfig),
  server: z
    .object({
      name: z.string().min(1).default(defaultServerConfig.name),
      port: z
        .number()
        .int()
        .min(1)
        .max(65_535)
        .default(defaultServerConfig.port),
    })
    .default(defaultServerConfig),
  video: videoConfigSchema.default(defaultVideoConfig),
  web: z
    .object({
      title: z.string().min(1).default(defaultWebConfig.title),
    })
    .default(defaultWebConfig),
});

export type ToolConfig = z.infer<typeof toolConfigSchema>;

export interface PublicToolConfig {
  crawl: ToolConfig["crawl"];
  features: ToolConfig["features"];
  license: Omit<ToolConfig["license"], "odooDatabase">;
  server: Pick<ToolConfig["server"], "name" | "port">;
  video: Omit<
    ToolConfig["video"],
    | "googleCloudApiKey"
    | "fptAiApiKey"
    | "ausynclabApiKey"
    | "vivibeApiKey"
    | "openAiApiKey"
  >;
  web: ToolConfig["web"];
}

export const toPublicToolConfig = (config: ToolConfig): PublicToolConfig => ({
  crawl: config.crawl,
  features: config.features,
  license: {
    appName: config.license.appName,
    enabled: config.license.enabled,
    scope: config.license.scope,
    verifyUrls: config.license.verifyUrls,
    verifyUrl: config.license.verifyUrl,
  },
  server: {
    name: config.server.name,
    port: config.server.port,
  },
  video: {
    audioDir: config.video.audioDir,
    abbreviationsCsvPath: config.video.abbreviationsCsvPath,
    chunkMaxChars: config.video.chunkMaxChars,
    chunkTargetChars: config.video.chunkTargetChars,
    draftsDir: config.video.draftsDir,
    enabled: config.video.enabled,
    ffmpegPath: config.video.ffmpegPath,
    fptAiBaseUrl: config.video.fptAiBaseUrl,
    fptAiVoiceName: config.video.fptAiVoiceName,
    googleCloudAudioEncoding: config.video.googleCloudAudioEncoding,
    googleCloudBaseUrl: config.video.googleCloudBaseUrl,
    googleCloudLanguageCode: config.video.googleCloudLanguageCode,
    googleCloudPitch: config.video.googleCloudPitch,
    googleCloudSpeakingRate: config.video.googleCloudSpeakingRate,
    googleCloudSsmlGender: config.video.googleCloudSsmlGender,
    googleCloudVoiceName: config.video.googleCloudVoiceName,
    maxCommentsPerPost: config.video.maxCommentsPerPost,
    mergeGapMs: config.video.mergeGapMs,
    minCommentSceneMs: config.video.minCommentSceneMs,
    minPostSceneMs: config.video.minPostSceneMs,
    openAiBaseUrl: config.video.openAiBaseUrl,
    openAiModel: config.video.openAiModel,
    rendersDir: config.video.rendersDir,
    sceneTransitionGapMs: config.video.sceneTransitionGapMs,
    uploadsDir: config.video.uploadsDir,
    vivibeBaseUrl: config.video.vivibeBaseUrl,
  },
  web: config.web,
});
