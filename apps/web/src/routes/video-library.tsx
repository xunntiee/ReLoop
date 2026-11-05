import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";
import { withRouteLoading } from "./-route-loading";

const VideoLibraryPage = lazy(() =>
  import("@/features/video-workflow/video-library-page").then((module) => ({
    default: module.VideoLibraryPage,
  }))
);

export const Route = createFileRoute("/video-library")({
  component: withRouteLoading(VideoLibraryPage),
});
