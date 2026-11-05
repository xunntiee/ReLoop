import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";
import { withRouteLoading } from "./-route-loading";

const MusicLibraryPage = lazy(() =>
  import("@/features/video-workflow/music-library-page").then((module) => ({
    default: module.MusicLibraryPage,
  }))
);

export const Route = createFileRoute("/music-library")({
  component: withRouteLoading(MusicLibraryPage),
});
