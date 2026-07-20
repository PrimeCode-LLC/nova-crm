"use client";

import * as React from "react";
import { Lock, Maximize2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const WALL_PIN_SESSION_KEY = "nova-crm-wall-pin-v1";
export const WALL_PIN_GUARD_ACTOR = "wall-guard";

const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 30_000;
const PIN_MIN = 4;
const PIN_MAX = 6;

export async function hashWallPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function readStoredWallPinHash(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const v = sessionStorage.getItem(WALL_PIN_SESSION_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function writeStoredWallPinHash(hash: string): void {
  try {
    sessionStorage.setItem(WALL_PIN_SESSION_KEY, hash);
  } catch {
    /* private mode / quota */
  }
}

export function clearStoredWallPinHash(): void {
  try {
    sessionStorage.removeItem(WALL_PIN_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function isValidWallPin(pin: string): boolean {
  return /^\d+$/.test(pin) && pin.length >= PIN_MIN && pin.length <= PIN_MAX;
}

type WallPinSetupProps = {
  pin: string;
  confirm: string;
  onPinChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  error?: string | null;
  className?: string;
};

/** Numeric PIN + confirm fields for the wall entry card. */
export function WallPinSetupFields({
  pin,
  confirm,
  onPinChange,
  onConfirmChange,
  error,
  className,
}: WallPinSetupProps) {
  return (
    <div className={cn("space-y-3 text-left", className)}>
      <div className="space-y-1.5">
        <Label htmlFor="wall-pin" className="text-xs">
          Exit PIN (4–6 digits)
        </Label>
        <Input
          id="wall-pin"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={PIN_MAX}
          placeholder="••••"
          value={pin}
          onChange={(e) => onPinChange(e.target.value.replace(/\D/g, "").slice(0, PIN_MAX))}
          className="tabular-nums tracking-widest"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wall-pin-confirm" className="text-xs">
          Confirm PIN
        </Label>
        <Input
          id="wall-pin-confirm"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={PIN_MAX}
          placeholder="••••"
          value={confirm}
          onChange={(e) => onConfirmChange(e.target.value.replace(/\D/g, "").slice(0, PIN_MAX))}
          className="tabular-nums tracking-widest"
        />
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Required to leave fullscreen or exit wall mode. Failed attempts are logged in Live activity.
      </p>
    </div>
  );
}

type WallPinLockOverlayProps = {
  open: boolean;
  pinHash: string;
  onUnlock: () => void;
  onDenied: () => void;
  onReenterFullscreen: () => void;
};

/** Full-screen lock gate shown when armed wall mode loses fullscreen or Exit is pressed. */
export function WallPinLockOverlay({
  open,
  pinHash,
  onUnlock,
  onDenied,
  onReenterFullscreen,
}: WallPinLockOverlayProps) {
  const [attempt, setAttempt] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [fails, setFails] = React.useState(0);
  const [cooldownUntil, setCooldownUntil] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) {
      setAttempt("");
      setError(null);
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (!open || cooldownUntil <= Date.now()) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [open, cooldownUntil]);

  const cooling = cooldownUntil > now;
  const cooldownSec = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (cooling) return;
    if (!isValidWallPin(attempt)) {
      setError(`Enter a ${PIN_MIN}–${PIN_MAX} digit PIN.`);
      return;
    }
    const hash = await hashWallPin(attempt);
    if (hash === pinHash) {
      setAttempt("");
      setError(null);
      setFails(0);
      onUnlock();
      return;
    }
    const nextFails = fails + 1;
    setFails(nextFails);
    setAttempt("");
    onDenied();
    if (nextFails >= MAX_ATTEMPTS) {
      setCooldownUntil(Date.now() + COOLDOWN_MS);
      setNow(Date.now());
      setFails(0);
      setError(`Too many attempts. Try again in ${COOLDOWN_MS / 1000}s.`);
    } else {
      setError(`Incorrect PIN. ${MAX_ATTEMPTS - nextFails} attempt(s) left.`);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-background/95 p-6 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wall-lock-title"
    >
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-lg">
        <div className="mb-4 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <ShieldAlert className="h-6 w-6 text-destructive" />
          </div>
          <h2 id="wall-lock-title" className="text-lg font-semibold tracking-tight">
            Wall display locked
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
            Enter the exit PIN to leave wall mode. Wrong attempts are recorded.
          </p>
        </div>

        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="wall-unlock-pin" className="text-xs">
              Exit PIN
            </Label>
            <Input
              ref={inputRef}
              id="wall-unlock-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={PIN_MAX}
              placeholder="••••"
              value={attempt}
              disabled={cooling}
              onChange={(e) => {
                setAttempt(e.target.value.replace(/\D/g, "").slice(0, PIN_MAX));
                setError(null);
              }}
              className="tabular-nums tracking-widest"
            />
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {cooling ? (
            <p className="text-xs text-muted-foreground">Locked for {cooldownSec}s…</p>
          ) : null}
          <Button type="submit" className="w-full gap-2" disabled={cooling || !attempt}>
            <Lock className="h-4 w-4" />
            Unlock and exit
          </Button>
        </form>

        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full gap-2"
          onClick={onReenterFullscreen}
        >
          <Maximize2 className="h-4 w-4" />
          Back to board (fullscreen)
        </Button>
      </div>
    </div>
  );
}
