#!/usr/bin/env python3
"""元データに新しい版が出ていないかを調べる（.github/workflows/check-data-updates.yml が月1回実行）.

  python scripts/check_updates.py [--markdown 出力先.md]

使っている版は src/data/ と src/fonts/README.md から読み、公式の配布ページの最新版と比べる。
新しい版があれば一覧を表示して終了コード 1 を返す（ワークフローはこれを見て Issue を立てる）。
配布ページが読めなかったものは「確認できなかった」として表示し、それだけでは失敗にしない。
標準ライブラリだけで動く。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
USER_AGENT = "Mozilla/5.0 (compatible; mj-variant-finder update check)"


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def version_key(version: str) -> tuple[int, ...]:
    return tuple(int(n) for n in re.findall(r"\d+", version))


def latest(pattern: str, text: str) -> str | None:
    found = re.findall(pattern, text)
    return max(found, key=version_key) if found else None


def current_versions() -> dict[str, str]:
    meta = json.loads((ROOT / "src" / "data" / "meta.json").read_text(encoding="utf-8"))["sources"]
    hand = json.loads((ROOT / "src" / "data" / "handwriting-patterns.json").read_text(encoding="utf-8"))["source"]
    font_readme = (ROOT / "src" / "fonts" / "README.md").read_text(encoding="utf-8")
    return {
        "mji": re.search(r"mji\.(\d+)\.xlsx", meta["mji"]["url"]).group(1),
        "shrink": re.search(r"MJShrinkMap\.([\d.]+)\.json", meta["shrink"]["url"]).group(1),
        "ivd": re.search(r"(\d{4}-\d{2}-\d{2})", meta["ivd"]["url"]).group(1),
        "unihan": re.search(r"/(\d+\.\d+\.\d+)/", meta["unihan"]["url"]).group(1),
        "kanjivg": re.search(r"(r\d{8})", hand["title"]).group(1),
        "font": re.search(r"IPAmj明朝 Ver\.(\d{3}\.\d{2})", font_readme).group(1),
    }


# 名前、配布ページ、最新版の取り出し方、作り直すコマンド
CHECKS = {
    "mji": ("MJ文字情報一覧表", "https://moji.or.jp/mojikiban/mjlist/",
            lambda text: latest(r"mji\.(\d+)\.xlsx", text), "npm run build:data"),
    "shrink": ("MJ縮退マップ", "https://moji.or.jp/mojikiban/map/",
               lambda text: latest(r"MJShrinkMap\.([\d.]+?)\.(?:json|zip)", text), "npm run build:data"),
    "ivd": ("Unicode IVD", "https://www.unicode.org/ivd/",
            lambda text: latest(r"data/(\d{4}-\d{2}-\d{2})", text), "npm run build:data"),
    "unihan": ("Unihan（Unicode）", "https://www.unicode.org/Public/UCD/latest/ucd/ReadMe.txt",
               lambda text: latest(r"version (\d+\.\d+\.\d+)", text), "npm run build:data"),
    "kanjivg": ("KanjiVG", "https://api.github.com/repos/KanjiVG/kanjivg/releases/latest",
                lambda text: json.loads(text).get("tag_name"), "npm run build:handwriting"),
    "font": ("IPAmj明朝", "https://moji.or.jp/mojikiban/font/",
             lambda text: latest(r"Ver\.(\d{3}\.\d{2})", text), "npm run build:font && npm run build:imageindex"),
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--markdown", type=Path, help="結果を Markdown で書き出す（Issue の本文に使う）")
    args = parser.parse_args()

    current = current_versions()
    updates, lines = [], []
    for key, (name, page, parse, command) in CHECKS.items():
        try:
            newest = parse(fetch(page))
        except Exception:  # 配布ページの変更・一時的な障害
            newest = None
        if newest is None:
            lines.append(f"| {name} | {current[key]} | 確認できなかった | [配布ページ]({page}) |")
            print(f"?  {name}: {current[key]}（配布ページから版を読めなかった: {page}）", file=sys.stderr)
        elif version_key(newest) > version_key(current[key]):
            updates.append(key)
            lines.append(f"| **{name}** | {current[key]} | **{newest}** | [配布ページ]({page})、`{command}` |")
            print(f"新 {name}: {current[key]} → {newest}", file=sys.stderr)
        else:
            lines.append(f"| {name} | {current[key]} | 最新 | |")
            print(f"   {name}: {current[key]}（最新）", file=sys.stderr)

    if args.markdown:
        body = [
            "元データに新しい版が出ています（`scripts/check_updates.py` の自動確認）。",
            "",
            "| データ | 使っている版 | 配布元の最新 | 作り直し |",
            "|---|---|---|---|",
            *lines,
            "",
            "手順は docs/ARCHITECTURE.md を参照。"
            "作り直したら `npm test` と `npm run test:e2e` を通し、差分（件数の変化など）を PR に書いてください。",
            "ライセンスや配布条件が変わっていないかも、配布ページで確認してください。",
        ]
        args.markdown.write_text("\n".join(body) + "\n", encoding="utf-8")

    sys.exit(1 if updates else 0)


if __name__ == "__main__":
    main()
