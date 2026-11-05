import type { VideoVoiceSettings } from "../../apps/server/src/modules/video/types.js";
import { resolveSceneVoiceProfile } from "../../apps/server/src/modules/video/voice-strategy.js";

const dummyConfig = {
  ausynclabApiKey: "",
  ausynclabBaseUrl: "",
  defaultVoice: {
    languageCode: "vi-VN",
    pitch: 0,
    provider: "google_cloud" as const,
    speakingRate: 1,
    ssmlGender: "FEMALE" as const,
    voiceName: "vi-VN-Wavenet-A",
  },
  fptApiKey: "",
  fptBaseUrl: "",
  googleApiKey: "",
  openAiApiKey: "",
  openAiBaseUrl: "",
  openAiModel: "",
  renderConcurrency: 1,
  remotionConcurrency: 1,
  vivibeApiKey: "test-key",
  vivibeBaseUrl: "https://example.invalid",
};

const customFemaleVoiceId = "cACFxDTEUiNBcCSpmJbgwj"; // Nữ kể chuyện 
const requestedVoice: VideoVoiceSettings = {
  languageCode: "vi-VN",
  pitch: 0,
  provider: "vivibe",
  speakingRate: 1,
  ssmlGender: "FEMALE",
  voiceName: customFemaleVoiceId,
};

const vivibeVoices = [
  { id: customFemaleVoiceId, isActive: true, name: "Nữ kể chuyện " },
  { id: "5r2MVjMfzwsSDzTpaLjbY9", isActive: true, name: "Adam" },
  { id: "26ys7wicEUR9exGcq8GoTb", isActive: true, name: "Nam ấm kể chuyện" },
];

// Test 1: Post narration (first spoken scene in video) uses the exact selected voice
const emotionPost = resolveSceneVoiceProfile({
  commentVoiceMode: "emotion",
  config: dummyConfig as never,
  kind: "post",
  requestedVoice,
  vivibeVoices,
});

if (emotionPost.voiceName !== customFemaleVoiceId) {
  throw new Error(`Expected post narration voice ${customFemaleVoiceId}, got ${emotionPost.voiceName}`);
}

// Test 2: First comment starting gender aligns with selected voice gender (FEMALE)
const emotionComment0 = resolveSceneVoiceProfile({
  commentSequenceIndex: 0,
  commentText: "Một bình luận tuyệt vời",
  commentVoiceMode: "emotion",
  config: dummyConfig as never,
  kind: "comment",
  previousSceneKind: "post",
  requestedVoice,
  vivibeVoices,
});

if (emotionComment0.ssmlGender !== "FEMALE") {
  throw new Error(`Expected first comment gender FEMALE to match selected voice gender, got ${emotionComment0.ssmlGender}`);
}

console.log("smoke:vivibe-voice-strategy ok");
