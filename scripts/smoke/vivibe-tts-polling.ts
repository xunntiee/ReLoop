import { VivibeTtsClient } from "../../apps/server/src/modules/video/vivibe-tts.js";

const config = {
  vivibeApiKey: "test-key",
  vivibeBaseUrl: "https://example.test/json-rpc",
};
const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
let statusChecks = 0;

globalThis.setTimeout = ((callback: TimerHandler) => {
  if (typeof callback === "function") callback();
  return 0 as unknown as ReturnType<typeof setTimeout>;
}) as typeof setTimeout;

globalThis.fetch = (async (input, init) => {
  if (String(input) === "https://example.test/audio.mp3") {
    return new Response(Uint8Array.from([0x49, 0x44, 0x33]), {
      headers: { "content-type": "audio/mpeg" },
    });
  }

  const body = JSON.parse(String(init?.body ?? "{}")) as {
    method?: string;
  };
  if (body.method === "ttsLongText") {
    return Response.json({ result: { projectExportId: "export-delayed" } });
  }
  if (body.method === "getExportStatus") {
    statusChecks += 1;
    return Response.json({
      result:
        statusChecks > 60
          ? { state: "completed", url: "https://example.test/audio.mp3" }
          : { state: "delayed" },
    });
  }
  throw new Error(`Unexpected ViVibe RPC method: ${String(body.method)}`);
}) as typeof fetch;

try {
  const result = await new VivibeTtsClient(config as never).synthesize("Test", {
    voiceName: "voice-id",
  });
  if (result.audioBytes.length !== 3 || statusChecks !== 61) {
    throw new Error(
      `Expected a delayed export to finish after 61 status checks, got ${statusChecks}.`,
    );
  }
  console.log("smoke:vivibe-tts-polling ok");
} finally {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
}
