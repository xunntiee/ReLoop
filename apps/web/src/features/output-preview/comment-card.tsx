import type { CrawlComment } from "@/lib/api";
import { formatNumber } from "@/lib/formatters";
import { formatStructuredPreviewText } from "@/lib/structured-preview-text";
import { AvatarImage } from "./asset-status";
import { MediaGrid } from "./media-grid";

export const CommentCard = ({ comment }: { comment: CrawlComment }) => {
  const previewText = formatStructuredPreviewText(comment.text);

  return (
    <li className="flex gap-2 text-sm" key={comment.comment_id}>
      <AvatarImage
        alt={`@${comment.username}`}
        assetPath={comment.avatar_asset_path}
        className="mt-0.5 size-7"
        remoteUrl={comment.avatar_url}
      />
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">@{comment.username}</span>
          <span className="text-muted-foreground text-xs">
            {formatNumber(comment.like_count)} lượt thích
          </span>
          <span className="text-muted-foreground text-xs">
            {formatNumber(comment.reply_count)} trả lời
          </span>
        </div>
        <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/85">
          {previewText}
        </p>
        <MediaGrid compact media={comment.media ?? []} />
      </div>
    </li>
  );
};
