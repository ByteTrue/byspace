import { CodeBlock, CodeBlockContent } from "~/components/ui/code-block";
import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatCaughtValue } from "@/components/root-error-details";
import { Button } from "~/components/ui/button";

interface RootErrorBoundaryState {
  error: string | null;
  resetKey: number;
}

/** Same contract as the Expo app's RootErrorBoundary: catch, show the error, retry by remounting. */
export class RootErrorBoundary extends Component<{ children: ReactNode }, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: unknown): Partial<RootErrorBoundaryState> {
    return { error: formatCaughtValue(error) };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("[RootErrorBoundary] Unhandled render error", {
      error: formatCaughtValue(error),
      componentStack: errorInfo.componentStack,
    });
  }

  retry = () => {
    this.setState(({ resetKey }) => ({ error: null, resetKey: resetKey + 1 }));
  };

  render() {
    const { error, resetKey } = this.state;
    if (error !== null) return <RootErrorFallback error={error} onRetry={this.retry} />;
    return <Fragment key={resetKey}>{this.props.children}</Fragment>;
  }
}

function RootErrorFallback({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="root-error-boundary"
      className="h-svh overflow-auto pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-16">
        <div data-testid="root-error-boundary-header" className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{t("rootError.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("rootError.body")}</p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t("rootError.details")}
          </span>
          <CodeBlock>
            <CodeBlockContent data-testid="root-error-boundary-details" className="max-h-[300px]">
              {error}
            </CodeBlockContent>
          </CodeBlock>
        </div>
        <Button data-testid="root-error-boundary-retry" className="self-start" onClick={onRetry}>
          {t("common.actions.retry")}
        </Button>
      </div>
    </div>
  );
}
