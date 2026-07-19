import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  checkForUpdate,
  skipVersion as skipVersionHelper,
  UpdateInfo,
} from '@/hooks/useUpdateChecker';

type UpdateContextType = {
  updateInfo: UpdateInfo | null;
  checkingUpdate: boolean;
  checkNow: () => Promise<UpdateInfo | null>; // manual, force=true — used by the Settings button
  clearUpdate: () => void;
  skipVersion: () => Promise<void>;
};

const UpdateContext = createContext<UpdateContextType>({
  updateInfo: null,
  checkingUpdate: false,
  checkNow: async () => null,
  clearUpdate: () => {},
  skipVersion: async () => {},
});

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // Cold-start check — runs once when the provider mounts (app launch)
  useEffect(() => {
    checkForUpdate(false).then((result) => {
      if (result) setUpdateInfo(result);
    });
  }, []);

  const checkNow = useCallback(async () => {
    setCheckingUpdate(true);
    const result = await checkForUpdate(true);
    setCheckingUpdate(false);
    if (result) setUpdateInfo(result);
    return result;
  }, []);

  const clearUpdate = useCallback(() => setUpdateInfo(null), []);

  const skipVersion = useCallback(async () => {
    if (updateInfo) await skipVersionHelper(updateInfo.tag);
    setUpdateInfo(null);
  }, [updateInfo]);

  return (
    <UpdateContext.Provider
      value={{ updateInfo, checkingUpdate, checkNow, clearUpdate, skipVersion }}
    >
      {children}
    </UpdateContext.Provider>
  );
}

export function useUpdateContext() {
  return useContext(UpdateContext);
}
