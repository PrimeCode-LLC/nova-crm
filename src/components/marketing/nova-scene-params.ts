/**
 * Mutable scene params updated by GSAP ScrollTrigger (not React state).
 */
export type NovaSceneParams = {
  /** Overall story progress 0 → 1 */
  progress: number;
  /** Expand rings / connections */
  connect: number;
  /** Path / focus highlight */
  focus: number;
  /** Settle toward final calm state */
  settle: number;
  /** Idle camera / spin drift */
  drift: number;
};

export const novaSceneParams: NovaSceneParams = {
  progress: 0,
  connect: 0,
  focus: 0,
  settle: 0,
  drift: 0.4,
};

export function setNovaSceneParams(partial: Partial<NovaSceneParams>) {
  Object.assign(novaSceneParams, partial);
}
