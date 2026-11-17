// Ein Audio-Element fürs Diggen, das die ganze Sitzung lebt. Das iPhone spielt Ton nur, wenn das
// Element einmal in einer Berührung gestartet wurde. Darum wird es bei der ersten Berührung
// irgendwo in der App stumm angespielt: danach laufen Hörproben beim Diggen von selbst.
let el: HTMLAudioElement | null = null;
let unlocked = false;

// Eine Zehntelsekunde Stille (WAV), damit kein Netz nötig ist
const SILENCE = "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

export function digAudio(): HTMLAudioElement {
  if (!el) {
    el = new Audio();
    el.preload = "auto";
    el.loop = true;
    el.setAttribute("playsinline", "");
  }
  return el;
}

export const digAudioUnlocked = () => unlocked;
export const markDigAudioUnlocked = () => void (unlocked = true);

/** Bei der ersten Berührung aufrufen (aus dem Ereignis heraus) */
export function unlockDigAudio() {
  if (unlocked) return;
  const a = digAudio();
  // Läuft schon etwas (Diggen ist offen), nicht dazwischenfunken
  if (a.src && !a.src.startsWith("data:")) return;
  a.muted = true;
  a.src = SILENCE;
  a.play().then(
    () => {
      unlocked = true;
      a.muted = false;
      // Hat das Diggen inzwischen schon eine Hörprobe geladen, die nicht anhalten
      if (a.src.startsWith("data:")) {
        a.pause();
        a.removeAttribute("src");
      }
    },
    () => {
      a.muted = false;
    },
  );
}
