"""Adversarial safety battery (target §30.5): every attack in the
battery must fail safely with evidence. Executors live in
evals.runner.harness; this module is the stable entry point.
"""

from __future__ import annotations


def run_battery(harness, core_factory):
    """Run the adversarial-v1 suite and return its report."""
    return harness.run_suite(core_factory, "adversarial-v1")
