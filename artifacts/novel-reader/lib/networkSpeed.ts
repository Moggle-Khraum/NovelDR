// Connection-speed tracking for site health checks. Pure logic plus one small
// probe, with no React imports, so it can be unit tested under plain Node
// (scripts/test-network-speed.ts).

/** Timeout the health-check tiers start from, before any scaling. */
export const BASE_TIMEOUT_MS = 10000;

/** A check that takes this long or longer counts as a timeout. */
export const STALL_LIMIT = 3;

const WINDOW = 8;
const MIN_SAMPLES = 3;
const SLOW_MEDIAN_MS = 4000;
const VERY_SLOW_MEDIAN_MS = 8000;

// A stable host that answers with an empty 204. Used only when a run stalls,
// to tell a slow network apart from a few sites that are down.
export const PROBE_URL = "https://www.gstatic.com/generate_204";
const PROBE_TIMEOUT_MS = 5000;
const PROBE_FAST_MS = 3000;

export type NetworkTier = "unknown" | "fast" | "slow" | "very_slow";

export const medianOf = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const classifyMedian = (median: number | null): NetworkTier => {
  if (median === null) return "unknown";
  if (median < SLOW_MEDIAN_MS) return "fast";
  if (median < VERY_SLOW_MEDIAN_MS) return "slow";
  return "very_slow";
};

export const timeoutScaleFor = (tier: NetworkTier): number => {
  if (tier === "slow") return 1.5;
  if (tier === "very_slow") return 2;
  return 1;
};

export const createNetworkSpeed = () => {
  const samples: number[] = [];
  let consecutiveTimeouts = 0;

  const tier = (): NetworkTier =>
    classifyMedian(samples.length < MIN_SAMPLES ? null : medianOf(samples));

  return {
    /** Call at the start of each run: stall counting restarts, samples stay. */
    startRun(): void {
      consecutiveTimeouts = 0;
    },
    /** Record how long one site check took, in milliseconds. */
    record(durationMs: number): void {
      samples.push(durationMs);
      if (samples.length > WINDOW) samples.shift();
      consecutiveTimeouts =
        durationMs >= BASE_TIMEOUT_MS ? consecutiveTimeouts + 1 : 0;
    },
    tier,
    /** Multiplier for the health-check timeouts, from the current tier. */
    timeoutScale: (): number => timeoutScaleFor(tier()),
    /** True after STALL_LIMIT timeouts in a row in this run. */
    isStalled: (): boolean => consecutiveTimeouts >= STALL_LIMIT,
    /** Call when the probe says the network is fine: the run goes on. */
    clearStall(): void {
      consecutiveTimeouts = 0;
    },
  };
};

/** One small request to PROBE_URL. True only if it answers quickly. */
export const probeConnection = async (): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    await fetch(PROBE_URL, { method: "GET", signal: controller.signal });
    return Date.now() - startedAt < PROBE_FAST_MS;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};
