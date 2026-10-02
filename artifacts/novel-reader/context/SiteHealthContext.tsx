import * as FileSystem from "expo-file-system";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { checkSiteHealth } from "@/hooks/useApi";
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
  { name: "Novel-Bin", baseUrl: "https://novel-bin.com/" },
  { name: "NovelBinCC", baseUrl: "https://www.novelbin.cc/" },
  { name: "NovelArchiveCC", baseUrl: "https://novelarchive.cc/" },
  { name: "NovelPing", baseUrl: "https://novelping.com/" },
  { name: "FanMTL", baseUrl: "https://fanmtl.com/" },
];

// Simple status: checking, online, maintenance (503), gateway_timeout (504), or offline
export type SiteStatus =
  | "idle"
  | "checking"
  | "online"
  | "maintenance"
  | "gateway_timeout"
  | "offline";

const SITE_STATUS_STORAGE = `${FileSystem.documentDirectory}NovelDR/site_status.json`;
const CACHE_VALID_MS = 12 * 60 * 60 * 1000; // 12 hours

type SiteHealthContextType = {
  statuses: Record<string, SiteStatus>;
  isChecking: boolean;
  recheck: (siteName?: string) => void;
};

const SiteHealthContext = createContext<SiteHealthContextType>({
  statuses: {},
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
  const [isChecking, setIsChecking] = useState(false);
  const checkingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingRecheckRef = useRef(false);

  const connectivity = useConnectivity();

  // Latest values for use inside async code. runHealthChecks/init capture
  // the first render's `connectivity` (always "initializing"), which made
  // them bail out before ever checking anything - sites with no cached
  // status (new ones) then sat at "?" until Recheck was tapped.
  const connectivityRef = useRef(connectivity.status);
  connectivityRef.current = connectivity.status;
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;
  const cacheLoadedRef = useRef(false);

  // Runs the check loop for a subset of sites
  const runHealthChecks = async (
    sitesToCheck: typeof SUPPORTED_SITES,
    baseStatuses: Record<string, SiteStatus>,
  ) => {
    if (sitesToCheck.length === 0) return;

    // Simple switch: if device is offline, skip checks
    if (connectivityRef.current !== "online") {
      return;
    }

    if (checkingRef.current) {
      pendingRecheckRef.current = true;
      return;
    }

    checkingRef.current = true;
    setIsChecking(true);

    const results: Record<string, SiteStatus> = {};

    // Check each site on its own: only the site currently being checked
    // shows "checking", and its result lands as soon as it finishes
    // instead of every site waiting on the slowest one.
    for (const site of sitesToCheck) {
      setStatuses((prev) => ({ ...prev, [site.name]: "checking" }));
      try {
        const isUp = await checkSiteHealth(site.baseUrl);
        results[site.name] = isUp ? "online" : "offline";
      } catch (error: any) {
        results[site.name] = "offline";
      }
      setStatuses((prev) => ({ ...prev, [site.name]: results[site.name] }));
    }

    const finalStatuses = { ...baseStatuses, ...results };
    await saveSiteStatus(finalStatuses);

    checkingRef.current = false;

    // If a recheck was requested while this run was in flight, go
    // straight into it - keep isChecking (and the disabled Recheck
    // button) on the whole time instead of flipping off and back on
    // between the two runs.
    if (pendingRecheckRef.current) {
      pendingRecheckRef.current = false;
      await runHealthChecks(SUPPORTED_SITES, finalStatuses);
    } else {
      setIsChecking(false);
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
    //   stay true to the last real result. There's no separate
    //   reconnect-trigger effect - the next legitimate check is the next
    //   stale (12h) auto-check or an explicit tap of Recheck, not the
    //   moment connectivity happens to come back.
    const init = async () => {
      const saved = await loadSavedSiteStatus();

      cacheLoadedRef.current = true;

      if (saved) {
        setStatuses(saved.statuses);

        if (connectivityRef.current !== "online") return;

        const isStale = Date.now() - saved.timestamp >= CACHE_VALID_MS;
        if (isStale) {
          await runHealthChecks(SUPPORTED_SITES, saved.statuses);
        } else {
          // Fresh cache, but sites added since it was written have no
          // entry - check just those so they don't sit at "?".
          const missing = SUPPORTED_SITES.filter(
            (s) => !saved.statuses[s.name],
          );
          if (missing.length > 0) {
            await runHealthChecks(missing, saved.statuses);
          }
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

  // Connectivity usually resolves after the init above has already run (it
  // starts as "initializing"). When it flips to online, check only the sites
  // that still have no status - a stale-cache refresh stays on its 12h
  // schedule, this just fills in "?" cells.
  useEffect(() => {
    if (connectivity.status !== "online") return;
    if (!cacheLoadedRef.current || checkingRef.current) return;
    const missing = SUPPORTED_SITES.filter((s) => !statusesRef.current[s.name]);
    if (missing.length > 0) {
      runHealthChecks(missing, statusesRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectivity.status]);

  return (
    <SiteHealthContext.Provider value={{ statuses, isChecking, recheck }}>
      {children}
    </SiteHealthContext.Provider>
  );
}

export function useSiteHealth() {
  return useContext(SiteHealthContext);
}
