import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useUpdateContext } from "@/context/UpdateContext";
import { downloadApk, installApk } from "@/hooks/useUpdateChecker";

export type UpdatePhase = "idle" | "downloading" | "ready" | "installing";

/**
 * Owns the whole "update available" UX state: modal visibility, download
 * progress, install hand-off, and skip/dismiss. Screens just call this and
 * render <UpdateModal flow={...} /> — no update logic lives in the screen.
 */
export function useUpdateFlow() {
  const { updateInfo, skipVersion } = useUpdateContext();
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [progress, setProgress] = useState(0);
  const [localApkUri, setLocalApkUri] = useState<string | null>(null);

  const open = useCallback(() => setVisible(true), []);

  // Session-only close — doesn't dismiss the tag, so it shows again next cold start.
  const close = useCallback(() => setVisible(false), []);

  const download = useCallback(async () => {
    if (!updateInfo) return;
    setPhase("downloading");
    setProgress(0);
    try {
      const uri = await downloadApk(updateInfo, setProgress);
      setLocalApkUri(uri);
      setPhase("ready");
    } catch {
      setPhase("idle");
      Alert.alert(
        "Download failed",
        "Could not download the update. Check your connection and try again.",
      );
    }
  }, [updateInfo]);

  const apply = useCallback(async () => {
    if (!localApkUri) return;
    setPhase("installing");
    try {
      await installApk(localApkUri);
      // Android takes over from here — the app backgrounds while the installer
      // runs. If "Install unknown apps" isn't granted yet, Android shows its own
      // system prompt automatically before the installer screen appears.
    } catch {
      setPhase("ready");
      Alert.alert("Install failed", "Could not open the installer.");
    }
  }, [localApkUri]);

  const skip = useCallback(async () => {
    await skipVersion();
    setVisible(false);
    setPhase("idle");
    setLocalApkUri(null);
  }, [skipVersion]);

  return {
    info: updateInfo,
    visible,
    phase,
    progress,
    open,
    close,
    download,
    apply,
    skip,
  };
}

export type UpdateFlow = ReturnType<typeof useUpdateFlow>;
