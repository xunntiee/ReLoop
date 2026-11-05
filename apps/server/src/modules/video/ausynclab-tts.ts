import type { ToolConfig } from "@tool-base/config/schema";
import type {
  TextToSpeechProvider,
  TtsSynthesisResult,
} from "./tts-provider.js";
import type { VideoVoiceSettings } from "./types.js";

const AUSYNCLAB_BASE_URL = "https://api.ausynclab.io/api/v1/speech";
const DEFAULT_VOICE_ID = 1927315;
const DEFAULT_MODEL_NAME = "myna-1-turbo";
const AUDIO_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_DELAY_MS = 2000;
const LOOKUP_ATTEMPTS = 8;
const LOOKUP_DELAY_MS = 1500;
const RATE_LIMIT_DELAY_MS = 1100;

interface AuSyncLabAudioDetail {
  audio_url?: string;
  created_at?: string;
  id?: number | string;
  message?: string | null;
  name?: string;
  speed?: number;
  state?: string;
  status?: string | null;
  voice_id?: number | string;
}

export class AuSyncLabTtsClient implements TextToSpeechProvider {
  readonly providerId = "ausynclab";

  constructor(private readonly config: ToolConfig["video"]) {}

  async synthesize(
    text: string,
    voiceSettings?: VideoVoiceSettings | null
  ): Promise<TtsSynthesisResult> {
    const apiKey = this.config.ausynclabApiKey?.trim();
    if (!apiKey) {
      throw new Error("AuSyncLab API key chua duoc cau hinh.");
    }

    const voiceId = normalizeVoiceId(voiceSettings?.voiceName);
    const uniqueAudioName = `vgen-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

    await rateLimitSleep();

    const createResponse = await fetch(`${AUSYNCLAB_BASE_URL}/text-to-speech`, {
      body: JSON.stringify({
        audio_name: uniqueAudioName,
        language: toAuSyncLabLanguage(voiceSettings?.languageCode),
        model_name: DEFAULT_MODEL_NAME,
        // Keep provider output at neutral speed; final timing is normalized locally.
        speed: 1,
        text,
        voice_id: voiceId,
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      method: "POST",
    });

    if (!createResponse.ok) {
      throw new Error(
        `Loi tu AuSyncLab API: ${createResponse.status} - ${await readResponseError(
          createResponse
        )}`
      );
    }

    const createdPayload = (await createResponse.json()) as {
      message?: string | null;
      result?: { audio_id?: number | string } | null;
      status?: number | null;
    };

    const directAudioId = String(createdPayload.result?.audio_id ?? "").trim();
    const audioId =
      directAudioId ||
      (await this.findNewAudioIdAfterCreate({
        apiKey,
        uniqueAudioName,
      }));

    if (!audioId) {
      throw new Error(
        `AuSyncLab tao job nhung khong tra ve audio_id, va khong tim thay audio moi trong danh sach. Response: ${JSON.stringify(
          createdPayload
        )}`
      );
    }

    const audioDetail = await this.waitForAudioReady(audioId, apiKey);
    const audioUrl = String(audioDetail.audio_url ?? "").trim();
    if (!audioUrl) {
      throw new Error(
        `AuSyncLab không trả về audio_url cho audio_id ${audioId}.`
      );
    }

    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(
        `Không tải được audio từ AuSyncLab: ${audioResponse.status} - ${audioUrl}`
      );
    }

    return {
      audioBytes: Buffer.from(await audioResponse.arrayBuffer()),
      message: "Scene audio generated with AuSyncLab.",
      provider: "ausynclab",
      requestId: audioId,
      status: "ready",
    };
  }

  private async findNewAudioIdAfterCreate({
    apiKey,
    uniqueAudioName,
  }: {
    apiKey: string;
    uniqueAudioName: string;
  }): Promise<string> {
    for (let attempt = 0; attempt < LOOKUP_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await sleep(LOOKUP_DELAY_MS);
      }

      const list = await this.fetchAudioList(apiKey);
      const match = list.find((item) => item.name === uniqueAudioName);

      if (match?.id !== undefined && match.id !== null) {
        return String(match.id).trim();
      }
    }

    return "";
  }

  private async fetchAudioList(apiKey: string): Promise<AuSyncLabAudioDetail[]> {
    await rateLimitSleep();
    const response = await fetch(AUSYNCLAB_BASE_URL, {
      headers: {
        Accept: "application/json",
        "X-API-Key": apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Khong lay duoc danh sach audio AuSyncLab: ${response.status} - ${await readResponseError(
          response
        )}`
      );
    }

    const payload = (await response.json()) as {
      result?: AuSyncLabAudioDetail[] | null;
    };
    return Array.isArray(payload.result) ? payload.result : [];
  }

  private async waitForAudioReady(
    audioId: string,
    apiKey: string
  ): Promise<AuSyncLabAudioDetail> {
    let lastKnownState = "PENDING";
    const deadline = Date.now() + AUDIO_WAIT_TIMEOUT_MS;
    let attempt = 0;

    while (Date.now() < deadline) {
      if (attempt > 0) {
        await sleep(POLL_DELAY_MS);
      }
      await rateLimitSleep();

      const response = await fetch(`${AUSYNCLAB_BASE_URL}/${audioId}`, {
        headers: {
          Accept: "application/json",
          "X-API-Key": apiKey,
        },
      });

      if (!response.ok) {
        if (response.status === 404 || isRetryablePollingStatus(response.status)) {
          attempt += 1;
          continue;
        }
        throw new Error(
          `Khong lay duoc trang thai AuSyncLab cho audio_id ${audioId}: ${response.status} - ${await readResponseError(
            response
          )}`
        );
      }

      const payload = (await response.json()) as {
        result?: AuSyncLabAudioDetail | null;
      };
      const detail = payload.result;
      if (!detail) {
        continue;
      }

      const state = normalizeState(detail);
      if (state) {
        lastKnownState = state;
      }

      if (isSucceededState(state) && detail.audio_url) {
        return detail;
      }

      if (isFailedState(state)) {
        throw new Error(
          `AuSyncLab TTS job that bai o trang thai ${state}: ${JSON.stringify(
            detail
          )}`
        );
      }

      attempt += 1;
    }

    throw new Error(
      `AuSyncLab vẫn chưa xuất audio sau 5 phút cho audio_id ${audioId}. Last state: ${lastKnownState}.`
    );
  }
}

function normalizeVoiceId(voiceName: string | undefined): number {
  const normalized = String(voiceName ?? "").trim();
  if (!normalized || normalized === "default") {
    return DEFAULT_VOICE_ID;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_VOICE_ID;
}

function toAuSyncLabLanguage(languageCode: string | undefined): string {
  const normalized = String(languageCode ?? "").trim().toLowerCase();
  if (!normalized) {
    return "vi";
  }

  const [base] = normalized.split("-");
  return base || "vi";
}

function normalizeState(detail: AuSyncLabAudioDetail): string {
  return String(detail.state ?? detail.status ?? "")
    .trim()
    .toUpperCase();
}

function isSucceededState(state: string): boolean {
  return state === "SUCCEED" || state === "SUCCEEDED" || state === "READY";
}

function isFailedState(state: string): boolean {
  return state === "FAILED" || state === "ERROR";
}

function isRetryablePollingStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      detail?: string;
      message?: string | null;
      result?: unknown;
    };

    return (
      String(payload.message ?? payload.detail ?? "").trim() ||
      JSON.stringify(payload)
    );
  } catch {
    const text = await response.text();
    return text.trim() || "Unknown AuSyncLab error.";
  }
}

let nextAvailableRequestMs = 0;

async function rateLimitSleep(): Promise<void> {
  const now = Date.now();
  if (now >= nextAvailableRequestMs) {
    nextAvailableRequestMs = now + RATE_LIMIT_DELAY_MS;
    return;
  }

  const waitTime = nextAvailableRequestMs - now;
  nextAvailableRequestMs += RATE_LIMIT_DELAY_MS;
  await sleep(waitTime);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
