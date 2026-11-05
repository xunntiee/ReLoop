import { VivibeTtsClient } from "../../apps/server/src/modules/video/vivibe-tts.js";

const config = {
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
  vivibeBaseUrl: "https://example.test/json-rpc",
};

const originalFetch = globalThis.fetch;
let communityCalls = 0;

globalThis.fetch = ((_input, init) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    input?: { page?: number };
    mappings?: { items?: Record<string, number> };
    method?: string;
  };
  const page = body.input?.page ?? 1;

  if (
    (body.method === "getUserVoices" || body.method === "getCommunityVoices") &&
    body.mappings?.items?.sampleAsset !== 1
  ) {
    return new Response(
      JSON.stringify({ error: { message: "sampleAsset mapping is required" } }),
      { status: 400 }
    );
  }

  if (body.method === "getUserVoices") {
    return new Response(
      JSON.stringify({
        result: {
          items: [{
            id: "user-voice",
            isActive: true,
            name: "Giọng riêng",
            sampleAsset: { cdnUrl: "https://example.test/user-preview.wav" },
          }],
          total: 1,
        },
      }),
      { status: 200 }
    );
  }

  if (body.method === "getCommunityVoices") {
    communityCalls += 1;
    const items =
      page === 1
        ? Array.from({ length: 100 }, (_, index) => ({
            id: `community-${index}`,
            isActive: true,
            isPublic: true,
            isVerified: index === 0,
            name: `Giọng thịnh hành ${index}`,
            score: 10_000 - index,
            tags: ["review", "nữ"],
          }))
        : [{
            id: "community-100",
            isActive: true,
            isPublic: true,
            name: "Giọng cuối trang",
            score: 1,
            tags: ["vlog"],
          }];
    return new Response(
      JSON.stringify({ result: { items, total: 101 } }),
      { status: 200 }
    );
  }

  return new Response(JSON.stringify({ error: { message: "unexpected method" } }), {
    status: 400,
  });
}) as typeof fetch;

try {
  const voices = await new VivibeTtsClient(config as never).listVoices();
  if (voices.length !== 102) {
    throw new Error(`Expected 102 deduplicated voices, got ${voices.length}`);
  }
  if (communityCalls !== 2) {
    throw new Error(`Expected community pagination to use 2 pages, got ${communityCalls}`);
  }
  if (voices[1]?.score !== 10_000 || !voices[1]?.tags?.includes("review")) {
    throw new Error("Community metadata was not preserved");
  }
  if (voices[0]?.sampleAsset?.cdnUrl !== "https://example.test/user-preview.wav") {
    throw new Error("Voice preview asset was not preserved");
  }
  console.log("smoke:vivibe-voice-list ok");
} finally {
  globalThis.fetch = originalFetch;
}
