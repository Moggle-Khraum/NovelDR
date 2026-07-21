import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  RepeatMode,
  State,
} from "react-native-track-player";

// react-native-track-player owns a real native MediaSession (Android) /
// Now Playing + Remote Command Center (iOS) — that's what actually puts
// play/pause/next/prev on the lock screen and notification shade with
// native styling, instead of the plain alert-style notification we had
// before.
//
// The catch: RNTP expects an actual playable track, and our narration
// comes from expo-speech, which has no accessible audio stream/URL to
// hand it. So we give RNTP a silent, looping local track purely to hold
// the media session and drive the transport UI, while expo-speech keeps
// doing the real narration. Play/pause on the lock screen mirrors into
// the app's TTS controls via setRemoteHandlers below — it doesn't
// control audible playback itself.
const SILENT_TRACK_ID = "tts_silent_anchor";

export interface TTSNotificationState {
  novelTitle: string;
  chapterNumber: number;
  chapterTitle: string;
  progressPercent: number;
  isPlaying: boolean;
}

export interface TTSRemoteHandlers {
  onPlay?: () => void;
  onPause?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onStop?: () => void;
}

let remoteHandlers: TTSRemoteHandlers = {};

// Read by service.js inside the headless playback service — kept as a
// plain module-level object rather than React state since the service
// can run outside the component tree.
export const getRemoteHandlers = () => remoteHandlers;

export const setRemoteHandlers = (handlers: TTSRemoteHandlers) => {
  remoteHandlers = handlers;
};

let playerReady: Promise<void> | null = null;

export const setupMediaSession = async () => {
  if (playerReady) return playerReady;

  playerReady = (async () => {
    await TrackPlayer.setupPlayer({
      autoHandleInterruptions: true,
    });

    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior:
          AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
      },
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.Stop,
      ],
      compactCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
      ],
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
      ],
    });

    await TrackPlayer.setRepeatMode(RepeatMode.Track);
  })();

  return playerReady;
};

const ensureAnchorTrackLoaded = async (state: TTSNotificationState) => {
  const activeTrack = await TrackPlayer.getActiveTrack();
  if (activeTrack?.id === SILENT_TRACK_ID) return;

  await TrackPlayer.reset();
  await TrackPlayer.add({
    id: SILENT_TRACK_ID,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    url: require("@/assets/audio/silence.mp3"),
    title: state.chapterTitle,
    artist: state.novelTitle,
    artwork: require("@/assets/images/icon.png"),
    duration: 60,
  });
};

// Reading progress has no real audio-duration analogue, so rather than
// faking a scrubber position against the silent track (which would let
// someone "seek" reading progress and looks broken when it snaps back),
// progress is surfaced as text in the notification body instead.
const describeState = (state: TTSNotificationState) =>
  `Chapter ${state.chapterNumber} — ${state.progressPercent}% ${
    state.isPlaying ? "" : "(Paused)"
  }`.trim();

export const updateMediaSession = async (state: TTSNotificationState) => {
  try {
    await setupMediaSession();
    await ensureAnchorTrackLoaded(state);

    await TrackPlayer.updateNowPlayingMetadata({
      title: state.chapterTitle,
      artist: state.novelTitle,
      description: describeState(state),
    });

    const playbackState = await TrackPlayer.getPlaybackState();
    const isCurrentlyPlaying = playbackState.state === State.Playing;
    if (state.isPlaying && !isCurrentlyPlaying) {
      await TrackPlayer.play();
    } else if (!state.isPlaying && isCurrentlyPlaying) {
      await TrackPlayer.pause();
    }
  } catch (error) {
    console.warn("[TTS Media Session] Failed to update:", error);
  }
};

export const clearMediaSession = async () => {
  try {
    await TrackPlayer.reset();
  } catch (error) {
    console.warn("[TTS Media Session] Failed to clear:", error);
  }
};
