import { createRootRoute } from "@tanstack/react-router";
import { AppLayout } from "@/features/app-shell/app-layout";

export const Route = createRootRoute({
  component: AppLayout,
});
