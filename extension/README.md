# Nolane Browser Companion (Chrome MV3)

The extension bridges selected Chrome tabs into Nolane Infinite. It deliberately does **not** read cookies, passwords, local storage, page text, screenshots or service tokens.

## Install locally

1. Download or clone this repository.
2. Open chrome://extensions in Chrome.
3. Turn on **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository's extension/ folder.
6. Open https://nolane-x.github.io/web-view/ and refresh the page.
7. Click the Nolane Companion toolbar icon.
8. Choose **Grant tab-list permission**. Chrome will show its permission prompt.
9. Select the tabs you want, then click **Import selected**.

## What the permission means

The optional tabs permission is requested only after the user clicks the grant button in the extension popup. It allows the popup to enumerate open browser tabs and read their URLs/titles so the user can choose what to import.

Before import, the extension removes URL fragments and query parameters whose names resemble credentials, tokens, signatures, passwords, authorization codes or session IDs. This is a best-effort filter, not a guarantee that every secret-looking value can be identified; review the tabs you select.

The extension sends only the selected tab ID, window ID, sanitized URL and title to the Nolane page. The browser keeps each website session in its original Chrome tab. Clicking **Switch to Chrome tab** focuses that tab; the workspace does not copy its login session into an iframe.

## Limitations

- Tab IDs are temporary browser identifiers. If Chrome restarts or a tab is closed, the card falls back to opening its URL.
- This does not embed the page's live DOM in the canvas. It focuses the original Chrome tab.
- Some websites block iframe embedding. Use the original tab for authenticated services.
- The extension currently targets the published GitHub Pages origin. A different deployment origin requires updating the match pattern and origin constants in manifest.json, content.js and the website code.

## Permissions

- tabs is optional and requested interactively.
- No cookies, webRequest, debugger, history, scripting or broad host permissions are requested.
- The content script only runs on https://nolane-x.github.io/web-view/*.
