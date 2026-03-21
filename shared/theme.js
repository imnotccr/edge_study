import { readState } from "./storage.js";

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
}

export async function initTheme() {
  const state = await readState();
  applyTheme(state.settings.theme);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.settings?.newValue) {
      return;
    }

    applyTheme(changes.settings.newValue.theme);
  });
}
