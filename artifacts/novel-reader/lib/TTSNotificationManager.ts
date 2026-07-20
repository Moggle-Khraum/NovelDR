import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export interface TTSNotificationState {
  novelTitle: string;
  chapterNumber: number;
  chapterTitle: string;
  progressPercent: number;
  isPlaying: boolean;
}

// Fixed identifier so re-scheduling REPLACES the existing notification
// in place (Android treats same-id notifications as an update) instead of
// creating a brand new one each time. This is what actually prevents the
// flood — the old dismiss-then-recreate approach raced with itself because
// currentNotificationId was only assigned after the previous await resolved,
// so overlapping calls could each see a stale/null id and both schedule.
const TTS_NOTIFICATION_ID = "tts_playback_notification";

let lastPostedSignature: string | null = null;
let updateInFlight = false;
let pendingState: TTSNotificationState | null = null;

const buildSignature = (state: TTSNotificationState) =>
  `${state.novelTitle}|${state.chapterNumber}|${state.chapterTitle}|${state.progressPercent}|${state.isPlaying}`;

export const updateTTSNotification = async (state: TTSNotificationState) => {
  if (Platform.OS !== "android") return; // Android only for now

  const signature = buildSignature(state);
  if (signature === lastPostedSignature) return; // nothing actually changed

  if (updateInFlight) {
    // Another update is already in progress — remember the latest
    // requested state and let that call pick it up when it finishes,
    // instead of firing a second overlapping native call.
    pendingState = state;
    return;
  }
  updateInFlight = true;

  try {
    lastPostedSignature = signature;
    await Notifications.scheduleNotificationAsync({
      identifier: TTS_NOTIFICATION_ID,
      content: {
        title: state.novelTitle,
        subtitle: `Chapter ${state.chapterNumber}: ${state.chapterTitle}`,
        body: `${state.progressPercent}% — ${
          state.isPlaying ? "Playing" : "Paused"
        }`,
        data: {
          novelTitle: state.novelTitle,
          chapterNumber: state.chapterNumber,
          chapterTitle: state.chapterTitle,
          progressPercent: state.progressPercent,
          isPlaying: state.isPlaying,
        },
        // Set as persistent notification
        sticky: true,
        // Show progress as a custom field (will be rendered as subtitle)
        autoDismiss: false,
        // Actions for play/pause
        ...{
          android: {
            channelId: "tts_playback",
            priority: "high",
            sticky: true,
            actions: [
              {
                identifier: "pause",
                buttonTitle: state.isPlaying ? "Pause" : "Play",
                options: { authenticationRequired: false },
              },
              {
                identifier: "next",
                buttonTitle: "Next",
                options: { authenticationRequired: false },
              },
              {
                identifier: "prev",
                buttonTitle: "Previous",
                options: { authenticationRequired: false },
              },
            ],
          },
        },
      },
      trigger: null, // Deliver immediately
    });
  } catch (error) {
    console.warn("[TTS Notification] Failed to update:", error);
  } finally {
    updateInFlight = false;
    if (pendingState) {
      const next = pendingState;
      pendingState = null;
      // Fire and forget — this re-enters updateTTSNotification with
      // whatever the latest state was while we were busy.
      updateTTSNotification(next);
    }
  }
};

export const clearTTSNotification = async () => {
  lastPostedSignature = null;
  pendingState = null;
  try {
    await Notifications.dismissNotificationAsync(TTS_NOTIFICATION_ID);
  } catch (error) {
    console.warn("[TTS Notification] Failed to clear:", error);
  }
};

export const setupNotificationChannels = async () => {
  if (Platform.OS !== "android") return;

  try {
    // Only call for Android 8.0+
    if (Platform.Version >= 26) {
      await Notifications.setNotificationChannelAsync("tts_playback", {
        name: "TTS Playback",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0],
        lightColor: "#FF231F7C",
        enableVibrate: false,
        enableLights: false,
      });
    }
  } catch (error) {
    console.warn("[TTS Notification] Failed to setup channels:", error);
  }
};
