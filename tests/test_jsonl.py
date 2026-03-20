import pytest

from app.services.jsonl import detect_form, parse_jsonl


def test_detect_form_1_prompt_only():
    assert detect_form({"prompt": "hello"}) == 1


def test_detect_form_2_with_responses():
    assert detect_form({"prompt": "hello", "responses": {"m1": "world"}}) == 2


def test_detect_form_3_full():
    assert (
        detect_form(
            {
                "prompt": "hello",
                "responses": {"m1": "world"},
                "scores": {"m1": 4},
                "rankings": {"m1": 1},
            }
        )
        == 3
    )


def test_detect_form_3_requires_all_three_fields():
    # scores without rankings → still form 2
    assert detect_form({"prompt": "hi", "responses": {}, "scores": {}}) == 2


def test_parse_jsonl_basic():
    content = b'{"prompt": "a"}\n{"prompt": "b"}\n'
    records = parse_jsonl(content)
    assert len(records) == 2
    assert records[0]["prompt"] == "a"
    assert records[1]["prompt"] == "b"


def test_parse_jsonl_ignores_blank_lines():
    content = b'{"prompt": "a"}\n\n{"prompt": "b"}\n'
    assert len(parse_jsonl(content)) == 2


def test_parse_jsonl_empty():
    assert parse_jsonl(b"") == []


def test_parse_jsonl_invalid_raises():
    with pytest.raises(Exception):
        parse_jsonl(b"not valid json\n")
