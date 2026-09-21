import { useEffect, useRef } from "react";
import { AppState } from "react-native";

// Update this to your deployed server URL
const API_URL = "https://262e5a3b-3a35-4fca-bec3-4785f8fb1300-00-1lx4cgng71mch.pike.replit.dev/api/";

export const useDiscordStatus = () => {
  const sessionIdRef = useRef<string | null>(null);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    // Join when app starts
    const joinApp = async () => {
      try {
        const response = await fetch(`${API_URL}/sessions/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionIdRef.current }),
        });
        const data = await response.json();
        sessionIdRef.current = data.sessionId;
        console.log(`Discord: Joined. Online: ${data.onlineCount}`);
      } catch (error) {
        console.error("Discord join error:", error);
      }
    };

    // Leave when app closes
    const leaveApp = async () => {
      if (!sessionIdRef.current) return;
      try {
        const response = await fetch(`${API_URL}/sessions/leave`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionIdRef.current }),
        });
        const data = await response.json();
        console.log(`Discord: Left. Online: ${data.onlineCount}`);
      } catch (error) {
        console.error("Discord leave error:", error);
      }
    };

    // Listen to app state changes
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && appStateRef.current !== "active") {
        // App came to foreground
        joinApp();
      } else if (state !== "active" && appStateRef.current === "active") {
        // App went to background
        leaveApp();
      }
      appStateRef.current = state;
    });

    // Join on mount
    joinApp();

    return () => {
      subscription.remove();
      leaveApp();
    };
  }, []);
};
