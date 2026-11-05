import {
  cacheKey,
  extractPostUrls,
  matchShareUrl,
  normalizeThreadsNavigationUrl,
  normalizeThreadsUrl,
} from "../../apps/server/src/modules/crawl/collectors/threads-url";

const baseUrl = "https://www.threads.com";
const post = normalizeThreadsUrl("https://m.threads.net/@Demo/post/ABC_123/?x=1#reply", baseUrl);
if (post.kind !== "post" || post.url !== "https://www.threads.com/@Demo/post/ABC_123") {
  throw new Error(`Unexpected normalized post target: ${JSON.stringify(post)}.`);
}

const share = normalizeThreadsUrl("https://threads.com/t/SHARE123?share=1", baseUrl);
if (share.kind !== "post" || share.url !== "https://www.threads.com/t/SHARE123") {
  throw new Error(`Unexpected normalized share target: ${JSON.stringify(share)}.`);
}

const copiedShare = normalizeThreadsUrl(
  "https://www.threads.com/share/Fj3BUMon4/",
  baseUrl,
);
if (
  copiedShare.kind !== "post" ||
  copiedShare.url !== "https://www.threads.com/share/Fj3BUMon4/"
) {
  throw new Error(
    `Unexpected normalized copied share target: ${JSON.stringify(copiedShare)}.`,
  );
}

const signedPostUrl =
  "https://www.threads.com/@jqklone/post/DdK8JePCcLK?xmt=AQG0g3mjqjnU36EOXUqnqDrf1WleS6QyT5-KopCMi77me6GRko_8osh2nAPmjZC_J2T8L9M";
const signedNavigationUrl = normalizeThreadsNavigationUrl(signedPostUrl, baseUrl);
if (signedNavigationUrl !== signedPostUrl) {
  throw new Error(`Expected signed post query to be retained for navigation: ${signedNavigationUrl}.`);
}

const signedShareUrl = normalizeThreadsNavigationUrl(
  "https://www.threads.com/share/F2G13cPhn/?xmt=share-token#reply",
  baseUrl,
);
if (signedShareUrl !== "https://www.threads.com/share/F2G13cPhn/?xmt=share-token") {
  throw new Error(`Expected share query to be retained without the fragment: ${signedShareUrl}.`);
}

const mobileShare = normalizeThreadsUrl(
  "https://m.threads.net/share/Fj3BUMon4/",
  baseUrl,
);
if (
  mobileShare.kind !== "post" ||
  mobileShare.url !== "https://www.threads.com/share/Fj3BUMon4/"
) {
  throw new Error(
    `Expected mobile share URL to be detected: ${JSON.stringify(mobileShare)}.`,
  );
}
if (!matchShareUrl("https://m.threads.net/share/Fj3BUMon4/?x=1")) {
  throw new Error("Expected matchShareUrl to accept a mobile Threads host.");
}
const extractedMobileShare = extractPostUrls(
  ["Open https://m.threads.net/share/Fj3BUMon4/?x=1"],
  baseUrl,
);
if (extractedMobileShare.length !== 1) {
  throw new Error(
    `Expected one extracted mobile share URL, got ${JSON.stringify(extractedMobileShare)}.`,
  );
}

const profile = normalizeThreadsUrl("https://www.threads.net/@Demo/?hl=vi", baseUrl);
if (profile.kind !== "profile" || profile.url !== "https://www.threads.com/@Demo") {
  throw new Error(`Unexpected normalized profile target: ${JSON.stringify(profile)}.`);
}

if (normalizeThreadsUrl("https://threads.com/search?q=world+cup", baseUrl).kind !== "search") {
  throw new Error("Expected a Threads search URL to be detected as search.");
}
if (normalizeThreadsUrl("https://example.com/@demo/post/ABC", baseUrl).kind !== "unsupported") {
  throw new Error("Expected a non-Threads URL to be rejected.");
}
if (cacheKey("https://www.threads.com/@demo/post/ABC/?x=1#foo") !== "https://www.threads.com/@demo/post/ABC") {
  throw new Error("Expected cache keys to remove query, hash, and trailing slash.");
}

console.log("smoke:threads-url-targets ok");
