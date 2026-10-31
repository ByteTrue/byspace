#!/usr/bin/env python3
"""Copy packages/app's canvas diff document (git/diff-document/index.tsx and surface.web.tsx) to
web/src/overrides with two changes: imports go through `@/` so the web file header and review
thread replace the Expo ones, and the context-menu trigger around the surface is a flex column
(a React Native View was one; the web trigger is a plain div)."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "packages/app/src/git/diff-document"
OVR = ROOT / "web/src/overrides/git/diff-document"

HEADER = """// Generated from the Expo file by web/scripts/port/diff-document.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
"""


def via_alias(source: str, name: str) -> str:
    def to_alias(match: re.Match[str]) -> str:
        module = match.group(1)
        # Name the .web module so the typecheck reads the file Vite picks.
        if module in ("surface", "paint", "horizontal-scroll"):
            module = f"{module}.web" if not module.endswith(".web") else module
        return f'from "@/git/diff-document/{module}"'

    out = re.sub(r'from "\./([^"]+)"', to_alias, source)
    if 'from "./' in out:
        raise SystemExit(f"{name}: relative import left")
    return out


def rep(source: str, old: str, new: str, name: str) -> str:
    if source.count(old) != 1:
        raise SystemExit(f"{name}: expected one of:\n{old}")
    return source.replace(old, new)


OVR.mkdir(parents=True, exist_ok=True)

index = via_alias((APP / "index.tsx").read_text(encoding="utf-8"), "index")
(OVR / "index.tsx").write_text(
    "// Override of packages/app/src/git/diff-document/index.tsx: unchanged but for `@/` imports.\n"
    + HEADER + index, encoding="utf-8")

surface = via_alias((APP / "surface.web.tsx").read_text(encoding="utf-8"), "surface")
surface = rep(surface, "      <ContextMenuTrigger contextOnly style={CONTEXT_TRIGGER_STYLE}>",
              '      <ContextMenuTrigger contextOnly className="flex min-h-0 flex-1 flex-col">',
              "surface")
surface = rep(surface, "const CONTEXT_TRIGGER_STYLE: ViewStyle = { flex: 1, minHeight: 0 };\n", "",
              "surface")
(OVR / "surface.web.tsx").write_text(
    "// Override of packages/app/src/git/diff-document/surface.web.tsx: unchanged but for `@/` imports\n"
    "// and the context-menu trigger's layout (a flex column, as the React Native View was).\n"
    + HEADER + surface, encoding="utf-8")
print("ok")
