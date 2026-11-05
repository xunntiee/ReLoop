import {
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const outputFileLocks = new Map<string, Promise<void>>();

export async function withOutputFileLock<T>(
  filePath: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  const lockKey = resolve(filePath);
  const previousLock = outputFileLocks.get(lockKey) ?? Promise.resolve();
  let releaseCurrentLock: () => void = () => undefined;
  const currentLock = previousLock
    .catch(() => undefined)
    .then(
      () =>
        new Promise<void>((resolveLock) => {
          releaseCurrentLock = resolveLock;
        }),
    );

  outputFileLocks.set(lockKey, currentLock);
  await previousLock.catch(() => undefined);

  try {
    return await operation();
  } finally {
    releaseCurrentLock();
    if (outputFileLocks.get(lockKey) === currentLock) {
      outputFileLocks.delete(lockKey);
    }
  }
}

export function writeJsonFileAtomic(filePath: string, value: unknown): void {
  writeTextFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeTextFileAtomic(filePath: string, text: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  try {
    writeFileSync(tempPath, text, "utf8");
    renameSync(tempPath, filePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}
