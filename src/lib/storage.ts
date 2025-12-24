export function safeLocalStorageSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e: any) {
    const msg = String(e?.message || e);
    const isQuota =
      e?.name === 'QuotaExceededError' ||
      msg.toLowerCase().includes('quota') ||
      msg.toLowerCase().includes('exceeded');

    if (isQuota) {
      // Free up space by removing the largest known keys first
      try {
        localStorage.removeItem('ai_practice_tests');
        localStorage.removeItem('ai_practice_results');
        localStorage.removeItem('pendingTestSubmission');
      } catch {
        // ignore
      }

      // Retry once
      try {
        localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }
}

export function safeLocalStorageGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
