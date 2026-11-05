import type { VideoVoiceSettings } from "./types.js";

export interface TtsSynthesisResult {
  audioBytes: Buffer;
  message: string;
  provider: "ausynclab" | "fpt_ai" | "google_cloud" | "vivibe";
  requestId: string;
  status: "ready";
}

export interface TextToSpeechProvider {
  readonly providerId: "ausynclab" | "fpt_ai" | "google_cloud" | "vivibe";
  synthesize(
    text: string,
    voiceSettings?: VideoVoiceSettings | null
  ): Promise<TtsSynthesisResult>;
}
