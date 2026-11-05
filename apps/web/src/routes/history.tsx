import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";
import { withRouteLoading } from "./-route-loading";

const HistoryPage = lazy(() => import("@/features/history-page").then((module) => ({
  default: module.HistoryPage,
})));

export const Route = createFileRoute("/history")({
  component: withRouteLoading(HistoryPage),
});
