"""Agent and prompt versioning (target §8.3): every execution identifies
agent, prompt, policy-bundle, tool-registry, and model versions so
evaluations and incident replay are reproducible.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass


@dataclass(frozen=True)
class AgentVersion:
    """Version pin for one agent release line."""

    agent_id: str
    agent_version: str
    prompt_version: str
    policy_bundle_version: str
    tool_registry_version: str
    model_version: str = ""

    def as_dict(self) -> dict[str, str]:
        return {
            "agent_id": self.agent_id,
            "agent_version": self.agent_version,
            "prompt_version": self.prompt_version,
            "policy_bundle_version": self.policy_bundle_version,
            "tool_registry_version": self.tool_registry_version,
            "model_version": self.model_version,
        }


def policy_bundle_version(policy) -> str:
    """Content-derived policy bundle version: any merchant policy change
    produces a new bundle id, so replays pin the exact rules evaluated."""
    canonical = json.dumps(policy.model_dump(mode="json"), sort_keys=True)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:12]
    return f"merchant-policy@{digest}"


class VersionRegistry:
    """In-memory registry of active agent versions (seeded at startup)."""

    def __init__(self) -> None:
        self._versions: dict[str, AgentVersion] = {}

    def register(self, version: AgentVersion) -> AgentVersion:
        self._versions[version.agent_id] = version
        return version

    def get(self, agent_id: str) -> AgentVersion | None:
        return self._versions.get(agent_id)

    def require(self, agent_id: str) -> AgentVersion:
        version = self.get(agent_id)
        if version is None:
            raise ValueError(f"Unknown agent version: {agent_id}")
        return version

    def all(self) -> list[AgentVersion]:
        return list(self._versions.values())


#: Canonical platform agent ids.
SELLER_AGENT_ID = "sellable-seller-agent"
CUSTOMER_SERVICE_AGENT_ID = "sellable-customer-service-agent"


def seed_registry(registry: VersionRegistry, policy) -> VersionRegistry:
    """Seed the two platform agents (§7). Callers refresh the seed when the
    merchant policy changes so the bundle version stays exact."""
    bundle = policy_bundle_version(policy)
    registry.register(
        AgentVersion(
            agent_id=SELLER_AGENT_ID,
            agent_version="v4",
            prompt_version="seller-staged-v1",
            policy_bundle_version=bundle,
            tool_registry_version="seller-tools-v2",
        )
    )
    registry.register(
        AgentVersion(
            agent_id=CUSTOMER_SERVICE_AGENT_ID,
            agent_version="v1",
            prompt_version="cs-staged-v1",
            policy_bundle_version=bundle,
            tool_registry_version="cs-tools-v1",
        )
    )
    return registry
