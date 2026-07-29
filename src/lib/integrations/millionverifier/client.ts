const REALTIME_BASE = "https://api.millionverifier.com/api/v3";

export class MillionVerifierApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "MillionVerifierApiError";
  }
}

export type MillionVerifierVerifyResponse = {
  email?: string;
  quality?: string;
  result?: string;
  resultcode?: number;
  subresult?: string;
  free?: boolean;
  role?: boolean;
  didyoumean?: string;
  credits?: number;
  executiontime?: number;
  error?: string;
  livemode?: boolean;
};

export type MillionVerifierCreditsResponse = {
  credits?: number;
  error?: string;
};

export function buildVerifyUrl(input: {
  apiKey: string;
  email: string;
  timeout?: number;
}): string {
  const params = new URLSearchParams({
    api: input.apiKey,
    email: input.email.trim(),
  });
  const timeout = input.timeout ?? 10;
  if (timeout >= 2 && timeout <= 60) {
    params.set("timeout", String(timeout));
  }
  return `${REALTIME_BASE}/?${params.toString()}`;
}

export function buildCreditsUrl(apiKey: string): string {
  const params = new URLSearchParams({ api: apiKey });
  return `${REALTIME_BASE}/credits?${params.toString()}`;
}

export async function verifyEmail(input: {
  apiKey: string;
  email: string;
  timeout?: number;
}): Promise<MillionVerifierVerifyResponse> {
  const email = input.email.trim();
  if (!email) {
    throw new MillionVerifierApiError(400, "Email is required");
  }

  const res = await fetch(buildVerifyUrl({ ...input, email }), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const text = await res.text();
  let body: MillionVerifierVerifyResponse = {};
  if (text) {
    try {
      body = JSON.parse(text) as MillionVerifierVerifyResponse;
    } catch {
      throw new MillionVerifierApiError(res.status || 502, text || res.statusText);
    }
  }

  if (!res.ok) {
    throw new MillionVerifierApiError(
      res.status,
      body.error?.trim() || text || res.statusText || "Million Verifier request failed",
    );
  }

  if (body.error?.trim()) {
    throw new MillionVerifierApiError(400, body.error.trim());
  }

  return body;
}

export async function getCredits(apiKey: string): Promise<number | null> {
  const res = await fetch(buildCreditsUrl(apiKey), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const text = await res.text();
  let body: MillionVerifierCreditsResponse = {};
  if (text) {
    try {
      body = JSON.parse(text) as MillionVerifierCreditsResponse;
    } catch {
      return null;
    }
  }
  if (!res.ok || body.error?.trim()) return null;
  return typeof body.credits === "number" ? body.credits : null;
}
