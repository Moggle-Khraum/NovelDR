import * as FileSystem from "expo-file-system";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { checkSiteHealth } from "@/hooks/useApi";

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
];

export type SiteStatus = "idle" | "checking" | "online" | "offline";

const SITE_STATUS_STORAGE = `${FileSystem.documentDirectory}NovelDR/site_status.json`;
const CACHE_VALID_MS = 12 * 60 * 60 * 1000; // 12 hours

type SiteHealthContextType = {
  statuses: Record<string, SiteStatus>;
  isChecking: boolean;
};

const SiteHealthContext = createContext<SiteHealthContextType>({
  statuses: {},
  isChecking: false,
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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkingRef = useRef(false);

  // Runs the actual check loop for a subset of sites, updating state and
  // persisting to disk after each one so progress isn't lost if the app
  // backgrounds mid-check.
  const runHealthChecks = async (
    sitesToCheck: typeof SUPPORTED_SITES,
    baseStatuses: Record<string, SiteStatus>,
  ) => {
    if (sitesToCheck.length === 0 || checkingRef.current) return;

    checkingRef.current = true;
    setIsChecking(true);

    const updated: Record<string, SiteStatus> = { ...baseStatuses };
    sitesToCheck.forEach((site) => {
      updated[site.name] = "checking";
    });
    setStatuses({ ...updated });

    for (const site of sitesToCheck) {
      try {
        const isUp = await checkSiteHealth(site.baseUrl);
        updated[site.name] = isUp ? "online" : "offline";
      } catch {
        updated[site.name] = "offline";
      }
      setStatuses({ ...updated });
      await saveSiteStatus(updated);
      // Small delay between sites so we're not firing everything at once.
      await new Promise((r) => setTimeout(r, 200));
    }

    checkingRef.current = false;
    setIsChecking(false);
  };

  useEffect(() => {
    // Fires once per app launch (this provider lives at the root, mounted
    // for the lifetime of the app - not tied to whether the Download tab
    // has ever been opened).
    //
    // - Cache still fresh (<12h)  -> show it immediately, no network hit.
    // - Cache stale or missing    -> show whatever's cached (or idle) right
    //   away, then refresh in the background so the grid is current by the
    //   time the person actually looks at Download, without blocking app
    //   startup on a health check.
    const init = async () => {
      const saved = await loadSavedSiteStatus();

      if (saved) {
        setStatuses(saved.statuses);

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
      } else {
        // No cache at all - first run.
        await runHealthChecks(SUPPORTED_SITES, {});
      }
    };

    init();

    // Keep checking periodically for as long as the app stays open/backgrounded
    // without being fully closed, same as before - this just now lives at the
    // root instead of inside the Download tab.
    intervalRef.current = setInterval(() => {
      runHealthChecks(SUPPORTED_SITES, {});
    }, CACHE_VALID_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SiteHealthContext.Provider value={{ statuses, isChecking }}>
      {children}
    </SiteHealthContext.Provider>
  );
}

export function useSiteHealth() {
  return useContext(SiteHealthContext);
}
