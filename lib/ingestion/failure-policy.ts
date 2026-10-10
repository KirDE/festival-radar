export const FAILURE_INTERVALS_SECONDS = [3600, 21600, 86400, 259200, 604800] as const;
export const DEPRECATED_AFTER_MS = 21 * 86400000;
export function failureRetryAt(failures: number, now = new Date()): Date {
  if (!Number.isSafeInteger(failures) || failures < 1 || !Number.isFinite(now.getTime())) throw new Error('Invalid failure schedule');
  return new Date(now.getTime() + FAILURE_INTERVALS_SECONDS[Math.min(failures - 1, 4)] * 1000);
}
