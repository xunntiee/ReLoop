import type { ReactNode } from "react";
import {
  Activity,
  Eye,
  Heart,
  SquareArrowOutUpRight,
} from "lucide-react";
import type { CrawlPost } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/formatters";
import { formatStructuredPreviewText } from "@/lib/structured-preview-text";
import { AvatarImage } from "./asset-status";
import { CommentCard } from "./comment-card";
import { MediaGrid } from "./media-grid";

const ReplyThreadsIcon = () => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    viewBox="0 0 24 24"
  >
    <path d="M20.656 17.008a9.993 9.993 0 1 0-3.59 3.615L22 22Z" />
  </svg>
);

const RepostThreadsIcon = () => (
  <svg fill="currentColor" viewBox="0 0 24 24">
    <path d="M4.51617 6.9986C6.13179 4.58593 8.88099 2.99979 11.9995 2.99979C15.7267 2.99979 18.9259 5.26459 20.2927 8.49676C20.5079 9.00543 21.0946 9.24341 21.6033 9.0283C22.1119 8.81318 22.3499 8.22644 22.1348 7.71777C20.466 3.7716 16.5582 0.999786 11.9995 0.999786C8.27776 0.999786 4.9897 2.84823 2.99988 5.67416V2.9986C2.99988 2.44631 2.55216 1.9986 1.9988 1.9986C1.44759 1.9986 0.999878 2.44631 0.999878 2.9986V7.9986C0.999878 8.55088 1.44759 8.9986 1.9988 8.9986H6.9988C7.55216 8.9986 7.99988 8.55088 7.99988 7.9986C7.99988 7.44631 7.55216 6.9986 6.9988 6.9986H4.51617Z" />
    <path d="M2.39572 14.9713C2.90439 14.7562 3.49113 14.9942 3.70625 15.5029C5.07309 18.735 8.27228 20.9998 11.9995 20.9998C15.118 20.9998 17.8672 19.4137 19.4828 17.001H16.9991C16.4468 17.001 15.9991 16.5533 15.9991 16.001C15.9991 15.4487 16.4468 15.001 16.9991 15.001H21.9991C22.5514 15.001 22.9991 15.4487 22.9991 16.001V21.001C22.9991 21.5533 22.5514 22.001 21.9991 22.001C21.4468 22.001 20.9991 21.5533 20.9991 21.001V18.3255C19.0093 21.1514 15.7212 22.9998 11.9995 22.9998C7.44077 22.9998 3.53298 20.228 1.86419 16.2818C1.64908 15.7732 1.88705 15.1864 2.39572 14.9713Z" />
  </svg>
);

const ShareThreadsIcon = () => (
  <svg fill="currentColor" viewBox="0 0 24 24">
    <path
      clipRule="evenodd"
      d="M7.2474 1.49853C4.18324 -0.187039 0.600262 2.64309 1.53038 6.01431L3.18181 12L1.53038 17.9857C0.600277 21.3569 4.18324 24.1871 7.2474 22.5015L20.8245 15.0329C23.2153 13.7177 23.2153 10.2823 20.8244 8.96712L7.2474 1.49853ZM3.45835 5.48239C2.99873 3.81649 4.76927 2.41796 6.28345 3.25089L19.8605 10.7195C20.0016 10.7971 20.123 10.8923 20.2247 11H4.98064L3.45835 5.48239ZM4.98064 13L3.45835 18.5176C2.99873 20.1835 4.76927 21.5821 6.28345 20.7491L19.8605 13.2805C20.0016 13.2029 20.123 13.1078 20.2247 13H4.98064Z"
      fillRule="evenodd"
    />
  </svg>
);

export const PostCard = ({
  isSelected,
  onToggleSelected,
  post,
}: {
  isSelected?: boolean;
  onToggleSelected?: () => void;
  post: CrawlPost;
}) => {
  const previewText = formatStructuredPreviewText(post.text);

  return (
    <article className="relative grid min-w-0 gap-3 break-words rounded-lg border bg-card p-4 [contain-intrinsic-size:auto_680px] [content-visibility:auto]">
      <header className="flex flex-col gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {onToggleSelected && (
            <input
              aria-label={`Select post ${post.post_id}`}
              checked={isSelected}
              className="mt-1 size-4 accent-foreground"
              onChange={onToggleSelected}
              type="checkbox"
            />
          )}
          <AvatarImage
            alt={`@${post.username}`}
            assetPath={post.avatar_asset_path}
            remoteUrl={post.avatar_url}
          />
          <div className="min-w-0">
            <a
              className="inline-flex min-w-0 max-w-full items-center gap-1 font-medium underline-offset-4 hover:underline"
              href={post.url}
              rel="noreferrer"
              target="_blank"
            >
              <span className="truncate">@{post.username}</span>
              <SquareArrowOutUpRight className="size-3.5 shrink-0" />
            </a>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(post.created_at || post.crawled_at)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <MetricPill
            icon={<Activity />}
            label="điểm viral"
            value={formatScore(post.ranking?.final_score)}
          />
          {post.view_count > 0 ? (
            <MetricPill
              icon={<Eye />}
              label="lượt xem"
              value={formatNumber(post.view_count)}
            />
          ) : null}
          <MetricPill
            icon={<Heart className="fill-red-500 text-red-500" />}
            label="lượt thích"
            value={formatNumber(post.like_count)}
            valueClassName="text-red-500"
          />
          <MetricPill
            icon={<ReplyThreadsIcon />}
            label="bình luận"
            value={formatNumber(post.reply_count)}
          />
          <MetricPill
            icon={<RepostThreadsIcon />}
            label="đăng lại"
            value={formatNumber(post.repost_count)}
          />
          <MetricPill
            icon={<ShareThreadsIcon />}
            label="chia sẻ"
            value={formatNumber(post.share_count)}
          />
        </div>
      </header>
      <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6">
        {previewText}
      </p>
      <MediaGrid media={post.media ?? []} />
      {post.top_comments.length > 0 ? (
        <ol className="grid gap-2 border-t pt-3">
          {post.top_comments.map((comment) => (
            <CommentCard comment={comment} key={comment.comment_id} />
          ))}
        </ol>
      ) : null}
    </article>
  );
};

const MetricPill = ({
  icon,
  label,
  value,
  valueClassName,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  valueClassName?: string;
}) => (
  <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border bg-muted/30 px-2 text-xs text-black dark:text-white">
    <span className="shrink-0 [&_svg]:size-3.5">{icon}</span>
    <span className={`whitespace-nowrap font-medium ${valueClassName ?? ""}`}>
      {value}
    </span>
    <span className="whitespace-nowrap text-muted-foreground">{label}</span>
  </span>
);

function formatScore(value: number | undefined): string {
  const score = Number(value ?? 0);
  if (!Number.isFinite(score)) return "0";
  return score >= 100 ? score.toFixed(0) : score.toFixed(1);
}
