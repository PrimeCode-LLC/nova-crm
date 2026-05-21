import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { AiProvider } from "@/lib/ai/types";
import { getAiProviderKeyServer } from "@/lib/ai/ai-secrets-server";

export async function resolveLanguageModel(input: {
  organizationId: string;
  provider: AiProvider;
  model: string;
}): Promise<LanguageModel> {
  const apiKey = await getAiProviderKeyServer(input.organizationId, input.provider);
  if (!apiKey) {
    throw new Error(
      `No API key configured for ${input.provider}. Add keys in Admin → AI & knowledge.`,
    );
  }

  switch (input.provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return openai(input.model);
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(input.model);
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(input.model);
    }
    default:
      throw new Error(`Unsupported provider: ${input.provider}`);
  }
}

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  google: "gemini-2.0-flash",
};
