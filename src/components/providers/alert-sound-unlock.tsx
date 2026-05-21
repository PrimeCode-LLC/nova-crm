"use client";

import * as React from "react";
import { bindAlertSoundUnlock } from "@/lib/notifications/play-alert-sound";

/** Unlocks Web Audio after the first user interaction so alert chimes can play. */
export function AlertSoundUnlock() {
  React.useEffect(() => {
    bindAlertSoundUnlock();
  }, []);
  return null;
}
