// Override of packages/app/src/components/plan-card.tsx: a plan as a card — title, optional
// description, the plan's markdown, and the caller's footer (approval buttons).
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { createMarkdownParser } from "@/utils/markdown-parser";
import { cn } from "cn";
import { parseMarkdownAst } from "~/markdown/ast";
import { copyTag, MarkdownBody, type MarkdownRules } from "~/markdown/render";

// No typographer (a plan's literal `(c)` stays as typed) and no linkify: bare URLs stay plain text.
const planMarkdownParser = createMarkdownParser({ linkify: false });

const PLAN_RULES: MarkdownRules = {
  // The last paragraph drops its margin: the card's padding is the only space below the plan.
  paragraph: (node, children, parents) => {
    const isLastChild = parents[0]?.children.at(-1)?.key === node.key;
    return (
      <div key={node.key} className={cn("md-p", isLastChild && "mb-0!")} {...copyTag("p")}>
        {children}
      </div>
    );
  },
};

export function PlanCard({
  title,
  description,
  text,
  footer,
  disableOuterSpacing = false,
  testID,
}: {
  title?: string;
  description?: string;
  text: string;
  footer?: ReactNode;
  disableOuterSpacing?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const nodes = useMemo(() => parseMarkdownAst(text, planMarkdownParser), [text]);
  return (
    <div
      data-testid={testID}
      className={cn(
        "flex flex-col gap-2 rounded-md border bg-card p-3",
        disableOuterSpacing ? "my-0" : "my-3",
      )}
    >
      <span className="text-sm leading-[22px] text-foreground">
        {title ?? t("agentStream.permission.plan")}
      </span>
      {description ? (
        <span className="text-sm leading-5 text-muted-foreground">{description}</span>
      ) : null}
      <MarkdownBody nodes={nodes} rules={PLAN_RULES} />
      {footer ? <div className="flex flex-col gap-2">{footer}</div> : null}
    </div>
  );
}
