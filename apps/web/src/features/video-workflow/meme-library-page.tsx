import { getMemeLibrary } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { MemeTransitionLibrary } from "./meme-transition-library";

export const MemeLibraryPage = () => {
  const memeLibraryQuery = useQuery({
    queryFn: getMemeLibrary,
    queryKey: ["meme-library"],
  });

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col gap-4 overflow-y-auto px-4 py-6 sm:px-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Thư viện meme chuyển cảnh</h1>
        <p className="text-sm text-muted-foreground">
          Mỗi cảm xúc lưu dùng 1 ảnh meme và 1 sound meme để chèn giữa post và comment.
        </p>
      </div>

      <MemeTransitionLibrary
        isRefreshing={memeLibraryQuery.isFetching}
        items={memeLibraryQuery.data?.items ?? []}
        onRefresh={() => void memeLibraryQuery.refetch()}
      />
    </div>
  );
};
