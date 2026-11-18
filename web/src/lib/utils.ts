// The shadcn CLI resolves its `utils` alias (web/components.json) to this file when it installs a
// component. Every installed primitive imports `cn` from the npm package directly, so nothing in the
// app imports this module — it exists so `npx shadcn add` has a target and does not write its own
// class-merging implementation into the tree.
export { cn } from "cn";
