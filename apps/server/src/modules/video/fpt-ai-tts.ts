import { randomUUID } from "node:crypto";
import type { ToolConfig } from "@tool-base/config/schema";
import type {
  TextToSpeechProvider,
  TtsSynthesisResult,
} from "./tts-provider.js";
import type { VideoVoiceSettings } from "./types.js";

const AUDIO_READY_TIMEOUT_MS = 3 * 60 * 1000;

export class FptAiTtsClient implements TextToSpeechProvider {
  readonly providerId = "fpt_ai";

  constructor(private readonly config: ToolConfig["video"]) {}

  async synthesize(
    text: string,
    voiceSettings?: VideoVoiceSettings | null
  ): Promise<TtsSynthesisResult> {
    const apiKey = this.config.fptAiApiKey.trim();
    if (!apiKey) {
      throw new Error(
        "Missing FPT AI TTS API key. Set FPT_AI_TTS_API_KEY or config.video.fptAiApiKey."
      );
    }

    const voiceName =
      voiceSettings?.voiceName?.trim() ||
      this.config.fptAiVoiceName.trim() ||
      "banmai";
    const textVariants = buildFptTextVariants(text);
    let lastError: unknown = null;

    for (const [index, textVariant] of textVariants.entries()) {
      const response = await fetch(this.config.fptAiBaseUrl, {
        body: textVariant,
        headers: {
          "api-key": apiKey,
          // Keep provider output at neutral speed; final timing is normalized locally.
          speed: "0",
          voice: voiceName,
        },
        method: "POST",
      });

      if (!response.ok) {
        const fallbackMessage = `FPT AI TTS request failed: ${response.status}`;
        try {
          const payload = (await response.json()) as { message?: string };
          throw new Error(payload.message || fallbackMessage);
        } catch (error) {
          throw error instanceof Error ? error : new Error(fallbackMessage);
        }
      }

      const payload = (await response.json()) as {
        async?: string;
        error?: number;
        message?: string;
        request_id?: string;
      };
      if (payload.error && payload.error !== 0) {
        throw new Error(
          payload.message || `FPT AI TTS returned error ${payload.error}.`
        );
      }

      const audioUrl = String(payload.async ?? "").trim();
      if (!audioUrl) {
        throw new Error(
          payload.message || "FPT AI TTS did not return an audio URL."
        );
      }

      try {
        const audioBytes = await fetchFptAudio(audioUrl);
        return {
          audioBytes,
          message: "Scene audio generated with FPT AI.",
          provider: "fpt_ai",
          requestId: String(payload.request_id ?? randomUUID()),
          status: "ready",
        };
      } catch (error) {
        lastError = error;
        if (index === textVariants.length - 1 || !isFptAudioNotReadyError(error)) {
          break;
        }
      }
    }

    const textPreview = collapseWhitespace(
      sanitizeTextForLog(textVariants.at(-1) ?? text)
    ).slice(0, 180);
    throw new Error(
      `FPT AI audio file was not ready for voice "${voiceName}". Text preview: "${textPreview}". ${formatFptError(lastError)}`
    );
  }
}

async function fetchFptAudio(audioUrl: string): Promise<Buffer> {
  const initialDelayMs = 500;
  const retryDelayMs = 1000;
  const recentStatuses: string[] = [];
  const deadline = Date.now() + AUDIO_READY_TIMEOUT_MS;

  await sleep(initialDelayMs);

  while (Date.now() < deadline) {
    try {
      const response = await fetch(audioUrl, {
        redirect: "follow",
      });
      const contentType = response.headers.get("content-type") || "";
      recentStatuses.push(`${response.status}:${contentType || "unknown"}`);
      if (recentStatuses.length > 5) {
        recentStatuses.shift();
      }

      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (
          contentType.includes("audio") ||
          contentType.includes("mpeg") ||
          looksLikeAudioBuffer(bytes)
        ) {
          return bytes;
        }

        recentStatuses[recentStatuses.length - 1] += `:${bytes.length}b`;
      }
    } catch (error) {
      recentStatuses.push(
        `fetch_error:${error instanceof Error ? error.message : String(error)}`
      );
      if (recentStatuses.length > 5) {
        recentStatuses.shift();
      }
    }

    await sleep(Math.min(retryDelayMs, Math.max(0, deadline - Date.now())));
  }

  throw new FptAudioNotReadyError(recentStatuses);
}

class FptAudioNotReadyError extends Error {
  constructor(readonly recentStatuses: string[]) {
    super(`Recent responses: ${recentStatuses.join(", ")}`);
    this.name = "FptAudioNotReadyError";
  }
}

function isFptAudioNotReadyError(error: unknown): error is FptAudioNotReadyError {
  return error instanceof FptAudioNotReadyError;
}

function looksLikeAudioBuffer(value: Buffer): boolean {
  if (value.length < 3) return false;
  return (
    value.subarray(0, 3).toString("ascii") === "ID3" ||
    (value[0] === 0xff && (value[1] === 0xfb || value[1] === 0xf3 || value[1] === 0xf2))
  );
}

function buildFptTextVariants(text: string): string[] {
  const textWithBreaks = String(text ?? "").replace(/\s*[\r\n]+\s*/g, ". ");
  const original = collapseWhitespace(textWithBreaks);
  const sanitized = sanitizeTextForFpt(original);
  const prosodyPrepared = prepareVietnameseProsody(sanitized || original);
  const primary = ensureSpeakableFptText(sanitized || original);
  const prosodyVariant = ensureSpeakableFptText(prosodyPrepared || primary);
  const plainVariant = ensureSpeakableFptText(stripSoftPauses(primary));
  const prosodyFallback = ensureSpeakableFptText(stripSoftPauses(prosodyVariant));
  const originalVariant = ensureSpeakableFptText(original);

  return uniqueNonEmpty([
    primary,
    prosodyVariant,
    plainVariant,
    prosodyFallback,
    originalVariant,
  ]);
}

function sanitizeTextForFpt(text: string): string {
  const result = collapseWhitespace(
    String(text ?? "")
      .normalize("NFC")
      .replace(/\bTTS\b/giu, "thuc tap sinh")
      .replace(/\bCV\b/giu, "xi vi")
      .replace(/\bHR\b/giu, "nhan su")
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, " ")
      .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/giu, " ")
      .replace(/\b\S+\.(?:pdf|docx?|xlsx?|pptx?|zip|rar)\b/giu, " ")
      .replace(/[\/\\]+/g, " hoac ")
      .replace(/[|]+/g, " . ")
      .replace(/[_]+/g, " ")
      .replace(/[“”„]/g, '"')
      .replace(/[‘’‚]/g, "'")
      .replace(/…/g, ".")
      .replace(/[^\p{L}\p{N}\s.,!?;:'"()\-]/gu, " ")
  );

  if (result.length > 0 && result.length < 3) {
    return `${result} . .`;
  }

  return result;
}

function prepareVietnameseProsody(text: string): string {
  return collapseWhitespace(
    String(text ?? "")
      .replace(/(?<!^)\b(top|muc|phan)\s*(\d+)\s*[:.)-]*/giu, ", $1 $2, ")
      .replace(/\btop\s*(\d+)\s*:/giu, "top $1, ")
      .replace(/\b(\d+)\s*[:.)-]\s*/gu, "$1, ")
      .replace(/\s*\/\s*/g, ", ")
      .replace(/\s*:\s*/g, ", ")
      .replace(/\s*;\s*/g, ", ")
      .replace(/\s+-\s+/g, ", ")
      .replace(/\)\s+(?=\p{Lu}|\d)/gu, "), ")
      .replace(
        /\s*,?\s+\b(nhung|nhưng|ma|mà|va|và|roi|rồi|xong|nen|nên|vi|vì|neu|nếu|thi|thì)\b/giu,
        " $1"
      )
      .replace(
        /\s*,?\s+\b(con|còn|sau do|sau đó|tiep theo|tiếp theo|cuoi cung|cuối cùng)\b/giu,
          " $1"
      )
      .replace(/([,.!?]){2,}/g, "$1")
      .replace(/,\s*([.!?])/g, "$1")
      .replace(/,\s*,+/g, ", ")
      .replace(/\.\s*,/g, ", ")
      .replace(/\.\s*\./g, ".")
      .replace(/(?<![.!?])$/u, ".")
  );
}

function ensureSpeakableFptText(text: string): string {
  const normalized = collapseWhitespace(
    String(text ?? "")
      .replace(/([.!?])\s*\1+/g, "$1")
      .replace(/,\s*,+/g, ", ")
      .replace(/\.\s*\./g, ".")
  );

  if (!normalized) {
    return "";
  }

  if (normalized.length < 3) {
    return `${normalized} .`;
  }

  return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`;
}

function stripSoftPauses(text: string): string {
  return collapseWhitespace(
    String(text ?? "")
      .replace(/\s*,\s*/g, " ")
      .replace(/\s*;\s*/g, " ")
      .replace(/\s*:\s*/g, " ")
  );
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values.map(collapseWhitespace)) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function collapseWhitespace(value: string): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sanitizeTextForLog(value: string): string {
  return String(value ?? "").replace(/[\r\n"]/g, " ");
}

function formatFptError(error: unknown): string {
  if (isFptAudioNotReadyError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "Unknown FPT AI error.");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
