// Custom entry point (replaces the default "expo-router/entry").
//
// react-native-track-player requires its playback service to be
// registered at the app's root, before anything else touches the
// player — that can't happen inside a React component, since by then
// it's too late for Android to bind the headless JS service. So this
// file does that registration first, then hands off to expo-router's
// own entry to boot the app exactly as it did before.
import TrackPlayer from "react-native-track-player";

TrackPlayer.registerPlaybackService(() => require("./service"));

require("expo-router/entry");
