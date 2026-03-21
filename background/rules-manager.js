import { PAGE_PATHS } from "../shared/constants.js";
import { isUrlAllowed } from "../shared/domain.js";
import { recordBlockAttempt } from "./stats-manager.js";

function buildAllowRule(entry, id) {
  const escapedDomain = entry.domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hostPattern = entry.includeSubdomains ? `(?:[a-z0-9-]+\\.)*${escapedDomain}` : escapedDomain;

  return {
    id,
    priority: 100,
    action: {
      type: "allow"
    },
    condition: {
      regexFilter: `^https?://${hostPattern}(?::\\d+)?(?:/|$)`,
      resourceTypes: ["main_frame"]
    }
  };
}

function buildRedirectRule() {
  return {
    id: 1,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        extensionPath: `/${PAGE_PATHS.BLOCK}`
      }
    },
    condition: {
      regexFilter: "^https?://",
      resourceTypes: ["main_frame"]
    }
  };
}

export async function clearFocusRules() {
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();

  if (!existingRules.length) {
    return;
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingRules.map((rule) => rule.id)
  });
}

export async function applyFocusRules(session) {
  await clearFocusRules();

  if (!session || (session.allowAllUntil ?? 0) > Date.now()) {
    return;
  }

  const rules = session.whitelistSnapshot.map((entry, index) => buildAllowRule(entry, 1000 + index));
  rules.push(buildRedirectRule());

  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: rules,
    removeRuleIds: []
  });
}

export async function scanAndBlockExistingTabs(session) {
  if (!session || (session.allowAllUntil ?? 0) > Date.now()) {
    return;
  }

  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (!tab.id || !tab.url) {
      continue;
    }

    if (!/^https?:/i.test(tab.url)) {
      continue;
    }

    if (isUrlAllowed(tab.url, session.whitelistSnapshot)) {
      continue;
    }

    await recordBlockAttempt({
      tabId: tab.id,
      url: tab.url,
      source: "existing_tab"
    });

    await chrome.tabs.update(tab.id, {
      url: chrome.runtime.getURL(`${PAGE_PATHS.BLOCK}?source=existing-tab`)
    });
  }
}
