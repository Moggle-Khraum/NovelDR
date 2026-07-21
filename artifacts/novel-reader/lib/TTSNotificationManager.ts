import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// Show the notification even while the app is in the foreground — this is
// a persistent playback control (like a media-player notification), not a
// one-off alert, so it needs to stay visible the whole time TTS is active,
// not just while backgrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
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

const TTS_CHANNEL_ID = "tts_playback";
const TTS_CATEGORY_ID = "tts_playback_controls";

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
let categoryRegisteredForIsPlaying: boolean | null = null;

const buildSignature = (state: TTSNotificationState) =>
  `${state.novelTitle}|${state.chapterNumber}|${state.chapterTitle}|${state.progressPercent}|${state.isPlaying}`;

// Action buttons only exist on Android/iOS via a registered "category" —
// there is no `content.android.actions` field in expo-notifications (that
// shape was silently ignored, which is why the notification only ever
// showed the bare title/body with no buttons). The Pause/Play button's
// label needs to flip with playback state, so the category gets
// re-registered whenever isPlaying changes, and the notification content
// then just references it via `categoryIdentifier`.
const ensureTTSCategoryAsync = async (isPlaying: boolean) => {
  if (categoryRegisteredForIsPlaying === isPlaying) return;
  await Notifications.setNotificationCategoryAsync(TTS_CATEGORY_ID, [
    {
      identifier: "pause",
      buttonTitle: isPlaying ? "Pause" : "Play",
      options: { opensAppToForeground: false },
    },
    {
      identifier: "next",
      buttonTitle: "Next",
      options: { opensAppToForeground: false },
    },
    {
      identifier: "prev",
      buttonTitle: "Previous",
      options: { opensAppToForeground: false },
    },
  ]);
  categoryRegisteredForIsPlaying = isPlaying;
};

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
    await ensureTTSCategoryAsync(state.isPlaying);
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
        sticky: true, // Can't be swiped away while TTS is active
        autoDismiss: false,
        priority: "high",
        categoryIdentifier: TTS_CATEGORY_ID, // wires up the action buttons
      },
      // A ChannelAwareTriggerInput — this is what actually routes the
      // notification through the "tts_playback" channel (high importance,
      // no sound/vibration). `trigger: null` posts to the default channel
      // instead, which is why priority/importance never took effect before.
      trigger: { channelId: TTS_CHANNEL_ID },
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
      await Notifications.setNotificationChannelAsync(TTS_CHANNEL_ID, {
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

// Android 13+ (API 33) requires the POST_NOTIFICATIONS runtime permission,
// which is never granted automatically — without this call, every
// scheduleNotificationAsync above just silently does nothing. Call this
// once, up front, before TTS starts (not after backgrounding — Android
// gives an app no way to show a permission prompt once it's no longer in
// the foreground, so this has to happen while the user is still looking
// at the screen for it to have any chance of taking effect before they
// background the app).
export const ensureTTSNotificationPermissionAsync = async (): Promise<
  "granted" | "denied" | "undetermined"
> => {
  if (Platform.OS !== "android") return "granted";

  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return "granted";

    // Once denied, Android won't show the system dialog again on repeat
    // calls — canAskAgain tells us whether it's still worth asking or
    // whether we need to send the user to system Settings instead.
    if (current.canAskAgain === false) return "denied";

    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted ? "granted" : "denied";
  } catch (error) {
    console.warn("[TTS Notification] Permission check failed:", error);
    return "undetermined";
  }
};

export const getTTSNotificationPermissionStatusAsync = async (): Promise<
  "granted" | "denied" | "undetermined"
> => {
  if (Platform.OS !== "android") return "granted";
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return "granted";
    return current.canAskAgain === false ? "denied" : "undetermined";
  } catch {
    return "undetermined";
  }
};
