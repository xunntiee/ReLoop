export interface CommentScanCandidate {
  isReply?: boolean;
  likeCount?: number;
  metricTexts?: string[];
  replyCount?: number;
  text: string;
  username: string;
}

export interface CommentScanProfile {
  expectedCountStopTarget: number;
  maxRounds: number;
  minStableRounds: number;
  minTopConfidenceRounds: number;
  minimumCollectedTarget: number;
  scanDelayMs: number;
  stableBottomRounds: number;
  topFrontierStableRounds: number;
}

export interface CommentTopFrontier {
  loadedCount: number;
  outsideBestRank: number;
  signature: string;
  targetCount: number;
  weakestTopRank: number;
}

export function sourceOrderedCommentAssetIndexes(
  commentCount: number,
  requestedTopComments: number,
  maxAssets = 20,
): number[] {
  const count = Math.max(0, Math.trunc(commentCount || 0));
  const requested = Math.max(0, Math.trunc(requestedTopComments || 0));
  const limit = Math.min(count, requested, Math.max(0, Math.trunc(maxAssets || 0)));
  return Array.from({ length: limit }, (_, index) => index);
}

const THOROUGH_COMMENT_SCAN_ROUNDS = 180;

export function buildCommentScanProfile(
  scrollRounds: number,
  expectedCommentCount: number,
  desiredTopComments: number,
  delayMs: number,
): CommentScanProfile {
  const requestedRounds = Math.max(0, Math.trunc(scrollRounds || 0));
  const desiredCommentCount = Math.max(1, Math.trunc(desiredTopComments || 1));
  const expectedCoversRequestedTarget = expectedCommentCount >= desiredCommentCount;
  const requestedLimit = requestedRounds > 0 ? requestedRounds * 10 : 0;
  const minimumCollectedTarget =
    expectedCoversRequestedTarget
      ? Math.min(
          Math.max(desiredCommentCount, Math.ceil(expectedCommentCount * 0.35)),
          Math.max(desiredCommentCount + 3, desiredCommentCount + 2),
        )
      : desiredCommentCount + 2;
  const expectedCountStopTarget =
    expectedCoversRequestedTarget
      ? Math.min(
          expectedCommentCount,
          Math.max(desiredCommentCount + 2, Math.ceil(expectedCommentCount * 0.45)),
        )
      : minimumCollectedTarget;
  const countBasedLimit = Math.max(
    minimumCollectedTarget + 2,
    Math.min(
      expectedCoversRequestedTarget ? expectedCommentCount : minimumCollectedTarget,
      expectedCountStopTarget + desiredCommentCount,
    ),
  );

  return {
    expectedCountStopTarget,
    maxRounds: Math.min(
      THOROUGH_COMMENT_SCAN_ROUNDS,
      Math.max(12, requestedLimit, desiredCommentCount * 2 + 4, countBasedLimit),
    ),
    minStableRounds: 4,
    minTopConfidenceRounds: 2,
    minimumCollectedTarget,
    scanDelayMs: Math.min(520, Math.max(180, Math.floor(delayMs * 0.55))),
    stableBottomRounds: 2,
    topFrontierStableRounds: 3,
  };
}

export function buildCommentTopFrontier(
  comments: Iterable<CommentScanCandidate>,
  desiredTopComments: number,
  _expectedCommentCount: number,
): CommentTopFrontier | null {
  const targetCount = Math.max(1, Math.trunc(desiredTopComments));
  // “Top comments” on Threads means the first top-level comments in the
  // selected “Hàng đầu” thread order. Nested replies can have more likes than
  // their parent and must not occupy the requested top-comment slots or make
  // the scan stop early. Keep DOM insertion order here; ranking by likes would
  // turn a reply tree into a different flat list.
  const ranked = [...comments]
    .filter((comment) => comment.isReply !== true);
  if (ranked.length === 0) return null;

  const topComments = ranked.slice(0, targetCount);
  const weakestTopRank = topComments.length > 0 ? commentCandidateRank(topComments.at(-1) as CommentScanCandidate) : 0;
  const outsideBestRank = ranked.length > targetCount ? commentCandidateRank(ranked[targetCount] as CommentScanCandidate) : -1;
  const signature = topComments
    .map((comment) =>
      [
        normalizeIdentity(comment.username),
        metricNumber(comment.likeCount),
        metricNumber(comment.replyCount),
        compactText(comment.text).slice(0, 48),
      ].join("|"),
    )
    .join("||");

  return {
    loadedCount: ranked.length,
    outsideBestRank,
    signature,
    targetCount,
    weakestTopRank,
  };
}

export function commentCandidateRank(comment: CommentScanCandidate): number {
  return (
    metricNumber(comment.likeCount) * 1000 +
    metricNumber(comment.replyCount) * 20 +
    Math.min(300, compactText(comment.text).length) +
    Math.min(40, Array.isArray(comment.metricTexts) ? comment.metricTexts.length : 0)
  );
}

function normalizeIdentity(value: string): string {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}

function compactText(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function metricNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
