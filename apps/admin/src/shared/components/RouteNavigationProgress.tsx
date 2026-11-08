import { useDeferredValue } from "react";
import { useLocation, useNavigation } from "react-router-dom";

export const RouteNavigationProgress = () => {
  const navigation = useNavigation();
  const location = useLocation();
  const deferredLocation = useDeferredValue(location);

  const isVisible = navigation.state !== "idle" || location.pathname !== deferredLocation.pathname;

  if (!isVisible) return null;

  return (
    <div aria-hidden className="fixed inset-x-0 top-0 z-9999">
      <div className="h-1 w-full bg-transparent">
        <div className="route-progress-indicator h-full bg-primary" />
      </div>
    </div>
  );
};
