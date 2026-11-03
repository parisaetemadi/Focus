# Focus time

A Chrome extension that gives each app a few minutes a day and then takes it
away. Manifest V3, plain JS, no build step, nothing leaves the browser.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → pick this folder.
3. Pin the icon.

## The popup

One screen: each app, what's left of its day, a bar, and **Focus now**.
Everything else is under **More**, and nothing has a save button.

## App limits

Each app gets minutes a day — **20 on x.com, 20 on instagram.com, 5 on
tiktok.com** out of the box — and the clock runs only while that app is the tab
you are looking at, in a focused window, with someone at the keyboard. Spend
them and the app redirects to the blocked screen for the rest of the day. It
comes back at midnight, local time.

Nothing in the extension lifts a spent limit early. There is no override
button, stopping Focus now doesn't touch it, and a limit you **loosen** —
raising the number, or deleting the line — keeps today's number and only
loosens tomorrow. Lowering one, or writing in a new app, takes effect
immediately. So the version of you that wrote the list this morning gets the
last word tonight.

The list is written, one app per line, under **More**:

```
instagram.com 20
tiktok.com 5
x.com 20
```

That is the only place apps are added, changed or removed, and it saves itself
when you click away. A line with no number keeps the minutes it already had.
`x.com` and `twitter.com` are one app, so they share one budget.

## The record

Under **More**, the last 7 days: one row per app, the week's total, and a bar
per day on one shared scale — a tall bar means the same thing in every row,
and today is on the right and still counting. Hover a bar for that day's
minutes.

Each day goes into the record when it ends, 30 days are kept, and an app you
stop limiting keeps the days it already has. Like everything else here, it
stays in `chrome.storage.local` and never leaves the machine.

## Focus now

One button. It blocks every app on the list straight away, however many
minutes they have left, and stays on until you stop it. Unlike a spent limit,
this one is yours to call off — it's for the hour you decided to work, not for
the habit.

The honest caveat for both: this is an extension, so Chrome can still turn it
off at `chrome://extensions`, and another browser or profile never had it. It
makes the easy path the one you chose, not a wall.

## Hide feeds

Under **More**, always on, independent of the limits. Four ticks, by
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
| `background.js` | Counts the minutes, and turns limits and Focus now into `declarativeNetRequest` redirect rules; owns the alarms and the stored state. |
| `popup.*` | What's left of each app up front, the record and the written list under More. |
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
- Focus now has no timer: it is on until you stop it.
- Nothing stops you disabling the extension; see above.
- Decluttering reads no page content; it only adds a stylesheet.
- Unpacked extensions stay installed, but Chrome nags about developer mode on
  each launch. Publishing to the Web Store ($5 one-time) removes that.
