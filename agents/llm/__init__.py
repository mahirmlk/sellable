"""Provider-agnostic LLM access layer.

This package keeps the model/provider choice out of agent and domain logic so
that swapping providers is a configuration change, not a code change.
"""

from agents.llm.adapters.base import LLMError
from agents.llm.factory import get_llm

__all__ = ["get_llm", "LLMError"]
