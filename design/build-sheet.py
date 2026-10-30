#!/usr/bin/env python3
"""Build design/component-sheet.html from component-sheet.src.html.

BySpace's HTML preview blocks every network request (CSP default-src 'none'),
so fonts, screenshots and icons are inlined as data: URIs / an SVG sprite.

  python3 design/build-sheet.py            # uses assets in design/sheet-assets/
"""

import base64
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
ASSETS = ROOT / "sheet-assets"
SRC = ROOT / "component-sheet.src.html"
OUT = ROOT / "component-sheet.html"

FONTS = {
    "geist": "geist-latin-wght-normal.woff2",
    "inter": "inter-latin-wght-normal.woff2",
    "geist-mono": "geist-mono-latin-wght-normal.woff2",
}
LOADER = '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>'


def data_uri(path: pathlib.Path, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def main() -> int:
    html = SRC.read_text()

    def font(m: re.Match) -> str:
        return data_uri(ASSETS / FONTS[m.group(1)], "font/woff2")

    def shot(m: re.Match) -> str:
        return data_uri(ASSETS / f"{m.group(1)}.webp", "image/webp")

    html = re.sub(r"\{\{font:([a-z-]+)\}\}", font, html)
    html = re.sub(r"\{\{shot:([a-z-]+)\}\}", shot, html)

    icons = json.loads((ASSETS / "lucide-icons.json").read_text())
    icons["loader"] = LOADER
    used = set(re.findall(r'href="#([a-z0-9-]+)"', html))
    missing = sorted(used - icons.keys())
    if missing:
        print("missing icons:", ", ".join(missing), file=sys.stderr)
        return 1
    sprite = "".join(f'<symbol id="{n}" viewBox="0 0 24 24">{icons[n]}</symbol>' for n in sorted(used))
    html = html.replace("{{icons}}", f'<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>{sprite}</defs></svg>')

    left = re.findall(r"\{\{[^}]+\}\}", html)
    if left:
        print("unreplaced placeholders:", left, file=sys.stderr)
        return 1
    OUT.write_text(html)
    print(f"wrote {OUT.relative_to(ROOT.parent)} ({OUT.stat().st_size // 1024} KB, {len(used)} icons)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
