import { clientDownloadsUrl, webAppUrl, docsUrl, githubRepoUrl } from "~/downloads";

interface SiteFooterProps {
  width?: "default" | "prose";
}

export function SiteFooter({ width = "default" }: SiteFooterProps) {
  const widthClasses =
    width === "prose" ? "max-w-prose p-6 md:p-12 md:pt-0" : "max-w-5xl p-6 md:p-20 md:pt-0";

  return (
    <footer className={`${widthClasses} mx-auto`}>
      <div className="border-t border-white/10 pt-8 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-8 text-sm">
        <div className="space-y-3">
          <p className="text-white/60 font-medium">Product</p>
          <div className="space-y-2">
            <a
              href={webAppUrl}
              target="_blank"
              rel="noreferrer"
              className="block text-muted-foreground hover:text-foreground transition-colors"
            >
              Web App (Stable)
            </a>
            <a
              href="https://app-beta.byspace.cc.cd"
              target="_blank"
              rel="noreferrer"
              className="block text-muted-foreground hover:text-foreground transition-colors"
            >
              Beta Channel
            </a>
            <a
              href={clientDownloadsUrl}
              target="_blank"
              rel="noreferrer"
              className="block text-muted-foreground hover:text-foreground transition-colors"
            >
              Download Clients
            </a>
            <a
              href={`${docsUrl}/cli`}
              target="_blank"
              rel="noreferrer"
              className="block text-muted-foreground hover:text-foreground transition-colors"
            >
              CLI Reference
            </a>
            <a
              href={`${docsUrl}/configuration`}
              target="_blank"
              rel="noreferrer"
              className="block text-muted-foreground hover:text-foreground transition-colors"
            >
              Config Schema
            </a>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-white/60 font-medium">Documentation</p>
          <div className="space-y-2">
            <a
              href={docsUrl}
              target="_blank"
              rel="noreferrer"
              className="block text-muted-foreground hover:text-foreground transition-colors"
            >
              Getting Started
            </a>
            <a
              href={`${docsUrl}/providers`}
              target="_blank"
              rel="noreferrer"
              className="block text-muted-foreground hover:text-foreground transition-colors"
            >
              Supported Providers
            </a>
            <a
              href={`${docsUrl}/web-ui`}
              target="_blank"
              rel="noreferrer"
              className="block text-muted-foreground hover:text-foreground transition-colors"
            >
              Self-Hosting Web UI
            </a>
            <a
              href="https://github.com/ByteTrue/byspace/blob/main/SECURITY.md"
              target="_blank"
              rel="noreferrer"
              className="block text-muted-foreground hover:text-foreground transition-colors"
            >
              Security & E2EE Relay
            </a>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-white/60 font-medium">Ecosystem</p>
          <div className="space-y-2">
            <span className="block text-white/40">Claude Code (Agent SDK)</span>
            <span className="block text-white/40">OpenAI Codex (app-server)</span>
            <span className="block text-white/40">OpenCode & Pi Harnesses</span>
            <span className="block text-white/40">Agent Client Protocol (ACP)</span>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-white/60 font-medium">Community</p>
          <div className="space-y-2">
            <a
              href={githubRepoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-muted-foreground hover:text-foreground transition-colors"
            >
              GitHub Repository
            </a>
            <a
              href={`${githubRepoUrl}/issues`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-muted-foreground hover:text-foreground transition-colors"
            >
              Issue Tracker
            </a>
            <a
              href="https://www.npmjs.com/package/@bytetrue/byspace"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-muted-foreground hover:text-foreground transition-colors"
            >
              npm Package
            </a>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 mt-8 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="BySpace" className="w-4 h-4 opacity-70" />
          <span>
            &copy; {new Date().getFullYear()} ByteTrue &bull; AGPL-3.0 Licensed &bull; Telemetry
            Free
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span>
            Official Domain: <code>byspace.cc.cd</code>
          </span>
        </div>
      </div>
    </footer>
  );
}
