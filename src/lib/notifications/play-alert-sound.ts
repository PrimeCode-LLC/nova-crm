import { isSoundAlertsEnabled } from "@/lib/notifications/alert-preferences";

export type AlertSoundKind = "mail" | "chat" | "notification";

let sharedContext: AudioContext | null = null;
let unlockBound = false;

const KIND_PROFILE: Record<
  AlertSoundKind,
  { freqA: number; freqB: number; durationMs: number; gain: number }
> = {
  mail: { freqA: 523.25, freqB: 659.25, durationMs: 140, gain: 0.08 },
  chat: { freqA: 440, freqB: 554.37, durationMs: 120, gain: 0.07 },
  notification: { freqA: 587.33, freqB: 783.99, durationMs: 160, gain: 0.09 },
};

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    sharedContext ??= new Ctx();
    return sharedContext;
  } catch {
    return null;
  }
}

/** Browsers block audio until a user gesture; call once from the app shell. */
export function bindAlertSoundUnlock(): void {
  if (typeof window === "undefined" || unlockBound) return;
  unlockBound = true;
  const unlock = () => {
    const ctx = getContext();
    if (ctx?.state === "suspended") void ctx.resume();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true, passive: true });
  window.addEventListener("keydown", unlock, { once: true, passive: true });
}

function playTone(ctx: AudioContext, freq: number, startAt: number, durationSec: number, peakGain: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec + 0.02);
}

export function playAlertSound(kind: AlertSoundKind): void {
  if (!isSoundAlertsEnabled()) return;
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();

  const profile = KIND_PROFILE[kind];
  const now = ctx.currentTime;
  const toneSec = profile.durationMs / 1000;
  try {
    playTone(ctx, profile.freqA, now, toneSec, profile.gain);
    playTone(ctx, profile.freqB, now + toneSec * 0.55, toneSec, profile.gain * 0.85);
  } catch {
    /* ignore - audio is best-effort */
  }
}
