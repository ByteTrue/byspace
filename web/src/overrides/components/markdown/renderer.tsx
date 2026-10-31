// Override of packages/app/src/components/markdown/renderer.tsx: markdown outside agent prose
// (plan cards, review comments, file previews, the changelog). The same HTML-ish pre-pass splits
// out <details> and inline images; the markdown between them renders through web/src/markdown.
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import type MarkdownIt from "markdown-it";
import { ChevronDown, ChevronRight } from "lucide-react";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { MarkdownFenceBlock } from "@/components/markdown/fence";
import {
  splitHtmlishMarkdown,
  type MarkdownDisplayPart,
  type MarkdownInlineImagePart,
} from "@/components/markdown/html-ish";
import {
  resolveInlineImageSize,
  type InlineImageDimensions,
} from "@/components/markdown/inline-image-size";
import { groupMarkdownParts, type MarkdownPartGroup } from "@/components/markdown/part-groups";
import { createMarkdownParser } from "@/utils/markdown-parser";
import { openExternalUrl } from "@/utils/open-external-url";
import { parseMarkdownAst } from "~/markdown/ast";
import { MarkdownBody, type MarkdownRules } from "~/markdown/render";

// Serves PR comment bodies and the markdown file preview; agent chat passes its
// own parser. The preview has to show the bytes on disk, so no typographer.
const defaultMarkdownParser = createMarkdownParser({ linkify: true });

const DEFAULT_ALLOWED_IMAGE_HANDLERS = [
  "data:image/png;base64",
  "data:image/gif;base64",
  "data:image/jpeg;base64",
  "https://",
  "http://",
] as const;

export interface MarkdownRendererProps {
  text: string;
  compact?: boolean;
  rules?: MarkdownRules;
  markdownit?: MarkdownIt;
  onLinkPress?: (url: string) => boolean;
  allowedImageHandlers?: readonly string[];
  enableHtmlish?: boolean;
}

function openLink(href: string, onLinkPress: ((url: string) => boolean) | undefined) {
  if (!href) return;
  if (onLinkPress?.(href) === false) return;
  void openExternalUrl(href);
}

function SharedMarkdownLink({
  href,
  title,
  onLinkPress,
  children,
}: {
  href: string;
  title?: string;
  onLinkPress?: (url: string) => boolean;
  children: ReactNode;
}) {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      openLink(href, onLinkPress);
    },
    [href, onLinkPress],
  );
  return (
    <a href={href} title={title} onClick={handleClick}>
      {children}
    </a>
  );
}

/** Code, fences and links for markdown outside agent prose. */
export function createSharedMarkdownRules(
  options: {
    onLinkPress?: (url: string) => boolean;
    allowedImageHandlers?: readonly string[];
  } = {},
): MarkdownRules {
  const { onLinkPress, allowedImageHandlers = DEFAULT_ALLOWED_IMAGE_HANDLERS } = options;
  return {
    code_block: (node) => (
      <HighlightedCodeBlock
        key={node.key}
        code={node.content}
        language={null}
        variant="code_block"
      />
    ),
    fence: (node) => (
      <MarkdownFenceBlock
        key={node.key}
        code={node.content}
        info={node.sourceInfo}
        phase="complete"
      />
    ),
    link: (node, children) => (
      <SharedMarkdownLink
        key={node.key}
        href={node.attributes.href ?? ""}
        title={node.attributes.title}
        onLinkPress={onLinkPress}
      >
        {children}
      </SharedMarkdownLink>
    ),
    image: (node) => {
      const src = node.attributes.src ?? "";
      if (!allowedImageHandlers.some((handler) => src.startsWith(handler))) return null;
      return <img key={node.key} src={src} alt={node.attributes.alt} className="md-image" />;
    },
  };
}

export function MarkdownRenderer({
  text,
  compact = false,
  rules,
  markdownit = defaultMarkdownParser,
  onLinkPress,
  allowedImageHandlers,
  enableHtmlish = true,
}: MarkdownRendererProps) {
  const markdownRules = useMemo(
    () => rules ?? createSharedMarkdownRules({ onLinkPress, allowedImageHandlers }),
    [allowedImageHandlers, onLinkPress, rules],
  );
  const parts = useMemo<MarkdownDisplayPart[]>(
    () => (enableHtmlish ? splitHtmlishMarkdown(text) : [{ kind: "markdown", text }]),
    [enableHtmlish, text],
  );
  const rendererProps = useMemo(
    () => ({ compact, rules: markdownRules, markdownit, onLinkPress }),
    [compact, markdownRules, markdownit, onLinkPress],
  );
  return <MarkdownPartList parts={parts} rendererProps={rendererProps} />;
}

interface MarkdownPartRendererProps {
  compact: boolean;
  rules: MarkdownRules;
  markdownit: MarkdownIt;
  onLinkPress?: (url: string) => boolean;
}

function MarkdownPartList({
  parts,
  rendererProps,
}: {
  parts: MarkdownDisplayPart[];
  rendererProps: MarkdownPartRendererProps;
}) {
  const keyedGroups = useMemo(() => keyMarkdownGroups(groupMarkdownParts(parts)), [parts]);
  return (
    <>
      {keyedGroups.map(({ key, group }) =>
        group.kind === "part" ? (
          <MarkdownPart key={key} part={group.part} rendererProps={rendererProps} />
        ) : (
          <MarkdownImageTextGroup key={key} group={group} rendererProps={rendererProps} />
        ),
      )}
    </>
  );
}

function keyMarkdownGroups(
  groups: MarkdownPartGroup[],
): { key: string; group: MarkdownPartGroup }[] {
  const seen = new Map<string, number>();
  return groups.map((group) => {
    const identity =
      group.kind === "part"
        ? getMarkdownPartIdentity(group.part)
        : `imageText:${group.images.map((i) => i.src).join(",")}:${group.lead.slice(0, 80)}`;
    const seenCount = seen.get(identity) ?? 0;
    seen.set(identity, seenCount + 1);
    return { key: `${identity}:${seenCount}`, group };
  });
}

function getMarkdownPartIdentity(part: MarkdownDisplayPart): string {
  if (part.kind === "markdown") return `markdown:${part.text.slice(0, 80)}`;
  if (part.kind === "inlineImage") return `inlineImage:${part.src}:${part.alt}`;
  return `details:${part.summary.slice(0, 80)}:${part.body.slice(0, 80)}`;
}

function MarkdownPart({
  part,
  rendererProps,
}: {
  part: MarkdownDisplayPart;
  rendererProps: MarkdownPartRendererProps;
}) {
  if (part.kind === "details") return <MarkdownDetails part={part} rendererProps={rendererProps} />;
  if (part.kind === "inlineImage") {
    return <MarkdownInlineImage part={part} onLinkPress={rendererProps.onLinkPress} />;
  }
  if (part.text.length === 0) return null;
  return <MarkdownFragment text={part.text} rendererProps={rendererProps} />;
}

function MarkdownFragment({
  text,
  rendererProps,
}: {
  text: string;
  rendererProps: MarkdownPartRendererProps;
}) {
  const nodes = useMemo(
    () => parseMarkdownAst(text, rendererProps.markdownit),
    [rendererProps.markdownit, text],
  );
  return <MarkdownBody nodes={nodes} rules={rendererProps.rules} compact={rendererProps.compact} />;
}

function useNaturalImageDimensions(part: MarkdownInlineImagePart) {
  const [natural, setNatural] = useState<InlineImageDimensions | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (part.width && part.height) return;
    let cancelled = false;
    const image = new Image();
    image.addEventListener("load", () => {
      if (!cancelled) setNatural({ width: image.naturalWidth, height: image.naturalHeight });
    });
    image.addEventListener("error", () => {
      if (!cancelled) setFailed(true);
    });
    image.src = part.src;
    return () => {
      cancelled = true;
    };
  }, [part.height, part.src, part.width]);
  return { natural, failed, setFailed };
}

function MarkdownInlineImage({
  part,
  onLinkPress,
}: {
  part: MarkdownInlineImagePart;
  onLinkPress?: (url: string) => boolean;
}) {
  const { natural } = useNaturalImageDimensions(part);
  const size = useMemo<CSSProperties>(
    () => resolveInlineImageSize({ explicit: { width: part.width, height: part.height }, natural }),
    [natural, part.height, part.width],
  );
  const handleClick = useCallback(() => {
    if (part.href) openLink(part.href, onLinkPress);
  }, [onLinkPress, part.href]);
  const image = (
    <img src={part.src} alt={part.alt || undefined} style={size} className="object-contain" />
  );
  if (!part.href) return <div className="mb-1 self-start">{image}</div>;
  return (
    <button type="button" className="mb-1 self-start" onClick={handleClick}>
      {image}
    </button>
  );
}

const FLOW_IMAGE_MAX_HEIGHT = 18;

function MarkdownFlowImage({
  part,
  onLinkPress,
}: {
  part: MarkdownInlineImagePart;
  onLinkPress?: (url: string) => boolean;
}) {
  const { natural, failed, setFailed } = useNaturalImageDimensions(part);
  const handleClick = useCallback(() => {
    if (part.href) openLink(part.href, onLinkPress);
  }, [onLinkPress, part.href]);
  const handleError = useCallback(() => setFailed(true), [setFailed]);
  const size = useMemo<CSSProperties>(() => {
    const resolved = resolveInlineImageSize({
      explicit: { width: part.width, height: part.height },
      natural,
    });
    const scale = Math.min(1, FLOW_IMAGE_MAX_HEIGHT / resolved.height);
    return {
      width: Math.round(resolved.width * scale),
      height: Math.round(resolved.height * scale),
    };
  }, [natural, part.height, part.width]);
  if (failed) {
    if (!part.alt) return null;
    return (
      <div className="mt-0.5 rounded-[4px] bg-muted px-1">
        <span className="text-[10px] leading-[14px] text-muted-foreground">{part.alt}</span>
      </div>
    );
  }
  const image = (
    <img
      src={part.src}
      alt={part.alt || undefined}
      style={size}
      className="mt-0.5 object-contain"
      onError={handleError}
    />
  );
  if (!part.href) return image;
  return (
    <button type="button" onClick={handleClick}>
      {image}
    </button>
  );
}

function MarkdownImageTextGroup({
  group,
  rendererProps,
}: {
  group: Extract<MarkdownPartGroup, { kind: "imageText" }>;
  rendererProps: MarkdownPartRendererProps;
}) {
  return (
    <>
      <div className="mb-3 flex items-start gap-2">
        {group.images.map((image) => (
          <MarkdownFlowImage key={image.src} part={image} onLinkPress={rendererProps.onLinkPress} />
        ))}
        <div className="min-w-0 flex-1">
          <MarkdownFragment text={group.lead} rendererProps={rendererProps} />
        </div>
      </div>
      {group.rest ? <MarkdownFragment text={group.rest} rendererProps={rendererProps} /> : null}
    </>
  );
}

function MarkdownDetails({
  part,
  rendererProps,
}: {
  part: Extract<MarkdownDisplayPart, { kind: "details" }>;
  rendererProps: MarkdownPartRendererProps;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const bodyParts = useMemo<MarkdownDisplayPart[]>(
    () => part.bodyParts ?? [{ kind: "markdown", text: part.body }],
    [part.body, part.bodyParts],
  );
  return (
    <div className="mb-2 overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1 bg-muted p-2 text-left"
      >
        {open ? (
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 text-sm leading-[18px] text-foreground">
          {part.summary}
        </span>
      </button>
      {open ? (
        <div className="px-2 pt-2">
          <MarkdownPartList parts={bodyParts} rendererProps={rendererProps} />
        </div>
      ) : null}
    </div>
  );
}
