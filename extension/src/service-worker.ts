import {
  computeQualityScoreCore,
  rankAssignedStrategies,
  type MatchEvidence,
} from "@nova/scoring";
import type {
  BootstrapPayload,
  ExtensionState,
  ExtractedPage,
  ScanResult,
  WorkerRequest,
} from "./types";

const NOVA_BASE_URL = (import.meta.env.VITE_NOVA_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const AUTH_KEY = "novaIntentRadarAuth";
const BOOTSTRAP_KEY = "novaIntentRadarBootstrap";
const RESULT_KEY = "novaIntentRadarResult";
const ETAG_KEY = "novaIntentRadarEtag";
const LEASE_KEY = "novaIntentRadarLease";
const PENDING_AUTH_KEY = "novaIntentRadarPendingAuth";

type StoredAuth = { token: string; expiresAt: string };
type PendingAuth = {
  verifier: string;
  state: string;
  redirectUri: string;
  tabId?: number;
  createdAt: number;
};

async function storageGet<T>(key: string): Promise<T | undefined> {
  const value = await chrome.storage.local.get(key);
  return value[key] as T | undefined;
}

async function sessionGet<T>(key: string): Promise<T | undefined> {
  const value = await chrome.storage.session.get(key);
  return value[key] as T | undefined;
}

async function broadcastState() {
  const state = await getState();
  void chrome.runtime.sendMessage({ type: "state-changed", state }).catch(() => undefined);
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const auth = await storageGet<StoredAuth>(AUTH_KEY);
  const headers = new Headers(init.headers);
  headers.set("X-Nova-Extension-Id", chrome.runtime.id);
  if (auth?.token) headers.set("Authorization", `Bearer ${auth.token}`);
  return fetch(`${NOVA_BASE_URL}${path}`, { ...init, headers });
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as {
      message?: unknown;
      formErrors?: unknown;
      fieldErrors?: Record<string, unknown>;
    };
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    const messages = [
      ...(Array.isArray(record.formErrors) ? record.formErrors : []),
      ...Object.values(record.fieldErrors ?? {}).flatMap((value) =>
        Array.isArray(value) ? value : [],
      ),
    ].filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
    if (messages.length) return messages.join(" ");
  }
  return fallback;
}

function randomBase64Url(bytes: number): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function login(): Promise<void> {
  const existing = await sessionGet<PendingAuth>(PENDING_AUTH_KEY);
  if (existing && Date.now() - existing.createdAt < 10 * 60 * 1000) {
    if (existing.tabId) {
      await chrome.tabs.update(existing.tabId, { active: true }).catch(() => undefined);
    }
    return;
  }
  const verifier = randomBase64Url(64);
  const challenge = await sha256Base64Url(verifier);
  const state = randomBase64Url(32);
  const redirectUri = chrome.identity.getRedirectURL("nova");
  const authorizeUrl = new URL(`${NOVA_BASE_URL}/extension-login`);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("extension_id", chrome.runtime.id);
  const pending: PendingAuth = {
    verifier,
    state,
    redirectUri,
    createdAt: Date.now(),
  };
  await chrome.storage.session.set({ [PENDING_AUTH_KEY]: pending });
  const tab = await chrome.tabs.create({
    url: authorizeUrl.toString(),
    active: true,
  });
  await chrome.storage.session.set({
    [PENDING_AUTH_KEY]: { ...pending, tabId: tab.id },
  });
  await broadcastState();
}

async function exchangeLoginCode(
  code: string,
  pending: PendingAuth,
): Promise<void> {
  const response = await fetch(`${NOVA_BASE_URL}/api/extension/auth/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Nova-Extension-Id": chrome.runtime.id,
    },
    body: JSON.stringify({
      code,
      codeVerifier: pending.verifier,
      redirectUri: pending.redirectUri,
    }),
  });
  const body = (await response.json()) as {
    token?: string;
    expiresAt?: string;
    error?: string;
  };
  if (!response.ok || !body.token || !body.expiresAt) {
    throw new Error(body.error ?? "Nova login failed.");
  }
  await chrome.storage.local.set({
    [AUTH_KEY]: { token: body.token, expiresAt: body.expiresAt },
  });
  await chrome.storage.session.remove(PENDING_AUTH_KEY);
  try {
    await refreshBootstrap(true);
  } catch {
    await broadcastState();
  }
}

async function logout(): Promise<void> {
  await api("/api/extension/auth/logout", { method: "POST" }).catch(() => undefined);
  await chrome.storage.local.remove([
    AUTH_KEY,
    BOOTSTRAP_KEY,
    RESULT_KEY,
    ETAG_KEY,
    LEASE_KEY,
  ]);
  await chrome.storage.session.remove(PENDING_AUTH_KEY);
  await clearHighlights();
  await broadcastState();
}

async function ensureAccess(): Promise<void> {
  const lease = await storageGet<string>(LEASE_KEY);
  if (lease && Date.parse(lease) > Date.now()) return;
  const response = await api("/api/extension/access");
  const body = (await response.json()) as {
    leaseExpiresAt?: string;
    error?: string;
    code?: string;
  };
  if (!response.ok || !body.leaseExpiresAt) {
    if (response.status === 401 || response.status === 403) {
      await chrome.storage.local.remove([AUTH_KEY, BOOTSTRAP_KEY, RESULT_KEY, LEASE_KEY]);
    }
    throw new Error(body.error ?? "Nova access validation failed.");
  }
  await chrome.storage.local.set({ [LEASE_KEY]: body.leaseExpiresAt });
}

async function refreshBootstrap(force = false): Promise<BootstrapPayload> {
  const etag = force ? undefined : await storageGet<string>(ETAG_KEY);
  const headers: HeadersInit = etag ? { "If-None-Match": etag } : {};
  const response = await api("/api/extension/bootstrap", { headers });
  if (response.status === 304) {
    const cached = await storageGet<BootstrapPayload>(BOOTSTRAP_KEY);
    if (cached) return cached;
    return refreshBootstrap(true);
  }
  const body = (await response.json()) as BootstrapPayload & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Could not refresh Nova data.");
  const nextEtag = response.headers.get("etag");
  await chrome.storage.local.set({
    [BOOTSTRAP_KEY]: body,
    [LEASE_KEY]: body.leaseExpiresAt,
    ...(nextEtag ? { [ETAG_KEY]: nextEtag } : {}),
  });
  await broadcastState();
  return body;
}

function extractVisiblePage(mode: "page" | "selection"): ExtractedPage {
  const selection = window.getSelection()?.toString().trim() ?? "";
  const canonical =
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? location.href;
  const description =
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ??
    document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content ??
    "";
  const selectors = [
    "main p",
    "main li",
    "main h1",
    "main h2",
    "main h3",
    "article p",
    "article li",
    "article h1",
    "article h2",
    "[role='article'] p",
    "[role='article'] li",
    "section p",
    "section li",
    "td",
  ];
  const seen = new Set<string>();
  const blocks: { id: string; text: string }[] = [];
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selectors.join(",")));
  for (const element of elements) {
    if (blocks.length >= 250) break;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      rect.width === 0 ||
      rect.height === 0
    ) {
      continue;
    }
    const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length < 20 || seen.has(text)) continue;
    seen.add(text);
    const id = `b${blocks.length}`;
    element.dataset.novaRadarBlockId = id;
    blocks.push({ id, text });
  }
  const fallbackText = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
  const text =
    mode === "selection" && selection
      ? selection.slice(0, 40000)
      : blocks.length
        ? blocks.map((block) => block.text).join("\n").slice(0, 40000)
        : fallbackText.slice(0, 40000);
  return {
    url: location.href,
    canonicalUrl: canonical,
    title: document.title,
    description,
    domain: location.hostname.replace(/^www\./, ""),
    text,
    selectedText: selection,
    blocks,
  };
}

function applyHighlights(evidence: MatchEvidence[]): void {
  document.querySelectorAll<HTMLElement>("[data-nova-radar-block-id]").forEach((element) => {
    element.style.removeProperty("box-shadow");
    element.style.removeProperty("background-color");
  });
  document.getElementById("nova-intent-radar-highlight-style")?.remove();
  const cssHighlights = CSS as typeof CSS & {
    highlights?: { clear(): void; set(name: string, highlight: Highlight): void };
  };
  cssHighlights.highlights?.clear();

  const style = document.createElement("style");
  style.id = "nova-intent-radar-highlight-style";
  style.textContent =
    "::highlight(nova-intent-radar) { background: rgba(250, 204, 21, .42); color: inherit; }";
  document.documentElement.appendChild(style);
  const ranges: Range[] = [];
  for (const item of evidence) {
    const element = document.querySelector<HTMLElement>(
      `[data-nova-radar-block-id="${CSS.escape(item.blockId)}"]`,
    );
    if (!element) continue;
    element.style.boxShadow = "inset 3px 0 0 #eab308";
    element.style.backgroundColor = "rgba(250, 204, 21, .08)";
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text; start: number; end: number }[] = [];
    let offset = 0;
    let current: Node | null;
    while ((current = walker.nextNode())) {
      const node = current as Text;
      nodes.push({ node, start: offset, end: offset + node.data.length });
      offset += node.data.length;
    }
    for (const evidenceRange of item.ranges) {
      const startNode = nodes.find(
        (entry) => evidenceRange.start >= entry.start && evidenceRange.start <= entry.end,
      );
      const endNode = nodes.find(
        (entry) => evidenceRange.end >= entry.start && evidenceRange.end <= entry.end,
      );
      if (!startNode || !endNode) continue;
      const range = new Range();
      range.setStart(startNode.node, Math.max(0, evidenceRange.start - startNode.start));
      range.setEnd(
        endNode.node,
        Math.min(endNode.node.data.length, evidenceRange.end - endNode.start),
      );
      ranges.push(range);
    }
  }
  if (ranges.length && cssHighlights.highlights) {
    cssHighlights.highlights.set("nova-intent-radar", new Highlight(...ranges));
  }
}

function removeHighlights(): void {
  document.querySelectorAll<HTMLElement>("[data-nova-radar-block-id]").forEach((element) => {
    element.style.removeProperty("box-shadow");
    element.style.removeProperty("background-color");
  });
  document.getElementById("nova-intent-radar-highlight-style")?.remove();
  (
    CSS as typeof CSS & { highlights?: { delete(name: string): void } }
  ).highlights?.delete("nova-intent-radar");
}

async function currentTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    throw new Error("Open a normal web page before scanning.");
  }
  return tab;
}

async function scan(mode: "page" | "selection" = "page"): Promise<ScanResult> {
  await ensureAccess();
  const bootstrap =
    (await storageGet<BootstrapPayload>(BOOTSTRAP_KEY)) ?? (await refreshBootstrap(true));
  const tab = await currentTab();
  const [{ result: page }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: extractVisiblePage,
    args: [mode],
  });
  if (!page?.text || page.text.length < 20) {
    throw new Error("Not enough visible page text to evaluate.");
  }
  const quality = computeQualityScoreCore(
    {
      triggerEvent: page.title,
      recentNews: page.description,
      notes: page.text,
      touches: 0,
    },
    bootstrap.playbook,
    { evidenceBlocks: page.blocks },
  );
  const strategies = rankAssignedStrategies({
    page: {
      text: page.text,
      title: page.title,
      blocks: page.blocks,
    },
    quality,
    assignments: bootstrap.assignments,
    strategies: bootstrap.strategies,
    personas: bootstrap.personas,
  });
  const result: ScanResult = {
    scannedAt: new Date().toISOString(),
    page,
    quality,
    strategies,
  };
  await chrome.storage.local.set({ [RESULT_KEY]: result });
  const evidence = quality.matchedSignals
    .map((signal) => signal.evidence)
    .filter((item): item is MatchEvidence => Boolean(item));
  if (evidence.length) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: applyHighlights,
      args: [evidence],
    });
  }
  await broadcastState();
  return result;
}

async function clearHighlights(): Promise<void> {
  try {
    const tab = await currentTab();
    await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: removeHighlights,
    });
  } catch {
    // Restricted browser pages cannot be modified.
  }
}

async function saveFinding(
  action: "intake" | "draft" | "attach",
  leadId?: string,
  strategyAssignmentId?: string,
  strategySelectionMode: "auto" | "manual" = "auto",
): Promise<unknown> {
  await ensureAccess();
  const result = await storageGet<ScanResult>(RESULT_KEY);
  if (!result) throw new Error("Scan a page before saving.");
  const eligibleStrategies = result.strategies.filter((item) => !item.disqualified);
  const strategy =
    eligibleStrategies.find(
      (item) => item.strategyAssignmentId === strategyAssignmentId,
    ) ?? eligibleStrategies[0];
  const response = await api(
    action === "draft" ? "/api/extension/drafts" : "/api/extension/findings",
    {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(action === "draft" ? {} : { action, leadId }),
      page: {
        url: result.page.canonicalUrl || result.page.url,
        title: result.page.title,
        text: result.page.text,
        domain: result.page.domain,
      },
      quality: {
        score: result.quality.score,
        matchedSignalIds: result.quality.matchedSignals.map((signal) => signal.signalId),
        primaryOpportunityId: result.quality.primaryOpportunity?.id,
        primaryOpportunityLabel: result.quality.primaryOpportunity?.label,
      },
      strategy: strategy
        ? {
            strategyId: strategy.strategyId,
            strategyName: strategy.strategyName,
            strategyVersion: strategy.strategyVersion,
            strategyAssignmentId: strategy.strategyAssignmentId,
            personaId: strategy.personaId,
            score: strategy.score,
            matchedSignalIds: strategy.matchedSignalIds,
            selectionMode: strategySelectionMode,
          }
        : undefined,
    }),
    },
  );
  const body = (await response.json()) as { error?: unknown };
  if (!response.ok) throw new Error(apiErrorMessage(body.error, "Could not save to Nova."));
  return body;
}

async function draftApi(
  method: "GET" | "PATCH" | "PUT" | "DELETE",
  body?: Record<string, unknown>,
): Promise<unknown> {
  await ensureAccess();
  const response = await api("/api/extension/drafts", {
    method,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const value = (await response.json()) as { error?: unknown };
  if (!response.ok) {
    throw new Error(apiErrorMessage(value.error, "Could not update working draft."));
  }
  return value;
}

async function getState(): Promise<ExtensionState> {
  const [auth, bootstrap, result, lease, pendingAuth] = await Promise.all([
    storageGet<StoredAuth>(AUTH_KEY),
    storageGet<BootstrapPayload>(BOOTSTRAP_KEY),
    storageGet<ScanResult>(RESULT_KEY),
    storageGet<string>(LEASE_KEY),
    sessionGet<PendingAuth>(PENDING_AUTH_KEY),
  ]);
  if (!auth || Date.parse(auth.expiresAt) <= Date.now()) {
    return {
      status:
        pendingAuth && Date.now() - pendingAuth.createdAt < 10 * 60 * 1000
          ? "authenticating"
          : "locked",
    };
  }
  return {
    status: bootstrap ? "ready" : "offline",
    tokenExpiresAt: auth.expiresAt,
    leaseExpiresAt: lease,
    bootstrap,
    result,
  };
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.create({
    id: "nova-scan-selection",
    title: "Scan selection with Nova Intent Radar",
    contexts: ["selection"],
  });
  chrome.alarms.create("nova-bootstrap-refresh", { periodInMinutes: 15 });
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
});

chrome.runtime.onMessageExternal.addListener(
  (
    request: { type?: string; code?: string; state?: string },
    sender,
    sendResponse,
  ) => {
    const run = async () => {
      let senderOrigin = "";
      try {
        senderOrigin = sender.url ? new URL(sender.url).origin : "";
      } catch {
        // Invalid sender URLs are denied below.
      }
      if (
        request.type !== "nova-auth-code" ||
        !request.code ||
        !request.state ||
        senderOrigin !== new URL(NOVA_BASE_URL).origin
      ) {
        throw new Error("This Nova login response is not allowed.");
      }
      const pending = await sessionGet<PendingAuth>(PENDING_AUTH_KEY);
      if (
        !pending ||
        pending.state !== request.state ||
        Date.now() - pending.createdAt >= 10 * 60 * 1000
      ) {
        throw new Error("The Nova login request expired. Start again from Intent Radar.");
      }
      await exchangeLoginCode(request.code, pending);
      sendResponse({ ok: true });
      if (pending.tabId) {
        setTimeout(() => void chrome.tabs.remove(pending.tabId!).catch(() => undefined), 250);
      }
      await broadcastState();
    };
    void run().catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return true;
  },
);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "nova-scan-selection" || !tab?.windowId) return;
  void chrome.sidePanel.open({ windowId: tab.windowId });
  void scan("selection").catch(async (error) => {
    await chrome.storage.local.set({ novaIntentRadarError: String(error) });
    await broadcastState();
  });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "scan-current-page" || !tab?.windowId) return;
  void chrome.sidePanel.open({ windowId: tab.windowId });
  void scan("page").catch(async (error) => {
    await chrome.storage.local.set({ novaIntentRadarError: String(error) });
    await broadcastState();
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "nova-bootstrap-refresh") return;
  void refreshBootstrap(false).catch(() => undefined);
});

chrome.runtime.onMessage.addListener(
  (request: WorkerRequest, _sender, sendResponse) => {
    const run = async () => {
      switch (request.type) {
        case "get-state":
          return getState();
        case "login":
          await login();
          return getState();
        case "logout":
          await logout();
          return getState();
        case "refresh":
          await ensureAccess();
          await refreshBootstrap(true);
          return getState();
        case "scan":
          await scan(request.mode);
          return getState();
        case "save":
          return saveFinding(
            request.action,
            request.leadId,
            request.strategyAssignmentId,
            request.strategySelectionMode,
          );
        case "get-draft":
          return draftApi("GET");
        case "update-draft":
          return draftApi("PATCH", {
            draftId: request.draftId,
            values: request.values,
          });
        case "complete-draft":
          return draftApi("PUT", { draftId: request.draftId });
        case "discard-draft":
          return draftApi("DELETE", {
            draftId: request.draftId,
            reason: request.reason,
          });
        case "clear-highlights":
          await clearHighlights();
          return { ok: true };
      }
    };
    void run()
      .then((value) => sendResponse({ ok: true, value }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  },
);
