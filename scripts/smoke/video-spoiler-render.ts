import { normalizeSpoilerRevealRegions } from "../../apps/server/src/modules/video/service";

// Smoke test for spoiler text extraction and timing calculations
const rawNarrationText = "Hôm nay đi chợ. ||Nhặt được 100k tiền giả.||";
const hasSpoiler = rawNarrationText.includes("||");
const cleanNarrationText = rawNarrationText.replace(/\|\|/g, "");

if (!hasSpoiler) {
  throw new Error("Expected spoiler syntax to be detected.");
}
if (cleanNarrationText !== "Hôm nay đi chợ. Nhặt được 100k tiền giả.") {
  throw new Error(`Expected clean text output, got: ${cleanNarrationText}`);
}

const mockChunks = [
  { text: "Hôm nay đi chợ.", duration_ms: 2500 },
  { text: "Nhặt được 100k tiền giả.", duration_ms: 3200 },
];

const firstPipeIdx = rawNarrationText.indexOf("||");
const spoilerStartIndex = firstPipeIdx;

let currentOffset = 0;
let reveal_time_ms = 0;
let precedingDurationMs = 0;
let foundRevealChunk = false;

for (const chunk of mockChunks) {
  const startIdx = cleanNarrationText.indexOf(chunk.text, currentOffset);
  if (startIdx !== -1) {
    const endIdx = startIdx + chunk.text.length;
    if (!foundRevealChunk && endIdx > spoilerStartIndex) {
      reveal_time_ms = precedingDurationMs;
      foundRevealChunk = true;
    }
    currentOffset = endIdx;
  }
  precedingDurationMs += chunk.duration_ms || 0;
}

if (reveal_time_ms !== 2500) {
  throw new Error(`Expected reveal_time_ms to be 2500, got: ${reveal_time_ms}`);
}

const rawDisplayText = "Hôm nay đi chợ. ||Nhặt được 100k tiền giả.||";
const text_initial = rawDisplayText.replace(/\|\|[\s\S]*?\|\|/g, "");
const text_full = rawDisplayText.replace(/\|\|/g, "");

if (text_initial.trim() !== "Hôm nay đi chợ.") {
  throw new Error(
    `Expected text_initial to be 'Hôm nay đi chợ.', got: '${text_initial}'`
  );
}
if (text_full.trim() !== "Hôm nay đi chợ. Nhặt được 100k tiền giả.") {
  throw new Error(
    `Expected text_full to be 'Hôm nay đi chợ. Nhặt được 100k tiền giả.', got: '${text_full}'`
  );
}

const splitRegions = normalizeSpoilerRevealRegions(
  [
    {
      bbox: { height: 120, width: 360, x: 40, y: 180 },
      image_height: 720,
      image_width: 480,
      text: "OCR source line",
    },
  ],
  ["Line one", "Line two"],
);
if (
  splitRegions.length !== 2 ||
  splitRegions[0]?.bbox.y !== 180 ||
  splitRegions[0]?.bbox.height !== 60 ||
  splitRegions[1]?.bbox.y !== 240 ||
  splitRegions[1]?.bbox.height !== 60
) {
  throw new Error("Expected a multi-line OCR region to reveal one line at a time.");
}

console.log("smoke:video-spoiler-render ok");
