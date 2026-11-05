import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { assetSources } from "@/lib/formatters";

const DEFAULT_PROFILE_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns=%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 viewBox=%220 0 96 96%22%3E%3Crect width=%2296%22 height=%2296%22 rx=%2248%22 fill=%22%23e2e8f0%22%2F%3E%3Ccircle cx=%2248%22 cy=%2236%22 r=%2216%22 fill=%22%2394a3b8%22%2F%3E%3Cpath d=%22M20 80c4-16 15-24 28-24s24 8 28 24%22 fill=%22%2394a3b8%22%2F%3E%3C%2Fsvg%3E";

export const AvatarImage = ({
  alt,
  assetPath,
  className,
  remoteUrl,
}: {
  alt: string;
  assetPath?: string;
  className?: string;
  remoteUrl?: string;
}) => {
  const sources = useMemo(
    () => assetSources(assetPath, remoteUrl),
    [assetPath, remoteUrl]
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const retryTimerRef = useRef<number | null>(null);
  const sourcesKey = sources.join("|");

  useEffect(() => {
    setSourceIndex(0);
    setRetryToken(0);
    return () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
    };
  }, [sourcesKey]);

  const src = sources[sourceIndex] ?? "";
  const displayedSrc =
    retryToken > 0
      ? `${src}${src.includes("?") ? "&" : "?"}avatar_retry=${retryToken}`
      : src;
  const failedAllSources = !src && sources.length > 0;

  if (src) {
    return (
      <img
        alt={alt}
        className={cn("size-9 shrink-0 rounded-full border object-cover", className)}
        loading="lazy"
        onError={() => {
          if (src.startsWith("/media/") && retryToken === 0) {
            retryTimerRef.current = window.setTimeout(() => {
              setRetryToken(Date.now());
              retryTimerRef.current = null;
            }, 250);
            return;
          }
          setRetryToken(0);
          setSourceIndex((current) =>
            current + 1 < sources.length ? current + 1 : sources.length,
          );
        }}
        referrerPolicy="no-referrer"
        src={displayedSrc}
        title={alt}
      />
    );
  }

  return (
    <img
      alt={alt}
      className={cn("size-9 shrink-0 rounded-full border object-cover", className)}
      loading="lazy"
      src={DEFAULT_PROFILE_AVATAR}
      title={failedAllSources ? alt + " - dùng avatar mặc định" : alt}
    />
  );
};
