export function isQuotaExceededError(err: unknown): boolean {
  if (
    err instanceof DOMException &&
    (err.code === 22 ||
      err.code === 1014 ||
      err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED")
  ) {
    return true;
  }
  if (typeof err === "object" && err !== null) {
    const errorObj = err as Record<string, unknown>;
    if (errorObj.name === "QuotaExceededError" || errorObj.code === 22) {
      return true;
    }
    if (
      typeof errorObj.message === "string" &&
      errorObj.message.toLowerCase().includes("quota")
    ) {
      return true;
    }
  }
  return false;
}

export function cleanupStaleStorage(): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    const taskStateKeys: string[] = [];
    const panelStateKeys: string[] = [];
    const fileStateKeys: string[] = [];

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) {
        continue;
      }
      if (key.startsWith("videoWorkflow.taskState.")) {
        taskStateKeys.push(key);
      } else if (key.startsWith("videoWorkflow.panelState.")) {
        panelStateKeys.push(key);
      } else if (key.startsWith("videoWorkflow.v2.fileState.")) {
        fileStateKeys.push(key);
      }
    }

    // Heavy draft tasks take the most space (often megabytes). Remove all of them first.
    for (const key of taskStateKeys) {
      window.localStorage.removeItem(key);
    }

    // Keep only latest 5 file states and panel states
    if (panelStateKeys.length > 5) {
      for (const key of panelStateKeys.slice(0, panelStateKeys.length - 5)) {
        window.localStorage.removeItem(key);
      }
    }
    if (fileStateKeys.length > 5) {
      for (const key of fileStateKeys.slice(0, fileStateKeys.length - 5)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch (error) {
    console.warn("[Storage] Error during storage cleanup:", error);
  }
}

export function safeLocalStorageGetItem(
  key: string,
  fallback: string | null = null
): string | null {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function safeLocalStorageSetItem(key: string, value: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      try {
        cleanupStaleStorage();
        window.localStorage.setItem(key, value);
        return true;
      } catch (retryError) {
        console.warn(
          `[Storage] localStorage quota exceeded for key "${key}", falling back to sessionStorage`,
          retryError
        );
        safeSessionStorageSetItem(key, value);
        return false;
      }
    }
    console.warn(
      `[Storage] Failed to save key "${key}" to localStorage:`,
      error
    );
    return false;
  }
}

export function safeLocalStorageRemoveItem(key: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function safeSessionStorageGetItem(
  key: string,
  fallback: string | null = null
): string | null {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    return window.sessionStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function safeSessionStorageSetItem(key: string, value: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(
      `[Storage] Failed to save key "${key}" to sessionStorage:`,
      error
    );
    return false;
  }
}

export function safeSessionStorageRemoveItem(key: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}
