import * as React from "react";
import { motion, useInView, useScroll, useTransform, type Transition } from "framer-motion";
import { Mic, ArrowRight } from "lucide-react";
import { CursorFieldProvider } from "~/components/butterfly";
import { CommandDialog } from "~/components/command-dialog";
import { HeroMockup } from "~/components/hero-mockup";
import { FAQItem } from "~/components/faq-item";
import { SiteFooter } from "~/components/site-footer";
import { SiteHeader } from "~/components/site-header";
import { webAppUrl, docsUrl, githubRepoUrl, GlobeIcon, TerminalIcon } from "~/downloads";
import "~/styles.css";

// Shared motion presets
const FADE_IN_UP = { opacity: 0, y: 20 };
const FADE_IN = { opacity: 1, y: 0 };
const FADE_IN_UP_TINY = { opacity: 0, y: -10 };
const FADE_IN_UP_XL = { opacity: 0, y: 30 };
const FADE_IN_UP_40 = { opacity: 0, y: 40 };

const EASE_OUT_06_DELAY_01: Transition = { duration: 0.6, delay: 0.1, ease: "easeOut" };
const EASE_OUT_08_DELAY_05: Transition = { duration: 0.8, delay: 0.5, ease: "easeOut" };
const EASE_OUT_05: Transition = { duration: 0.5, ease: "easeOut" };
const DURATION_05: Transition = { duration: 0.5 };

const VIEWPORT_60 = { once: true, margin: "-60px" };
const SVG_OVERFLOW_VISIBLE_STYLE = { overflow: "visible" as const };
const PHONE_PERSPECTIVE_STYLE = { minHeight: 480, perspective: 1200 };

interface LandingPageProps {
  title: React.ReactNode;
  subtitle: string;
}

export function LandingPage({ title, subtitle }: LandingPageProps) {
  return (
    <CursorFieldProvider>
      {/* Hero section with background image */}
      <div className="relative bg-cover bg-center bg-no-repeat">
        <div className="relative p-6 pb-10 md:px-32 md:pt-16 md:pb-12 max-w-7xl mx-auto">
          <Nav />
          <Hero title={title} subtitle={subtitle} />
          <GetStarted />
        </div>

        {/* Mockup - inside hero so it's above the gradient, positioned to overflow into black section */}
        <motion.div
          initial={FADE_IN_UP_40}
          animate={FADE_IN}
          transition={EASE_OUT_08_DELAY_05}
          className="relative px-6 md:px-8 pb-8 md:pb-16"
        >
          <div className="max-w-7xl mx-auto">
            <HeroMockup />
          </div>
        </motion.div>
      </div>

      {/* Phone showcase */}
      <PhoneShowcase />

      {/* Content section */}
      <div className="landing-content bg-background">
        <main className="p-6 md:p-20 md:pt-40 max-w-5xl mx-auto">
          <div className="space-y-24">
            <SocialProofWall />
            <MultiProviderSection />
            <SelfHostedSection />
            <WorkflowSection />
            <SplitPanelsSection />
            <ServiceProxySection />
            <ShortcutsSection />
            <LocalVoiceSection />
            <CLISection />
            <FAQ />
            <SponsorCTA />
          </div>
        </main>
        <SiteFooter />
      </div>
    </CursorFieldProvider>
  );
}

function Nav() {
  return (
    <nav className="mb-16">
      <SiteHeader />
    </nav>
  );
}

function Hero({ title, subtitle }: { title: React.ReactNode; subtitle: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl md:text-5xl font-medium tracking-tight text-white">{title}</h1>
      <p className="text-white/70 text-lg leading-relaxed max-w-lg">{subtitle}</p>
    </div>
  );
}

const CLAUDE_CODE_BADGE_ICON = <ClaudeCodeIcon className="h-6 w-6" />;
const CODEX_BADGE_ICON = <CodexIcon className="h-6 w-6" />;
const OPENCODE_BADGE_ICON = <OpenCodeIcon className="h-6 w-6" />;
const PI_BADGE_ICON = <PiIcon className="h-6 w-6" />;
const CURSOR_BADGE_ICON = <CursorIcon className="h-6 w-6" />;

const SOCIAL_PROOF_TWEETS = [
  {
    name: "Cam",
    handle: "@ceeebeeebeee",
    date: "Apr 6, 2026",
    avatar: "./social-proof/ceeebeeebeee.jpg",
    url: "https://x.com/ceeebeeebeee",
    text: "without a doubt the most slept on orchestrator right now. Open source, every OS, and a mobile experience that truly blew me away.",
  },
  {
    name: "Erik Sherman",
    handle: "@erikksherman",
    date: "Apr 11, 2026",
    avatar: "./social-proof/erikksherman.jpg",
    url: "https://x.com/erikksherman",
    text: "Having an ongoing interactive conversation with Claude Code from my phone while walking the dog is insane. The future is wild.",
  },
  {
    name: "Jason Torres",
    handle: "@jasontorres",
    date: "Apr 2, 2026",
    avatar: "./social-proof/jasontorres.jpg",
    url: "https://x.com/jasontorres",
    text: "BySpace is a really good interface for local agents. Multi-provider, zero latency, and runs completely self-hosted on my workstation.",
  },
  {
    name: "Tietou",
    handle: "@tietougongshiba",
    date: "Apr 14, 2026",
    avatar: "./social-proof/tietougongshiba.jpg",
    url: "https://x.com/tietougongshiba",
    text: "BySpace is the best development software I've used this year. Absolutely amazing!",
  },
  {
    name: "Arnold Gamboa",
    handle: "@arnoldgamboa",
    date: "Apr 4, 2026",
    avatar: "./social-proof/arnoldgamboa.jpg",
    url: "https://x.com/arnoldgamboa",
    text: "This is so cool. I've been wanting an interface for coding agents that works across both browser and CLI.",
  },
];

function SocialProofCard({ tweet }: { tweet: (typeof SOCIAL_PROOF_TWEETS)[number] }) {
  return (
    <a
      href={tweet.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block w-80 shrink-0 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition-colors hover:border-white/20 hover:bg-white/[0.05]"
    >
      <div className="flex items-center gap-3">
        <img src={tweet.avatar} alt={tweet.name} className="h-10 w-10 rounded-full object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-white/90">{tweet.name}</span>
          </div>
          <span className="truncate text-xs text-white/40">{tweet.handle}</span>
        </div>
      </div>
      <p className="social-proof-card-text mt-3 text-sm leading-relaxed text-white/70">
        {tweet.text}
      </p>
    </a>
  );
}

function SocialProofRow({
  tweets,
  reverse = false,
}: {
  tweets: typeof SOCIAL_PROOF_TWEETS;
  reverse?: boolean;
}) {
  return (
    <div className="social-proof-row">
      <div
        className={`social-proof-track flex gap-4 ${reverse ? "social-proof-track-reverse" : ""}`}
      >
        {tweets.map((tweet) => (
          <SocialProofCard key={`${tweet.handle}-1`} tweet={tweet} />
        ))}
        {tweets.map((tweet) => (
          <SocialProofCard key={`${tweet.handle}-2`} tweet={tweet} />
        ))}
      </div>
    </div>
  );
}

function SocialProofWall() {
  const firstRow = SOCIAL_PROOF_TWEETS.slice(0, 3);
  const secondRow = SOCIAL_PROOF_TWEETS.slice(2);

  return (
    <FeatureSection
      title="Loved by developers"
      description="See what developers are saying about orchestrating agents with BySpace."
    >
      <div className="social-proof-marquee space-y-4">
        <SocialProofRow tweets={firstRow} />
        <SocialProofRow tweets={secondRow} reverse />
      </div>
    </FeatureSection>
  );
}

interface AgentItem {
  name: string;
  desc: string;
  icon: React.ReactNode;
}

const AGENTS: AgentItem[] = [
  {
    name: "Claude Code",
    desc: "Anthropic's CLI and agent SDK with support for thinking models and custom tools.",
    icon: <ClaudeCodeIcon className="h-8 w-8 text-[#d97706]" />,
  },
  {
    name: "Codex",
    desc: "OpenAI's coding agent running on the official app-server runtime.",
    icon: <CodexIcon className="h-8 w-8 text-[#10b981]" />,
  },
  {
    name: "OpenCode",
    desc: "Open source terminal coding agent harness with custom model endpoints.",
    icon: <OpenCodeIcon className="h-8 w-8 text-white" />,
  },
  {
    name: "Pi",
    desc: "Fast, minimal coding agent harness with subagent orchestration and tree-sitter tools.",
    icon: <PiIcon className="h-8 w-8 text-[#3b82f6]" />,
  },
  {
    name: "Cursor & ACP",
    desc: "Any agent speaking the Agent Client Protocol (Cursor, Qwen, Kimi, Hermes, Copilot).",
    icon: <CursorIcon className="h-8 w-8 text-white/80" />,
  },
];

function ProviderTabButton({
  agent,
  index,
  selected,
  onSelect,
}: {
  agent: AgentItem;
  index: number;
  selected: boolean;
  onSelect: (i: number) => void;
}) {
  const handleClick = React.useCallback(() => {
    onSelect(index);
  }, [index, onSelect]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-all cursor-pointer ${
        selected
          ? "border-emerald-500/50 bg-emerald-500/10 text-white shadow-sm"
          : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:text-white"
      }`}
    >
      {agent.icon}
      <span className="font-medium">{agent.name}</span>
    </button>
  );
}

function MultiProviderSection() {
  const [selected, setSelected] = React.useState(0);
  const activeAgent = AGENTS[selected];

  const handleSelect = React.useCallback((index: number) => {
    setSelected(index);
  }, []);

  return (
    <FeatureSection
      title="Bring your own agents"
      description="Run your agents from one interface. BySpace uses each provider's native harness, so your subscriptions, skills, config, and MCP servers keep working."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {AGENTS.map((agent, i) => (
            <ProviderTabButton
              key={agent.name}
              agent={agent}
              index={i}
              selected={selected === i}
              onSelect={handleSelect}
            />
          ))}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/70 leading-relaxed">
          <span className="font-medium text-white">{activeAgent.name}: </span>
          {activeAgent.desc}
        </div>
      </div>
    </FeatureSection>
  );
}

function FeatureSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={FADE_IN_UP}
      whileInView={FADE_IN}
      viewport={VIEWPORT_60}
      transition={EASE_OUT_05}
      className="space-y-6"
    >
      <div className="space-y-2">
        <h2 className="text-2xl md:text-3xl font-medium tracking-tight text-white">{title}</h2>
        <p className="text-white/60 text-base leading-relaxed max-w-2xl">{description}</p>
      </div>
      {children}
    </motion.section>
  );
}

function SelfHostedDiagram() {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const clientRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const hostRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const centerRef = React.useRef<HTMLDivElement>(null);

  const [paths, setPaths] = React.useState<{ left: string[]; right: string[] }>({
    left: [],
    right: [],
  });

  const clients = React.useMemo(
    () => [
      { name: "Browser / Web", icon: <GlobeIcon className="w-5 h-5 text-emerald-400" /> },
      { name: "Mobile Web / PWA", icon: <GlobeIcon className="w-5 h-5 text-cyan-400" /> },
      { name: "Remote CLI", icon: <TerminalIcon className="w-5 h-5 text-amber-400" /> },
    ],
    [],
  );

  const hosts = React.useMemo(() => ["MacBook Pro", "Linux VM", "Cloud DevBox"], []);

  const setClientRef = React.useCallback(
    (i: number) => (el: HTMLDivElement | null) => {
      clientRefs.current[i] = el;
    },
    [],
  );
  const setHostRef = React.useCallback(
    (i: number) => (el: HTMLDivElement | null) => {
      hostRefs.current[i] = el;
    },
    [],
  );

  React.useEffect(() => {
    function update() {
      if (!containerRef.current || !centerRef.current) return;
      const cRect = containerRef.current.getBoundingClientRect();
      const mRect = centerRef.current.getBoundingClientRect();

      const mLeftX = mRect.left - cRect.left;
      const mRightX = mRect.right - cRect.left;
      const mCenterY = mRect.top - cRect.top + mRect.height / 2;

      const left = clientRefs.current.filter(Boolean).map((el) => {
        const r = el!.getBoundingClientRect();
        const startX = r.right - cRect.left;
        const startY = r.top - cRect.top + r.height / 2;
        const dx = (mLeftX - startX) * 0.5;
        return `M ${startX} ${startY} C ${startX + dx} ${startY}, ${mLeftX - dx} ${mCenterY}, ${mLeftX} ${mCenterY}`;
      });

      const right = hostRefs.current.filter(Boolean).map((el) => {
        const r = el!.getBoundingClientRect();
        const endX = r.left - cRect.left;
        const endY = r.top - cRect.top + r.height / 2;
        const dx = (endX - mRightX) * 0.5;
        return `M ${mRightX} ${mCenterY} C ${mRightX + dx} ${mCenterY}, ${endX - dx} ${endY}, ${endX} ${endY}`;
      });

      setPaths({ left, right });
    }

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <>
      {/* Mobile: vertical stack */}
      <div className="md:hidden flex flex-col items-center gap-4 py-4">
        <div className="space-y-2 w-full">
          {clients.map((c) => (
            <div
              key={c.name}
              className="flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3"
            >
              <span>{c.icon}</span>
              <span className="font-medium text-sm text-white">{c.name}</span>
            </div>
          ))}
        </div>
        <div className="w-px h-6 border-l border-dashed border-white/25" />
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-6 py-4 text-center space-y-1">
          <p className="text-xs font-semibold text-emerald-400">E2E Encrypted Relay (443)</p>
          <p className="text-[10px] text-white/40">Curve25519 &bull; Zero Knowledge</p>
        </div>
        <div className="w-px h-6 border-l border-dashed border-white/25" />
        <div className="space-y-2 w-full">
          {hosts.map((h) => (
            <div
              key={h}
              className="flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3"
            >
              <span className="font-medium text-sm text-white">{h} (Daemon)</span>
            </div>
          ))}
        </div>
      </div>

      {/* Desktop: horizontal with bezier curves */}
      <div ref={containerRef} className="relative hidden md:flex items-center py-6 gap-0">
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={SVG_OVERFLOW_VISIBLE_STYLE}
        >
          {[...paths.left, ...paths.right].map(
            (d) =>
              d && (
                <path
                  key={d}
                  d={d}
                  fill="none"
                  stroke="rgba(16, 185, 129, 0.4)"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
              ),
          )}
        </svg>

        {/* Clients */}
        <div className="space-y-3 flex-shrink-0 relative z-10">
          {clients.map((c, i) => (
            <div
              key={c.name}
              ref={setClientRef(i)}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3.5 backdrop-blur-sm"
            >
              <span>{c.icon}</span>
              <span className="font-medium text-sm text-white">{c.name}</span>
            </div>
          ))}
        </div>

        <div className="flex-1" />

        {/* Center label */}
        <div
          ref={centerRef}
          className="flex-shrink-0 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] px-8 py-6 text-center space-y-1.5 relative z-10 backdrop-blur-sm shadow-glow"
        >
          <p className="text-sm font-semibold text-emerald-400">E2E Encrypted Relay</p>
          <p className="text-xs text-white/50">relay.byspace.cc.cd:443</p>
          <p className="text-xs text-white/40">or Direct Localhost Connection</p>
        </div>

        <div className="flex-1" />

        {/* Hosts */}
        <div className="space-y-3 flex-shrink-0 relative z-10">
          {hosts.map((h, i) => (
            <div
              key={h}
              ref={setHostRef(i)}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3.5 backdrop-blur-sm"
            >
              <span className="font-medium text-sm text-white">{h}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                daemon
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function SelfHostedSection() {
  return (
    <FeatureSection
      title="Runs where you work"
      description="Start the BySpace daemon on your laptop, a VM, or a dev server. Connect from any browser or terminal over direct loopback or the end-to-end encrypted relay."
    >
      <SelfHostedDiagram />
    </FeatureSection>
  );
}

const WORKFLOW_STEPS = ["Worktree", "Preview", "Review", "Commit", "PR", "Merge"] as const;

const REVIEW_FILES = [
  { path: "packages/server/src/auth.ts", delta: "+42" },
  { path: "packages/protocol/src/offer.ts", delta: "+18 -9" },
  { path: "tests/auth.test.ts", delta: "+31" },
] as const;

function ReviewFileItem({ path, delta }: { path: string; delta: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="truncate font-mono text-white/50">{path}</span>
      <span className="font-mono text-emerald-300/80">{delta}</span>
    </div>
  );
}

function WorkflowReviewPanel() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-white/80">Inline review</span>
        <span className="text-xs text-white/40">3 files changed</span>
      </div>
      <div className="space-y-2">
        {REVIEW_FILES.map((file) => (
          <ReviewFileItem key={file.path} path={file.path} delta={file.delta} />
        ))}
      </div>
    </div>
  );
}

function WorkflowSection() {
  return (
    <FeatureSection
      title="Review, preview, ship"
      description="Create branches, preview your apps in isolated worktrees, review diffs inline, then commit, open PRs, and merge without leaving BySpace."
    >
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
        <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-sm text-white/80 font-mono">feat/auth-pkce</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/40">
              worktree
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/40">
            {WORKFLOW_STEPS.map((step) => (
              <span key={step} className="rounded-full border border-white/10 px-2.5 py-1">
                {step}
              </span>
            ))}
          </div>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-[1.1fr_0.9fr]">
          <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
            <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/60" />
              </div>
              <div className="min-w-0 flex-1 rounded-md bg-black/40 px-2 py-1 text-center font-mono text-[10px] text-white/40">
                web.auth-pkce.my-app.localhost
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="h-3 w-32 rounded bg-white/20" />
              <div className="h-2 w-48 rounded bg-white/10" />
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="h-10 rounded border border-white/10 bg-white/[0.03]" />
                <div className="h-10 rounded border border-emerald-500/30 bg-emerald-500/10" />
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <WorkflowReviewPanel />
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex items-center justify-between">
              <span className="text-xs text-white/60">Tests Passing</span>
              <button
                type="button"
                className="rounded-lg bg-emerald-500 text-black text-xs font-semibold px-4 py-1.5 hover:bg-emerald-400 transition-colors"
              >
                Merge Worktree
              </button>
            </div>
          </div>
        </div>
      </div>
    </FeatureSection>
  );
}

function SplitPanelsSection() {
  return (
    <FeatureSection
      title="Split panels"
      description="Open agents, browsers, terminals, diffs, and logs in the same workspace. Split them side by side or group them in tabs."
    >
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <div className="grid gap-3 md:h-[320px] md:grid-cols-[1.05fr_0.95fr]">
          <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-sm text-white/70 min-h-36 md:min-h-0">
            Agent Pane (Claude 3.7 Sonnet)
          </div>
          <div className="grid gap-3 md:grid-rows-[1fr_0.75fr]">
            <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-sm text-white/70 min-h-24">
              File Diff Pane
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-sm text-white/70 min-h-20">
                Terminal Pane
              </div>
              <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-sm text-white/70 min-h-20">
                Subagent Pane
              </div>
            </div>
          </div>
        </div>
      </div>
    </FeatureSection>
  );
}

function ServiceProxySection() {
  const workspaces = [
    { name: "feat-auth", url: "web.feat-auth.my-app.localhost" },
    { name: "add-search", url: "web.add-search.my-app.localhost" },
    { name: "upgrade-deps", url: "web.upgrade-deps.my-app.localhost" },
  ];

  return (
    <FeatureSection
      title="Forget about ports"
      description="When agents work in parallel, they all run dev servers. BySpace gives each one a stable URL based on the branch name, no port conflicts, no guessing."
    >
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-medium text-white/60">my-project</span>
          </div>
          <div className="pl-6 space-y-2">
            {workspaces.map((ws) => (
              <div key={ws.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-sm text-white/80">{ws.name}</span>
                  <span className="text-xs text-white/30 font-mono">npm run dev</span>
                </div>
                <span className="text-xs font-mono text-emerald-300/60">{ws.url}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </FeatureSection>
  );
}

function ShortcutsSection() {
  const shortcuts = [
    { keys: ["⌘", "1-9"], action: "Switch panels" },
    { keys: ["⌘", "D"], action: "Split vertical" },
    { keys: ["⌘", "Shift", "D"], action: "Split horizontal" },
    { keys: ["⌘", "W"], action: "Close panel" },
    { keys: ["⌘", "N"], action: "New agent / workspace" },
    { keys: ["⌘", "K"], action: "Command palette" },
  ];

  return (
    <FeatureSection
      title="Keyboard-first"
      description="Every action has a shortcut. Panels, splits, agents, and navigation — all from the keyboard."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {shortcuts.map((s) => (
          <div
            key={s.action}
            className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2.5"
          >
            <span className="text-sm text-white/70">{s.action}</span>
            <div className="flex items-center gap-1">
              {s.keys.map((k) => (
                <kbd
                  key={k}
                  className="text-xs px-2 py-0.5 rounded bg-white/10 text-white/70 font-mono border border-white/10"
                >
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </FeatureSection>
  );
}

function LocalVoiceSection() {
  return (
    <FeatureSection
      title="Voice control, fully local"
      description="Host-managed local speech models transcribe your voice prompts with zero audio data leaving your machine."
    >
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center gap-3 text-emerald-400">
          <Mic className="w-5 h-5" />
          <span className="text-sm font-medium">Whisper Model &bull; Local Speech-to-Text</span>
        </div>
        <p className="text-sm text-white/80 font-mono bg-black/40 p-4 rounded-xl border border-white/10">
          &ldquo;Refactor the authentication middleware to use the new session store, then run the
          test suite.&rdquo;
        </p>
      </div>
    </FeatureSection>
  );
}

function GetStarted() {
  return (
    <div className="pt-8">
      <div className="flex flex-row flex-wrap items-center gap-3.5">
        <a
          href={webAppUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 text-black px-5 py-2.5 text-sm font-semibold hover:bg-emerald-400 transition-colors shadow-glow"
        >
          <GlobeIcon className="h-4 w-4" />
          Open Web Console
          <ArrowRight className="h-4 w-4 ml-1" />
        </a>

        <ServerInstallButton />

        <a
          href={githubRepoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10 transition-colors"
        >
          GitHub Repository
        </a>
      </div>

      <div className="flex items-center gap-2 pt-6">
        <span className="text-xs text-muted-foreground">Supported harnesses:</span>
        <div className="flex items-center gap-1.5">
          <AgentBadge name="Claude Code" icon={CLAUDE_CODE_BADGE_ICON} />
          <AgentBadge name="Codex" icon={CODEX_BADGE_ICON} />
          <AgentBadge name="OpenCode" icon={OPENCODE_BADGE_ICON} />
          <AgentBadge name="Pi" icon={PI_BADGE_ICON} />
          <AgentBadge name="Cursor" icon={CURSOR_BADGE_ICON} />
        </div>
        <span className="text-xs text-muted-foreground">+ 30 more ACP agents</span>
      </div>
    </div>
  );
}

function AgentBadge({ name, icon }: { name: string; icon: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/80"
      title={name}
    >
      {icon}
      <span className="hidden sm:inline">{name}</span>
    </span>
  );
}

const SERVER_INSTALL_TRIGGER = (
  <button
    type="button"
    className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10 transition-colors cursor-pointer"
  >
    <TerminalIcon className="h-4 w-4 text-emerald-400" />
    <span>Install CLI</span>
  </button>
);

const SERVER_INSTALL_FOOTNOTE = (
  <>
    Requires Node.js 18+. Run <span className="font-mono text-emerald-300">byspace</span> to start
    the daemon.
  </>
);

function ServerInstallButton() {
  return (
    <CommandDialog
      trigger={SERVER_INSTALL_TRIGGER}
      title="Install BySpace on your machine"
      description="Run the BySpace daemon on any laptop, server, or workstation you want to control."
      command="npm install -g @bytetrue/byspace && byspace"
      footnote={SERVER_INSTALL_FOOTNOTE}
    />
  );
}

function ClaudeCodeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" />
    </svg>
  );
}

function CodexIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M21.55 10.004a5.416 5.416 0 00-.478-4.501c-1.217-2.09-3.662-3.166-6.05-2.66A5.59 5.59 0 0010.831 1C8.39.995 6.224 2.546 5.473 4.838A5.553 5.553 0 001.76 7.496a5.487 5.487 0 00.691 6.5 5.416 5.416 0 00.477 4.502c1.217 2.09 3.662 3.165 6.05 2.66A5.586 5.586 0 0013.168 23c2.443.006 4.61-1.546 5.361-3.84a5.553 5.553 0 003.715-2.66 5.488 5.488 0 00-.693-6.497v.001zm-8.381 11.558a4.199 4.199 0 01-2.675-.954c.034-.018.093-.05.132-.074l4.44-2.53a.71.71 0 00.364-.623v-6.176l1.877 1.069c.02.01.033.029.036.05v5.115c-.003 2.274-1.87 4.118-4.174 4.123zM4.192 17.78a4.059 4.059 0 01-.498-2.763c.032.02.09.055.131.078l4.44 2.53c.225.13.504.13.73 0l5.42-3.088v2.138a.068.068 0 01-.027.057L9.9 19.288c-1.999 1.136-4.552.46-5.707-1.51h-.001zM3.023 8.216A4.15 4.15 0 015.198 6.41l-.002.151v5.06a.711.711 0 00.364.624l5.42 3.087-1.876 1.07a.067.067 0 01-.063.005l-4.489-2.559c-1.995-1.14-2.679-3.658-1.53-5.63h.001zm15.417 3.54l-5.42-3.088L14.896 7.6a.067.067 0 01.063-.006l4.489 2.557c1.998 1.14 2.683 3.662 1.529 5.633a4.163 4.163 0 01-2.174 1.807V12.38a.71.71 0 00-.363-.623zm1.867-2.773a6.04 6.04 0 00-.132-.078l-4.44-2.53a.731.731 0 00-.729 0l-5.42 3.088V7.325a.068.068 0 01.027-.057L14.1 4.713c2-1.137 4.555-.46 5.707 1.513.487.833.664 1.809.499 2.757h.001zm-11.741 3.81l-1.877-1.068a.065.065 0 01-.036-.051V6.559c.001-2.277 1.873-4.122 4.181-4.12.976 0 1.92.338 2.671.954-.034.018-.092.05-.131.073l-4.44 2.53a.71.71 0 00-.365.623l-.003 6.173v.002zm1.02-2.168L12 9.25l2.414 1.375v2.75L12 14.75l-2.415-1.375v-2.75z" />
    </svg>
  );
}

function OpenCodeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="96 64 288 384" fill="currentColor" {...props}>
      <path d="M320 224V352H192V224H320Z" opacity="0.4" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z"
      />
    </svg>
  );
}

function CursorIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 466.73 532.09"
      fill="currentColor"
      {...props}
    >
      <path d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z" />
    </svg>
  );
}

function PiIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="currentColor" {...props}>
      <path
        d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"
        fillRule="evenodd"
      />
      <path d="M517.36 400 H634.72 V634.72 H517.36 Z" />
    </svg>
  );
}

function CLICodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(() => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  return (
    <div className="relative bg-white/5 rounded-lg overflow-hidden border border-white/10">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-3 right-3 text-white/40 hover:text-white transition-colors p-1.5 rounded-md bg-white/5 cursor-pointer"
        title="Copy to clipboard"
      >
        {copied ? (
          <span className="text-xs text-emerald-400 font-mono">Copied!</span>
        ) : (
          <span className="text-xs text-white/50 font-mono">Copy</span>
        )}
      </button>
      <pre className="p-4 pr-16 text-xs leading-relaxed overflow-x-auto text-white/80 font-mono whitespace-pre">
        {children}
      </pre>
    </div>
  );
}

interface CLIExample {
  title: string;
  description: string;
  code: string;
}

const cliExamples: CLIExample[] = [
  {
    title: "Run agents",
    description:
      "Launch agents locally or on any remote host. The --worktree flag spins up an isolated git branch so you can run multiple agents on the same repo without conflicts.",
    code: `byspace run "implement user authentication"
byspace run --provider codex --worktree feature-x "implement feature X"
byspace run --host workstation.local:6777 "run the full test suite"

byspace ls                           # list running agents
byspace attach abc123                # stream live output
byspace send abc123 "also add tests" # follow-up task`,
  },
  {
    title: "Loops",
    description:
      "Have one agent do the work, another verify the result, and loop until it passes. Built-in, no shell scripting needed.",
    code: `# Worker-verifier loop: fix tests until they pass
byspace loop run "make all tests pass" \\
  --verify "verify tests pass and the code is production-ready" \\
  --verify-check "npm test" \\
  --max-iterations 5

byspace loop ls                        # list running loops
byspace loop logs abc123               # stream loop output`,
  },
  {
    title: "Schedules",
    description:
      "Run agents on a cron schedule. Automate recurring tasks like dependency updates, security audits, or report generation.",
    code: `# Run a security audit every Monday at 9am
byspace schedule create --cron "0 9 * * 1" \\
  "audit the codebase for security issues and open PRs for fixes"

byspace schedule ls                    # list all schedules
byspace schedule pause abc123          # pause a schedule
byspace schedule delete abc123         # remove a schedule`,
  },
];

function PhoneShowcase() {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const textInView = useInView(containerRef, { once: true, margin: "-80px" });

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "center center"],
  });

  const [slideDistance, setSlideDistance] = React.useState(260);
  React.useEffect(() => {
    function update() {
      setSlideDistance(window.innerWidth < 768 ? 140 : 260);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const sideOpacity = useTransform(scrollYProgress, [0.2, 0.6], [0, 1]);
  const leftX = useTransform(scrollYProgress, [0.2, 0.6], [0, -slideDistance]);
  const rightX = useTransform(scrollYProgress, [0.2, 0.6], [0, slideDistance]);

  const leftPhoneStyle = React.useMemo(
    () => ({ opacity: sideOpacity, x: leftX, rotateY: -15, scale: 0.97 }),
    [sideOpacity, leftX],
  );
  const rightPhoneStyle = React.useMemo(
    () => ({ opacity: sideOpacity, x: rightX, rotateY: 15, scale: 0.97 }),
    [sideOpacity, rightX],
  );
  const centerPhoneAnimate = React.useMemo(() => (textInView ? FADE_IN : {}), [textInView]);
  const textAnimate = React.useMemo(() => (textInView ? FADE_IN : {}), [textInView]);

  return (
    <div ref={containerRef} className="flex flex-col items-center pt-4 pb-16 gap-16">
      <motion.div
        initial={FADE_IN_UP_TINY}
        animate={textAnimate}
        transition={DURATION_05}
        className="flex flex-col items-center gap-2 px-6"
      >
        <p className="text-xl md:text-2xl font-medium text-white/90 text-center">
          When you want to step away from your desk, you can.
        </p>
        <p className="text-sm text-white/50 text-center">
          The hosted Web app and PWA have full feature parity with desktop.
        </p>
      </motion.div>

      <div
        className="relative flex items-center justify-center overflow-x-clip w-full"
        style={PHONE_PERSPECTIVE_STYLE}
      >
        <motion.div style={leftPhoneStyle} className="w-[160px] md:w-[240px] absolute">
          <img
            src="./phone-1-480.webp"
            srcSet="./phone-1-320.webp 320w, ./phone-1-480.webp 480w"
            sizes="(min-width: 768px) 240px, 160px"
            alt="BySpace sessions list"
            width={480}
            height={1044}
            loading="lazy"
            decoding="async"
            className="w-full rounded-[40px] shadow-2xl border-[3px] border-black outline-[3px] outline-white/20"
          />
        </motion.div>

        <motion.div
          initial={FADE_IN_UP_XL}
          animate={centerPhoneAnimate}
          transition={EASE_OUT_06_DELAY_01}
          className="w-[220px] md:w-[240px] relative z-10"
        >
          <img
            src="./phone-2-480.webp"
            srcSet="./phone-2-320.webp 320w, ./phone-2-480.webp 480w"
            sizes="(min-width: 768px) 240px, 220px"
            alt="BySpace agent chat"
            width={480}
            height={1044}
            loading="lazy"
            decoding="async"
            className="w-full rounded-[40px] shadow-2xl border-[3px] border-black outline-[3px] outline-white/20"
          />
        </motion.div>

        <motion.div style={rightPhoneStyle} className="w-[160px] md:w-[240px] absolute">
          <img
            src="./phone-3-480.webp"
            srcSet="./phone-3-320.webp 320w, ./phone-3-480.webp 480w"
            sizes="(min-width: 768px) 240px, 160px"
            alt="BySpace diff view"
            width={480}
            height={1044}
            loading="lazy"
            decoding="async"
            className="w-full rounded-[40px] shadow-2xl border-[3px] border-black outline-[3px] outline-white/20"
          />
        </motion.div>
      </div>
    </div>
  );
}

function CLITabButton({
  title,
  index,
  active,
  onSelect,
}: {
  title: string;
  index: number;
  active: boolean;
  onSelect: (i: number) => void;
}) {
  const handleClick = React.useCallback(() => {
    onSelect(index);
  }, [index, onSelect]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`text-xs px-3.5 py-1.5 rounded-full border transition-colors cursor-pointer ${
        active
          ? "border-emerald-500/50 text-white bg-emerald-500/15"
          : "border-white/15 text-white/50 hover:text-white/80 hover:border-white/30"
      }`}
    >
      {title}
    </button>
  );
}

function CLISection() {
  const [activeIndex, setActiveIndex] = React.useState(0);
  const active = cliExamples[activeIndex];

  const handleSelect = React.useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  return (
    <FeatureSection
      title="Fully scriptable"
      description="Everything you can do in the app, you can do from the terminal."
    >
      <div className="mb-3 flex flex-wrap gap-2">
        {cliExamples.map((example, i) => (
          <CLITabButton
            key={example.title}
            title={example.title}
            index={i}
            active={i === activeIndex}
            onSelect={handleSelect}
          />
        ))}
      </div>

      <div className="mb-3">
        <CLICodeBlock>{active.code}</CLICodeBlock>
      </div>

      <a
        href={`${docsUrl}/cli`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
      >
        Full CLI reference &rarr;
      </a>
    </FeatureSection>
  );
}

function FAQ() {
  return (
    <motion.div
      initial={FADE_IN_UP}
      whileInView={FADE_IN}
      viewport={VIEWPORT_60}
      transition={EASE_OUT_05}
      className="space-y-6"
    >
      <h2 className="text-3xl font-medium text-white">Frequently asked questions</h2>
      <div className="space-y-6">
        <FAQItem question="Is BySpace free and open source?">
          Yes. BySpace is free and open source under AGPL-3.0. You run agents on your machine using
          your own API keys and accounts.
        </FAQItem>
        <FAQItem question="Does my code leave my machine?">
          No. BySpace runs agents locally as normal subprocesses. When using remote access, all
          traffic is end-to-end encrypted with Curve25519 ECDH + NaCl Box. The relay server is
          zero-knowledge and cannot read your messages or code.
        </FAQItem>
        <FAQItem question="What agents are supported?">
          Native adapters for Claude Code (Agent SDK), OpenAI Codex (app-server), OpenCode, and Pi,
          plus 30+ ACP-compatible harnesses (Cursor, Qwen Coder, Kimi Code, Hermes, Copilot).
        </FAQItem>
        <FAQItem question="How do I connect from another computer or phone?">
          Run <code className="font-mono text-emerald-300">byspace daemon pair</code> on your host
          machine. Open the printed pairing link on any phone or laptop to establish an end-to-end
          encrypted session.
        </FAQItem>
        <FAQItem question="How do worktrees work?">
          When launching an agent with the worktree option, BySpace creates an isolated git worktree
          and runs the agent inside it. You can run multiple agents on different branches
          simultaneously without conflicts.
        </FAQItem>
      </div>
    </motion.div>
  );
}

function SponsorCTA() {
  return (
    <motion.div
      initial={FADE_IN_UP}
      whileInView={FADE_IN}
      viewport={VIEWPORT_60}
      transition={EASE_OUT_05}
      className="rounded-2xl bg-white/[0.03] border border-white/10 p-8 md:p-10 text-left space-y-4 max-w-xl mx-auto"
    >
      <div className="text-sm text-white/70 leading-relaxed space-y-3">
        <p>
          BySpace is an independent open source development environment for orchestrating coding
          agents across your machines, browser, and terminal.
        </p>
        <p>
          Built on freedom of choice: bring your own models, keep your data local, and control
          everything from anywhere.
        </p>
      </div>
      <div className="pt-2 flex items-center gap-4">
        <a
          href={webAppUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 text-black font-semibold px-5 py-2 text-sm hover:bg-emerald-400 transition-colors shadow-glow"
        >
          Open Web Console &rarr;
        </a>
        <a
          href={githubRepoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-white/10 border border-white/20 px-4 py-2 text-sm font-medium text-white hover:bg-white/15 transition-colors"
        >
          Star on GitHub
        </a>
      </div>
    </motion.div>
  );
}
