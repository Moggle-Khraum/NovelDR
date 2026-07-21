// Playback service for react-native-track-player.
//
// This runs in a headless JS context — it can be invoked by the OS
// (lock screen, notification, Bluetooth headset button, Android Auto)
// even when the app's React tree isn't mounted. It must stay a *thin*
// bridge: forward each remote command to whatever the app registered
// via TTSMediaSession.setRemoteHandlers(), and do nothing else here.
import TrackPlayer, { Event } from "react-native-track-player";

import { getRemoteHandlers } from "@/lib/TTSMediaSession";

module.exports = async function () {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    getRemoteHandlers().onPlay?.();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    getRemoteHandlers().onPause?.();
  });

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    getRemoteHandlers().onNext?.();
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    getRemoteHandlers().onPrevious?.();
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    getRemoteHandlers().onStop?.();
  });

  // Android media-style notification's own dismiss ("swipe away") action.
  TrackPlayer.addEventListener(Event.RemoteDuck, async (event) => {
    if (event.paused) {
      getRemoteHandlers().onPause?.();
    }
  });
};
