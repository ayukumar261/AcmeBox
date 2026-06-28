"""Offline unit tests for the eval-gate decision logic (no infra)."""

from __future__ import annotations

from src.flywheel.gate import GateDecision, SuiteResult, decide


def _suite(model, **per_task):
    return SuiteResult(model=model, k=3, per_task=dict(per_task))


def test_no_regression_with_improvement_promotes():
    base = _suite("base", t1=True, t2=False, t3=True)
    cand = _suite("adapter", t1=True, t2=True, t3=True)  # t2 fixed
    d = decide(base, cand)
    assert d.promote is True
    assert d.improvements == ["t2"]
    assert d.regressions == []
    assert (d.baseline_pass, d.candidate_pass, d.total) == (2, 3, 3)


def test_any_regression_rejects():
    base = _suite("base", t1=True, t2=True)
    cand = _suite("adapter", t1=True, t2=False)  # t2 broke
    d = decide(base, cand)
    assert d.promote is False
    assert d.regressions == ["t2"]
    assert "regressed" in d.reason


def test_flat_run_promotes_by_default_but_not_under_require_improvement():
    base = _suite("base", t1=True, t2=False)
    cand = _suite("adapter", t1=True, t2=False)  # identical
    assert decide(base, cand).promote is True
    strict = decide(base, cand, require_improvement=True)
    assert strict.promote is False
    assert "no improvement" in strict.reason


def test_regression_outweighs_improvement():
    base = _suite("base", t1=True, t2=False)
    cand = _suite("adapter", t1=False, t2=True)  # one each way
    d = decide(base, cand)
    assert d.promote is False  # a regression is disqualifying even with an improvement
    assert d.regressions == ["t1"] and d.improvements == ["t2"]


def test_suiteresult_roundtrip_and_counts():
    s = _suite("m", a=True, b=False, c=True)
    assert s.pass_count == 2 and s.total == 3
    assert SuiteResult.from_dict(s.to_dict()).per_task == s.per_task


def test_decision_to_dict_shape():
    d = decide(_suite("b", t1=True), _suite("c", t1=True))
    out = GateDecision(**{
        "promote": d.promote, "reason": d.reason,
        "regressions": d.regressions, "improvements": d.improvements,
        "baseline_pass": d.baseline_pass, "candidate_pass": d.candidate_pass,
        "total": d.total,
    }).to_dict()
    assert set(out) == {"promote", "reason", "regressions", "improvements",
                        "baselinePass", "candidatePass", "total"}
