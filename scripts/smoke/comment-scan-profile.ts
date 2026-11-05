import {
  buildCommentScanProfile,
  buildCommentTopFrontier,
  type CommentScanCandidate,
} from "../../apps/server/src/modules/crawl/collectors/threads-comment-scan";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const requestedCommentTarget = 35;
const underreportedExpectedCount = 11;

const underreportedProfile = buildCommentScanProfile(
  0,
  underreportedExpectedCount,
  requestedCommentTarget,
  300,
);

expect(
  underreportedProfile.minimumCollectedTarget >= requestedCommentTarget,
  `Expected minimumCollectedTarget to honor requested target ${requestedCommentTarget}, got ${underreportedProfile.minimumCollectedTarget}.`,
);
expect(
  underreportedProfile.expectedCountStopTarget >= requestedCommentTarget,
  `Expected expectedCountStopTarget to avoid stopping at underreported count ${underreportedExpectedCount}, got ${underreportedProfile.expectedCountStopTarget}.`,
);
expect(
  underreportedProfile.maxRounds >= requestedCommentTarget * 2,
  `Expected maxRounds to scale with requested target ${requestedCommentTarget}, got ${underreportedProfile.maxRounds}.`,
);

const loadedCandidates: CommentScanCandidate[] = Array.from({ length: underreportedExpectedCount }, (_, index) => ({
  likeCount: underreportedExpectedCount - index,
  replyCount: index % 2,
  text: `comment ${index + 1}`,
  username: `user${index + 1}`,
}));

const frontier = buildCommentTopFrontier(
  loadedCandidates,
  requestedCommentTarget,
  underreportedExpectedCount,
);

expect(frontier !== null, "Expected a frontier for loaded comments.");
expect(
  frontier?.targetCount === requestedCommentTarget,
  `Expected frontier targetCount ${requestedCommentTarget}, got ${String(frontier?.targetCount)}.`,
);
expect(
  (frontier?.loadedCount ?? 0) < (frontier?.targetCount ?? 0),
  `Expected ${underreportedExpectedCount} loaded comments to remain below requested target ${requestedCommentTarget}.`,
);

const reliableProfile = buildCommentScanProfile(0, 100, requestedCommentTarget, 300);
expect(
  reliableProfile.minimumCollectedTarget >= requestedCommentTarget,
  `Expected reliable known count profile to still honor requested target, got ${reliableProfile.minimumCollectedTarget}.`,
);

console.log("smoke:comment-scan-profile ok");
