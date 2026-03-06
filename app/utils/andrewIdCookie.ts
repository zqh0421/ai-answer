const ANDREW_ID_COOKIE_KEY = "andrew_id";
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
  if (typeof document === "undefined") return null;
  const value = parseCookieValue(document.cookie || "", ANDREW_ID_COOKIE_KEY);
  const normalized = value?.trim() || "";
  return normalized || null;
};

export const setAndrewIdCookie = (andrewId: string): void => {
  if (typeof document === "undefined") return;
  const normalized = andrewId.trim();
  if (!normalized) return;
  const encodedValue = encodeURIComponent(normalized);
  document.cookie = `${ANDREW_ID_COOKIE_KEY}=${encodedValue}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("andrew-id-updated", { detail: { andrewId: normalized } }));
  }
};
