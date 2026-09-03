#!/usr/bin/env python3
"""Create one Excel sheet per English JSON translation catalog."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from translation_workbook import format_error, json_to_workbook


SCRIPT_DIR = Path(__file__).resolve().parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--locales-dir", type=Path, default=SCRIPT_DIR / "locales",
        help="directory containing locale folders (default: translations/locales)",
    )
    parser.add_argument(
        "--english", default="en", help="English locale folder name (default: en)"
    )
    parser.add_argument(
        "--output", type=Path, default=SCRIPT_DIR / "translations.xlsx",
        help="output workbook (default: translations/translations.xlsx)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        json_to_workbook(args.locales_dir, args.english, args.output)
    except (OSError, UnicodeError, ValueError) as error:
        print(format_error(error), file=sys.stderr)
        return 1
    print(f"Created {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
