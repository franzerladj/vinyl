// Erscheinungsbild: System, Hell oder Dunkel. Wird pro Gerät gespeichert.
export type Theme = "system" | "light" | "dark";

export const getTheme = (): Theme => {
  try {
    return (localStorage.getItem("crate:theme") as Theme) || "system";
  } catch {
    return "system";
  }
};

export function applyTheme(t: Theme = getTheme()) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#16120f" : "#efe8dc"));
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem("crate:theme", t);
  } catch {
    /* egal */
  }
  applyTheme(t);
}

export const hapticsEnabled = () => {
  try {
    return localStorage.getItem("crate:haptics") !== "off";
  } catch {
    return true;
  }
};
export const setHaptics = (on: boolean) => {
  try {
    localStorage.setItem("crate:haptics", on ? "on" : "off");
  } catch {
    /* egal */
  }
};

/** Einwilligung für YouTube: "yes" = Videos direkt laden, "no" = erst nach Antippen, null = noch nicht gefragt */
export type YtConsent = "yes" | "no" | null;
export const ytConsent = (): YtConsent => {
  try {
    return (localStorage.getItem("crate:yt") as YtConsent) ?? null;
  } catch {
    return null;
  }
};
export const setYtConsent = (v: "yes" | "no") => {
  try {
    localStorage.setItem("crate:yt", v);
  } catch {
    /* egal */
  }
  window.dispatchEvent(new Event("crate:yt"));
};
