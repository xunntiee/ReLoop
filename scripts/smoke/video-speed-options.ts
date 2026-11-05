import {
  normalizeVoiceSpeed,
  VOICE_SPEED_OPTIONS,
} from "../../apps/web/src/features/video-workflow/voice-speed";
import { isVoiceDraftSignatureReusable } from "../../apps/web/src/features/video-workflow/video-draft-actions";

for (const speed of [1.3, 1.4]) {
  if (!VOICE_SPEED_OPTIONS.some((option) => option.value === speed)) {
    throw new Error(`Expected ${speed}x to be available in the voice speed menu.`);
  }
  if (normalizeVoiceSpeed(String(speed)) !== speed) {
    throw new Error(`Expected ${speed}x to be preserved without rounding.`);
  }
}

if (normalizeVoiceSpeed("invalid") !== 1) {
  throw new Error("Expected an invalid persisted voice speed to fall back to 1.0x.");
}

const signatureAt = (speakingRate: number) =>
  JSON.stringify({
    voicePipelineVersion: 28,
    voiceSettings: { speakingRate },
  });
if (
  isVoiceDraftSignatureReusable({
    currentSignature: signatureAt(1.4),
    draftSignature: signatureAt(1.3),
  })
) {
  throw new Error("Expected a speed change to invalidate the old voice timeline.");
}

console.log("smoke:video-speed-options ok");
