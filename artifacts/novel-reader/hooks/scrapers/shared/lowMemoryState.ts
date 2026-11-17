// Low Memory Mode state for code outside React (the WebView bridge). The
// LowMemoryProvider keeps this in step with the setting.
let active = false;

export const setLowMemoryActive = (value: boolean): void => {
  active = value;
};

// Set while the person has allowed one paused-site job to run.
let exceptionActive = false;

export const isLowMemoryActive = (): boolean => active && !exceptionActive;

export const grantPausedSiteException = (): void => {
  exceptionActive = true;
};

export const endPausedSiteException = (): void => {
  exceptionActive = false;
};

export const PAUSED_MESSAGE = "paused in Low Memory Mode";
