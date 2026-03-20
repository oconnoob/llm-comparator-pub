"""Pure helpers for JSONL parsing and form detection."""

import json


def detect_form(record: dict) -> int:
    """
    Detect which JSONL form a record belongs to:
      1 — prompt only
      2 — prompt + responses
      3 — prompt + responses + scores + rankings
    """
    if "responses" in record and "scores" in record and "rankings" in record:
        return 3
    if "responses" in record:
        return 2
    return 1


def parse_jsonl(content: bytes) -> list[dict]:
    """Parse newline-delimited JSON bytes into a list of dicts."""
    records = []
    for line in content.decode().splitlines():
        line = line.strip()
        if line:
            records.append(json.loads(line))
    return records
