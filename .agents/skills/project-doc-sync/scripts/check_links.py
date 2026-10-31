from pathlib import Path
from urllib.parse import unquote, urlsplit
import re
import sys

ROOT = Path(__file__).resolve().parents[4]
LINK_RE = re.compile(r"!?\[[^\]\n]*\]\(([^)\n]+)\)")
HEADING_RE = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$")
ID_RE = re.compile(r"\bid\s*=\s*(['\"])(.*?)\1", re.IGNORECASE)
FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")

def markdown_files():
    files = [ROOT / name for name in ("AGENTS.md", "CLAUDE.md", "README.md")]
    files = [path for path in files if path.is_file()]
    files.extend((ROOT / "docs").rglob("*.md"))
    skills = ROOT / ".agents" / "skills"
    files.extend(skills.rglob("SKILL.md"))
    files.extend(skills.glob("*/references/**/*.md"))
    return sorted(set(files))

def without_fences(text):
    kept = []
    fence = None
    for line in text.splitlines():
        match = FENCE_RE.match(line)
        if match:
            marker = match.group(1)
            if fence is None:
                fence = marker[0]
            elif marker[0] == fence:
                fence = None
            continue
        if fence is None:
            kept.append(line)
    return "\n".join(kept)

def slugify(title):
    title = re.sub(r"<[^>]+>", "", title).strip().lower()
    title = re.sub(r"[^\w\- ]", "", title)
    return re.sub(r"\s+", "-", title).strip("-")

def anchors(path):
    text = without_fences(path.read_text(encoding="utf-8"))
    found = set(match.group(2) for match in ID_RE.finditer(text))
    counts = {}
    for line in text.splitlines():
        match = HEADING_RE.match(line)
        if not match:
            continue
        base = slugify(match.group(1))
        count = counts.get(base, 0)
        counts[base] = count + 1
        found.add(base if count == 0 else f"{base}-{count}")
    return found

def link_target(raw):
    raw = raw.strip()
    if raw.startswith("<") and ">" in raw:
        return raw[1 : raw.index(">")]
    title = re.search(r"\s+(?:['\"].*['\"]|\(.*\))\s*$", raw)
    return raw[: title.start()] if title else raw

def resolve(source, raw):
    target = link_target(raw)
    parts = urlsplit(target)
    if parts.scheme or parts.netloc:
        return None
    path_text = unquote(parts.path)
    path = source if not path_text else ROOT / path_text.lstrip("/") if path_text.startswith("/") else source.parent / path_text
    return path.resolve(), unquote(parts.fragment), target

def main():
    files = markdown_files()
    errors = []
    checked = 0
    claude = ROOT / "CLAUDE.md"
    if claude.is_file() and claude.read_bytes() not in (b"@AGENTS.md", b"@AGENTS.md\n"):
        errors.append("CLAUDE.md 必须只包含 @AGENTS.md")
    anchor_cache = {}
    for source in files:
        text = without_fences(source.read_text(encoding="utf-8"))
        for match in LINK_RE.finditer(text):
            result = resolve(source, match.group(1))
            if result is None:
                continue
            target, fragment, original = result
            checked += 1
            label = source.relative_to(ROOT)
            if target != ROOT and ROOT not in target.parents:
                errors.append(f"{label}：链接目标超出仓库：{original}")
                continue
            if not target.exists():
                errors.append(f"{label}：链接目标不存在：{original}")
                continue
            if fragment and target.is_file():
                if target not in anchor_cache:
                    anchor_cache[target] = anchors(target)
                available = anchor_cache[target]
                if fragment not in available:
                    errors.append(f"{label}：链接锚点不存在：{original}")
    if errors:
        print("文档检查失败：")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"文档检查通过：核对 {len(files)} 个文件、{checked} 个本地链接")
    return 0

if __name__ == "__main__":
    sys.exit(main())
