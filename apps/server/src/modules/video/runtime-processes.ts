import type { ChildProcess } from "node:child_process";

type RuntimeCleanup = () => Promise<void> | void;

const activeChildren = new Set<ChildProcess>();
const activeCleanups = new Set<RuntimeCleanup>();
let shutdownPromise: Promise<void> | null = null;

export function trackVideoChildProcess<T extends ChildProcess>(child: T): T {
  activeChildren.add(child);
  const remove = () => activeChildren.delete(child);
  child.once("close", remove);
  child.once("error", remove);
  return child;
}

export function registerVideoRuntimeCleanup(cleanup: RuntimeCleanup): () => void {
  activeCleanups.add(cleanup);
  return () => activeCleanups.delete(cleanup);
}

export async function stopVideoRuntimeProcesses(
  timeoutMs = 4000,
): Promise<void> {
  if (shutdownPromise) {
    await shutdownPromise;
    return;
  }

  shutdownPromise = (async () => {
    const cleanups = [...activeCleanups];
    activeCleanups.clear();
    await Promise.allSettled(cleanups.map((cleanup) => cleanup()));

    const children = [...activeChildren];
    for (const child of children) {
      if (child.exitCode === null && !child.killed) {
        child.kill();
      }
    }

    if (children.length > 0) {
      await Promise.race([
        Promise.allSettled(
          children.map(
            (child) =>
              new Promise<void>((resolvePromise) => {
                if (child.exitCode !== null) {
                  resolvePromise();
                  return;
                }
                child.once("close", () => resolvePromise());
              }),
          ),
        ),
        new Promise<void>((resolvePromise) => {
          setTimeout(resolvePromise, Math.max(250, timeoutMs));
        }),
      ]);
    }
  })().finally(() => {
    shutdownPromise = null;
  });

  await shutdownPromise;
}
