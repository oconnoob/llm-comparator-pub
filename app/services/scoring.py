"""Pure functions for scoring and ranking model responses via a preference model."""

import json
import re


def build_scoring_prompt(prompt: str, responses: dict[str, str]) -> str:
    """
    Build a prompt that asks the preference model to score and rank the responses.
    Returns a prompt expecting JSON output.
    """
    models = list(responses.keys())
    response_block = "\n\n".join(f"### {name}\n{text}" for name, text in responses.items())

    return f"""You are an expert evaluator assessing the quality of AI responses.

Given the following user prompt and responses from {len(models)} models, please:
1. Score each response on helpfulness (1-5, where 5 is most helpful)
2. Rank the responses from best (1) to worst ({len(models)})

User prompt:
{prompt}

---

{response_block}

---

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{{
  "scores": {{{", ".join(f'"{m}": <1-5>' for m in models)}}},
  "rankings": {{{", ".join(f'"{m}": <1-{len(models)}>' for m in models)}}}
}}"""


def parse_scoring_response(
    raw: str, model_names: list[str]
) -> tuple[dict[str, float], dict[str, int]]:
    """
    Parse the preference model's JSON output into scores and rankings.
    Returns (scores, rankings). Raises ValueError if parsing fails.
    """
    # Strip markdown code fences if present
    cleaned = re.sub(r"```[a-z]*\n?", "", raw).strip()

    # Find JSON object
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON found in scoring response: {raw!r}")

    data = json.loads(match.group())

    scores_raw = data.get("scores", {})
    rankings_raw = data.get("rankings", {})

    scores: dict[str, float] = {}
    rankings: dict[str, int] = {}

    for name in model_names:
        if name not in scores_raw:
            raise ValueError(f"Missing score for model {name!r}")
        if name not in rankings_raw:
            raise ValueError(f"Missing ranking for model {name!r}")
        scores[name] = float(scores_raw[name])
        rankings[name] = int(rankings_raw[name])

    return scores, rankings
