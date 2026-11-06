import { Component, type ReactNode } from "react";
import { logger } from "@/lib/logger";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: { componentStack: string }) {
    logger.error("ui.render_error", {
      message: error.message,
      stack: info.componentStack,
    });
  }

  override render() {
    if (this.state.error) return this.props.fallback ?? <DefaultError />;
    return this.props.children;
  }
}

const DefaultError = () => (
  <div role="alert" className="p-8 text-center">
    <h2>Something went wrong</h2>
    <p>Please refresh the page. If the problem persists, contact support.</p>
  </div>
);
