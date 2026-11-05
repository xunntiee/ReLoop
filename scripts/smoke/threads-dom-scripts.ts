import { readFileSync } from "node:fs";
import { join } from "node:path";

const sourcePath = join(process.cwd(), "apps/server/src/modules/crawl/collectors/threads-web.ts");
const source = readFileSync(sourcePath, "utf8");

for (const [name, nextMarker] of [
  ["POST_META_SCRIPT", "const COMMENT_BLOCKS_SCRIPT"],
  ["COMMENT_BLOCKS_SCRIPT", "export class ThreadsWebCollector"],
] as const) {
  const raw = extractTemplateConstant(name, nextMarker);
  const script = evaluateTemplateLiteral(raw, name);
  assertNoUnexpectedControlChars(script, name);
  assertParsesAsBrowserExpression(script, name);
}

if (!source.includes("if (targetPostId && !threadRegion && !commentSectionMarker) return [];")) {
  throw new Error("COMMENT_BLOCKS_SCRIPT must allow a marker-based fallback when the root post anchor is absent");
}

if (!source.includes("anchorRect.left - nearestPriorAnchor.left >= 24")) {
  throw new Error("COMMENT_BLOCKS_SCRIPT must require a real visual indent before marking a comment as a reply");
}

if (source.includes("anchorRect.left >= nearestPriorAnchor.left - 12")) {
  throw new Error("COMMENT_BLOCKS_SCRIPT must not mark same-level siblings as replies");
}

if (!source.includes("onProgress?.(countTopLevelCommentBlocks(collected));")) {
  throw new Error("Comment progress must report usable top-level candidates, not raw reply candidates");
}

if (!source.includes("mediaItems(mediaRoot, anchor, scopeRoot)")) {
  throw new Error("Comment media must be scoped with the comment author anchor");
}

if (!source.includes("resolveCommentMediaRange(root, anchor)")) {
  throw new Error("Comment media extraction must stop before the next same-level comment");
}

if (!source.includes("resolveMediaRoot(best.node, scopedText, anchor)")) {
  throw new Error("Comment media root must be resolved with the comment author anchor");
}

if (!source.includes("clickNextVisibleCommentMedia(page)")) {
  throw new Error("Comment crawl must walk visible carousel slides before stopping a scan pass");
}

if (!source.includes("translate|dich|dịch")) {
  throw new Error("Post carousel scanning must not treat the Threads translate control as next media");
}

if (!source.includes(".slice(0, 24)") || !source.includes("const mediaPassLimit = expectedCount >= 500 ? 3 : 6;")) {
  throw new Error("Visible comment carousel scanning must stay bounded on high-comment posts");
}

if (!source.includes("page.isClosed() || isClosedPageError(error)")) {
  throw new Error("A closed page during optional carousel scanning must preserve the collected comments");
}

if (!source.includes("const mergedMedia = normalizeRawMedia([")) {
  throw new Error("Repeated comment scans must merge carousel media instead of replacing the previous slide");
}

console.log("[smoke] threads-dom-scripts passed");

function extractTemplateConstant(name: string, nextMarker: string): string {
  const startToken = `const ${name} = \``;
  const start = source.indexOf(startToken);
  if (start < 0) {
    throw new Error(`${name}: start marker not found`);
  }

  const contentStart = start + startToken.length;
  const next = source.indexOf(nextMarker, contentStart);
  if (next < 0) {
    throw new Error(`${name}: next marker not found`);
  }

  const end = source.lastIndexOf("`;", next);
  if (end < contentStart) {
    throw new Error(`${name}: template end not found`);
  }

  return source.slice(contentStart, end);
}

function evaluateTemplateLiteral(raw: string, name: string): string {
  if (raw.includes("`") || raw.includes("${")) {
    throw new Error(`${name}: unsupported template syntax in smoke parser`);
  }
  return Function(`return \`${raw}\`;`)() as string;
}

function assertNoUnexpectedControlChars(script: string, name: string): void {
  const invalid = [...script]
    .map((char, index) => ({ code: char.charCodeAt(0), index }))
    .filter((item) => item.code < 32 && item.code !== 9 && item.code !== 10 && item.code !== 13);
  if (invalid.length > 0) {
    throw new Error(`${name}: unexpected control characters ${JSON.stringify(invalid.slice(0, 8))}`);
  }
}

function assertParsesAsBrowserExpression(script: string, name: string): void {
  try {
    Function(`return (${script});`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${name}: browser expression parse failed: ${message}`);
  }
}
