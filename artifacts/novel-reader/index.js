// Custom entry point (replaces the default "expo-router/entry").
//
// Notifee requires its background event handler and foreground-service
// task to be registered at the app's root, before anything else touches
// them — that can't happen inside a React component, since by then it's
// too late for Android to deliver events to a headless JS context. So
// this file does that registration first, then hands off to expo-router's
// own entry to boot the app exactly as it did before.
import notifee, { EventType } from "@notifee/react-native";

import { getRemoteHandlers } from "@/lib/TTSMediaSession";

// The foreground service task itself does no work — its only job is to
// stay pending, which is what keeps the process (and expo-speech
// narration) alive while backgrounded. All the real behavior happens via
// notification button presses, forwarded below.
notifee.registerForegroundService(() => new Promise(() => {}));

// Notification button presses (Play/Pause, Stop) while the app is
// backgrounded or fully closed. Foreground presses are handled separately
// in lib/TTSMediaSession.ts via notifee.onForegroundEvent.
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type !== EventType.ACTION_PRESS) return;
  const handlers = getRemoteHandlers();
  if (detail.pressAction?.id === "play-pause") handlers.onPlayPause?.();
  if (detail.pressAction?.id === "stop") handlers.onStop?.();
});

require("expo-router/entry");
