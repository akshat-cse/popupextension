# Popup Window — Clean Tab Pop-out

A small Chromium extension for Brave. The toolbar action now opens the current page in a resizable, always-on-top **Document Picture-in-Picture (PiP)** window. Right-click a page to choose either the floating PiP view or **Pop up / merge this page (regular window)** for the original tab-moving popup behavior.

## Floating-window behavior

- Click the toolbar button or press **Alt+Shift+P** to open/close the current page's floating PiP view.
- PiP opens at a side-window-friendly size and remembers its size/position when reopened.
- The original tab remains open as the PiP opener; the floating view loads the same URL in an embedded frame and starts at the same scroll position. Closing the PiP does not close the original tab. Because it reloads the URL, unsaved in-memory page state may not carry over.
- If Chromium rejects the toolbar click as a page gesture, a small **Open floating window** button appears on the page. Click it once to complete the PiP launch.
- Right-click a page and choose **Pop up / merge this page (regular window)** to move the existing tab to/from an ordinary popup window.
- Right-click a web link and choose **Open this link in a pop-up window** for the regular popup behavior.

The browser's Document PiP window is the supported browser-native way to stay above other windows; the regular `chrome.windows.create({type: "popup"})` window cannot be pinned by a normal extension.

## Install in Brave

1. Open `brave://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this repository folder (the one containing `manifest.json`).
4. Pin **Popup Window** if you want quick access from the toolbar.

After changing extension files, use the reload button on its card in `brave://extensions`.

## Privacy and permissions

The extension requests `activeTab`, `scripting`, `contextMenus`, and `storage`. Temporary access to the active page is used only after you invoke the extension. The PiP setup reads its URL, title, and scroll position to load the floating frame; it does not read page text or send browsing data anywhere. The extension does not request permanent access to all sites. Session storage holds only source tab/window IDs, an insertion index, and the private-window flag required by regular-popup restore; it is cleared at the end of the browser session.

## Limitations

- Document PiP requires a recent desktop Chromium build (Chrome 116+; Brave versions based on a compatible Chromium release). If PiP is unavailable or the page cannot be injected, the toolbar action falls back to an ordinary popup.
- PiP is a separate floating view, not the original browser window. The opener tab must remain open, and the embedded page can behave differently from a top-level tab. Some sites block being framed; for those, use the regular popup context-menu action.
- Browser-owned screens such as `brave://` pages and the Web Store cannot be injected into or opened as ordinary web pages.

## Next iteration

Try the floating view on your everyday sites and tell me which ones behave poorly. Follow-ups could include a configurable default PiP size, opening same-site links in the floating view, or a visible close/restore control.
