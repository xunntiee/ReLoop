import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";
import { withRouteLoading } from "./-route-loading";

const SettingsPage = lazy(() => import("@/features/settings-page").then((module) => ({
  default: module.SettingsPage,
})));

export const Route = createFileRoute("/settings")({
  component: withRouteLoading(SettingsPage),
});
