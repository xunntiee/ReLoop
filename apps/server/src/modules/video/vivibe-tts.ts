import { randomUUID } from "node:crypto";
import type { ToolConfig } from "@tool-base/config/schema";
import type {
  TextToSpeechProvider,
  TtsSynthesisResult,
} from "./tts-provider.js";
import type { VideoVoiceSettings } from "./types.js";

const EXPORT_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_DELAY_MS = 2000;

export interface VivibeVoiceItem {
  avatarUrl?: string;
  audioUrl?: string;
  createdAt?: string;
  description?: string;
  favorited?: boolean;
  id?: string;
  isActive?: boolean;
  isPublic?: boolean;
  isVerified?: boolean;
  model?: string;
  name?: string;
  previewText?: string;
  previewAudioUrl?: string;
  previewUrl?: string;
  sampleUrl?: string;
  sampleAsset?: {
    cdnUrl?: string;
  } | null;
  language?: string;
  languageCode?: string;
  locale?: string;
  score?: number;
  slug?: string;
  tags?: string[];
}

interface VivibeVoicePage {
  items?: VivibeVoiceItem[];
  total?: number;
}

const VOICE_PAGE_SIZE = 100;
const MAX_VOICE_PAGES = 100;

interface VivibeRpcResponse<TResult> {
  error?: {
    code?: number;
    message?: string;
  };
  result?: TResult;
}

let vivibeMutex: Promise<unknown> = Promise.resolve();

async function runSequentialVivibe<T>(task: () => Promise<T>): Promise<T> {
  const previous = vivibeMutex;
  let release: () => void = () => {};
  vivibeMutex = new Promise<void>((resolve) => {
    release = resolve;
  });

  try {
    await previous.catch(() => {});
    return await task();
  } finally {
    release();
  }
}

export class VivibeTtsClient implements TextToSpeechProvider {
  readonly providerId = "vivibe";

  constructor(private readonly config: ToolConfig["video"]) {}

  async listVoices(): Promise<VivibeVoiceItem[]> {
    const apiKey = this.requireApiKey();
    const userVoices = await this.listVoiceCollection(apiKey, "getUserVoices");
    let communityVoices: VivibeVoiceItem[] = [];
    try {
      // Vivibe's web app exposes this read-only RPC for the public voice library.
      // Keep it optional so older API deployments still return account voices.
      communityVoices = await this.listVoiceCollection(apiKey, "getCommunityVoices", {
        sortBy: "score",
      });
    } catch (error) {
      console.warn("[vivibe] Community voice library unavailable:", error);
    }

    const seen = new Set<string>();
    return [...userVoices, ...communityVoices]
      .filter((voice) => {
        const id = String(voice.id ?? "").trim();
        if (!id || seen.has(id)) {
          return false;
        }
        seen.add(id);
        return true;
      })
      .map((voice) => ({
        ...voice,
        id: String(voice.id).trim(),
        name: String(voice.name ?? voice.id).trim(),
      }));
  }

  private async listVoiceCollection(
    apiKey: string,
    method: "getCommunityVoices" | "getUserVoices",
    extraInput: Record<string, unknown> = {}
  ): Promise<VivibeVoiceItem[]> {
    const voices: VivibeVoiceItem[] = [];
    let total: number | undefined;

    for (let page = 1; page <= MAX_VOICE_PAGES; page += 1) {
      const payload = await this.callRpc<VivibeVoicePage>(apiKey, {
        input: {
          ...extraInput,
          limit: VOICE_PAGE_SIZE,
          page,
        },
        mappings: {
          items: {
            avatar: 1,
            sampleAsset: 1,
          },
        },
        method,
      });
      const items = Array.isArray(payload.items) ? payload.items : [];
      total = Number.isFinite(Number(payload.total))
        ? Number(payload.total)
        : total;
      voices.push(...items);

      if (
        items.length === 0 ||
        items.length < VOICE_PAGE_SIZE ||
        (total !== undefined && voices.length >= total)
      ) {
        break;
      }
    }

    return voices.filter((voice) => String(voice.id ?? "").trim());
  }

  async synthesize(
    text: string,
    voiceSettings?: VideoVoiceSettings | null
  ): Promise<TtsSynthesisResult> {
    return runSequentialVivibe(async () => {
      const apiKey = this.requireApiKey();
      const userVoiceId = String(voiceSettings?.voiceName ?? "").trim();
      if (!userVoiceId) {
        throw new Error("ViVibe cần voiceId trong phần chọn giọng.");
      }

      let created: {
        blockCount?: number;
        characterCount?: number;
        projectExportId?: string;
      } | undefined;

      const CREATE_ATTEMPTS = 25;
      for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
        try {
          created = await this.callRpc<{
            blockCount?: number;
            characterCount?: number;
            projectExportId?: string;
          }>(apiKey, {
            input: {
              // Keep ViVibe at native speed; final timing is normalized locally
              // so preview and export stay exact even if provider speed is approximate.
              speed: 1,
              text,
              userVoiceId,
            },
            method: "ttsLongText",
          });
          break;
        } catch (error) {
          const message = String(
            error instanceof Error ? error.message : error
          ).toLowerCase();
          if (
            (message.includes("export in progress") ||
              message.includes("in progress") ||
              message.includes("please wait")) &&
            attempt < CREATE_ATTEMPTS - 1
          ) {
            await sleep(2000);
            continue;
          }
          throw error;
        }
      }

      const exportId = String(created?.projectExportId ?? "").trim();
      if (!exportId) {
        throw new Error("ViVibe không trả về projectExportId.");
      }

      const audioUrl = await this.waitForAudioUrl(apiKey, exportId);
      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        throw new Error(
          `Không tải được audio ViVibe: ${audioResponse.status} - ${audioUrl}`
        );
      }

      return {
        audioBytes: Buffer.from(await audioResponse.arrayBuffer()),
        message: "Scene audio generated with ViVibe.",
        provider: "vivibe",
        requestId: exportId || randomUUID(),
        status: "ready",
      };
    });
  }

  private async waitForAudioUrl(
    apiKey: string,
    projectExportId: string
  ): Promise<string> {
    let lastState = "pending";
    const deadline = Date.now() + EXPORT_WAIT_TIMEOUT_MS;
    let attempt = 0;

    while (Date.now() < deadline) {
      if (attempt > 0) {
        await sleep(POLL_DELAY_MS);
      }

      let payload: { jobId?: string; state?: string; url?: string };
      try {
        payload = await this.callRpc<{
          jobId?: string;
          state?: string;
          url?: string;
        }>(apiKey, {
          input: { projectExportId },
          method: "getExportStatus",
        });
      } catch (error) {
        if (isRetryableVivibePollingError(error)) {
          lastState = "status check temporarily unavailable";
          attempt += 1;
          continue;
        }
        throw error;
      }

      const state = String(payload.state ?? "").trim().toLowerCase();
      if (state) {
        lastState = state;
      }

      if (state === "completed") {
        const audioUrl = String(payload.url ?? "").trim();
        if (!audioUrl) {
          throw new Error(
            `ViVibe báo completed me nhưng không có url cho export ${projectExportId}.`
          );
        }
        return audioUrl;
      }

      if (isFailedVivibeExportState(state)) {
        throw new Error(`ViVibe export ${projectExportId} thất bại.`);
      }

      attempt += 1;
    }

    throw new Error(
      `ViVibe vẫn chưa xuất audio sau 5 phút cho export ${projectExportId}. Last state: ${lastState}.`
    );
  }

  private requireApiKey(): string {
    const apiKey = this.config.vivibeApiKey.trim();
    if (!apiKey) {
      throw new Error(
        "Missing ViVibe API key. Set VIVIBE_API_KEY or config.video.vivibeApiKey."
      );
    }
    return apiKey;
  }

  private async callRpc<TResult>(
    apiKey: string,
    body: {
      input: Record<string, unknown>;
      mappings?: Record<string, unknown>;
      method: string;
    }
  ): Promise<TResult> {
    const response = await fetch(this.config.vivibeBaseUrl, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const payload = (await response.json()) as VivibeRpcResponse<TResult>;

    if (!response.ok) {
      throw new Error(
        payload.error?.message ||
          `ViVibe request failed: ${response.status}`
      );
    }

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    if (!payload.result) {
      throw new Error("ViVibe không trả về result hợp lệ.");
    }

    return payload.result;
  }
}

function isFailedVivibeExportState(state: string): boolean {
  return ["failed", "error", "cancelled", "canceled", "expired"].includes(state);
}

function isRetryableVivibePollingError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return /(?:fetch failed|network|socket|connection|econnreset|timed? out|\b(?:408|425|429|500|502|503|504)\b)/.test(
    message,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
