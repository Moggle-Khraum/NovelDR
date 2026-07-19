import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';

const RELEASE_REPO = 'Moggle-Khraum/NovelDR-site'; // release repo, not this code repo
const LAST_CHECK_KEY = 'update_last_check_v1';
const REQUEST_LOG_KEY = 'update_request_log_v1';
const DISMISSED_KEY = 'update_dismissed_version_v1';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;

export interface UpdateInfo {
  tag: string;
  notes: string;
  apkUrl: string;
  apkName: string;
  apkSize: number;
}

const getAsyncStorage = async () => {
  try {
    return require('@react-native-async-storage/async-storage').default;
  } catch {
    return null;
  }
};

function parseVersion(tag: string) {
  const clean = tag.replace(/^v/i, '');
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)(?:rev(\d+))?/);
  if (!match) return null;
  return { major: +match[1], minor: +match[2], patch: +match[3], rev: match[4] ? +match[4] : 0 };
}

// `currentBuildNumber` is the real installed android.versionCode (== the `rev`
// baked in by the build workflow), NOT parsed from the semver string — the
// semver string never carries a rev suffix, so parsing it always yielded 0
// and made every release look newer than whatever was actually installed.
function isNewerVersion(current: string, currentBuildNumber: number, latest: string): boolean {
  const c = parseVersion(current);
  const l = parseVersion(latest);
  if (!c || !l) return false;
  if (l.major !== c.major) return l.major > c.major;
  if (l.minor !== c.minor) return l.minor > c.minor;
  if (l.patch !== c.patch) return l.patch > c.patch;
  return l.rev > currentBuildNumber;
}

async function withinRequestBudget(AsyncStorage: any): Promise<boolean> {
  if (!AsyncStorage) return true;
  const raw = await AsyncStorage.getItem(REQUEST_LOG_KEY);
  const log: number[] = raw ? JSON.parse(raw) : [];
  const recent = log.filter((t) => t > Date.now() - WINDOW_MS);
  return recent.length < MAX_REQUESTS_PER_WINDOW;
}

async function logRequest(AsyncStorage: any) {
  if (!AsyncStorage) return;
  const raw = await AsyncStorage.getItem(REQUEST_LOG_KEY);
  const log: number[] = raw ? JSON.parse(raw) : [];
  const recent = log.filter((t) => t > Date.now() - WINDOW_MS);
  recent.push(Date.now());
  await AsyncStorage.setItem(REQUEST_LOG_KEY, JSON.stringify(recent));
}

export async function checkForUpdate(force = false): Promise<UpdateInfo | null> {
  const AsyncStorage = await getAsyncStorage();
  const currentVersion = Constants.expoConfig?.version ?? '0.0.0';
  const currentBuildNumber =
    Constants.expoConfig?.android?.versionCode ?? Number(Constants.nativeBuildVersion) ?? 0;

  if (!force && AsyncStorage) {
    const lastCheck = await AsyncStorage.getItem(LAST_CHECK_KEY);
    if (lastCheck && Date.now() - Number(lastCheck) < CHECK_INTERVAL_MS) return null;
  }

  if (!(await withinRequestBudget(AsyncStorage))) return null;

  try {
    await logRequest(AsyncStorage);
    if (AsyncStorage) await AsyncStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

    const res = await fetch(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const tag: string = data.tag_name;

    if (!isNewerVersion(currentVersion, currentBuildNumber, tag)) return null;

    if (!force && AsyncStorage) {
      const dismissed = await AsyncStorage.getItem(DISMISSED_KEY);
      if (dismissed === tag) return null;
    }

    const apkAsset = (data.assets || []).find((a: any) => a.name?.toLowerCase().endsWith('.apk'));
    if (!apkAsset) return null;

    return {
      tag,
      notes: data.body ?? '',
      apkUrl: apkAsset.browser_download_url,
      apkName: apkAsset.name,
      apkSize: apkAsset.size,
    };
  } catch {
    return null; // offline / GitHub hiccup — next cold start retries naturally
  }
}

export async function skipVersion(tag: string) {
  const AsyncStorage = await getAsyncStorage();
  if (AsyncStorage) await AsyncStorage.setItem(DISMISSED_KEY, tag);
}

// ─── APK download + install (Android self-update flow) ─────────────────────

const UPDATES_DIR = `${FileSystem.documentDirectory}updates/`;

/**
 * Downloads the release APK to local storage, reporting progress as a
 * 0-100 percentage (matches how the Settings/Library update modal renders it).
 * Returns the local file:// URI of the downloaded APK.
 */
export async function downloadApk(
  info: UpdateInfo,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const dirInfo = await FileSystem.getInfoAsync(UPDATES_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(UPDATES_DIR, { intermediates: true });
  }

  const destUri = `${UPDATES_DIR}${info.apkName}`;
  // Clear out any partial/stale download of the same file name first.
  const existing = await FileSystem.getInfoAsync(destUri);
  if (existing.exists) {
    await FileSystem.deleteAsync(destUri, { idempotent: true });
  }

  const downloadResumable = FileSystem.createDownloadResumable(
    info.apkUrl,
    destUri,
    {},
    (progressEvent) => {
      if (!onProgress) return;
      const { totalBytesWritten, totalBytesExpectedToWrite } = progressEvent;
      if (totalBytesExpectedToWrite > 0) {
        onProgress(Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100));
      }
    },
  );

  const result = await downloadResumable.downloadAsync();
  if (!result?.uri) {
    throw new Error('APK download did not complete');
  }
  return result.uri;
}

/**
 * Hands the downloaded APK off to Android's package installer. Requires a
 * content:// URI (not a raw file:// path) since Android 7+ blocks file://
 * across app boundaries — expo-file-system's FileProvider handles that.
 */
export async function installApk(fileUri: string): Promise<void> {
  const contentUri = await FileSystem.getContentUriAsync(fileUri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  });
}
