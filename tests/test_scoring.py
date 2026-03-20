import pytest

from app.services.scoring import build_scoring_prompt, parse_scoring_response


def test_build_scoring_prompt_contains_models():
    responses = {"GPT-4o": "Answer A", "Llama": "Answer B", "Mistral": "Answer C"}
    prompt = build_scoring_prompt("What is 2+2?", responses)
    assert "GPT-4o" in prompt
    assert "Llama" in prompt
    assert "Mistral" in prompt
    assert "What is 2+2?" in prompt


def test_parse_scoring_response_valid():
    raw = '{"scores": {"A": 4, "B": 3, "C": 5}, "rankings": {"A": 2, "B": 3, "C": 1}}'
    scores, rankings = parse_scoring_response(raw, ["A", "B", "C"])
    assert scores == {"A": 4.0, "B": 3.0, "C": 5.0}
    assert rankings == {"A": 2, "B": 3, "C": 1}


def test_parse_scoring_response_with_markdown():
    raw = '```json\n{"scores": {"A": 5, "B": 4}, "rankings": {"A": 1, "B": 2}}\n```'
    scores, rankings = parse_scoring_response(raw, ["A", "B"])
    assert scores["A"] == 5.0
    assert rankings["B"] == 2


def test_parse_scoring_response_missing_model():
    raw = '{"scores": {"A": 4}, "rankings": {"A": 1}}'
    with pytest.raises(ValueError, match="Missing score"):
        parse_scoring_response(raw, ["A", "B"])


def test_parse_scoring_response_no_json():
    with pytest.raises(ValueError, match="No JSON"):
        parse_scoring_response("Sorry, I cannot score these.", ["A", "B"])
