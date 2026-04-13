import { z } from "zod";
import type { ProviderModelCapabilities } from "@/lib/chat-parts";

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  isActive?: boolean;
  isAdmin?: boolean;
  createdAt?: string | Date;
  counts?: {
    activeApiKeys: number;
    providerCredentials: number;
    totalRequests: number;
  };
};

export type ProviderKeyField = {
  envName: string;
  label: string;
  placeholder: string;
};

export type UiProvider = {
  id: string;
  label: string;
  base: string;
  hasModels: boolean;
  requiredEnv?: string;
  requiredKeys?: ProviderKeyField[];
  signupUrl?: string;
  signupLabel?: string;
};

export type UsageProviderStat = {
  provider: string;
  count: number;
};

export type UsageModelStat = {
  model: string | null;
  count: number;
};

export type UsageStatusStat = {
  status: number;
  count: number;
};

export type UsageDailyStat = {
  date: string;
  count: number;
};

export type UsageSummary = {
  period: {
    days: number;
    since: string;
  };
  totalRequests: number;
  errorRate: number;
  byProvider: UsageProviderStat[];
  byModel: UsageModelStat[];
  byStatus: UsageStatusStat[];
  daily: UsageDailyStat[];
};

export type RecentUsageLog = {
  id: string;
  providerId: string | null;
  modelId: string | null;
  endpoint: string | null;
  statusCode: number;
  createdAt: string;
  apiKey: {
    prefix: string;
    label: string;
  } | null;
};

export type ProviderModel = {
  capabilities: ProviderModelCapabilities;
  id: string;
  name: string;
};

export type ProviderCatalogResponse = {
  authRequired: boolean;
  providers: UiProvider[];
};

export type ApiKeySummary = {
  id: string;
  prefix: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt?: string | null;
};

export type ProviderCredentialSummary = {
  id: string;
  providerId: string;
  credentialKey: string;
  createdAt?: string;
  updatedAt: string;
};

export type ToolStartEvent = {
  type: "tool-start";
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type ToolResultEvent = {
  type: "tool-result";
  toolCallId: string;
  result: unknown;
};

export type TextDeltaEvent = {
  type: "text-delta";
  delta: string;
};

export type StreamEvent = ToolStartEvent | ToolResultEvent | TextDeltaEvent;

export const providerCredentialSchema = z.object({
  providerId: z.string().min(1).max(64),
  credentialKey: z.string().min(1).max(128),
  credentialValue: z.string().min(1).max(4096),
});

export const apiKeyLabelSchema = z.object({
  label: z.string().max(100).optional(),
});
