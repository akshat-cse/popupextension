const PAGE_MENU_ID = "toggle-current-page";
const LINK_MENU_ID = "open-link-in-popup";
const RESTORE_KEY_PREFIX = "restore-target:";

// storage.session survives service-worker suspension but is cleared when the
// browser session ends. We only keep tab/window IDs and an insertion index —
// never page URLs or content.
const inMemoryRestoreTargets = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      console.warn("Could not reset popup-window context menus:", chrome.runtime.lastError.message);
      return;
    }

    chrome.contextMenus.create({
      id: PAGE_MENU_ID,
      title: "Pop up / merge this page",
      contexts: ["page"]
    });
    chrome.contextMenus.create({
      id: LINK_MENU_ID,
      title: "Open this link in a pop-up window",
      contexts: ["link"]
    });
  });
});

chrome.action.onClicked.addListener((tab) => {
  runSafely(() => toggleCurrentTab(tab));
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-current-tab") return;
  runSafely(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await toggleCurrentTab(tab);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === PAGE_MENU_ID) {
    runSafely(() => toggleCurrentTab(tab));
    return;
  }

  if (info.menuItemId === LINK_MENU_ID) {
    runSafely(() => openLinkInPopup(info.linkUrl, tab));
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  runSafely(() => forgetRestoreTarget(tabId));
});

async function toggleCurrentTab(tab) {
  if (!tab || !Number.isInteger(tab.id) || !Number.isInteger(tab.windowId)) return;

  const currentWindow = await chrome.windows.get(tab.windowId);
  if (currentWindow.type === "normal") {
    await popOutExistingTab(tab, currentWindow);
  } else if (currentWindow.type === "popup") {
    await restorePopupTab(tab, currentWindow);
  }
}

async function popOutExistingTab(tab, sourceWindow) {
  const restoreTarget = makeRestoreTarget(tab, sourceWindow);
  await saveRestoreTarget(tab.id, restoreTarget);

  try {
    await chrome.windows.create({
      tabId: tab.id,
      type: "popup",
      focused: true,
      incognito: Boolean(sourceWindow.incognito)
    });
  } catch (error) {
    await forgetRestoreTarget(tab.id);
    throw error;
  }
}

async function openLinkInPopup(linkUrl, sourceTab) {
  const safeUrl = asWebUrl(linkUrl);
  if (!safeUrl) {
    console.warn("Popup Window only opens http(s) links.");
    return;
  }

  const sourceWindow = sourceTab?.windowId != null
    ? await chrome.windows.get(sourceTab.windowId)
    : null;
  const popup = await chrome.windows.create({
    url: safeUrl,
    type: "popup",
    focused: true,
    ...(sourceWindow ? { incognito: Boolean(sourceWindow.incognito) } : {})
  });

  if (!sourceTab || !Number.isInteger(sourceTab.id) || !Number.isInteger(popup.id)) return;

  const [popupTab] = await chrome.tabs.query({ windowId: popup.id });
  if (!popupTab || !Number.isInteger(popupTab.id)) return;

  await saveRestoreTarget(popupTab.id, makeRestoreTarget(sourceTab, sourceWindow));
}

async function restorePopupTab(tab, popupWindow) {
  const restoreTarget = await loadRestoreTarget(tab.id);
  const targetWindow = await findRestoreWindow(restoreTarget, popupWindow);

  if (!targetWindow) {
    // No regular window is open (or the original one has gone away). Re-home
    // the existing tab in a fresh normal window rather than duplicating it.
    await chrome.windows.create({
      tabId: tab.id,
      type: "normal",
      focused: true,
      incognito: Boolean(popupWindow.incognito)
    });
    await forgetRestoreTarget(tab.id);
    return;
  }

  const targetTabs = await chrome.tabs.query({ windowId: targetWindow.id });
  const sourceTab = restoreTarget?.sourceTabId == null
    ? undefined
    : targetTabs.find((candidate) => candidate.id === restoreTarget.sourceTabId);
  const fallbackIndex = restoreTarget?.sourceIndex ?? targetTabs.length;
  const requestedIndex = sourceTab
    ? sourceTab.index + 1
    : fallbackIndex;
  const index = Math.max(0, Math.min(requestedIndex, targetTabs.length));

  await chrome.tabs.move(tab.id, { windowId: targetWindow.id, index });
  await chrome.windows.update(targetWindow.id, { focused: true });
  await forgetRestoreTarget(tab.id);
}

async function findRestoreWindow(restoreTarget, popupWindow) {
  const expectedIncognito = restoreTarget?.incognito ?? Boolean(popupWindow.incognito);

  if (restoreTarget?.sourceWindowId != null) {
    try {
      const originalWindow = await chrome.windows.get(restoreTarget.sourceWindowId);
      const supportedType = originalWindow.type === "normal" || originalWindow.type === "popup";
      if (supportedType && Boolean(originalWindow.incognito) === expectedIncognito) {
        return originalWindow;
      }
    } catch {
      // The original window was closed. Fall through to another compatible
      // window, or create a new one if none exists.
    }
  }

  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  return windows.find((window) => Boolean(window.incognito) === expectedIncognito) ?? null;
}

function makeRestoreTarget(tab, sourceWindow) {
  return {
    sourceWindowId: tab.windowId,
    sourceTabId: tab.id,
    sourceIndex: Number.isInteger(tab.index) ? tab.index : 0,
    incognito: Boolean(sourceWindow?.incognito ?? tab.incognito)
  };
}

function asWebUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

async function saveRestoreTarget(tabId, target) {
  const key = `${RESTORE_KEY_PREFIX}${tabId}`;
  inMemoryRestoreTargets.set(tabId, target);
  if (chrome.storage?.session) {
    await chrome.storage.session.set({ [key]: target });
  }
}

async function loadRestoreTarget(tabId) {
  if (inMemoryRestoreTargets.has(tabId)) return inMemoryRestoreTargets.get(tabId);

  const key = `${RESTORE_KEY_PREFIX}${tabId}`;
  if (!chrome.storage?.session) return null;
  const stored = await chrome.storage.session.get(key);
  return stored[key] ?? null;
}

async function forgetRestoreTarget(tabId) {
  inMemoryRestoreTargets.delete(tabId);
  if (chrome.storage?.session) {
    await chrome.storage.session.remove(`${RESTORE_KEY_PREFIX}${tabId}`);
  }
}

function runSafely(task) {
  Promise.resolve()
    .then(task)
    .catch((error) => console.error("Popup Window action failed:", error));
}
