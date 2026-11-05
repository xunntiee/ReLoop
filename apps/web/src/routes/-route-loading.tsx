import { LoaderCircle } from "lucide-react";
import { Suspense, type ComponentType } from "react";

const RouteLoading = () => (
  <div className="flex h-full min-h-64 items-center justify-center bg-background text-muted-foreground">
    <LoaderCircle className="size-5 animate-spin" />
  </div>
);

export function withRouteLoading(Component: ComponentType) {
  return function RouteComponent() {
    return (
      <Suspense fallback={<RouteLoading />}>
        <Component />
      </Suspense>
    );
  };
}
