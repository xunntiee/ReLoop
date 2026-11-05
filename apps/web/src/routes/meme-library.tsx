import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";
import { withRouteLoading } from "./-route-loading";

const MemeLibraryPage = lazy(() =>
  import("@/features/video-workflow/meme-library-page").then((module) => ({
    default: module.MemeLibraryPage,
  }))
);

export const Route = createFileRoute("/meme-library")({
  component: withRouteLoading(MemeLibraryPage),
});
