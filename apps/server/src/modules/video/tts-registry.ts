import type { ToolConfig } from "@tool-base/config/schema";
import { FptAiTtsClient } from "./fpt-ai-tts.js";
import { GoogleCloudTtsClient } from "./google-cloud-tts.js";
import { AuSyncLabTtsClient } from "./ausynclab-tts.js";
import { VivibeTtsClient } from "./vivibe-tts.js";
import type { TextToSpeechProvider } from "./tts-provider.js";

export function createTtsProviderRegistry(
  config: ToolConfig["video"]
): Record<"google_cloud" | "fpt_ai" | "ausynclab" | "vivibe", TextToSpeechProvider> {
  return {
    ausynclab: new AuSyncLabTtsClient(config),
    fpt_ai: new FptAiTtsClient(config),
    google_cloud: new GoogleCloudTtsClient(config),
    vivibe: new VivibeTtsClient(config),
  };
}
