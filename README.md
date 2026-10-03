# Popup Window — Clean Tab Pop-out

A small, independently implemented Chromium extension for Brave. It recreates the core workflow described by the linked **Popup window** extension:

- Click the toolbar button to move the current tab into a minimal popup window.
- Right-click a page and choose **Pop up / merge this page** to toggle it between a popup and a regular browser window.
- Right-click a web link and choose **Open this link in a pop-up window** to open it directly in a popup.
- Use **Alt+Shift+P** to toggle the active tab (the shortcut can be changed in Brave's extension-shortcuts page).

When restoring a tab, the extension tries to put it back in the window and position it came from. If that window has been closed, it uses another regular window of the same privacy mode, or creates one. It moves the existing tab rather than making a duplicate.

## Install in Brave

1. Open `brave://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this repository folder (the one containing `manifest.json`).
4. Pin **Popup Window** if you want quick access from the toolbar.

After changing extension files, use the reload button on its card in `brave://extensions`.

## Privacy and permissions

The extension requests only `contextMenus` and `storage`; it does not request site access or read page contents. Session storage holds only the source tab/window IDs, tab index, and private-window flag needed for restoring a popped-out tab. It is cleared when the browser session ends. Link opening is restricted to `http` and `https` URLs.

## Known limitations

- Browser- and operating-system-owned screens (for example, `brave://` pages, the Web Store, and some internal pages) cannot be moved/opened as ordinary web tabs.
- A popup window has reduced browser chrome by design. Use the page context menu or the keyboard shortcut to restore its tab; keyboard shortcuts can also be customized at `brave://extensions/shortcuts`.
- Popup dimensions are left to the browser/OS defaults in this first version.

## Next iteration

Try it for a bit and tell me what feels missing—common follow-ups are remembered window size/position, per-site behavior, a configurable shortcut, or a clearer one-click restore flow. This version is deliberately kept small so those changes can follow your actual workflow.
