"""Shared helpers for the web/scripts/port scripts: load an Expo file, replace exact snippets (each
must match exactly as often as expected, or the script stops), turn the remaining View/Text tags
into div/span, and write the override with its header."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "packages/app/src"
OVR = ROOT / "web/src/overrides"

# Things a finished port must not contain.
# (Icons may keep `withUnistyles` + `uniProps`: the react-native-unistyles shim maps the theme.)
LEFTOVERS = [
    "<View", "<Text ", "<Text>", "<Pressable", "<ScrollView", "StyleSheet", "styles.", "react-native\"",
    "PressableStateCallbackType", "useSafeAreaInsets",
]


class Port:
    def __init__(self, rel: str):
        self.rel = rel
        self.s = (APP / rel).read_text(encoding="utf-8")

    def rep(self, old: str, new: str, count: int = 1) -> None:
        n = self.s.count(old)
        if n != count:
            raise SystemExit(f"{self.rel}: expected {count} of:\n{old[:400]}\n--- found {n}")
        self.s = self.s.replace(old, new)

    def sub(self, pattern: str, new: str, count: int | None = None) -> None:
        """Regex replace; `count` asserts how many matched."""
        found = len(re.findall(pattern, self.s))
        if count is not None and found != count:
            raise SystemExit(f"{self.rel}: expected {count} matches of /{pattern}/, found {found}")
        self.s = re.sub(pattern, new, self.s)

    def between(self, start: str, end: str, new: str) -> None:
        """Replace from `start` (unique) up to, not including, the next `end`."""
        if self.s.count(start) != 1:
            raise SystemExit(f"{self.rel}: start marker not unique: {start[:100]}")
        i = self.s.index(start)
        j = self.s.index(end, i)
        self.s = self.s[:i] + new + self.s[j:]

    def cut_from(self, marker: str) -> None:
        """Drop everything from `marker` (unique) to the end of the file: the StyleSheet block."""
        if self.s.count(marker) != 1:
            raise SystemExit(f"{self.rel}: cut marker not unique: {marker[:100]}")
        self.s = self.s[: self.s.index(marker)].rstrip() + "\n"

    def dom_tags(self) -> None:
        """View → div, Text → span, settingsStyles.* style props → className."""
        self.s = re.sub(r"<View(?=[\s>/])", "<div", self.s)
        self.s = self.s.replace("</View>", "</div>")
        self.s = re.sub(r"<Text(?=[\s>/])", "<span", self.s)
        self.s = self.s.replace("</Text>", "</span>")
        self.s = re.sub(r"style=\{settingsStyles\.(\w+)\}", r"className={settingsStyles.\1}", self.s)

    def check(self, extra: tuple[str, ...] = ()) -> None:
        for needle in (*LEFTOVERS, *extra):
            if needle in self.s:
                i = self.s.index(needle)
                raise SystemExit(f"{self.rel}: leftover {needle!r}:\n{self.s[max(0, i - 300):i + 200]}")

    def write(self, summary: str, script: str) -> None:
        out = OVR / self.rel
        out.parent.mkdir(parents=True, exist_ok=True)
        header = (
            f"// Override of packages/app/src/{self.rel}: {summary}\n"
            f"// Generated from the Expo file by web/scripts/port/{script}.\n"
            "// After changing either file, rerun it and then npm run format:files; do not edit by hand.\n"
        )
        out.write_text(header + self.s, encoding="utf-8")
        print(f"wrote {out.relative_to(ROOT)}")
