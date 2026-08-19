import notifee, {
  AndroidForegroundServiceType,
  AndroidImportance,
  EventType,
} from "@notifee/react-native";

// Simple, no-fuss persistent notification + foreground service that keeps
// the app process alive so expo-speech narration doesn't get suspended
// when the screen locks or the app is backgrounded (Home, Recents, tab
// switch). The previous implementation used a plain expo-notifications
// alert with no foreground service behind it — that notification could
// show, but nothing kept the process itself running once Android decided
// to freeze it, which is why narration used to cut off. This notification
// is bound to a real foreground service instead, and its Play/Pause and
// Stop buttons mirror into the app's existing TTS controls.
const CHANNEL_ID = "tts-playback";
const NOTIFICATION_ID = "tts-session";

export interface TTSNotificationState {
  novelTitle: string;
  chapterNumber: number;
  chapterTitle: string;
  progressPercent: number;
  isPlaying: boolean;
}

export interface TTSRemoteHandlers {
  onPlayPause?: () => void;
  onStop?: () => void;
}

let remoteHandlers: TTSRemoteHandlers = {};

// Read by index.js's background event handler (and the foreground handler
// below) — kept as a plain module-level object rather than React state
// since the background handler can run outside the component tree.
export const getRemoteHandlers = () => remoteHandlers;

export const setRemoteHandlers = (handlers: TTSRemoteHandlers) => {
  remoteHandlers = handlers;
};

let channelReady: Promise<void> | null = null;

const ensureChannel = async () => {
  if (!channelReady) {
    channelReady = notifee
      .createChannel({
        id: CHANNEL_ID,
        name: "TTS Playback",
        importance: AndroidImportance.LOW,
      })
      .then(() => undefined);
  }
  return channelReady;
};

export const setupMediaSession = async () => {
  await ensureChannel();
};

const describeState = (state: TTSNotificationState) =>
  `Chapter ${state.chapterNumber} — ${state.progressPercent}%${
    state.isPlaying ? "" : " (Paused)"
  }`;

export const updateMediaSession = async (state: TTSNotificationState) => {
  try {
    await ensureChannel();
    await notifee.displayNotification({
      id: NOTIFICATION_ID,
      title: state.chapterTitle,
      body: `${state.novelTitle} — ${describeState(state)}`,
      android: {
        channelId: CHANNEL_ID,
        asForegroundService: true,
        foregroundServiceTypes: [
          AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
        ],
        ongoing: true,
        onlyAlertOnce: true,
        actions: [
          {
            title: state.isPlaying ? "Pause" : "Play",
            pressAction: { id: "play-pause" },
          },
          {
            title: "Stop",
            pressAction: { id: "stop" },
          },
        ],
      },
    });
  } catch (error) {
    console.warn("[TTS Notification] Failed to update:", error);
  }
};

export const clearMediaSession = async () => {
  try {
    await notifee.stopForegroundService();
    await notifee.cancelNotification(NOTIFICATION_ID);
  } catch (error) {
    console.warn("[TTS Notification] Failed to clear:", error);
  }
};

// Notification button presses while the app is open. Background presses
// (screen locked, app switched away, or fully closed) are handled by
// index.js's notifee.onBackgroundEvent instead — only one of the two
// fires for any given press, depending on app state.
notifee.onForegroundEvent(({ type, detail }) => {
  if (type !== EventType.ACTION_PRESS) return;
  const handlers = getRemoteHandlers();
  if (detail.pressAction?.id === "play-pause") handlers.onPlayPause?.();
  if (detail.pressAction?.id === "stop") handlers.onStop?.();
});
