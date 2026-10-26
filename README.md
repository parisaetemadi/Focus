# Just Focus

A Chrome extension that blocks the sites you name, for as long as you say.
Manifest V3, plain JS, no build step, nothing leaves the browser.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → pick this folder.
3. Pin the icon so the badge (minutes left) is visible.

## Use

- Click the icon, pick **25 / 50 / 90 min** or **Until I stop**, hit **Start focus**.
- While a session runs, any page on your list redirects to a blocked screen
  that shows the time left. Open tabs on those sites reload into it too.
- **End focus** stops it — in the popup or from the blocked page. No lockout,
  no password; it's a speed bump against habit, not a prison.
- Edit the list under **Blocked sites**: one domain per line. Subdomains are
  covered, so `reddit.com` also blocks `old.reddit.com`.

## How it works

| File | Job |
| --- | --- |
| `background.js` | Turns a session into `declarativeNetRequest` redirect rules; owns the badge, the end alarm, and the stored state. |
| `popup.*` | Start/stop, countdown, list editor. |
| `blocked.*` | The page you land on, with the time left. |

Blocking happens in Chrome's network layer, so a blocked request never loads —
the extension doesn't read page content or browsing history. State lives in
`chrome.storage.local`.

## Limits

- Chrome only (and Chromium browsers — Edge, Brave, Arc).
- Only top-level navigation is blocked, not embeds.
- Unpacked extensions stay installed, but Chrome nags about developer mode on
  each launch. Publishing to the Web Store ($5 one-time) removes that.
