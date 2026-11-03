# Focus time

A Chrome extension with three halves: it gives each site a **daily budget** of
minutes and shuts it off when they run out, it **blocks** your whole list for a
focus session, and it **hides** the feeds on the sites you still want to use.
Manifest V3, plain JS, no build step, nothing leaves the browser.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → pick this folder.
3. Pin the icon so the badge (minutes left) is visible.

## The popup

One screen: each site, what's left of today, and a box to change the number.
Everything else — adding a site, focus sessions, feed hiding — is under
**More**. Nothing has a save button; every change goes in as you make it, and
the feed-hiding ticks are remembered per site until you change them.

## Daily limits

The top of the popup. Each site gets minutes a day — **20 on x.com, 20 on
instagram.com, 5 on tiktok.com** out of the box — and the clock runs only while
that site is the tab you are looking at, in a focused window, with someone at
the keyboard. Spend the budget and the site redirects to the blocked screen for
the rest of the day. It comes back at midnight, local time.

Nothing in the extension lifts a spent limit early. There is no override button,
ending a focus session doesn't touch it, and a limit you **loosen** — raise the
minutes, or delete it with the × — keeps today's number and only loosens
tomorrow. Tightening a limit, or adding a site, takes effect immediately. So the
version of you that set the budget this morning gets the last word tonight.

`x.com` and `twitter.com` are one app, so they share one budget.

The honest caveat: this is an extension, so Chrome can still turn it off at
`chrome://extensions`, and another browser or profile never had it. It makes the
easy path the one you chose, not a wall.

## Focus sessions

- Click the icon, open **More**, pick a length, hit **Start focus**.
- While a session runs, any page on your list redirects to a blocked screen
  that shows the time left. Open tabs on those sites reload into it too.
- **End focus** stops it — in the popup or from the blocked page. No lockout,
  no password; it's a speed bump against habit, not a prison.
- The list sits under the same section: one domain per line, saved when you
  click away. Subdomains are covered, so `reddit.com` also blocks
  `old.reddit.com`.

## Hide feeds (no session needed)

Under **More**, always on, independent of limits and sessions. Four ticks, by
the kind of thing rather than by the site — each covers every site that has
one, and the sites that don't simply ignore it:

| Tick | Hides |
| --- | --- |
| Feeds | YouTube home, Reddit home/popular, the X timeline, the Instagram feed, the Facebook news feed, the LinkedIn feed, TikTok For You |
| Shorts, Reels and stories | YouTube Shorts, Instagram stories and Reels/Explore, Facebook stories and Reels, the TikTok For You nav |
| Suggestions, trends and who to follow | YouTube's sidebar and end cards, Reddit's sidebar and trending, X's trends column, LinkedIn's asides |
| Comments | YouTube and Reddit comment threads |

Shorts/Reels is on by default; the rest start off. With it on, a `/shorts/`
link also redirects to the normal player — same video, no reel.

Hiding is a stylesheet injected at `document_start`, so nothing flashes before
it disappears. The catalog lives in `rules.js`; add a site to a group there and
both the content script and the popup pick it up. When a selector goes stale
(these sites rewrite their markup often) the rule simply stops hiding
anything — it never breaks the page.

Choices are saved the moment you make them and apply to every page load after,
until you change them. Settings from the old per-site version carry over.

## How it works

| File | Job |
| --- | --- |
| `background.js` | Counts the minutes, and turns limits and sessions into `declarativeNetRequest` redirect rules; owns the alarms and the stored state. |
| `popup.*` | What's left of each day up front, the rest under More. |
| `blocked.*` | The page you land on, and why you landed on it. |
| `rules.js` | The hide catalog: group → site → selectors, and the old settings' upgrade path. |
| `declutter.js` | Injects the hiding stylesheet; escapes Shorts URLs. |

Blocking happens in Chrome's network layer, so a blocked request never loads —
the extension doesn't read page content or browsing history. Counting time reads
one thing: the address of the tab in front, and only for sites that have a
limit. State lives in `chrome.storage.local` and never leaves the machine.

Time is banked every 30 seconds and at every switch of tab, window or idle
state, so a crash or a closed browser loses at most half a minute — and time
that started yesterday is never charged to today.

## Limits

- Chrome only (and Chromium browsers — Edge, Brave, Arc).
- Chrome re-reads the popup from disk every time it opens, but only picks up a
  new `background.js` or `manifest.json` when the extension is reloaded. After
  pulling changes, hit **Reload** at `chrome://extensions` — the popup says so
  if it notices it is talking to an older worker.
- Only top-level navigation is blocked, not embeds.
- A limit is per day, local time, and the day turns over at midnight.
- Nothing stops you disabling the extension; see above.
- Decluttering reads no page content; it only adds a stylesheet.
- Unpacked extensions stay installed, but Chrome nags about developer mode on
  each launch. Publishing to the Web Store ($5 one-time) removes that.
