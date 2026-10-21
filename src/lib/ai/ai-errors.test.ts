import { APICallError } from "ai";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/error-logging/record-error-server", () => ({ recordErrorLog: vi.fn(async () => undefined) }));

import { aiErrorResponse } from "@/lib/ai/ai-route-errors";
import { aiFeatureDenialMessage, canUseAiFeature } from "@/lib/ai/ai-settings-server";
import { DEFAULT_AI_SETTINGS } from "@/lib/ai/types";

function badKey() {
  return new APICallError({
    message: "Incorrect API key provided: sk-qa-in*****0000",
    url: "https://api.openai.com/v1/embeddings",
    requestBodyValues: {},
    statusCode: 401,
    responseBody: JSON.stringify({ error: { code: "invalid_api_key" } }),
  });
}

describe("AI error handling (QA 2.7)", () => {
  it("a rejected provider key is provider_auth/400, not not_configured/503 (AI-02)", async () => {
    const res = aiErrorResponse(badKey());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "provider_auth" });
  });

  it("a missing key is still not_configured", async () => {
    const res = aiErrorResponse(new Error("No API key for openai"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "not_configured" });
  });

  it("says AI is not set up instead of blaming the role (AI-03)", () => {
    const off = { ...DEFAULT_AI_SETTINGS, enabled: false };
    expect(canUseAiFeature(off, "followup_suggest", "director")).toBe(false);
    expect(aiFeatureDenialMessage(off, "followup_suggest", "role msg")).toMatch(/not set up for this workspace/);

    const featureOff = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      features: { ...DEFAULT_AI_SETTINGS.features, followup_suggest: { enabled: false, ragMode: "reference" as const } },
    };
    expect(aiFeatureDenialMessage(featureOff, "followup_suggest", "role msg")).toMatch(/turned off/);

    const on = { ...DEFAULT_AI_SETTINGS, enabled: true };
    expect(aiFeatureDenialMessage(on, "dashboard_brief", "role msg")).toBe("role msg");
  });
});
