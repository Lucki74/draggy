import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Button, Icon } from "./ui";
import { collectErrorDetails } from "./errorDetails";
import { currentScreen, flushLogs, logRendererError, logSwallow } from "./logger";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  copied?: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logRendererError("react", "component threw", error, {
      componentStack: errorInfo.componentStack,
      screen: currentScreen(),
    });
    flushLogs();
  }

  private copyLog = async () => {
    const text = await collectErrorDetails({ text: this.state.error?.stack || this.state.error?.message || "", scope: "react" });
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch (error) {
      logSwallow("app", error, "clipboard access can fail in restricted environments");
    }
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div role="alert" className="p-4 my-4 rounded-md border border-rule-strong bg-surface-base text-text-primary space-y-3">
          <div className="flex items-center gap-2 text-danger">
            <Icon name="warning-circle" size={18} />
            <span className="font-semibold text-sm">Something went wrong</span>
          </div>
          <p className="text-xs font-mono text-text-secondary overflow-x-auto max-h-32 p-2 rounded-sm bg-surface-canvas border border-rule break-all whitespace-pre-wrap">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="secondary"
              size="dense"
              onClick={() => window.location.reload()}
              icon={<Icon name="arrow-clockwise" size={14} />}
            >
              Reload
            </Button>
            <Button
              variant="ghost"
              size="dense"
              onClick={this.copyLog}
              icon={<Icon name={this.state.copied ? "check" : "copy"} size={14} />}
            >
              {this.state.copied ? "Copied" : "Copy error details"}
            </Button>
            {typeof window !== "undefined" && window.electronAPI?.openLogs && (
              <Button
                variant="ghost"
                size="dense"
                onClick={() => void window.electronAPI?.openLogs?.()}
                icon={<Icon name="folder-simple" size={14} />}
              >
                Open logs
              </Button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

