import {
  buildStartPayload,
  resolveImplicitViralRuntimeBudget,
} from "../../apps/web/src/features/crawl-console/payload";
import {
  defaultForm,
  type CrawlFormState,
} from "../../apps/web/src/features/crawl-console/form-state";
import {
  resolveAdaptiveViralReserveTarget,
  resolveProfileBackfillLimit,
  resolveViralProfileSummaryTarget,
} from "../../apps/server/src/modules/crawl/collectors/threads-web";

const cases = [
  { target: 5, candidate: 120, collected: 50, detail: 40, finalist: 15, adaptive: 18, profiles: 32, profileSummaries: 32 },
  { target: 10, candidate: 150, collected: 80, detail: 60, finalist: 30, adaptive: 30, profiles: 32, profileSummaries: 32 },
  { target: 20, candidate: 150, collected: 100, detail: 80, finalist: 32, adaptive: 32, profiles: 36, profileSummaries: 30 },
  { target: 30, candidate: 150, collected: 135, detail: 120, finalist: 41, adaptive: 41, profiles: 40, profileSummaries: 40 },
] as const;

for (const expected of cases) {
  const budget = resolveImplicitViralRuntimeBudget(expected.target);
  const actual = {
    adaptive: resolveAdaptiveViralReserveTarget(expected.target),
    candidate: budget.maxCandidateLinks,
    collected: budget.maxCollectedPostsPerTopic,
    detail: budget.maxDetailRequests,
    finalist: budget.maxCommentScanPosts,
    profiles: resolveProfileBackfillLimit(expected.target),
    profileSummaries: resolveViralProfileSummaryTarget(expected.target),
  };
  for (const [key, value] of Object.entries(actual)) {
    const expectedValue = expected[key as keyof typeof expected];
    if (value !== expectedValue) {
      throw new Error(
        `Target ${expected.target}: expected ${key}=${expectedValue}, got ${value}.`,
      );
    }
  }
}

const smallPayload = buildStartPayload({
  ...defaultForm,
  datePreset: "none",
  sourceMode: "discover",
  topicTitle: "",
  wantedPosts: 5,
} satisfies CrawlFormState);
if (
  smallPayload.overrides?.maxConcurrency !== 3 ||
  smallPayload.overrides?.maxDetailRequests !== 40
 ) {
  throw new Error("Target 5 payload must use adaptive 40-post depth with concurrency three.");
}

const largePayload = buildStartPayload({
  ...defaultForm,
  datePreset: "none",
  sourceMode: "discover",
  topicTitle: "",
  wantedPosts: 20,
} satisfies CrawlFormState);
if (
  largePayload.overrides?.maxConcurrency !== 3 ||
  largePayload.overrides?.maxCandidateLinks !== 150 ||
  largePayload.overrides?.maxCollectedPostsPerTopic !== 100 ||
  largePayload.overrides?.maxDetailRequests !== 80 ||
  largePayload.overrides?.maxCommentScanPosts !== 32
) {
  throw new Error("Target 20 payload did not receive the scalable Viral feed profile.");
}

for (const target of [10, 20, 30]) {
  const budget = resolveImplicitViralRuntimeBudget(target);
  if (budget.maxCandidateLinks > 150) {
    throw new Error(`Target ${target}: candidate budget must stay within the API cap.`);
  }
  if (budget.maxDetailRequests < target * 4) {
    throw new Error(`Target ${target}: detail budget is too shallow for production Viral feed.`);
  }
}

const target20 = resolveImplicitViralRuntimeBudget(20);
if (target20.maxCommentScanPosts >= 40) {
  throw new Error("Target 20 must not use the old 2x finalist scan budget.");
}
if (resolveAdaptiveViralReserveTarget(5) < 18) {
  throw new Error("Target 5 must keep a deep enough production reserve.");
}

console.log("smoke:viral-scale-budget ok");