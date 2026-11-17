from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel
from pydantic import Field


class ModelPriceConfig(BaseModel):
    input_per_1m_tokens: float
    output_per_1m_tokens: float
    cached_input_per_1m_tokens: float | None = None


class ToolPriceConfig(BaseModel):
    cost_per_call: float = 0.0


class PricingRegistryConfig(BaseModel):
    models: dict[str, ModelPriceConfig] = Field(default_factory=dict)
    tools: dict[str, ToolPriceConfig] = Field(default_factory=dict)
    default: ModelPriceConfig | None = None


@dataclass(frozen=True)
class ModelPrice:
    input_per_1m_tokens: float
    cached_input_per_1m_tokens: float
    output_per_1m_tokens: float

    def cost(self, prompt_tokens: int, cached_tokens: int, completion_tokens: int) -> float:
        uncached = max(0, prompt_tokens - cached_tokens)
        return (
            uncached * self.input_per_1m_tokens
            + cached_tokens * self.cached_input_per_1m_tokens
            + completion_tokens * self.output_per_1m_tokens
        ) / 1_000_000

    def cache_savings(self, cached_tokens: int) -> float:
        return cached_tokens * (self.input_per_1m_tokens - self.cached_input_per_1m_tokens) / 1_000_000


@dataclass(frozen=True)
class ToolPrice:
    cost_per_call: float = 0.0


class PricingRegistry:
    def __init__(
        self,
        prices: dict[str, ModelPrice],
        default: ModelPrice | None = None,
        tools: dict[str, ToolPrice] | None = None,
    ):
        self._prices = prices
        self._default = default
        self._tools: dict[str, ToolPrice] = tools or {}

    @classmethod
    def from_config(cls, config: PricingRegistryConfig) -> PricingRegistry:
        prices = {}
        for name, cfg in config.models.items():
            cached = cfg.cached_input_per_1m_tokens
            if cached is None:
                cached = cfg.input_per_1m_tokens
            prices[name] = ModelPrice(
                input_per_1m_tokens=cfg.input_per_1m_tokens,
                cached_input_per_1m_tokens=cached,
                output_per_1m_tokens=cfg.output_per_1m_tokens,
            )

        default = None
        if config.default is not None:
            cached = config.default.cached_input_per_1m_tokens
            if cached is None:
                cached = config.default.input_per_1m_tokens
            default = ModelPrice(
                input_per_1m_tokens=config.default.input_per_1m_tokens,
                cached_input_per_1m_tokens=cached,
                output_per_1m_tokens=config.default.output_per_1m_tokens,
            )

        tools = {name: ToolPrice(cost_per_call=cfg.cost_per_call) for name, cfg in config.tools.items()}

        return cls(prices, default, tools)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> PricingRegistry:
        return cls.from_config(PricingRegistryConfig(**raw))

    def get(self, model_name: str) -> ModelPrice:
        if model_name in self._prices:
            return self._prices[model_name]
        best: ModelPrice | None = None
        best_len = -1
        for key, price in self._prices.items():
            if (key in model_name or model_name in key) and len(key) > best_len:
                best, best_len = price, len(key)
        if best is not None:
            return best
        if self._default is not None:
            return self._default
        raise KeyError(
            f"No price configured for model {model_name!r}. "
            "Add it to tokenomics.pricing.models in the config file, "
            "or set tokenomics.pricing.default."
        )

    def get_tool(self, tool_name: str) -> ToolPrice:
        if tool_name in self._tools:
            return self._tools[tool_name]
        best: ToolPrice | None = None
        best_len = -1
        for key, price in self._tools.items():
            if (key in tool_name or tool_name in key) and len(key) > best_len:
                best, best_len = price, len(key)
        return best if best is not None else ToolPrice(cost_per_call=0.0)

    def known_models(self) -> list[str]:
        return list(self._prices)

    def known_tools(self) -> list[str]:
        return list(self._tools)
