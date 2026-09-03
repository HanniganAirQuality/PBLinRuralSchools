#!/usr/bin/env python3
"""Audit locale JSON catalogs against the English reference catalogs.

Checks for duplicate JSON object keys, keys missing from non-English locales,
keys in non-English locales that do not exist in the matching English file,
and English entries that do not appear to be used by the website. Returns exit
code 1 when any problem is found so it can be used in CI.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# User settings
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOCALES_DIR = PROJECT_ROOT / "translations" / "locales"
ENGLISH_LOCALE = "en"
CHECK_UNUSED_ENTRIES = True
UNUSED_ENTRIES_ARE_ERRORS = True
SOURCE_FILE_EXTENSIONS = {".html", ".js"}
EXCLUDED_SOURCE_DIRECTORIES = {".git", "mnt", "translations"}
TRANSLATABLE_HTML_ATTRIBUTES = {"alt", "aria-label", "data-help", "placeholder", "title"}
IGNORED_HTML_ELEMENTS = {"script", "style", "template", "pre", "code"}


@dataclass
class Catalog:
    entries: dict[str, Any]
    duplicates: list[str]


class HtmlUsageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.strings: set[str] = set()
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in IGNORED_HTML_ELEMENTS:
            self._ignored_depth += 1

        if self._ignored_depth:
            return

        for name, value in attrs:
            if name in TRANSLATABLE_HTML_ATTRIBUTES and value:
                self.strings.add(normalize_text(value))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in IGNORED_HTML_ELEMENTS:
            return
        for name, value in attrs:
            if name in TRANSLATABLE_HTML_ATTRIBUTES and value:
                self.strings.add(normalize_text(value))

    def handle_endtag(self, tag: str) -> None:
        if tag in IGNORED_HTML_ELEMENTS and self._ignored_depth:
            self._ignored_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            normalized = normalize_text(data)
            if normalized:
                self.strings.add(normalized)


def load_catalog(path: Path) -> Catalog:
    duplicates: list[str] = []

    def preserve_and_check_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                duplicates.append(key)
            result[key] = value
        return result

    with path.open(encoding="utf-8-sig") as stream:
        entries = json.load(stream, object_pairs_hook=preserve_and_check_keys)

    if not isinstance(entries, dict):
        raise ValueError("catalog root must be a JSON object")

    return Catalog(entries=entries, duplicates=duplicates)


def json_files(directory: Path) -> dict[Path, Path]:
    return {
        path.relative_to(directory): path
        for path in sorted(directory.rglob("*.json"))
        if path.is_file()
    }


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def source_files() -> list[Path]:
    files: list[Path] = []
    for path in PROJECT_ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in SOURCE_FILE_EXTENSIONS:
            continue
        relative_parts = path.relative_to(PROJECT_ROOT).parts
        if any(part in EXCLUDED_SOURCE_DIRECTORIES for part in relative_parts):
            continue
        files.append(path)
    return sorted(files)


def collect_source_usage() -> tuple[set[str], str, int]:
    html_strings: set[str] = set()
    javascript_source: list[str] = []
    files = source_files()

    for path in files:
        source = path.read_text(encoding="utf-8-sig")
        if path.suffix.lower() == ".html":
            parser = HtmlUsageParser()
            parser.feed(source)
            parser.close()
            html_strings.update(parser.strings)
        elif path.suffix.lower() == ".js":
            javascript_source.append(source)

    return html_strings, "\n".join(javascript_source), len(files)


def quoted_key_is_used(key: str, javascript_source: str) -> bool:
    double_quoted = json.dumps(key, ensure_ascii=False)
    single_quoted = "'" + key.replace("\\", "\\\\").replace("'", "\\'") + "'"
    return double_quoted in javascript_source or single_quoted in javascript_source


def english_value_is_used(value: Any, html_strings: set[str], javascript_source: str) -> bool:
    if not isinstance(value, str) or not value:
        return False

    normalized = normalize_text(value)
    return normalized in html_strings or value in javascript_source


def find_unused_entries(
    english_files: dict[Path, Path],
    catalogs: dict[Path, Catalog],
) -> tuple[dict[Path, set[str]], int]:
    html_strings, javascript_source, scanned_file_count = collect_source_usage()
    unused_by_file: dict[Path, set[str]] = {}

    for relative_path, path in english_files.items():
        catalog = catalogs.get(path)
        if catalog is None:
            continue

        unused = {
            key
            for key, value in catalog.entries.items()
            if not quoted_key_is_used(key, javascript_source)
            and not english_value_is_used(value, html_strings, javascript_source)
        }
        if unused:
            unused_by_file[relative_path] = unused

    return unused_by_file, scanned_file_count


def print_keys(label: str, keys: set[str]) -> None:
    if not keys:
        return

    print(f"    {label} ({len(keys)}):")
    for key in sorted(keys):
        print(f"      - {key}")


def main() -> int:
    locales_dir = LOCALES_DIR.resolve()
    english_dir = locales_dir / ENGLISH_LOCALE

    if not english_dir.is_dir():
        print(f"ERROR: English locale directory not found: {english_dir}", file=sys.stderr)
        return 2

    locale_dirs = [
        path
        for path in sorted(locales_dir.iterdir(), key=lambda item: item.name.casefold())
        if path.is_dir()
    ]
    english_files = json_files(english_dir)
    catalogs: dict[Path, Catalog] = {}
    issue_count = 0

    print(f"English reference: {english_dir}")

    for locale_dir in locale_dirs:
        for relative_path, path in json_files(locale_dir).items():
            try:
                catalog = load_catalog(path)
            except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as error:
                print(f"INVALID JSON [{locale_dir.name}/{relative_path.as_posix()}]: {error}")
                issue_count += 1
                continue

            catalogs[path] = catalog
            for key in catalog.duplicates:
                print(f"DUPLICATE [{locale_dir.name}/{relative_path.as_posix()}]: {key}")
                issue_count += 1

    if not english_files:
        print("ERROR: No English JSON catalogs were found.", file=sys.stderr)
        return 2

    for locale_dir in locale_dirs:
        if locale_dir == english_dir:
            continue

        print(f"\nLocale: {locale_dir.name}")
        locale_files = json_files(locale_dir)
        compared_any = False

        for relative_path in sorted(set(english_files) | set(locale_files)):
            english_path = english_files.get(relative_path)
            locale_path = locale_files.get(relative_path)

            if english_path is None:
                locale_catalog = catalogs.get(locale_path) if locale_path else None
                unexpected = set(locale_catalog.entries) if locale_catalog else set()
                print(f"  {relative_path.as_posix()} (no matching English file)")
                print_keys("Unexpected", unexpected)
                issue_count += max(1, len(unexpected))
                compared_any = True
                continue

            english_catalog = catalogs.get(english_path)
            if english_catalog is None:
                continue

            if locale_path is None:
                missing = set(english_catalog.entries)
                print(f"  {relative_path.as_posix()} (locale file missing)")
                print_keys("Missing", missing)
                issue_count += max(1, len(missing))
                compared_any = True
                continue

            locale_catalog = catalogs.get(locale_path)
            if locale_catalog is None:
                continue

            missing = set(english_catalog.entries) - set(locale_catalog.entries)
            unexpected = set(locale_catalog.entries) - set(english_catalog.entries)

            if missing or unexpected:
                print(f"  {relative_path.as_posix()}")
                print_keys("Missing", missing)
                print_keys("Unexpected", unexpected)
                issue_count += len(missing) + len(unexpected)
                compared_any = True

        if not compared_any:
            print("  OK")

    non_english_count = len(locale_dirs) - int(english_dir in locale_dirs)
    if non_english_count == 0:
        print("\nNo non-English locale directories found.")

    if CHECK_UNUSED_ENTRIES:
        unused_by_file, scanned_file_count = find_unused_entries(english_files, catalogs)
        print(f"\nUnused English entries (scanned {scanned_file_count} source files):")
        if unused_by_file:
            unused_count = 0
            for relative_path, unused in sorted(unused_by_file.items()):
                print(f"  {relative_path.as_posix()}")
                print_keys("Possibly unused", unused)
                unused_count += len(unused)
            if UNUSED_ENTRIES_ARE_ERRORS:
                issue_count += unused_count
        else:
            print("  OK")

    print(f"\nResult: {'PASS' if issue_count == 0 else 'FAIL'} ({issue_count} issue(s))")
    return 0 if issue_count == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
