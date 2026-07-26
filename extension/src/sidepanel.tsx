import * as React from "react";
import { createRoot } from "react-dom/client";
import type {
  DraftListPayload,
  ExtensionState,
  WorkerRequest,
  WorkingDraft,
} from "./types";
import "./styles.css";

type WorkerResponse<T> = { ok: true; value: T } | { ok: false; error: string };

async function send<T>(request: WorkerRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(request)) as WorkerResponse<T>;
  if (!response.ok) throw new Error(response.error);
  return response.value;
}

function ScoreRing({ score }: { score: number }) {
  return (
    <div className="score-ring" style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}>
      <div>
        <strong>{score}</strong>
        <span>/100</span>
      </div>
    </div>
  );
}

type InlineFeedback = { tone: "error" | "success"; message: string } | null;

function WorkingDraftCard({
  draft,
  busy,
  feedback,
  onSave,
  onComplete,
  onDiscard,
}: {
  draft: WorkingDraft;
  busy: boolean;
  feedback: InlineFeedback;
  onSave(values: {
    companyName: string;
    contactName: string;
    contactEmail: string;
  }): Promise<void>;
  onComplete(values: {
    companyName: string;
    contactName: string;
    contactEmail: string;
  }): Promise<void>;
  onDiscard(): Promise<void>;
}) {
  const [values, setValues] = React.useState({
    companyName: draft.fields.companyName?.value ?? "",
    contactName: draft.fields.contactName?.value ?? "",
    contactEmail: draft.fields.contactEmail?.value ?? "",
  });
  return (
    <section className="card draft-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Working draft</p>
          <h2>{values.companyName || "Untitled company"}</h2>
        </div>
        <strong>{draft.completionPercent}%</strong>
      </div>
      <p className="muted">
        {draft.sourceCount} source{draft.sourceCount === 1 ? "" : "s"} ·{" "}
        {draft.missingRequiredFields.length
          ? `Missing ${draft.missingRequiredFields.join(", ")}`
          : "Ready to complete"}
      </p>
      {draft.strategy ? (
        <p className="draft-attribution">
          {draft.strategy.strategyName} · {draft.strategy.selectionMode ?? "auto"}
        </p>
      ) : null}
      <div className="draft-fields">
        <label>
          Company name
          <input
            value={values.companyName}
            onChange={(event) =>
              setValues((current) => ({ ...current, companyName: event.target.value }))
            }
          />
        </label>
        <label>
          Contact name
          <input
            value={values.contactName}
            onChange={(event) =>
              setValues((current) => ({ ...current, contactName: event.target.value }))
            }
          />
        </label>
        <label>
          Contact email <span>(optional)</span>
          <input
            type="email"
            value={values.contactEmail}
            onChange={(event) =>
              setValues((current) => ({ ...current, contactEmail: event.target.value }))
            }
          />
        </label>
      </div>
      <div className="button-grid">
        <button className="button primary" disabled={busy} onClick={() => onSave(values)}>
          Save draft
        </button>
        <button
          className="button secondary"
          disabled={busy || !values.companyName.trim() || !values.contactName.trim()}
          onClick={() => onComplete(values)}
        >
          Complete prospect
        </button>
      </div>
      {feedback ? (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          className={`inline-feedback ${feedback.tone}`}
        >
          {feedback.message}
        </p>
      ) : null}
      <button className="link-button danger-link" disabled={busy} onClick={onDiscard}>
        Discard draft
      </button>
    </section>
  );
}

function IntentRadarPanel() {
  const [state, setState] = React.useState<ExtensionState>({ status: "locked" });
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [leadId, setLeadId] = React.useState("");
  const [drafts, setDrafts] = React.useState<WorkingDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = React.useState<string | null>(null);
  const [selectedStrategyAssignmentId, setSelectedStrategyAssignmentId] = React.useState("");
  const [saveFeedback, setSaveFeedback] = React.useState<InlineFeedback>(null);
  const [draftFeedback, setDraftFeedback] = React.useState<InlineFeedback>(null);

  const load = React.useCallback(async () => {
    try {
      setState(await send<ExtensionState>({ type: "get-state" }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const loadDraft = React.useCallback(async () => {
    try {
      const result = await send<DraftListPayload>({ type: "list-drafts" });
      setDrafts(result.drafts);
      setSelectedDraftId(result.selectedDraftId);
    } catch (caught) {
      setDrafts([]);
      setSelectedDraftId(null);
      setError(caught instanceof Error ? caught.message : "Could not load drafts.");
    }
  }, []);

  React.useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const initialDraftLoad = window.setTimeout(() => void loadDraft(), 0);
    const listener = (message: { type?: string; state?: ExtensionState }) => {
      if (message.type === "state-changed" && message.state) {
        setState(message.state);
        if (message.state.status === "ready") void loadDraft();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearTimeout(initialDraftLoad);
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [load, loadDraft]);

  async function act(label: string, request: WorkerRequest, success?: string) {
    const isFindingSave = request.type === "save";
    setBusy(label);
    if (isFindingSave) {
      setSaveFeedback(null);
    } else {
      setError("");
      setNotice("");
      if (request.type === "scan" || request.type === "ai-evaluate") {
        setSaveFeedback(null);
      }
    }
    try {
      const value = await send<unknown>(request);
      if (
        request.type === "login" ||
        request.type === "logout" ||
        request.type === "refresh" ||
        request.type === "scan" ||
        request.type === "ai-evaluate"
      ) {
        setState(value as ExtensionState);
      } else {
        await load();
      }
      if (
        request.type === "login" ||
        request.type === "save" ||
        request.type === "select-draft" ||
        request.type === "new-draft" ||
        request.type === "update-draft" ||
        request.type === "complete-draft" ||
        request.type === "discard-draft"
      ) {
        await loadDraft();
      }
      if (request.type === "save" && request.action === "draft") {
        const draftResult = value as {
          ai?: { status?: string; acceptedCount?: number };
          warnings?: string[];
        };
        setSaveFeedback({
          tone: "success",
          message:
          draftResult.ai?.status === "completed"
            ? `${success ?? "Source added"} · ${draftResult.ai.acceptedCount ?? 0} fields extracted`
            : `${success ?? "Source added"} · AI extraction unavailable; complete fields manually`,
        });
      } else if (request.type === "save" && success) {
        setSaveFeedback({ tone: "success", message: success });
      } else if (success) {
        setNotice(success);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (isFindingSave) {
        setSaveFeedback({ tone: "error", message });
      } else {
        setError(message);
      }
      await load();
    } finally {
      setBusy("");
    }
  }

  const draft = drafts.find((item) => item.id === selectedDraftId) ?? null;

  async function saveDraft(
    values: { companyName: string; contactName: string; contactEmail: string },
    complete: boolean,
  ) {
    if (!draft) return;
    setBusy(complete ? "complete-draft" : "save-draft");
    setDraftFeedback(null);
    try {
      const updated = await send<{ draft: WorkingDraft }>({
        type: "update-draft",
        draftId: draft.id,
        revision: draft.revision,
        values,
      });
      if (complete) {
        await send({
          type: "complete-draft",
          draftId: draft.id,
          revision: updated.draft.revision,
        });
        setDraftFeedback({
          tone: "success",
          message: "Draft completed and prospect created",
        });
      } else {
        setDraftFeedback({ tone: "success", message: "Working draft saved" });
      }
      await loadDraft();
    } catch (caught) {
      setDraftFeedback({
        tone: "error",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setBusy("");
    }
  }

  async function discardDraft() {
    if (!draft) return;
    const reason = window.prompt("Why are you discarding this draft?");
    if (!reason?.trim()) return;
    await act(
      "discard-draft",
      { type: "discard-draft", draftId: draft.id, revision: draft.revision, reason },
      "Working draft discarded",
    );
  }

  if (state.status === "locked" || state.status === "authenticating") {
    const authenticating = state.status === "authenticating";
    return (
      <main className="panel centered">
        {/* Browser-extension asset; next/image is unavailable in this Vite bundle. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="brand-mark" src="/icons/icon-128.png" alt="" />
        <p className="eyebrow">Nova</p>
        <h1>Intent Radar</h1>
        <p className="muted">
          {authenticating
            ? "Complete sign-in in the Nova tab. This panel will unlock automatically."
            : "Sign in with your Nova Google or email account. Access expires every 24 hours."}
        </p>
        {error ? <p className="alert error">{error}</p> : null}
        <button
          className="button primary"
          disabled={Boolean(busy)}
          onClick={() => act("login", { type: "login" })}
        >
          {busy === "login"
            ? "Opening Nova…"
            : authenticating
              ? "Return to login tab"
              : "Sign in to Nova"}
        </button>
      </main>
    );
  }

  const result = state.result;
  const eligibleStrategies = result?.strategies.filter((strategy) => !strategy.disqualified) ?? [];
  const topStrategy = eligibleStrategies[0];
  const manuallySelectedStrategy = eligibleStrategies.find(
    (strategy) => strategy.strategyAssignmentId === selectedStrategyAssignmentId,
  );
  const selectedStrategy = manuallySelectedStrategy ?? topStrategy;
  const strategySelectionMode = manuallySelectedStrategy ? "manual" : "auto";
  return (
    <main className="panel">
      <header className="header">
        <div>
          <p className="eyebrow">Nova</p>
          <h1>Intent Radar</h1>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            title="Refresh Nova data"
            disabled={Boolean(busy)}
            onClick={() => act("refresh", { type: "refresh" }, "Nova data refreshed")}
          >
            ↻
          </button>
          <button
            className="icon-button"
            title="Sign out"
            disabled={Boolean(busy)}
            onClick={() => act("logout", { type: "logout" })}
          >
            ⇥
          </button>
        </div>
      </header>

      <section className="account-strip">
        <span className="status-dot" />
        <div>
          <strong>{state.bootstrap?.user.name || state.bootstrap?.user.email || "Nova user"}</strong>
          <span>
            {state.bootstrap?.strategies.length ?? 0} assigned strateg
            {(state.bootstrap?.strategies.length ?? 0) === 1 ? "y" : "ies"}
          </span>
        </div>
        <time>
          {state.bootstrap?.syncedAt
            ? `Synced ${new Date(state.bootstrap.syncedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}`
            : "Sync needed"}
        </time>
      </section>

      <section className="card draft-picker">
        <div>
          <label htmlFor="active-draft">Active prospect draft</label>
          <select
            id="active-draft"
            value={selectedDraftId ?? ""}
            disabled={Boolean(busy) || drafts.length === 0}
            onChange={(event) => {
              const draftId = event.target.value;
              if (draftId) {
                void act(
                  "select-draft",
                  { type: "select-draft", draftId },
                  "Working draft selected",
                );
              }
            }}
          >
            {drafts.length === 0 ? (
              <option value="">No active drafts</option>
            ) : selectedDraftId ? null : (
              <option value="">Select a draft</option>
            )}
            {drafts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.fields.companyName?.value || "Untitled company"} · {item.completionPercent}%
              </option>
            ))}
          </select>
        </div>
        <button
          className="button secondary"
          disabled={Boolean(busy)}
          onClick={() =>
            act(
              "new-draft",
              { type: "new-draft", idempotencyKey: crypto.randomUUID() },
              "New draft selected",
            )
          }
        >
          {busy === "new-draft" ? "Creating…" : "New draft"}
        </button>
      </section>

      {draft ? (
        <WorkingDraftCard
          key={`${draft.id}-${draft.revision}`}
          draft={draft}
          busy={Boolean(busy)}
          feedback={draftFeedback}
          onSave={(values) => saveDraft(values, false)}
          onComplete={(values) => saveDraft(values, true)}
          onDiscard={discardDraft}
        />
      ) : (
        <section className="card new-draft-card">
          <p className="eyebrow">New draft</p>
          <h2>No working draft</h2>
          <p className="muted">
            Scan a source, review its strategy match, then create a draft with AI-extracted
            fields.
          </p>
        </section>
      )}

      <section className="scan-actions">
        <button
          className="button primary"
          disabled={Boolean(busy)}
          onClick={() => act("scan", { type: "scan", mode: "page" })}
        >
          {busy === "scan" ? "Scanning…" : "Scan current page"}
        </button>
        <button
          className="button secondary"
          disabled={Boolean(busy)}
          onClick={() => act("selection", { type: "scan", mode: "selection" })}
        >
          {busy === "selection" ? "Scanning…" : "Scan selected text"}
        </button>
        <p className="muted scan-hint">
          For selected text: highlight on the page first (last selection is kept if the panel
          clears it). Or right-click → Scan selection with Nova Intent Radar.
        </p>
      </section>

      {error ? <p role="alert" className="alert error">{error}</p> : null}
      {notice ? <p role="status" className="alert success">{notice}</p> : null}

      {!result ? (
        <section className="empty">
          <div className="radar-icon">⌁</div>
          <h2>Ready to evaluate</h2>
          <p>
            Open an article, company page, job post, or RFP and scan it against your Nova
            playbook.
          </p>
          <kbd>⌘ ⇧ N</kbd>
        </section>
      ) : (
        <>
          <section className="result-summary card">
            <ScoreRing score={result.quality.score} />
            <div>
              <span className={`pill ${result.quality.meetsThreshold ? "ready" : ""}`}>
                {result.quality.meetsThreshold ? "Outreach ready" : "Below threshold"}
              </span>
              <h2>{result.page.title || result.page.domain}</h2>
              <p>{result.quality.primaryOpportunity?.label || "No primary opportunity yet"}</p>
            </div>
          </section>

          <section className="card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Assigned strategy match</p>
                <h2>{selectedStrategy?.strategyName || "No assigned strategy matched"}</h2>
              </div>
              {selectedStrategy ? (
                <strong className="strategy-score">{selectedStrategy.score}%</strong>
              ) : null}
            </div>
            {selectedStrategy ? (
              <>
                {eligibleStrategies.length > 1 ? (
                  <label className="strategy-select">
                    Strategy attribution
                    <select
                      value={manuallySelectedStrategy?.strategyAssignmentId ?? ""}
                      onChange={(event) => setSelectedStrategyAssignmentId(event.target.value)}
                    >
                      <option value="">Best match (automatic)</option>
                      {eligibleStrategies.map((strategy) => (
                        <option
                          key={strategy.strategyAssignmentId}
                          value={strategy.strategyAssignmentId}
                        >
                          {strategy.strategyName} · {strategy.score}%
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="meta-row">
                  <span>{selectedStrategy.confidence} confidence</span>
                  <span>{selectedStrategy.assignmentType}</span>
                  <span>{strategySelectionMode}</span>
                  {selectedStrategy.personaName ? <span>{selectedStrategy.personaName}</span> : null}
                </div>
                {selectedStrategy.missingRequiredSignalIds.length ? (
                  <p className="alert warning">
                    Missing required: {selectedStrategy.missingRequiredSignalIds.join(", ")}
                  </p>
                ) : null}
                {eligibleStrategies
                  .filter(
                    (strategy) =>
                      strategy.strategyAssignmentId !== selectedStrategy.strategyAssignmentId,
                  )
                  .slice(0, 2)
                  .map((strategy) => (
                  <div className="alternate" key={strategy.strategyAssignmentId}>
                    <span>{strategy.strategyName}</span>
                    <strong>{strategy.score}%</strong>
                  </div>
                  ))}
              </>
            ) : (
              <p className="muted">Ask an admin to assign a published strategy in Nova.</p>
            )}
          </section>

          <section className="card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Why it matched</p>
                <h2>{result.quality.signalCount} intent signals</h2>
              </div>
              <button
                className="link-button"
                onClick={() => act("clear", { type: "clear-highlights" })}
              >
                Clear highlights
              </button>
            </div>
            <div className="signal-list">
              {result.quality.matchedSignals.length ? (
                result.quality.matchedSignals.map((signal) => (
                  <article key={signal.signalId} className="signal">
                    <div>
                      <strong>{signal.label}</strong>
                      <span>{signal.reason}</span>
                    </div>
                    <b>+{signal.points}</b>
                    {signal.evidence?.excerpt ? <blockquote>{signal.evidence.excerpt}</blockquote> : null}
                  </article>
                ))
              ) : (
                <p className="muted">No configured intent signals were found.</p>
              )}
            </div>
          </section>

          {result.quality.qualificationNotes.length ? (
            <section className="card">
              <p className="eyebrow">Qualification gaps</p>
              <ul className="gap-list">
                {result.quality.qualificationNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {result.quality.score > 0 ? (
            <section className="card ai-evaluate-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">AI context check</p>
                  <h2>
                    {result.aiEvaluation
                      ? result.aiEvaluation.result.pursueRecommendation.headline
                      : "Evaluate with AI"}
                  </h2>
                </div>
                {result.aiEvaluation ? (
                  <strong className="strategy-score">{result.aiEvaluation.result.fitScore}%</strong>
                ) : null}
              </div>
              {!result.aiEvaluation ? (
                <>
                  <p className="muted">
                    Keyword matches can be wrong without context. AI reviews each signal against the
                    page and your knowledge base, then scores whether this is worth pursuing.
                  </p>
                  <button
                    className="button primary"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      act("ai-evaluate", { type: "ai-evaluate" }, "AI evaluation complete")
                    }
                  >
                    {busy === "ai-evaluate" ? "Evaluating…" : "Evaluate with AI"}
                  </button>
                </>
              ) : (
                <>
                  <div className="meta-row">
                    <span
                      className={`pill ${
                        result.aiEvaluation.result.verdict === "pursue"
                          ? "ready"
                          : result.aiEvaluation.result.verdict === "maybe"
                            ? "maybe"
                            : ""
                      }`}
                    >
                      {result.aiEvaluation.result.verdict}
                    </span>
                    <span>{result.aiEvaluation.result.fitLabel}</span>
                    <span>
                      Adjusted intent {result.aiEvaluation.adjustedIntentScore}/100
                    </span>
                  </div>
                  <p>{result.aiEvaluation.result.summary}</p>
                  <p className="muted">
                    Confirmed {result.aiEvaluation.confirmedCount} · Rejected{" "}
                    {result.aiEvaluation.rejectedCount} · Uncertain{" "}
                    {result.aiEvaluation.uncertainCount} (lexical was{" "}
                    {result.aiEvaluation.lexicalScore}/100)
                  </p>
                  <div className="signal-list">
                    {result.aiEvaluation.result.signalReviews.map((review) => (
                      <article key={review.signalId} className="signal">
                        <div>
                          <strong>{review.label}</strong>
                          <span>{review.reason}</span>
                        </div>
                        <b className={`ai-decision ${review.decision}`}>{review.decision}</b>
                      </article>
                    ))}
                  </div>
                  {result.aiEvaluation.result.gaps.length ? (
                    <>
                      <p className="eyebrow">AI gaps</p>
                      <ul className="gap-list">
                        {result.aiEvaluation.result.gaps.map((gap) => (
                          <li key={gap.point}>
                            {gap.point}
                            {gap.severity === "blocker" ? " (blocker)" : ""}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  <button
                    className="link-button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      act("ai-evaluate", { type: "ai-evaluate" }, "AI evaluation refreshed")
                    }
                  >
                    {busy === "ai-evaluate" ? "Re-evaluating…" : "Re-run AI evaluate"}
                  </button>
                </>
              )}
            </section>
          ) : null}

          <section className="save-actions card">
            <p className="eyebrow">Save to Nova</p>
            <div className="button-grid">
              <button
                className="button secondary"
                disabled={Boolean(busy)}
                onClick={() =>
                  act(
                    "intake",
                    {
                      type: "save",
                      action: "intake",
                      strategyAssignmentId: selectedStrategy?.strategyAssignmentId,
                      strategySelectionMode,
                    },
                    "Saved to Intake",
                  )
                }
              >
                Save to Intake
              </button>
              <button
                className="button primary"
                disabled={Boolean(busy)}
                onClick={() =>
                  act(
                    "draft",
                    {
                      type: "save",
                      action: "draft",
                      draftId: draft?.id,
                      revision: draft?.revision,
                      strategyAssignmentId: selectedStrategy?.strategyAssignmentId,
                      strategySelectionMode,
                    },
                    "Source added to your working draft",
                  )
                }
              >
                {busy === "draft"
                  ? draft
                    ? "Adding…"
                    : "Creating…"
                  : draft
                    ? "Add to Working Draft"
                    : "Create New Draft"}
              </button>
            </div>
            {saveFeedback ? (
              <p
                role={saveFeedback.tone === "error" ? "alert" : "status"}
                className={`inline-feedback ${saveFeedback.tone}`}
              >
                {saveFeedback.message}
              </p>
            ) : null}
            <div className="attach-row">
              <input
                value={leadId}
                onChange={(event) => setLeadId(event.target.value)}
                placeholder="Existing prospect ID"
              />
              <button
                className="button secondary"
                disabled={!leadId.trim() || Boolean(busy)}
                onClick={() =>
                  act(
                    "attach",
                    {
                      type: "save",
                      action: "attach",
                      leadId: leadId.trim(),
                      strategyAssignmentId: selectedStrategy?.strategyAssignmentId,
                      strategySelectionMode,
                    },
                    "Evidence attached",
                  )
                }
              >
                Attach
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <IntentRadarPanel />
  </React.StrictMode>,
);
