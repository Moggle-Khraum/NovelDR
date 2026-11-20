/**
 * Unit tests for lib/networkSpeed.ts: tier classification, timeout scaling,
 * and the stall rule. The probe makes a real request, so it is not covered here.
 *
 * Run with: pnpm exec tsx scripts/test-network-speed.ts
 */

import {
  BASE_TIMEOUT_MS,
  STALL_LIMIT,
  classifyMedian,
  createNetworkSpeed,
  medianOf,
  timeoutScaleFor,
} from "../lib/networkSpeed";

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const checks: { name: string; run: () => void }[] = [
  {
    name: "medianOf: odd and even counts",
    run: () => {
      assertEqual(medianOf([3, 1, 2]), 2, "odd");
      assertEqual(medianOf([4, 1, 3, 2]), 2.5, "even");
    },
  },
  {
    name: "classifyMedian: null is unknown",
    run: () => assertEqual(classifyMedian(null), "unknown", "null"),
  },
  {
    name: "classifyMedian: under 4s is fast",
    run: () => assertEqual(classifyMedian(3999), "fast", "fast"),
  },
  {
    name: "classifyMedian: 4s to under 8s is slow",
    run: () => {
      assertEqual(classifyMedian(4000), "slow", "slow start");
      assertEqual(classifyMedian(7999), "slow", "slow end");
    },
  },
  {
    name: "classifyMedian: 8s or more is very slow",
    run: () => assertEqual(classifyMedian(8000), "very_slow", "very slow"),
  },
  {
    name: "timeoutScaleFor: fast and unknown keep the base timeout",
    run: () => {
      assertEqual(timeoutScaleFor("fast"), 1, "fast");
      assertEqual(timeoutScaleFor("unknown"), 1, "unknown");
    },
  },
  {
    name: "timeoutScaleFor: slow raises timeouts 1.5x, very slow 2x",
    run: () => {
      assertEqual(timeoutScaleFor("slow"), 1.5, "slow");
      assertEqual(timeoutScaleFor("very_slow"), 2, "very slow");
    },
  },
  {
    name: "tier stays unknown until three samples",
    run: () => {
      const speed = createNetworkSpeed();
      speed.record(1000);
      speed.record(1000);
      assertEqual(speed.tier(), "unknown", "two samples");
      speed.record(1000);
      assertEqual(speed.tier(), "fast", "three samples");
    },
  },
  {
    name: "tier follows the median of recent checks",
    run: () => {
      const speed = createNetworkSpeed();
      for (let i = 0; i < 5; i++) speed.record(9000);
      assertEqual(speed.tier(), "very_slow", "median of 9s");
      assertEqual(speed.timeoutScale(), 2, "scale follows tier");
    },
  },
  {
    name: "window keeps only the last 8 samples",
    run: () => {
      const speed = createNetworkSpeed();
      for (let i = 0; i < 8; i++) speed.record(9000);
      for (let i = 0; i < 8; i++) speed.record(500);
      assertEqual(speed.tier(), "fast", "old slow samples dropped");
    },
  },
  {
    name: "stalls after STALL_LIMIT timeouts in a row",
    run: () => {
      const speed = createNetworkSpeed();
      for (let i = 0; i < STALL_LIMIT - 1; i++) speed.record(BASE_TIMEOUT_MS);
      assertEqual(speed.isStalled(), false, "one short of the limit");
      speed.record(BASE_TIMEOUT_MS);
      assertEqual(speed.isStalled(), true, "at the limit");
    },
  },
  {
    name: "a fast check resets the timeout count",
    run: () => {
      const speed = createNetworkSpeed();
      speed.record(BASE_TIMEOUT_MS);
      speed.record(BASE_TIMEOUT_MS);
      speed.record(500);
      speed.record(BASE_TIMEOUT_MS);
      assertEqual(speed.isStalled(), false, "count restarted");
    },
  },
  {
    name: "startRun clears the stall but keeps the samples",
    run: () => {
      const speed = createNetworkSpeed();
      for (let i = 0; i < STALL_LIMIT; i++) speed.record(BASE_TIMEOUT_MS);
      assertEqual(speed.isStalled(), true, "stalled before the run");
      speed.startRun();
      assertEqual(speed.isStalled(), false, "cleared at run start");
      assertEqual(speed.tier(), "very_slow", "samples kept");
    },
  },
  {
    name: "clearStall lets a run continue after a healthy probe",
    run: () => {
      const speed = createNetworkSpeed();
      for (let i = 0; i < STALL_LIMIT; i++) speed.record(BASE_TIMEOUT_MS);
      speed.clearStall();
      assertEqual(speed.isStalled(), false, "cleared");
    },
  },
];

let failures = 0;
for (const check of checks) {
  try {
    check.run();
    console.log(`  ok  ${check.name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${check.name}`);
    console.error(`      ${(err as Error).message}`);
  }
}

console.log(`\n${checks.length - failures}/${checks.length} passed`);
if (failures > 0) {
  process.exit(1);
}
