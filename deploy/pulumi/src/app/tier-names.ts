export const CHAT_TIER = "chat";
export const API_TIER = "api";

export const LEGACY_CHAT_TIER = "aiq-agent";
export const LEGACY_API_TIER = "aiq-api";

export const CHAT_TIERS = [LEGACY_CHAT_TIER, CHAT_TIER] as const;
export const API_TIERS = [LEGACY_API_TIER, API_TIER] as const;
