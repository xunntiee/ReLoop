import { useQuery } from "@tanstack/react-query";
import { getUploadedBackgroundMusic } from "@/lib/api";
import { BackgroundMusicLibrary } from "./background-music-library";

export const MusicLibraryPage = () => {
  const uploadedMusicQuery = useQuery({
    queryFn: getUploadedBackgroundMusic,
    queryKey: ["music-uploads"],
  });

  const tracks = uploadedMusicQuery.data?.tracks ?? [];

  return (
    <div className="mx-auto flex w-full max-w-[120rem] flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Thư viện nhạc nền</h1>
      </div>

      <BackgroundMusicLibrary
        isRefreshing={uploadedMusicQuery.isFetching}
        onRefresh={() => void uploadedMusicQuery.refetch()}
        onUploaded={() => void uploadedMusicQuery.refetch()}
        tracks={tracks}
      />
    </div>
  );
};
