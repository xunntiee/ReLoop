import type { ToolConfig } from "@tool-base/config/schema";
import {
  loadUserToolSettings,
  updateUserToolSettings,
} from "@tool-base/config/server";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

export interface LicenseVerificationResult {
  allowed: boolean;
  checkedAt: string;
  employeeName: string;
  expiresAt: string;
  keyPreview: string;
  message: string;
  reason: string;
  valid: boolean;
  sessionToken?: string;
}

const VALID_LICENSE_CACHE_TTL_MS = 10 * 60_000;
const INVALID_LICENSE_CACHE_TTL_MS = 10_000;

interface LicenseCacheEntry {
  expiresAtMs: number;
  result: LicenseVerificationResult;
}

const verificationCache = new Map<string, LicenseCacheEntry>();
const verificationInFlight = new Map<string, Promise<LicenseVerificationResult>>();

export function clearLicenseCache(): void {
  verificationCache.clear();
  verificationInFlight.clear();
}

let memoizedMachineId: string | null = null;

export function getMachineId(): string {
  if (memoizedMachineId) return memoizedMachineId;

  try {
    if (process.platform === "win32") {
      const output = execSync(
        'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      const match = /MachineGuid\s+REG_SZ\s+([a-zA-Z0-9-]+)/i.exec(output);
      if (match && match[1]) {
        memoizedMachineId = createHash("sha256")
          .update(match[1].trim())
          .digest("hex");
        return memoizedMachineId;
      }
    }
  } catch (e) {
    // Fallback
  }

  memoizedMachineId = "fallback-machine-id";
  return memoizedMachineId;
}

export async function verifyLicenseOrThrow(
  config: ToolConfig,
  licenseKey: string,
  options?: { bypassCache?: boolean },
): Promise<LicenseVerificationResult> {
  const result = await verifyLicense(config, licenseKey, options);
  if (!result.valid || !result.allowed) {
    throw new Error(result.message || "License key khong hop le.");
  }
  return result;
}

export async function verifyLicense(
  config: ToolConfig,
  licenseKey: string,
  options?: { bypassCache?: boolean },
): Promise<LicenseVerificationResult> {
  const trimmedKey = licenseKey.trim();
  const checkedAt = new Date().toISOString();

  if (!config.license.enabled) {
    return {
      allowed: false,
      checkedAt,
      employeeName: "",
      expiresAt: "",
      keyPreview: maskLicenseKey(trimmedKey),
      message:
        "License đang bị tắt trong cấu hình hệ thống. Tool đã khóa để tránh bỏ qua bước kích hoạt.",
      reason: "license_gate_disabled",
      valid: false,
    };
  }

  if (!trimmedKey) {
    clearLicenseCache();
    return {
      allowed: false,
      checkedAt,
      employeeName: "",
      expiresAt: "",
      keyPreview: "",
      message: "Chưa có license key trên máy này",
      reason: "missing_key",
      valid: false,
    };
  }

  const settings = loadUserToolSettings().settings;
  const storedKey = String(settings.license?.key ?? "").trim();
  const sessionToken =
    trimmedKey === storedKey
      ? String(settings.license?.sessionToken ?? "").trim()
      : "";

  const cacheKey = buildCacheKey(config, trimmedKey, sessionToken);
  if (!options?.bypassCache) {
    const cached = verificationCache.get(cacheKey);
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.result;
    }

    const inFlight = verificationInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }
  }

  const verificationPromise = (async (): Promise<LicenseVerificationResult> => {
    const machineId = getMachineId();
    let result: LicenseVerificationResult;

    if (!sessionToken) {
      // Perform activation
      result = await fetchLicenseActivation(
        config,
        trimmedKey,
        machineId,
        checkedAt,
      );
      if (!result.valid) {
        // Fallback: If activation failed, try direct verification via key.
        const fallbackResult = await fetchLicenseVerificationWithKey(
          config,
          trimmedKey,
          machineId,
          checkedAt,
        );
        if (fallbackResult.valid && fallbackResult.allowed) {
          result = fallbackResult;
        }
      }
    } else {
      // Perform verification
      result = await fetchLicenseVerification(
        config,
        sessionToken,
        machineId,
        trimmedKey,
        checkedAt,
      );

      // If verification failed due to invalid session token, try to re-activate.
      if (!result.valid && result.reason === "invalid_token") {
        const activateResult = await fetchLicenseActivation(
          config,
          trimmedKey,
          machineId,
          checkedAt,
        );
        if (activateResult.valid && activateResult.allowed) {
          result = activateResult;
        } else {
          const fallbackResult = await fetchLicenseVerificationWithKey(
            config,
            trimmedKey,
            machineId,
            checkedAt,
          );
          if (fallbackResult.valid && fallbackResult.allowed) {
            result = fallbackResult;
          }
        }
      }
    }

    // If validation succeeded (valid & allowed), update settings.
    if (result.valid && result.allowed) {
      updateUserToolSettings((s) => ({
        ...s,
        license: {
          ...s.license,
          key: trimmedKey,
          sessionToken: result.sessionToken || "",
        },
      }));
    }

    const expiresAtMs =
      Date.now() +
      (result.valid && result.allowed
        ? VALID_LICENSE_CACHE_TTL_MS
        : INVALID_LICENSE_CACHE_TTL_MS);
    verificationCache.set(cacheKey, { expiresAtMs, result });
    if (result.sessionToken) {
      verificationCache.set(buildCacheKey(config, trimmedKey, result.sessionToken), {
        expiresAtMs,
        result,
      });
    }

    return result;
  })();

  if (!options?.bypassCache) {
    verificationInFlight.set(cacheKey, verificationPromise);
  }

  try {
    return await verificationPromise;
  } finally {
    verificationInFlight.delete(cacheKey);
  }
}

async function fetchLicenseActivation(
  config: ToolConfig,
  licenseKey: string,
  machineId: string,
  checkedAt: string,
): Promise<LicenseVerificationResult> {
  return fetchAcrossLicenseEndpoints(
    config,
    (endpointConfig) =>
      fetchLicenseActivationForEndpoint(endpointConfig, licenseKey, machineId, checkedAt),
  );
}

async function fetchLicenseActivationForEndpoint(
  config: ToolConfig,
  licenseKey: string,
  machineId: string,
  checkedAt: string,
): Promise<LicenseVerificationResult> {
  const dbCandidates = resolveOdooDatabaseCandidates(config);
  let lastResult: LicenseVerificationResult | null = null;

  for (const db of dbCandidates) {
    try {
      const activateUrl = config.license.verifyUrl.replace(
        /\/verify$/,
        "/activate",
      );
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (db) {
        requestHeaders["X-Odoo-Database"] = db;
      }
      const requestBody = {
        app_name: config.license.appName,
        key: licenseKey,
        machine_id: machineId,
        scope: config.license.scope || undefined,
      };

      logLicenseDebug(
        `[License] Activating key at: ${activateUrl} using db: "${db}"`,
      );
      const response = await fetch(activateUrl, {
        body: JSON.stringify(requestBody),
        headers: requestHeaders,
        method: "POST",
      });

      const payload = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      logLicenseDebug(
        `[License] Response status: ${response.status} for db: "${db}"`,
      );
      logLicenseDebug(`[License] Response payload:`, payload);

      const normalized = normalizeLicenseResponse(
        payload,
        checkedAt,
        licenseKey,
        response.status,
      );

      const sessionToken =
        typeof payload.session_token === "string"
          ? payload.session_token
          : undefined;
      const isDbError =
        response.status === 404 ||
        response.status === 500 ||
        (typeof payload.message === "string" &&
          (payload.message.toLowerCase().includes("database") ||
            payload.message.toLowerCase().includes("db") ||
            payload.message.toLowerCase().includes("không tìm thấy csdl")));

      if (response.ok && normalized.valid && normalized.allowed) {
        return {
          ...normalized,
          sessionToken,
        };
      }

      lastResult = {
        ...normalized,
        allowed: false,
        message:
          normalized.message ||
          `Odoo tu choi license key voi HTTP ${response.status}.`,
        valid: false,
        sessionToken,
      };

      if (!isDbError) {
        // If it's a real validation rejection (e.g. key expired or bound to other device), return immediately
        return lastResult;
      }
    } catch (error) {
      logLicenseNetworkFailure("activation", config.license.verifyUrl, db, error);
    }
  }

  if (lastResult) return lastResult;
  return networkFailureResult(licenseKey, checkedAt, [config.license.verifyUrl]);
}

async function fetchLicenseVerification(
  config: ToolConfig,
  sessionToken: string,
  machineId: string,
  licenseKey: string,
  checkedAt: string,
): Promise<LicenseVerificationResult> {
  return fetchAcrossLicenseEndpoints(
    config,
    (endpointConfig) =>
      fetchLicenseVerificationForEndpoint(
        endpointConfig,
        sessionToken,
        machineId,
        licenseKey,
        checkedAt,
      ),
  );
}

async function fetchLicenseVerificationForEndpoint(
  config: ToolConfig,
  sessionToken: string,
  machineId: string,
  licenseKey: string,
  checkedAt: string,
): Promise<LicenseVerificationResult> {
  const dbCandidates = resolveOdooDatabaseCandidates(config);
  let lastResult: LicenseVerificationResult | null = null;

  for (const db of dbCandidates) {
    try {
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (db) {
        requestHeaders["X-Odoo-Database"] = db;
      }
      const requestBody = {
        app_name: config.license.appName,
        machine_id: machineId,
        scope: config.license.scope || undefined,
        session_token: sessionToken,
      };

      logLicenseDebug(
        `[License] Verifying token at: ${config.license.verifyUrl} using db: "${db}"`,
      );
      const response = await fetch(config.license.verifyUrl, {
        body: JSON.stringify(requestBody),
        headers: requestHeaders,
        method: "POST",
      });

      const payload = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      logLicenseDebug(
        `[License] Response status: ${response.status} for db: "${db}"`,
      );
      logLicenseDebug(`[License] Response payload:`, payload);

      const normalized = normalizeLicenseResponse(
        payload,
        checkedAt,
        licenseKey,
        response.status,
      );

      const isDbError =
        response.status === 404 ||
        response.status === 500 ||
        (typeof payload.message === "string" &&
          (payload.message.toLowerCase().includes("database") ||
            payload.message.toLowerCase().includes("db") ||
            payload.message.toLowerCase().includes("không tìm thấy csdl")));

      if (response.ok && normalized.valid && normalized.allowed) {
        return {
          ...normalized,
          sessionToken,
        };
      }

      lastResult = {
        ...normalized,
        allowed: false,
        message:
          normalized.message ||
          `Odoo tu choi license verify voi HTTP ${response.status}.`,
        valid: false,
      };

      if (!isDbError) {
        return lastResult;
      }
    } catch (error) {
      logLicenseNetworkFailure("verification", config.license.verifyUrl, db, error);
    }
  }

  if (lastResult) return lastResult;
  return networkFailureResult(licenseKey, checkedAt, [config.license.verifyUrl]);
}

async function fetchLicenseVerificationWithKey(
  config: ToolConfig,
  licenseKey: string,
  machineId: string,
  checkedAt: string,
): Promise<LicenseVerificationResult> {
  return fetchAcrossLicenseEndpoints(
    config,
    (endpointConfig) =>
      fetchLicenseVerificationWithKeyForEndpoint(
        endpointConfig,
        licenseKey,
        machineId,
        checkedAt,
      ),
  );
}

async function fetchLicenseVerificationWithKeyForEndpoint(
  config: ToolConfig,
  licenseKey: string,
  machineId: string,
  checkedAt: string,
): Promise<LicenseVerificationResult> {
  const dbCandidates = resolveOdooDatabaseCandidates(config);
  let lastResult: LicenseVerificationResult | null = null;

  for (const db of dbCandidates) {
    try {
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (db) {
        requestHeaders["X-Odoo-Database"] = db;
      }
      const requestBody = {
        app_name: config.license.appName,
        machine_id: machineId,
        scope: config.license.scope || undefined,
        key: licenseKey,
      };

      logLicenseDebug(
        `[License] Verifying key at: ${config.license.verifyUrl} using db: "${db}"`,
      );
      const response = await fetch(config.license.verifyUrl, {
        body: JSON.stringify(requestBody),
        headers: requestHeaders,
        method: "POST",
      });

      const payload = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      logLicenseDebug(
        `[License] Response status: ${response.status} for db: "${db}"`,
      );
      logLicenseDebug(`[License] Response payload:`, payload);

      const normalized = normalizeLicenseResponse(
        payload,
        checkedAt,
        licenseKey,
        response.status,
      );

      const sessionToken =
        typeof payload.session_token === "string"
          ? payload.session_token
          : undefined;
      const isDbError =
        response.status === 404 ||
        response.status === 500 ||
        (typeof payload.message === "string" &&
          (payload.message.toLowerCase().includes("database") ||
            payload.message.toLowerCase().includes("db") ||
            payload.message.toLowerCase().includes("không tìm thấy csdl")));

      if (response.ok && normalized.valid && normalized.allowed) {
        return {
          ...normalized,
          sessionToken,
        };
      }

      lastResult = {
        ...normalized,
        allowed: false,
        message:
          normalized.message ||
          `Odoo tu choi license verify voi HTTP ${response.status}.`,
        valid: false,
        sessionToken,
      };

      if (!isDbError) {
        return lastResult;
      }
    } catch (error) {
      logLicenseNetworkFailure("key verification", config.license.verifyUrl, db, error);
    }
  }

  if (lastResult) return lastResult;
  return networkFailureResult(licenseKey, checkedAt, [config.license.verifyUrl]);
}

async function fetchAcrossLicenseEndpoints(
  config: ToolConfig,
  fetchEndpoint: (config: ToolConfig) => Promise<LicenseVerificationResult>,
): Promise<LicenseVerificationResult> {
  let firstFailure: LicenseVerificationResult | null = null;
  let preferredFailure: LicenseVerificationResult | null = null;
  const networkEndpoints: string[] = [];

  for (const verifyUrl of resolveLicenseVerifyUrls(config)) {
    const endpointConfig: ToolConfig = {
      ...config,
      license: {
        ...config.license,
        verifyUrl,
      },
    };
    const result = await fetchEndpoint(endpointConfig);
    if (result.valid && result.allowed) return result;
    firstFailure ??= result;
    if (result.reason === "network_error") {
      networkEndpoints.push(verifyUrl);
    } else {
      preferredFailure ??= result;
    }
  }

  if (preferredFailure) return preferredFailure;
  if (networkEndpoints.length) {
    return {
      ...(firstFailure ?? networkFailureResult("", new Date().toISOString(), networkEndpoints)),
      allowed: false,
      message: networkFailureMessage(networkEndpoints),
      reason: "network_error",
      valid: false,
    };
  }

  return (
    firstFailure ||
    networkFailureResult("", new Date().toISOString(), resolveLicenseVerifyUrls(config))
  );
}
export function normalizeLicenseResponse(
  payload: Record<string, unknown>,
  checkedAt: string,
  licenseKey: string,
  httpStatus?: number,
): LicenseVerificationResult {
  const reason =
    firstString(payload.reason, payload.code) ||
    inferReasonFromPayload(payload, httpStatus);
  const inferredFlags = inferFlagsFromReason(reason);
  const hasExplicitFailure =
    payload.valid === false ||
    payload.allowed === false ||
    payload.success === false;

  const valid = hasExplicitFailure
    ? false
    : coerceBoolean(payload.valid, payload.success, inferredFlags.valid);

  const allowed = hasExplicitFailure
    ? false
    : coerceBoolean(payload.allowed, payload.success, inferredFlags.allowed);

  const finalValid = valid && allowed;
  const finalAllowed = valid && allowed;
  const message =
    firstString(payload.message) || mapReasonToMessage(reason, finalValid, finalAllowed);
  const employee = asRecord(payload.employee);
  const license = asRecord(payload.license_key);

  return {
    allowed: finalAllowed,
    checkedAt,
    employeeName: firstString(employee?.name, payload.employee_name) || "",
    expiresAt:
      firstString(
        payload.expires_at,
        payload.expiry_date,
        payload.expires_on,
      ) || "",
    keyPreview:
      firstString(license?.preview) ||
      maskLicenseKey(firstString(payload.key) || licenseKey),
    message,
    reason: finalValid ? reason : (reason === "ok" ? "invalid_key" : reason),
    valid: finalValid,
  };
}

function coerceBoolean(...values: unknown[]): boolean {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return false;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function inferReason(valid: boolean, allowed: boolean): string {
  if (valid && allowed) return "ok";
  if (!valid) return "invalid_key";
  return "scope_not_allowed";
}

function inferReasonFromPayload(
  payload: Record<string, unknown>,
  httpStatus?: number,
): string {
  const message = firstString(payload.message).toLowerCase();

  if (message.includes("revoked")) {
    return "revoked";
  }
  if (message.includes("expired")) {
    return "expired";
  }
  if (
    message.includes("activated on another device") ||
    message.includes("bound to another device") ||
    message.includes("activated on another machine") ||
    message.includes("machine_id")
  ) {
    return "device_bound_other";
  }
  if (
    message.includes("not found") ||
    message.includes("không tìm thấy") ||
    message.includes("does not exist")
  ) {
    return "invalid_key";
  }
  if (
    message.includes("invalid session token") ||
    (message.includes("session token") && message.includes("invalid")) ||
    message.includes("session token not found")
  ) {
    return "invalid_token";
  }
  if (
    message.includes("scope") ||
    message.includes("not authorized") ||
    message.includes("not assigned")
  ) {
    return "scope_not_allowed";
  }
  if (message.includes("required")) {
    if (
      message.includes("session token") ||
      message.includes("session_token")
    ) {
      return "invalid_token";
    }
    return "missing_key";
  }

  if (payload.success === true || payload.valid === true) {
    return "ok";
  }

  if (payload.success === false || payload.valid === false) {
    if (httpStatus === 401) return "invalid_token";
    if (httpStatus === 403) return "invalid_key";
    return "invalid_key";
  }

  if (httpStatus === 200 && payload.success === undefined && payload.valid === undefined) {
    return "ok";
  }

  if (httpStatus === 400) {
    return "missing_key";
  }
  if (httpStatus === 401) {
    return "invalid_token";
  }
  if (httpStatus === 404) {
    return "invalid_key";
  }
  if (httpStatus === 403) {
    return "invalid_key";
  }

  return inferReason(false, false);
}

function inferFlagsFromReason(reason: string): {
  allowed: boolean;
  valid: boolean;
} {
  switch (reason) {
    case "ok":
      return { allowed: true, valid: true };
    case "scope_not_allowed":
      return { allowed: false, valid: true };
    default:
      return { allowed: false, valid: false };
  }
}

function mapReasonToMessage(
  reason: string,
  valid: boolean,
  allowed: boolean,
): string {
  if (valid && allowed) return "License hop le.";
  switch (reason) {
    case "missing_key":
      return "Chưa có license key trên máy này";
    case "expired":
      return "License key da het han.";
    case "revoked":
      return "License key da bi thu hoi.";
    case "employee_inactive":
      return "Nhan vien gan voi license key dang bi khoa.";
    case "scope_not_allowed":
      return "License key khong co quyen dung tool nay.";
    case "network_error":
      return "Khong ket noi duoc Odoo de kiem tra license.";
    case "device_bound_other":
      return "License has already been activated on another device";
    case "invalid_token":
      return "Phiên làm việc hết hạn hoặc không hợp lệ. Vui lòng kích hoạt lại.";
    case "invalid_key":
      return "License key khong hop le hoac khong ton tai tren Odoo. Hay Kiểm tra lại key full da copy tu Odoo.";
    default:
      return "License key khong hop le.";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resolveLicenseVerifyUrls(config: ToolConfig): string[] {
  return Array.from(
    new Set(
      [
        ...(config.license.verifyUrls ?? []),
        config.license.verifyUrl,
      ]
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  );
}

function resolveOdooDatabaseCandidates(
  config: ToolConfig,
  _verifyUrl = config.license.verifyUrl,
): string[] {
  const configuredDb = config.license.odooDatabase.trim();
  if (configuredDb && (configuredDb.toLowerCase() !== "samic" || _verifyUrl.includes("samic-erp"))) {
    return [configuredDb];
  }

  return [""];
}

function logLicenseDebug(...args: unknown[]): void {
  if (process.env.LICENSE_DEBUG === "1") {
    console.log(...args);
  }
}
function logLicenseNetworkFailure(
  operation: string,
  endpoint: string,
  db: string,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  logLicenseDebug(
    `[License] ${operation} unavailable at ${endpoint} using db "${db}": ${message}`,
  );
}

function networkFailureMessage(endpoints: string[]): string {
  const uniqueEndpoints = Array.from(new Set(endpoints.filter(Boolean)));
  const suffix = uniqueEndpoints.length
    ? ` Đã thử: ${uniqueEndpoints.join(", ")}.`
    : "";
  return `Không kết nối được máy chủ cấp phép.${suffix} Kiểm tra server/port rồi thử lại.`;
}

function networkFailureResult(
  licenseKey: string,
  checkedAt: string,
  endpoints: string[],
): LicenseVerificationResult {
  return {
    allowed: false,
    checkedAt,
    employeeName: "",
    expiresAt: "",
    keyPreview: maskLicenseKey(licenseKey),
    message: networkFailureMessage(endpoints),
    reason: "network_error",
    valid: false,
  };
}
function buildCacheKey(
  config: ToolConfig,
  licenseKey: string,
  sessionToken: string,
): string {
  return [
    ...(config.license.verifyUrls ?? []),
    config.license.verifyUrl,
    config.license.odooDatabase,
    config.license.scope,
    licenseKey,
    sessionToken,
  ].join("|");
}

export function maskLicenseKey(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  if (normalized.length <= 8) return "*".repeat(normalized.length);
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}
