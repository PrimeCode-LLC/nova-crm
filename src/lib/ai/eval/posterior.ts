/**
 * Beta-Binomial posterior helpers for experiment reads.
 * Prefer continuous metrics; for rates use Beta(1+successes, 1+failures).
 */

export type BetaPosterior = {
  alpha: number;
  beta: number;
  mean: number;
  /** 80% credible interval */
  ci80: [number, number];
};

function incompleteBetaInvApprox(p: number, a: number, b: number): number {
  // Simple quantile approximation via binary search on regularized incomplete beta (Monte-Carlo free).
  // Uses continued-fraction-free numerical search with beta PDF integral via trapezoid on [0,1].
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    const cdf = betaCdf(mid, a, b);
    if (cdf < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function logGamma(z: number): number {
  // Lanczos approximation
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843696540789e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = c[0]!;
  for (let i = 1; i < g + 2; i++) x += c[i]! / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaPdf(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  const logB = logGamma(a) + logGamma(b) - logGamma(a + b);
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - logB);
}

function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const n = 200;
  let sum = 0;
  const dx = x / n;
  for (let i = 0; i <= n; i++) {
    const xi = i * dx;
    const w = i === 0 || i === n ? 0.5 : 1;
    sum += w * betaPdf(xi, a, b);
  }
  return Math.min(1, Math.max(0, sum * dx));
}

export function betaPosterior(successes: number, trials: number): BetaPosterior {
  const s = Math.max(0, successes);
  const n = Math.max(0, trials);
  const failures = Math.max(0, n - s);
  const alpha = 1 + s;
  const beta = 1 + failures;
  const mean = alpha / (alpha + beta);
  const ci80: [number, number] = [
    incompleteBetaInvApprox(0.1, alpha, beta),
    incompleteBetaInvApprox(0.9, alpha, beta),
  ];
  return { alpha, beta, mean, ci80 };
}

/** Monte Carlo P(variant > control) for two Beta posteriors. */
export function probVariantBeatsControl(
  variant: BetaPosterior,
  control: BetaPosterior,
  samples = 5000,
): number {
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    const v = sampleBeta(variant.alpha, variant.beta);
    const c = sampleBeta(control.alpha, control.beta);
    if (v > c) wins += 1;
  }
  return wins / samples;
}

function sampleBeta(a: number, b: number): number {
  // Gamma ratio method with Marsaglia for shape >= 1, fallback for < 1
  const x = sampleGamma(a);
  const y = sampleGamma(b);
  return x / (x + y);
}

function sampleGamma(shape: number): number {
  if (shape < 1) {
    const u = Math.random();
    return sampleGamma(1 + shape) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function randn(): number {
  const u = 1 - Math.random();
  const v = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
