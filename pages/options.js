import { MESSAGE_TYPES } from "../shared/constants.js";
import { reportPageError, installGlobalErrorHandlers } from "../shared/error-log.js";
import { ERROR_CODES, formatErrorLabel } from "../shared/errors.js";
import { sendRuntimeMessage } from "../shared/api.js";
import { normalizeDomainInput } from "../shared/domain.js";
import { initTheme } from "../shared/theme.js";

const elements = {
  lockBanner: document.querySelector("#lockBanner"),
  optionsNotice: document.querySelector("#optionsNotice"),
  whitelistTabButton: document.querySelector("#whitelistTabButton"),
  settingsTabButton: document.querySelector("#settingsTabButton"),
  whitelistPanel: document.querySelector("#whitelistPanel"),
  settingsPanel: document.querySelector("#settingsPanel"),
  searchInput: document.querySelector("#searchInput"),
  domainInput: document.querySelector("#domainInput"),
  includeSubdomainsInput: document.querySelector("#includeSubdomainsInput"),
  addDomainButton: document.querySelector("#addDomainButton"),
  presetContainer: document.querySelector("#presetContainer"),
  whitelistList: document.querySelector("#whitelistList"),
  saveWhitelistButton: document.querySelector("#saveWhitelistButton"),
  durationCapSelect: document.querySelector("#durationCapSelect"),
  cooldownEnabledInput: document.querySelector("#cooldownEnabledInput"),
  cooldownMinutesInput: document.querySelector("#cooldownMinutesInput"),
  themeContainer: document.querySelector("#themeContainer"),
  saveSettingsButton: document.querySelector("#saveSettingsButton")
};

let draftWhitelist = [];
let draftSettings = null;
let presets = [];
let durationCapOptions = [];
let themes = [];
let hasActiveSession = false;
let selectedTheme = "dark";

function showNotice(text, type = "error") {
  elements.optionsNotice.textContent = text;
  elements.optionsNotice.className = `notice ${type}`;
  elements.optionsNotice.classList.remove("hidden");
}

function clearNotice() {
  elements.optionsNotice.textContent = "";
  elements.optionsNotice.className = "notice hidden";
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function setActivePanel(panel) {
  const whitelistActive = panel === "whitelist";
  elements.whitelistTabButton.classList.toggle("active", whitelistActive);
  elements.settingsTabButton.classList.toggle("active", !whitelistActive);
  elements.whitelistPanel.classList.toggle("hidden", !whitelistActive);
  elements.settingsPanel.classList.toggle("hidden", whitelistActive);
}

function renderPresets() {
  elements.presetContainer.innerHTML = "";

  for (const preset of presets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = `${preset.label} 路 ${preset.domain}`;
    button.disabled = hasActiveSession;
    button.addEventListener("click", () => {
      const exists = draftWhitelist.some((entry) => entry.domain === preset.domain);

      if (!exists) {
        draftWhitelist.push({
          id: preset.id,
          domain: preset.domain,
          includeSubdomains: preset.includeSubdomains,
          source: "preset",
          createdAt: Date.now()
        });
        renderWhitelist();
      }
    });
    elements.presetContainer.appendChild(button);
  }
}

function renderWhitelist() {
  elements.whitelistList.innerHTML = "";
  const keyword = elements.searchInput.value.trim().toLowerCase();
  const filteredItems = draftWhitelist.filter((entry) => entry.domain.includes(keyword));

  if (!filteredItems.length) {
    const empty = document.createElement("div");
    empty.className = "notice";
    empty.textContent = keyword ? "没有匹配到任何白名单域名。" : "当前还没有白名单域名。";
    elements.whitelistList.appendChild(empty);
    return;
  }

  for (const entry of filteredItems) {
    const item = document.createElement("div");
    item.className = "list-item";

    const wrapper = document.createElement("div");
    wrapper.appendChild(createTextElement("div", "title", entry.domain));
    wrapper.appendChild(
      createTextElement("div", "subtitle", entry.includeSubdomains ? "包含子域名" : "仅当前域名")
    );

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "button ghost";
    removeButton.textContent = "删除";
    removeButton.disabled = hasActiveSession;
    removeButton.addEventListener("click", () => {
      draftWhitelist = draftWhitelist.filter((candidate) => candidate.id !== entry.id);
      renderWhitelist();
    });

    item.append(wrapper, removeButton);
    elements.whitelistList.appendChild(item);
  }
}

function renderDurationCapOptions() {
  elements.durationCapSelect.innerHTML = "";

  for (const option of durationCapOptions) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    elements.durationCapSelect.appendChild(element);
  }
}

function renderThemes() {
  elements.themeContainer.innerHTML = "";

  for (const theme of themes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chip${theme.value === selectedTheme ? " selected" : ""}`;
    button.textContent = theme.label;
    button.disabled = hasActiveSession;
    button.addEventListener("click", () => {
      selectedTheme = theme.value;
      renderThemes();
    });
    elements.themeContainer.appendChild(button);
  }
}

function renderSettings() {
  renderDurationCapOptions();
  elements.durationCapSelect.value = draftSettings.customDurationCapOption;
  elements.cooldownEnabledInput.checked = Boolean(draftSettings.unlockCooldownEnabled);
  elements.cooldownMinutesInput.value = String(draftSettings.unlockCooldownMinutes);
  elements.cooldownMinutesInput.disabled = !elements.cooldownEnabledInput.checked || hasActiveSession;
  selectedTheme = draftSettings.theme;
  renderThemes();
}

function syncLockState() {
  elements.lockBanner.classList.toggle("hidden", !hasActiveSession);

  if (hasActiveSession) {
    elements.lockBanner.textContent = "专注进行中，白名单和设置当前处于只读状态。";
  }

  const controls = document.querySelectorAll("input, textarea, select, button");
  for (const control of controls) {
    if (
      control === elements.whitelistTabButton ||
      control === elements.settingsTabButton ||
      control === elements.searchInput
    ) {
      continue;
    }

    control.disabled = hasActiveSession;
  }

  elements.cooldownMinutesInput.disabled = !elements.cooldownEnabledInput.checked || hasActiveSession;
}

function refreshLockState(nextHasActiveSession, { showReadonlyNotice = false } = {}) {
  const wasLocked = hasActiveSession;
  hasActiveSession = Boolean(nextHasActiveSession);

  if (!draftSettings) {
    return;
  }

  renderPresets();
  renderWhitelist();
  renderSettings();
  syncLockState();

  if (!wasLocked && hasActiveSession && showReadonlyNotice) {
    showNotice("专注已开始，当前页面已切换为只读状态。", "warning");
  }
}

function collectSettings() {
  return {
    theme: selectedTheme,
    customDurationCapOption: elements.durationCapSelect.value,
    unlockCooldownEnabled: elements.cooldownEnabledInput.checked,
    unlockCooldownMinutes: Number(elements.cooldownMinutesInput.value)
  };
}

async function saveAll() {
  clearNotice();

  try {
    const nextSettings = collectSettings();
    const response = await sendRuntimeMessage(MESSAGE_TYPES.SAVE_OPTIONS, {
      whitelistEntries: draftWhitelist,
      settings: nextSettings
    });

    draftWhitelist = response.whitelistEntries;
    draftSettings = response.settings;
    renderWhitelist();
    renderSettings();
    showNotice("保存成功。", "success");
  } catch (error) {
    showNotice(formatErrorLabel(error), "error");
  }
}

async function loadOptions() {
  const data = await sendRuntimeMessage(MESSAGE_TYPES.GET_OPTIONS_DATA);
  draftWhitelist = [...data.whitelistEntries];
  draftSettings = { ...data.settings };
  presets = data.presets;
  durationCapOptions = data.durationCapOptions;
  themes = data.themes;
  hasActiveSession = Boolean(data.hasActiveSession);

  renderPresets();
  renderWhitelist();
  renderSettings();
  syncLockState();
}

elements.whitelistTabButton.addEventListener("click", () => setActivePanel("whitelist"));

elements.settingsTabButton.addEventListener("click", () => setActivePanel("settings"));

elements.searchInput.addEventListener("input", () => renderWhitelist());

elements.addDomainButton.addEventListener("click", () => {
  clearNotice();
  const domain = normalizeDomainInput(elements.domainInput.value ?? "");

  if (!domain) {
    const error = {
      code: ERROR_CODES.SETTINGS_DOMAIN_INVALID,
      message: "请输入合法域名，不能包含协议、路径或端口。"
    };
    void reportPageError(error, "pages/options:add-domain", { kind: "validation" });
    showNotice(formatErrorLabel(error), "error");
    return;
  }

  const exists = draftWhitelist.some((entry) => entry.domain === domain);

  if (exists) {
    const error = {
      code: ERROR_CODES.SETTINGS_DOMAIN_DUPLICATE,
      message: `白名单中已存在域名：${domain}`
    };
    void reportPageError(error, "pages/options:add-domain", { kind: "validation", domain });
    showNotice(formatErrorLabel(error), "error");
    return;
  }

  draftWhitelist.unshift({
    id: crypto.randomUUID(),
    domain,
    includeSubdomains: elements.includeSubdomainsInput.checked,
    source: "custom",
    createdAt: Date.now()
  });
  elements.domainInput.value = "";
  renderWhitelist();
});

elements.cooldownEnabledInput.addEventListener("change", () => {
  elements.cooldownMinutesInput.disabled = !elements.cooldownEnabledInput.checked || hasActiveSession;
});

elements.saveWhitelistButton.addEventListener("click", saveAll);

elements.saveSettingsButton.addEventListener("click", saveAll);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.currentSession) {
    return;
  }

  refreshLockState(Boolean(changes.currentSession.newValue), {
    showReadonlyNotice: !Boolean(changes.currentSession.oldValue) && Boolean(changes.currentSession.newValue)
  });
});

installGlobalErrorHandlers("pages/options");
await initTheme();
try {
  await loadOptions();
} catch (error) {
  showNotice(formatErrorLabel(error), "error");
}
