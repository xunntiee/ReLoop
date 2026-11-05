export function resolveImplicitViralRuntimeBudget(maxPostsInput: number): {
  maxCandidateLinks: number;
  maxCollectedPostsPerTopic: number;
  maxCommentScanPosts: number;
  maxDetailRequests: number;
} {
  const maxPosts = Math.max(1, Math.trunc(maxPostsInput || 1));
  const candidateMultiplier =
    maxPosts <= 5 ? 24 : maxPosts <= 10 ? 18 : maxPosts <= 20 ? 8 : 7;
  const collectedMultiplier =
    maxPosts <= 5 ? 10 : maxPosts <= 10 ? 8 : maxPosts <= 20 ? 5 : 4.5;
  const finalistMultiplier =
    maxPosts <= 5 ? 3 : maxPosts <= 10 ? 3 : maxPosts <= 20 ? 1.6 : 1.35;
  const detailMultiplier = maxPosts <= 5 ? 8 : maxPosts <= 10 ? 6 : 4;
  const maxCandidateLinks = Math.min(
    150,
    Math.max(Math.ceil(maxPosts * candidateMultiplier), maxPosts + 30, 36),
  );
  return {
    maxCandidateLinks,
    maxCollectedPostsPerTopic: Math.min(
      maxCandidateLinks,
      Math.max(Math.ceil(maxPosts * collectedMultiplier), maxPosts + 20, 24),
    ),
    maxCommentScanPosts: Math.max(
      maxPosts,
      Math.ceil(maxPosts * finalistMultiplier),
    ),
    maxDetailRequests: Math.min(
      maxCandidateLinks,
      Math.max(maxPosts * detailMultiplier, maxPosts + 8, 8),
    ),
  };
}
