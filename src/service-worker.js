const PAGE_MENU_ID = "toggle-current-page";
const PIP_PAGE_MENU_ID = "open-page-in-pip";
const LINK_MENU_ID = "open-link-in-popup";
const RESTORE_KEY_PREFIX = "restore-target:";

// storage.session survives service-worker suspension but is cleared when the
// browser session ends. We only keep tab/window IDs and an insertion index —
// never page URLs or content.
const inMemoryRestoreTargets = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      console.warn("Could not reset Popup Window context menus:", chrome.runtime.lastError.message);
      return;
    }

    chrome.contextMenus.create({
      id: PIP_PAGE_MENU_ID,
      title: "Open this page in an always-on-top window",
      contexts: ["page"]
    });
    chrome.contextMenus.create({
      id: PAGE_MENU_ID,
      title: "Pop up / merge this page (regular window)",
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
  runSafely(() => openPageInPictureInPicture(tab));
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-current-tab") return;
  runSafely(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await openPageInPictureInPicture(tab);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === PIP_PAGE_MENU_ID) {
    runSafely(() => openPageInPictureInPicture(tab));
    return;
  }

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

async function openPageInPictureInPicture(tab) {
  if (!tab || !Number.isInteger(tab.id) || !Number.isInteger(tab.windowId)) return;

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: openDocumentPipForCurrentPage
    });

    if (injection?.result?.status === "unsupported") {
      // Keep the extension useful on older Chromium builds and browser-owned
      // pages that do not expose Document Picture-in-Picture.
      await toggleCurrentTab(tab);
    }
  } catch (error) {
    console.warn("Could not open a floating PiP view; trying a regular popup instead:", error);
    await toggleCurrentTab(tab);
  }
}

// This function is serialized into the page's main world by chrome.scripting.
// Calling requestWindow immediately preserves the toolbar/context-menu gesture
// where Chromium allows it. If the page does not receive that activation, a
// small in-page button offers a second, genuine page click to launch PiP.
function openDocumentPipForCurrentPage() {
  const pipApi = window.documentPictureInPicture;
  if (!pipApi || !/^https?:$/.test(window.location.protocol)) {
    return { status: "unsupported" };
  }

  if (pipApi.window) {
    const existingWindow = pipApi.window;
    const isOurWindow = existingWindow.document.documentElement?.getAttribute("data-popup-window-pip") === "true";
    if (isOurWindow) {
      existingWindow.close();
      return { status: "closed" };
    }
    // Do not close a PiP window owned by the website (for example, a call UI).
    return { status: "already-open" };
  }

  const pageUrl = window.location.href;
  const pageTitle = document.title || "Floating page";
  const initialScrollX = window.scrollX;
  const initialScrollY = window.scrollY;
  const launcherId = "__popup-window-pip-launcher__";

  function openPipWindow() {
    let request;
    try {
      // The browser remembers the PiP window's size and position when it is
      // reopened, so users can keep their preferred side-window layout.
      request = pipApi.requestWindow({ width: 560, height: 720 });
    } catch (error) {
      return Promise.reject(error);
    }

    return request.then((pipWindow) => {
      const pipDocument = pipWindow.document;
      pipDocument.title = pageTitle;
      pipDocument.documentElement.setAttribute("data-popup-window-pip", "true");
      pipDocument.documentElement.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;";
      pipDocument.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#111;";

      const frame = pipDocument.createElement("iframe");
      frame.src = pageUrl;
      frame.title = pageTitle;
      frame.allow = "camera; microphone; clipboard-read; clipboard-write; fullscreen";
      frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:#fff;";
      frame.addEventListener("load", () => {
        try {
          frame.contentWindow.scrollTo(initialScrollX, initialScrollY);
        } catch {
          // A site with unusual frame restrictions may not expose the frame.
        }
      }, { once: true });
      pipDocument.body.replaceChildren(frame);
      return pipWindow;
    });
  }

  function showPageClickLauncher() {
    if (!document.documentElement || document.getElementById(launcherId)) return;

    const button = document.createElement("button");
    button.id = launcherId;
    button.type = "button";
    button.textContent = "Open floating window";
    button.title = "Click to open this page in an always-on-top window";
    button.style.cssText = [
      "position:fixed!important",
      "top:16px!important",
      "right:16px!important",
      "z-index:2147483647!important",
      "padding:10px 14px!important",
      "border:0!important",
      "border-radius:10px!important",
      "background:#4a59db!important",
      "color:#fff!important",
      "font:600 14px/1.2 system-ui,sans-serif!important",
      "box-shadow:0 3px 14px rgba(0,0,0,.3)!important",
      "cursor:pointer!important"
    ].join(";");

    button.addEventListener("click", () => {
      button.disabled = true;
      button.textContent = "Opening…";
      openPipWindow()
        .then(() => button.remove())
        .catch(() => {
          button.disabled = false;
          button.textContent = "Try floating window again";
        });
    });

    document.documentElement.appendChild(button);
  }

  // Do not await before this call: requestWindow requires a transient user
  // activation. If Chromium rejects the toolbar gesture in the page context,
  // the catch path presents a button whose click is a page-originating gesture.
  openPipWindow().catch(showPageClickLauncher);
  return { status: "requested" };
}

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
