import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Alert } from "react-native";
import * as Device from "expo-device";
import * as Sentry from "@sentry/react-native";

// Devices with less total RAM than this are treated as low-memory.
// The crashing TECNO KE5 reports about 1.9 GB, so 2 GB catches it.
export const LOW_RAM_THRESHOLD_BYTES = 2 * 1024 * 1024 * 1024;

const STORAGE_KEY = "low_memory_mode_setting";

// Shown once per app launch, not on every render.
let lowModeNoticeShown = false;

// "auto": follow the device (on for low-RAM devices, off otherwise). Default.
// "on" / "off": the user has chosen manually.
export type LowMemorySetting = "auto" | "on" | "off";

const getAsyncStorage = () => {
  try {
    return require("@react-native-async-storage/async-storage").default;
  } catch {
    return null;
  }
};

type LowMemoryValue = {
  /** Total device RAM in bytes, or null if the OS did not report it. */
  totalMemoryBytes: number | null;
  /** True when total RAM is below LOW_RAM_THRESHOLD_BYTES. */
  isLowRamDevice: boolean;
  /** Whether Low Memory Mode is in effect right now. */
  enabled: boolean;
  /** The saved choice: auto, or a manual on/off override. */
  setting: LowMemorySetting;
  setSetting: (value: LowMemorySetting) => void;
};

const LowMemoryContext = createContext<LowMemoryValue | null>(null);

export function LowMemoryProvider({ children }: { children: ReactNode }) {
  const totalMemoryBytes = Device.totalMemory ?? null;
  const isLowRamDevice =
    totalMemoryBytes !== null && totalMemoryBytes < LOW_RAM_THRESHOLD_BYTES;

  const [setting, setSettingState] = useState<LowMemorySetting>("auto");

  // Load the saved setting once at startup. Failures keep the default (auto).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const AsyncStorage = getAsyncStorage();
        if (!AsyncStorage) return;
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && (raw === "on" || raw === "off")) {
          setSettingState(raw);
        }
      } catch {
        // Keep the default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enabled =
    setting === "auto" ? isLowRamDevice : setting === "on";

  // Tell the person once per app launch when Low Memory Mode is in effect.
  useEffect(() => {
    if (!enabled || lowModeNoticeShown) return;
    lowModeNoticeShown = true;
    Alert.alert(
      "Running on Low Mode",
      "This device has limited memory, so NovelDR is running in Low Memory Mode to avoid crashes. You can change this in Settings.",
    );
  }, [enabled]);

  // Tag every Sentry event so we can see the device class and mode on crashes.
  useEffect(() => {
    Sentry.setTag("device.low_ram", String(isLowRamDevice));
    Sentry.setTag("low_memory_mode", String(enabled));
    Sentry.setTag("low_memory_setting", setting);
    if (totalMemoryBytes !== null) {
      Sentry.setTag(
        "device.total_ram_gb",
        (totalMemoryBytes / (1024 * 1024 * 1024)).toFixed(1),
      );
    }
  }, [isLowRamDevice, enabled, setting, totalMemoryBytes]);

  const setSetting = useCallback((value: LowMemorySetting) => {
    setSettingState(value);
    (async () => {
      try {
        const AsyncStorage = getAsyncStorage();
        if (AsyncStorage) {
          await AsyncStorage.setItem(STORAGE_KEY, value);
        }
      } catch {
        // The in-memory value still applies for this session.
      }
    })();
  }, []);

  const value = useMemo(
    () => ({
      totalMemoryBytes,
      isLowRamDevice,
      enabled,
      setting,
      setSetting,
    }),
    [totalMemoryBytes, isLowRamDevice, enabled, setting, setSetting],
  );

  return (
    <LowMemoryContext.Provider value={value}>
      {children}
    </LowMemoryContext.Provider>
  );
}

export function useLowMemory(): LowMemoryValue {
  const ctx = useContext(LowMemoryContext);
  if (!ctx) {
    throw new Error("useLowMemory must be used inside LowMemoryProvider");
  }
  return ctx;
}
