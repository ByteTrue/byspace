import * as React from "react";
import { Check, Copy } from "lucide-react";

export function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(() => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  return (
    <div className="relative flex items-center justify-between rounded-lg border border-white/10 bg-black/40 px-3.5 py-2.5 font-mono text-xs text-white/80">
      <code className="truncate pr-8 select-all">{children}</code>
      <button
        type="button"
        onClick={handleCopy}
        className="text-white/40 hover:text-white transition-colors p-1 rounded hover:bg-white/10 cursor-pointer"
        aria-label="Copy to clipboard"
      >
        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
}
