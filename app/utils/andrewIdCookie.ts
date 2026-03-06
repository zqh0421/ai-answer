const ANDREW_ID_COOKIE_KEY = "andrew_id";
const ANDREW_ID_LOCAL_STORAGE_KEY = "andrew_id";
const ANDREW_ID_SESSION_STORAGE_KEY = "andrew_id";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const parseCookieValue = (cookieString: string, key: string): string | null => {
  const pairs = cookieString.split(";").map((part) => part.trim());
  for (const pair of pairs) {
    if (!pair) continue;
    const eqIndex = pair.indexOf("=");
    if (eqIndex <= 0) continue;
    const cookieKey = decodeURIComponent(pair.slice(0, eqIndex));
    if (cookieKey !== key) continue;
    return decodeURIComponent(pair.slice(eqIndex + 1));
  }
  return null;
};

export const getAndrewIdFromCookie = (): string | null => {
  if (typeof window === "undefined") return null;

  const cookieValue = parseCookieValue(document.cookie || "", ANDREW_ID_COOKIE_KEY);
  const normalizedCookieValue = cookieValue?.trim() || "";
  if (normalizedCookieValue) {
    try {
      window.localStorage.setItem(ANDREW_ID_LOCAL_STORAGE_KEY, normalizedCookieValue);
      window.sessionStorage.setItem(ANDREW_ID_SESSION_STORAGE_KEY, normalizedCookieValue);
    } catch {
      // Ignore storage failures (private mode / iframe restrictions).
    }
    return normalizedCookieValue;
  }

  try {
    const localValue = (window.localStorage.getItem(ANDREW_ID_LOCAL_STORAGE_KEY) || "").trim();
    if (localValue) return localValue;
  } catch {
    // Ignore and continue fallback chain.
  }

  try {
    const sessionValue = (window.sessionStorage.getItem(ANDREW_ID_SESSION_STORAGE_KEY) || "").trim();
    if (sessionValue) return sessionValue;
  } catch {
    // Ignore and continue fallback chain.
  }

  return null;
};

export const setAndrewIdCookie = (andrewId: string): void => {
  if (typeof window === "undefined") return;
  const normalized = andrewId.trim();
  if (!normalized) return;
  const encodedValue = encodeURIComponent(normalized);

  try {
    document.cookie = `${ANDREW_ID_COOKIE_KEY}=${encodedValue}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  } catch {
    // Ignore cookie failures (common in third-party iframe contexts).
  }

  try {
    window.localStorage.setItem(ANDREW_ID_LOCAL_STORAGE_KEY, normalized);
  } catch {
    // Ignore localStorage failures and continue.
  }

  try {
    window.sessionStorage.setItem(ANDREW_ID_SESSION_STORAGE_KEY, normalized);
  } catch {
    // Ignore sessionStorage failures and continue.
  }

  window.dispatchEvent(new CustomEvent("andrew-id-updated", { detail: { andrewId: normalized } }));
};
