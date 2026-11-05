import { useQuery } from "@tanstack/react-query";
import {
  getUploadedPromotionVideos,
  getUploadedVideoBackgrounds,
} from "@/lib/api";
import { VideoBackgroundLibrary } from "./video-background-library";

export const VideoLibraryPage = () => {
  const uploadedVideosQuery = useQuery({
    queryFn: getUploadedVideoBackgrounds,
    queryKey: ["video-uploads"],
  });
  const promotionVideosQuery = useQuery({
    queryFn: getUploadedPromotionVideos,
    queryKey: ["promotion-video-uploads"],
  });

  const videos = uploadedVideosQuery.data?.videos ?? [];
  const promotionVideos = promotionVideosQuery.data?.videos ?? [];

  return (
    <div className="mx-auto flex w-full max-w-[120rem] flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Thư viện video
        </h1>
      </div>

      <VideoBackgroundLibrary
        isRefreshing={uploadedVideosQuery.isFetching}
        onRefresh={() => void uploadedVideosQuery.refetch()}
        onUploaded={() => void uploadedVideosQuery.refetch()}
        videos={videos}
      />
      <VideoBackgroundLibrary
        isRefreshing={promotionVideosQuery.isFetching}
        onRefresh={() => void promotionVideosQuery.refetch()}
        onUploaded={() => void promotionVideosQuery.refetch()}
        purpose="promotion"
        videos={promotionVideos}
      />
    </div>
  );
};
