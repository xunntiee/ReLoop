import { spawn } from "node:child_process";
import { trackVideoChildProcess } from "./runtime-processes.js";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import {
  compactMediaProcessError,
  findAvailableMediaBinary,
} from "./ffmpeg.js";

export interface MergeAudioResult {
  durationMs: number;
  method: "binary_concat" | "copy" | "ffmpeg_concat";
}

export async function mergeAudioChunks({
  chunkPaths,
  estimatedDurationMs,
  outputPath,
}: {
  chunkPaths: string[];
  estimatedDurationMs: number;
  outputPath: string;
}): Promise<MergeAudioResult> {
  const ffmpegBinary = await findAvailableMediaBinary("ffmpeg");
  await mkdir(dirname(outputPath), { recursive: true });

  if (chunkPaths.length === 0) {
    await writeFile(outputPath, Buffer.alloc(0));
    return { durationMs: 0, method: "binary_concat" };
  }

  if (chunkPaths.length === 1) {
    await copyFile(chunkPaths[0]!, outputPath);
    return {
      durationMs: (await probeDurationMs(outputPath)) ?? estimatedDurationMs,
      method: "copy",
    };
  }

  if (ffmpegBinary) {
    const codecArgs = getAudioCodecArgs(outputPath);
    const concatInputs = chunkPaths.flatMap((path) => ["-i", path]);
    const concatGraph = chunkPaths
      .map((_, index) => `[${index}:a]`)
      .join("");
    await runProcess(ffmpegBinary, [
      "-y",
      ...concatInputs,
      "-filter_complex",
      `${concatGraph}concat=n=${chunkPaths.length}:v=0:a=1[outa]`,
      "-map",
      "[outa]",
      ...codecArgs,
      outputPath,
    ]);
    return {
      durationMs: (await probeDurationMs(outputPath)) ?? estimatedDurationMs,
      method: "ffmpeg_concat",
    };
  }

  const buffers = await Promise.all(chunkPaths.map((path) => readFile(path)));
  await writeFile(outputPath, Buffer.concat(buffers));
  return {
    durationMs: estimatedDurationMs,
    method: "binary_concat",
  };
}

export async function probeDurationMs(path: string): Promise<number | null> {
  const ffprobeBinary = await findAvailableMediaBinary("ffprobe");
  if (!ffprobeBinary) return null;
  try {
    const output = await runProcess(ffprobeBinary, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      path,
    ]);
    const seconds = Number.parseFloat(output.trim());
    if (!Number.isFinite(seconds)) return null;
    return Math.max(0, Math.round(seconds * 1000));
  } catch {
    return null;
  }
}

export async function probeVideoDurationMs(path: string): Promise<number | null> {
  const durationMs = await probeDurationMs(path);
  if (durationMs !== null && durationMs > 0) {
    return durationMs;
  }

  const ffprobeBinary = await findAvailableMediaBinary("ffprobe");
  if (!ffprobeBinary) return null;
  try {
    const output = await runProcess(ffprobeBinary, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "packet=pts_time,duration_time",
      "-of",
      "csv=p=0",
      path,
    ]);
    let endSeconds = 0;
    for (const line of output.split(/\r?\n/)) {
      const values = line
        .split(",")
        .map((value) => Number.parseFloat(value.trim()))
        .filter((value) => Number.isFinite(value));
      if (values.length === 0) continue;
      const packetStart = values[0] ?? 0;
      const packetDuration = values[1] ?? 0;
      endSeconds = Math.max(endSeconds, packetStart + packetDuration);
    }
    return endSeconds > 0 ? Math.round(endSeconds * 1000) : null;
  } catch {
    return null;
  }
}

export async function retimeAudioFile({
  forceTranscode = false,
  inputPath,
  outputPath,
  speakingRate,
}: {
  forceTranscode?: boolean;
  inputPath: string;
  outputPath: string;
  speakingRate: number;
}): Promise<void> {
  const ffmpegBinary = await findAvailableMediaBinary("ffmpeg");
  if (!ffmpegBinary) {
    throw new Error("FFmpeg is required to retime generated audio.");
  }

  const normalizedRate = clampSpeakingRate(speakingRate);
  if (!forceTranscode && Math.abs(normalizedRate - 1) < 0.001) {
    await copyFile(inputPath, outputPath);
    return;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  const args = [
    "-y",
    "-i",
    inputPath,
  ];
  if (Math.abs(normalizedRate - 1) >= 0.001) {
    args.push("-filter:a", buildAtempoFilter(normalizedRate));
  }
  args.push(...getAudioCodecArgs(outputPath), outputPath);
  await runProcess(ffmpegBinary, args);
}

function buildAtempoFilter(rate: number): string {
  const factors: number[] = [];
  let remaining = clampSpeakingRate(rate);

  while (remaining > 2) {
    factors.push(2);
    remaining /= 2;
  }

  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }

  factors.push(remaining);
  return factors.map((value) => `atempo=${value.toFixed(4)}`).join(",");
}

function clampSpeakingRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(2, Math.max(0.5, rate));
}

function getAudioCodecArgs(outputPath: string): string[] {
  const extension = extname(outputPath).toLowerCase();

  switch (extension) {
    case ".wav":
      return ["-vn", "-c:a", "pcm_s16le"];
    case ".ogg":
      return ["-vn", "-c:a", "libopus", "-b:a", "96k"];
    case ".mp3":
    default:
      return ["-vn", "-c:a", "libmp3lame", "-b:a", "128k"];
  }
}

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = trackVideoChildProcess(
      spawn(command, args, {
        shell: false,
        windowsHide: true,
      }),
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          compactMediaProcessError(stderr, `${command} exited with code ${code}`),
        ),
      );
    });
  });
}
