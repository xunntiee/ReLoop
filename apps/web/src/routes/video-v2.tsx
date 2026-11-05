import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";
import { withRouteLoading } from "./-route-loading";

const VideoPageV2 = lazy(() =>
  import("@/features/video-workflow/video-page-v2").then((module) => ({
    default: module.VideoPageV2,
  }))
);

export const Route = createFileRoute("/video-v2")({
  component: withRouteLoading(VideoPageV2),
});
