export type UiDensity = "comfortable" | "compact";

export type UiPreferences = {
  density: UiDensity;
  reduceAnimation: boolean;
};

const STORAGE_KEY = "nodeshell_ui_preferences";
const defaults: UiPreferences = { density: "comfortable", reduceAnimation: false };

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function getUiPreferences(): UiPreferences {
  if (typeof window === "undefined") return defaults;
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<UiPreferences>;
    return {
      density: value.density === "compact" ? "compact" : "comfortable",
      reduceAnimation: typeof value.reduceAnimation === "boolean" ? value.reduceAnimation : prefersReducedMotion(),
    };
  } catch {
    return { ...defaults, reduceAnimation: prefersReducedMotion() };
  }
}

export function saveUiPreferences(preferences: UiPreferences): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  applyUiPreferences(preferences);
}

export function applyUiPreferences(preferences = getUiPreferences(), root?: HTMLElement): void {
  if (typeof document === "undefined") return;
  const element = root ?? document.documentElement;
  element.dataset.density = preferences.density;
  element.dataset.reduceAnimation = String(preferences.reduceAnimation);
}
