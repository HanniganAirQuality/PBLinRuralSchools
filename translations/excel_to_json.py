#!/usr/bin/env python3
"""Convert an Excel translation workbook back into locale JSON catalogs."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from translation_workbook import format_error, workbook_to_json


SCRIPT_DIR = Path(__file__).resolve().parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "workbook", nargs="?", type=Path, default=SCRIPT_DIR / "translations.xlsx",
        help="workbook to import (default: translations/translations.xlsx)",
    )
    parser.add_argument(
        "--output-dir", type=Path, default=SCRIPT_DIR / "locales",
        help="locale JSON destination (default: translations/locales)",
    )
    parser.add_argument(
        "--english", default="en", help="English locale folder name (default: en)"
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        workbook_to_json(args.workbook, args.output_dir.resolve(), args.english)
    except (OSError, UnicodeError, ValueError) as error:
        print(format_error(error), file=sys.stderr)
        return 1
    print(f"Wrote locale JSON files under {args.output_dir.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
