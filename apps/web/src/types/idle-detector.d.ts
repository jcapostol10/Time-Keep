// Minimal typings for the Idle Detection API (Chromium, secure contexts only).
// https://developer.mozilla.org/docs/Web/API/Idle_Detection_API

interface IdleDetector extends EventTarget {
  readonly userState: "active" | "idle" | null;
  readonly screenState: "locked" | "unlocked" | null;
  start(options?: { threshold?: number; signal?: AbortSignal }): Promise<void>;
}

interface IdleDetectorConstructor {
  new (): IdleDetector;
  requestPermission(): Promise<"granted" | "denied">;
}

interface Window {
  IdleDetector?: IdleDetectorConstructor;
}
