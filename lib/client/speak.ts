// Spoken announcements through the browser's built-in speech synthesis.
// Everything here is best-effort: no speech support, or a browser that blocks
// speech before the first click, just means silence.

const MUTE_KEY = "ask-voice-muted";

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Private window or blocked storage: the choice just won't be remembered.
  }
}

// Cancels whatever is still being said first, so a 1-second countdown never queues up.
export function speak(text: string): void {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch {
    // Ignore: speech is a nicety.
  }
}

// For output that should follow the person's Voice on/off choice (read fresh
// each time, since more than one card on the page can speak).
export function sayIfUnmuted(text: string): void {
  if (!readMuted()) speak(text);
}

export function stopSpeaking(): void {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Ignore.
  }
}
