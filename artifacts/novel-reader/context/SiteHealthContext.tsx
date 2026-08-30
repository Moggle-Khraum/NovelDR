import * as FileSystem from "expo-file-system";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { checkSiteHealthDetailed, SiteHealthState } from "@/hooks/useApi";
import { useConnectivity } from "@/hooks/useConnectivity";

// --- SUPPORTED SITES ---
// Moved here from app/(tabs)/add.tsx so the health-check logic can live at
// the app root (see SiteHealthProvider below) instead of being tied to
// whether the Download tab happens to be mounted. add.tsx still imports
// this list for rendering the grid.
export const SUPPORTED_SITES = [
  { name: "ReadNovelFullCom", baseUrl: "https://readnovelfull.com/" },
  { name: "NovelFullCom", baseUrl: "https://novelfull.com/" },
  { name: "NovelFullNet", baseUrl: "https://novelfull.net/" },
  { name: "AllNovelOrg", baseUrl: "https://allnovel.org/" },
  { name: "FreeWebNovelCom", baseUrl: "https://freewebnovel.com/" },
  { name: "NovGoNet", baseUrl: "https://novgo.net/" },
  { name: "LightNovelWorldOrg", baseUrl: "https://lightnovelworld.org/" },
  { name: "WuxiaWorldSite", baseUrl: "https://wuxiaworld.site/" },
  { name: "RoyalRoad", baseUrl: "https://royalroad.com/" },
  { name: "AsiaNovel", baseUrl: "https://asianovel.net/" },
  { name: "NovelPhoenix", baseUrl: "https://novelphoenix.com/" },
  { name: "NovelArrow", baseUrl: "https://novelarrow.com/" },
  { name: "Novel-Bin", baseUrl: "https://novel-bin.com/" },
  { name: "NovelBinCC", baseUrl: "https://www.novelbin.cc/" },
  { name: "NovelArchiveCC", baseUrl: "https://novelarchive.cc/" },
];

// "idle"/"checking" are UI-only phases; the rest mirror SiteHealthState
// from useApi so a 503 shows as "under maintenance" and a 504 shows as
// "gateway timeout" instead of both just collapsing into "offline".
export type SiteStatus = "idle" | "checking" | SiteHealthState;

export type SiteStatusDetail = {
  statusCode?: number;
  responseTime?: number;
  tier?: string;
  error?: string;
  checkedAt: number;
};

const SITE_STATUS_STORAGE = `${FileSystem.documentDirectory}NovelDR/site_status.json`;
const CACHE_VALID_MS = 12 * 60 * 60 * 1000; // 12 hours

type SiteHealthContextType = {
  statuses: Record<string, SiteStatus>;
  details: Record<string, SiteStatusDetail>;
  isChecking: boolean;
  // Force an immediate re-check, bypassing the 12h cache. Omit `siteName`
  // to recheck every supported site.
  recheck: (siteName?: string) => void;
};

const SiteHealthContext = createContext<SiteHealthContextType>({
  statuses: {},
  details: {},
  isChecking: false,
  recheck: () => {},
});

const loadSavedSiteStatus = async (): Promise<{
  statuses: Record<string, SiteStatus>;
  timestamp: number;
} | null> => {
  try {
    const fileInfo = await FileSystem.getInfoAsync(SITE_STATUS_STORAGE);
    if (!fileInfo.exists) return null;
    const content = await FileSystem.readAsStringAsync(SITE_STATUS_STORAGE);
    const data = JSON.parse(content);
    if (!data.timestamp || !data.statuses) return null;
    return { statuses: data.statuses, timestamp: data.timestamp };
  } catch (error) {
    console.warn("[SiteHealth] Failed to load saved status:", error);
    return null;
  }
};

const saveSiteStatus = async (statuses: Record<string, SiteStatus>) => {
  try {
    const dir = `${FileSystem.documentDirectory}NovelDR/`;
    const dirInfo = await FileSystem.getInfoAsync(dir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    await FileSystem.writeAsStringAsync(
      SITE_STATUS_STORAGE,
      JSON.stringify({ statuses, timestamp: Date.now() }),
    );
  } catch (error) {
    console.warn("[SiteHealth] Failed to save status:", error);
  }
};

export function SiteHealthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [statuses, setStatuses] = useState<Record<string, SiteStatus>>({});
  const [details, setDetails] = useState<Record<string, SiteStatusDetail>>({});
  const [isChecking, setIsChecking] = useState(false);
  const checkingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Sites queued for a manual recheck while a check is already in
  // progress - drained once the current run finishes.
  const pendingRecheckRef = useRef<Set<string> | null>(null);

  const connectivity = useConnectivity();
  // Read inside async functions/timers without stale-closure issues -
  // state from useConnectivity() would otherwise be frozen at whatever it
  // was when the effect/closure was created.
  const connectivityRef = useRef(connectivity.status);
  connectivityRef.current = connectivity.status;

  // Runs the actual check loop for a subset of sites, updating state and
  // persisting to disk after each one so progress isn't lost if the app
  // backgrounds mid-check.
  //
  // If the device itself has no internet, this is a no-op: a check run
  // while offline can only ever come back "offline" for every site
  // regardless of whether they're actually up, and that false reading
  // would otherwise get written over the last real (permanent) result.
  // Better to leave the saved JSON exactly as it was and just wait for
  // connectivity to return.
  const runHealthChecks = async (
    sitesToCheck: typeof SUPPORTED_SITES,
    baseStatuses: Record<string, SiteStatus>,
  ) => {
    if (sitesToCheck.length === 0) return;

    if (connectivityRef.current !== "online") {
      return;
    }

    if (checkingRef.current) {
      // Already checking (e.g. the periodic sweep) - queue these sites for
      // a manual recheck right after the current run finishes instead of
      // dropping the request.
      if (!pendingRecheckRef.current) pendingRecheckRef.current = new Set();
      sitesToCheck.forEach((s) => pendingRecheckRef.current!.add(s.name));
      return;
    }

    checkingRef.current = true;
    setIsChecking(true);

    const updated: Record<string, SiteStatus> = { ...baseStatuses };
    sitesToCheck.forEach((site) => {
      updated[site.name] = "checking";
    });
    setStatuses({ ...updated });

    for (const site of sitesToCheck) {
      // Connectivity can drop (or still not have resolved) mid-run - bail
      // out immediately rather than marking every remaining site
      // "offline", and reset anything this run had already flagged
      // "checking" back to whatever it was before this run started.
      if (connectivityRef.current !== "online") {
        sitesToCheck.forEach((s) => {
          if (updated[s.name] === "checking") {
            updated[s.name] = baseStatuses[s.name] ?? "idle";
          }
        });
        setStatuses({ ...updated });
        break;
      }

      try {
        const result = await checkSiteHealthDetailed(site.baseUrl);
        updated[site.name] = result.state;
        setDetails((prev) => ({
          ...prev,
          [site.name]: {
            statusCode: result.statusCode,
            responseTime: result.responseTime,
            tier: result.tier,
            error: result.error,
            checkedAt: Date.now(),
          },
        }));
      } catch (error: any) {
        updated[site.name] = "offline";
        setDetails((prev) => ({
          ...prev,
          [site.name]: {
            error: error?.message || "Unknown error",
            checkedAt: Date.now(),
          },
        }));
      }
      setStatuses({ ...updated });
      await saveSiteStatus(updated);
      // Small delay between sites so we're not firing everything at once.
      await new Promise((r) => setTimeout(r, 200));
    }

    checkingRef.current = false;
    setIsChecking(false);

    // Drain anything queued via recheck() while this run was in flight.
    if (pendingRecheckRef.current && pendingRecheckRef.current.size > 0) {
      const queued = SUPPORTED_SITES.filter((s) =>
        pendingRecheckRef.current!.has(s.name),
      );
      pendingRecheckRef.current = null;
      await runHealthChecks(queued, updated);
    }
  };

  // Manually force a recheck, bypassing the 12h cache entirely. Pass a
  // site name to recheck just that one (e.g. a "Recheck" button next to a
  // single offline site), or call with no argument to recheck everything.
  // No-ops while the device is offline, same as the automatic paths - see
  // runHealthChecks.
  const recheck = (siteName?: string) => {
    const targets = siteName
      ? SUPPORTED_SITES.filter((s) => s.name === siteName)
      : SUPPORTED_SITES;
    runHealthChecks(targets, statuses);
  };

  useEffect(() => {
    // Fires once per app launch (this provider lives at the root, mounted
    // for the lifetime of the app - not tied to whether the Download tab
    // has ever been opened).
    //
    // - Cache still fresh (<12h)  -> show it immediately, no network hit.
    // - Cache stale or missing,
    //   device confirmed online  -> show whatever's cached (or idle) right
    //   away, then refresh in the background so the grid is current by the
    //   time the person actually looks at Download, without blocking app
    //   startup on a health check.
    // - Device offline, or connectivity hasn't resolved yet
    //   ("initializing") -> show whatever's cached, however old, and don't
    //   attempt a check at all. A check with no confirmed internet can
    //   only produce false "offline" readings for every site - better to
    //   stay true to the last real result. Unlike before, there's no
    //   separate reconnect-trigger effect - the next legitimate check is
    //   the next stale (12h) auto-check or an explicit tap of Recheck, not
    //   the moment connectivity happens to come back.
    const init = async () => {
      const saved = await loadSavedSiteStatus();

      if (saved) {
        setStatuses(saved.statuses);

        if (connectivityRef.current !== "online") return;

        const missing = SUPPORTED_SITES.filter(
          (site) =>
            !saved.statuses[site.name] || saved.statuses[site.name] === "idle",
        );

        const isStale = Date.now() - saved.timestamp >= CACHE_VALID_MS;

        if (isStale) {
          // Stale: refresh everything, not just the missing ones.
          await runHealthChecks(SUPPORTED_SITES, saved.statuses);
        } else if (missing.length > 0) {
          // Fresh but incomplete (e.g. a source was added after the cache
          // was written) - fill in just the gaps.
          await runHealthChecks(missing, saved.statuses);
        }
      } else if (connectivityRef.current === "online") {
        // No cache at all - first run, and connectivity is confirmed.
        await runHealthChecks(SUPPORTED_SITES, {});
      }
    };

    init();

    // Keep checking every 12h for as long as the app stays open/backgrounded
    // without being fully closed. Guarded the same way inside
    // runHealthChecks - this just skips the wasted call when we already
    // know we're offline or haven't resolved connectivity yet. This is the
    // only automatic recheck path now - there's no separate trigger tied
    // to connectivity changing.
    intervalRef.current = setInterval(() => {
      if (connectivityRef.current !== "online") return;
      runHealthChecks(SUPPORTED_SITES, {});
    }, CACHE_VALID_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SiteHealthContext.Provider
      value={{ statuses, details, isChecking, recheck }}
    >
      {children}
    </SiteHealthContext.Provider>
  );
}

export function useSiteHealth() {
  return useContext(SiteHealthContext);
}
