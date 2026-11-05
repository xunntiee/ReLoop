import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";
import { withRouteLoading } from "./-route-loading";

const VideoPage = lazy(() =>
  import("@/features/video-workflow/video-page").then((module) => ({
    default: module.VideoPage,
  }))
);

export const Route = createFileRoute("/video")({
  component: withRouteLoading(VideoPage),
});
