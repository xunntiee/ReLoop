import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";
import { withRouteLoading } from "./-route-loading";

const HomePage = lazy(() => import("@/features/home-page").then((module) => ({
  default: module.HomePage,
})));

export const Route = createFileRoute("/")({
  component: withRouteLoading(HomePage),
});
