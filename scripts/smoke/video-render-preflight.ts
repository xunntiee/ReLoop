import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  compactMediaProcessError,
  formatVideoRenderErrorMessage,
} from "../../apps/server/src/modules/video/ffmpeg";
import { assertVideoDraftAssets } from "../../apps/server/src/modules/video/video-renderer";
import type { VideoDraftDocument } from "../../apps/server/src/modules/video/types";

const root = await mkdtemp(resolve(tmpdir(), "tool-base-render-preflight-"));
try {
  const draft = {
    uploaded_video: {
      lastModified: "",
      name: "background.mp4",
      serverPath: "data/processed/video_uploads/background.mp4",
      sizeBytes: 1,
      type: "video/mp4",
    },
  } as VideoDraftDocument;

  let failedEarly = false;
  try {
    assertVideoDraftAssets(draft, root);
  } catch (error) {
    failedEarly = error instanceof Error && error.message.includes("video nền");
  }
  if (!failedEarly) {
    throw new Error("Missing background video must fail before queueing a render job.");
  }

  const backgroundPath = resolve(root, draft.uploaded_video!.serverPath!);
  await mkdir(resolve(root, "data/processed/video_uploads"), { recursive: true });
  await writeFile(backgroundPath, "test");
  assertVideoDraftAssets(draft, root);

  const noisy = [
    "ffmpeg version 8.1.2-essentials_build",
    "built with gcc 16.1.0",
    "configuration: --enable-gpl --enable-libx264",
    "[Parsed_overlay_0 @ 000001] Failed to configure input pad",
    "Error reinitializing filters!",
    "Conversion failed!",
  ].join("\n");
  const compact = compactMediaProcessError(noisy, "ffmpeg failed");
  if (compact.includes("configuration:") || !compact.includes("Conversion failed!")) {
    throw new Error("FFmpeg banner was not compacted correctly.");
  }
  if (!formatVideoRenderErrorMessage(noisy).includes("Conversion failed!")) {
    throw new Error("Renderer error formatting lost the useful FFmpeg error.");
  }

  const noisyWithEncoderTail = [
    "[Parsed_overlay_0 @ 000001] Failed to configure input pad",
    "Error reinitializing filters!",
    "Error while filtering: Cannot allocate memory",
    "[libx264 @ 000001] coded y,uvDC,uvAC intra: 69.0% 64.8% 27.4% inter: 10.5% 10.7% 0.5%",
    "[libx264 @ 000001] i16 v,h,dc,p: 51% 25% 12% 12%",
    "[libx264 @ 000001] i8 v,h,dc,ddl,ddr,vr,hd,vl,hu: 23% 24% 17% 5% 6% 6% 8% 5% 6%",
    "[libx264 @ 000001] i4 v,h,dc,ddl,ddr,vr,hd,vl,hu: 21% 19% 10% 7% 10% 8% 10% 7% 8%",
    "[libx264 @ 000001] i8c dc,h,v,p: 49% 23% 19% 10%",
    "[libx264 @ 000001] Weighted P-Frames: Y:7.7% UV:7.7%",
    "[libx264 @ 000001] ref P L0: 74.9% 25.1%",
    "[libx264 @ 000001] ref B L0: 81.9% 18.1%",
    "[libx264 @ 000001] ref B L1: 96.7% 3.3%",
    "[libx264 @ 000001] kb/s:8161.20",
    "[aac @ 000001] Qavg: 5216.052",
    "Conversion failed!",
  ].join("\n");
  const compactWithEncoderTail = compactMediaProcessError(
    noisyWithEncoderTail,
    "ffmpeg failed",
  );
  if (
    !(
      compactWithEncoderTail.includes("Error while filtering") &&
      compactWithEncoderTail.includes("Conversion failed!")
    )
  ) {
    throw new Error("FFmpeg root cause was lost behind encoder statistics.");
  }

  console.log("smoke:video-render-preflight ok");
} finally {
  await rm(root, { recursive: true, force: true });
}
