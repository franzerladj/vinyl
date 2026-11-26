// Hintergrund-Skript: beantwortet die Fragen der Oberflächen (Feld auf Discogs, Suchfenster, Einblendung),
// legt den Eintrag im Rechtsklick-Menü an und hält die Zahl am Symbol aktuell.
import { CRATE, DISCOGS_SITE } from "./config.js";
import * as api from "./api.js";

const handlers = {
  me: () => api.me(),
  release: ({ id }) => api.release(Number(id)),
  master: ({ id }) => api.master(Number(id)),
  search: ({ q }) => api.search(q),
  want: ({ id, on }) => api.setWant(Number(id), Boolean(on)),
  counts: () => refreshBadge(),
  urls: () => ({ crate: CRATE, discogs: DISCOGS_SITE }),
};

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  Promise.resolve()
    .then(() => h(msg))
    .then(
      (data) => reply({ ok: true, data }),
      (e) => reply({ ok: false, signedOut: e?.name === "NotSignedIn", error: String(e?.message ?? e) }),
    );
  return true; // Antwort kommt später
});

async function refreshBadge() {
  const c = await api.counts().catch(() => null);
  await chrome.action.setBadgeBackgroundColor({ color: "#c6ff3a" });
  await chrome.action.setBadgeTextColor?.({ color: "#0b0b0b" });
  await chrome.action.setBadgeText({ text: c?.n ? String(Math.min(c.n, 99)) : "" });
  return c;
}

function setup() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "crate-look", title: "In Crate nachsehen: „%s“", contexts: ["selection"] });
  });
  chrome.alarms.create("crate-badge", { periodInMinutes: 15 });
  void refreshBadge();
}
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener((a) => a.name === "crate-badge" && void refreshBadge());

// Rechtsklick auf markierten Text: Einblendung auf der Seite. Von der Seite selbst wird nichts gelesen,
// der Browser reicht nur den markierten Text durch.
async function lookOnTab(tabId, q) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["panel.js", "overlay.js"] });
    await chrome.tabs.sendMessage(tabId, { type: "crate-overlay", q });
  } catch {
    // Seiten, auf denen Erweiterungen nichts einblenden dürfen (Chrome Web Store, interne Seiten): eigenes Fenster
    await chrome.windows.create({ url: chrome.runtime.getURL(`popup.html?q=${encodeURIComponent(q)}`), type: "popup", width: 420, height: 640 });
  }
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const q = String(info.selectionText ?? "").trim();
  if (info.menuItemId === "crate-look" && tab?.id && q) void lookOnTab(tab.id, q);
});
// Für den Browser-Test (das Rechtsklick-Menü lässt sich dort nicht bedienen)
self.crateLook = lookOnTab;
