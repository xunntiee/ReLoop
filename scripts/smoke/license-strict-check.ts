import { toolConfigSchema } from "@tool-base/config/schema";
import { normalizeVerifyUrl, normalizeVerifyUrls } from "@tool-base/config/server";
import { normalizeLicenseResponse, verifyLicense, clearLicenseCache } from "../../apps/server/src/modules/license/odoo-license.js";

async function runLicenseSmokeTests() {
  console.log("=== Testing License Enforcement ===");

  // Test 1: Default config schema has enabled: true
  const parsedDefault = toolConfigSchema.parse({});
  if (!parsedDefault.license.enabled) {
    throw new Error("FAIL: Default license.enabled should be true!");
  }
  console.log("PASS 1: Default config has license.enabled = true");

  // Test 2: Verify with empty key
  const mockConfig = parsedDefault;
  const emptyKeyResult = await verifyLicense(mockConfig, "");
  if (emptyKeyResult.valid || emptyKeyResult.allowed) {
    throw new Error("FAIL: Empty key should be invalid and disallowed!");
  }
  console.log("PASS 2: Empty key returns valid=false, allowed=false");

  // Test 3: Normalize Odoo response returning 200 with success=false
  const mockCheckedAt = new Date().toISOString();
  const falsePayloadResult = (normalizeLicenseResponse as any)(
    { success: false, message: "License key khong hop le" },
    mockCheckedAt,
    "TEST-KEY",
    200
  );
  if (falsePayloadResult.valid || falsePayloadResult.allowed) {
    throw new Error("FAIL: Payload with success=false MUST return valid=false!");
  }
  console.log("PASS 3: HTTP 200 with success=false correctly returns valid=false");

  // Test 4: Cache clear functionality
  clearLicenseCache();
  console.log("PASS 4: Cache clear succeeds");

  // Test 5: URL normalization removes duplicate slashes and deduplicates Portal.
  const normalizedUrl = normalizeVerifyUrl(
    "https://portal.monback.app//api/v1/license/verify/",
  );
  if (normalizedUrl !== "https://portal.monback.app/api/v1/license/verify") {
    throw new Error(`FAIL: Unexpected normalized license URL: ${normalizedUrl}`);
  }
  const normalizedUrls = normalizeVerifyUrls(
    "portal.monback.app,\nhttps://portal.monback.app/",
  );
  if (
    normalizedUrls.length !== 1 ||
    normalizedUrls[0] !== "https://portal.monback.app/api/v1/license/verify"
  ) {
    throw new Error(`FAIL: Unexpected normalized license URL list: ${normalizedUrls.join(", ")}`);
  }
  console.log("PASS 5: License URL list normalization and deduplication work");
  // Test 6: Network failures return a concise actionable result and do not throw.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  try {
    const networkConfig = toolConfigSchema.parse({
      license: {
        odooDatabase: "",
        verifyUrls: [
          "http://127.0.0.1:1/api/v1/license/verify",
          "http://127.0.0.1:2/api/v1/license/verify",
        ],
        verifyUrl: "http://127.0.0.1:1/api/v1/license/verify",
      },
    });
    const networkResult = await verifyLicense(networkConfig, "NETWORK-SMOKE-KEY", {
      bypassCache: true,
    });
    if (
      networkResult.reason !== "network_error" ||
      !networkResult.message.includes("server/port")
    ) {
      throw new Error(`FAIL: Unexpected network error result: ${networkResult.message}`);
    }
    console.log("PASS 6: Network license failure is concise and actionable");
  } finally {
    globalThis.fetch = originalFetch;
    clearLicenseCache();
  }

  console.log("\nALL LICENSE SMOKE TESTS PASSED SUCCESSFULLY!");
}

runLicenseSmokeTests().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
