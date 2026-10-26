# Just Focus

A Chrome extension with two halves: it **blocks** the sites you name for as
long as you say, and it **hides** the feeds on the sites you still want to use.
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

## Hide stuff (no session needed)

The second half is always on, independent of focus sessions — the
news-feed-eradicator idea. Tick what you don't want to see:

| Site | Can hide |
| --- | --- |
| YouTube | Shorts, home feed, sidebar suggestions, end cards, comments |
| Reddit | Home/popular feed, trending sidebar |
| X / Twitter | Timeline, trends and who-to-follow |
| Instagram | Feed, stories tray, Reels/Explore links |
| Facebook | News feed, stories and Reels |
| LinkedIn | The feed |
| TikTok | For You feed |

Shorts is on by default; everything else starts off. With Shorts hidden, a
`/shorts/` link also redirects to the normal player — same video, no reel.

Hiding is a stylesheet injected at `document_start`, so nothing flashes before
it disappears. The catalog lives in `rules.js`; add a site or selector there
and both the content script and the popup pick it up.

When a selector goes stale (these sites rewrite their markup often) the rule
simply stops hiding anything — it never breaks the page.

## How it works

| File | Job |
| --- | --- |
| `background.js` | Turns a session into `declarativeNetRequest` redirect rules; owns the badge, the end alarm, and the stored state. |
| `popup.*` | Start/stop, countdown, list editor. |
| `blocked.*` | The page you land on, with the time left. |
| `rules.js` | The declutter catalog: site → toggles → selectors. |
| `declutter.js` | Injects the hiding stylesheet; escapes Shorts URLs. |

Blocking happens in Chrome's network layer, so a blocked request never loads —
the extension doesn't read page content or browsing history. State lives in
`chrome.storage.local`.

## Limits

- Chrome only (and Chromium browsers — Edge, Brave, Arc).
- Only top-level navigation is blocked, not embeds.
- Decluttering reads no page content; it only adds a stylesheet.
- Unpacked extensions stay installed, but Chrome nags about developer mode on
  each launch. Publishing to the Web Store ($5 one-time) removes that.
