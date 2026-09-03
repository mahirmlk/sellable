"""Agent orchestration constrained to deterministic commerce tools.

This package only re-exports the single canonical top-level ``agents``
package. There must never be a second ``agents`` tree (e.g. under
``services/commerce/``); the CI single-tree check enforces this.
"""
