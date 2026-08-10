import { useEffect, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

export function useConnectivity() {
  const [connectivity, setConnectivity] = useState({
    isConnected: true,
    isInternetReachable: true,
    status: 'initializing' as const,
  });

  const prevStateRef = useRef<typeof connectivity | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const newState = {
        isConnected: state.isConnected ?? false,
        isInternetReachable: state.isInternetReachable ?? false,
        status: (state.isConnected && state.isInternetReachable ? 'online' : 'offline') as 'online' | 'offline' | 'initializing',
      };

      if (prevStateRef.current) {
        if (
          prevStateRef.current.isConnected === newState.isConnected &&
          prevStateRef.current.isInternetReachable === newState.isInternetReachable
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