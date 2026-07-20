import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
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

let currentNotificationId: string | null = null;

export const updateTTSNotification = async (state: TTSNotificationState) => {
  if (Platform.OS !== "android") return; // Android only for now

  try {
    // Cancel existing notification
    if (currentNotificationId) {
      await Notifications.dismissNotificationAsync(currentNotificationId);
      currentNotificationId = null;
    }

    // Create new notification
    currentNotificationId = await Notifications.scheduleNotificationAsync({
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
  }
};

export const clearTTSNotification = async () => {
  if (currentNotificationId) {
    try {
      await Notifications.dismissNotificationAsync(currentNotificationId);
      currentNotificationId = null;
    } catch (error) {
      console.warn("[TTS Notification] Failed to clear:", error);
    }
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
