import { VERSION } from './version.mjs';

export const defaultSettings = () => ({ notifyBefore: '12小时', useBefore: '永不使用' });
export function platformSupport(platform = process.platform) {
  const supported = platform === 'win32';
  const os = platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform;
  return { platform, supported, supportMessage: supported ? ''
    : `当前版本仅支持 Windows，暂不支持 ${os}。系统通知和自动使用暂不可用。` };
}
export function requireWindows(platform = process.platform) {
  const support = platformSupport(platform);
  if (!support.supported) throw new Error(support.supportMessage);
}
export async function routePlatformRequest(method, params, execute, platform = process.platform) {
  const support = platformSupport(platform);
  if (!support.supported) {
    if (method === 'readSettings') return defaultSettings();
    if (method === 'status' || method === 'refresh') return {
      ...support, ...defaultSettings(), workerVersion: VERSION, runtimeActive: false,
      enabled: false, reminderEnabled: false, detailsAvailable: false, cards: [],
      availableCount: null, unreadCount: 0, notifications: [], error: null,
    };
    throw new Error(support.supportMessage);
  }
  const value = await execute(method, params);
  return value?.workerVersion ? { ...value, ...support } : value;
}
