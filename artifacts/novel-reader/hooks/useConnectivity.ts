import { useEffect, useRef, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

type ConnectivityState = {
  isConnected: boolean;
  isInternetReachable: boolean;
  status: "online" | "offline" | "initializing";
};

export function useConnectivity() {
  const [connectivity, setConnectivity] = useState<ConnectivityState>({
    isConnected: true,
    isInternetReachable: true,
    status: "initializing",
  });

  const prevStateRef = useRef<ConnectivityState | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const newState: ConnectivityState = {
        isConnected: state.isConnected ?? false,
        isInternetReachable: state.isInternetReachable ?? false,
        status:
          state.isConnected && state.isInternetReachable ? "online" : "offline",
      };

      if (prevStateRef.current) {
        if (
          prevStateRef.current.isConnected === newState.isConnected &&
          prevStateRef.current.isInternetReachable ===
            newState.isInternetReachable
        ) {
          return;
        }
      }

      prevStateRef.current = newState;
      setConnectivity(newState);
    });

    return () => unsubscribe();
  }, []);

  return connectivity;
}
