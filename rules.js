// What to hide, grouped by the kind of thing rather than by the site it lives
// on. One tick covers every site that has that thing; a site that doesn't have
// it ignores the tick, and a selector that goes stale hides nothing — which is
// the safe way to fail, since these sites rewrite their markup often.
//
// Shared verbatim by the content script and the popup, so it is a plain global
// rather than a module (MV3 content scripts can't import).
const HIDE_RULES = [
  {
    id: 'feeds',
    label: 'Feeds — home, timeline, For You',
    sites: {
      'youtube.com': ['ytd-browse[page-subtype="home"] #contents'],
      'reddit.com': [
        'shreddit-feed',
        '[data-testid="frontpage-feed"]',
        'body.listing-page.front-page #siteTable'
      ],
      'x.com': ['[data-testid="primaryColumn"] [aria-label^="Timeline"]'],
      'instagram.com': ['main article'],
      'facebook.com': ['[role="feed"]'],
      'linkedin.com': ['main .scaffold-finite-scroll', 'main .feed-outlet'],
      'tiktok.com': ['[data-e2e="recommend-list-item-container"]']
    }
  },

  {
    id: 'reels',
    label: 'Shorts, Reels and stories',
    on: true,
    sites: {
      'youtube.com': [
        'ytd-rich-shelf-renderer[is-shorts]',
        'ytd-reel-shelf-renderer',
        'ytm-shorts-lockup-view-model',
        'grid-shelf-view-model',
        'ytd-video-renderer:has(a[href*="/shorts/"])',
        'ytd-rich-item-renderer:has(a[href*="/shorts/"])',
        'ytd-guide-entry-renderer:has([title="Shorts"])',
        'ytd-mini-guide-entry-renderer[aria-label="Shorts"]'
      ],
      'instagram.com': [
        '[data-pagelet="story_tray"]',
        'a[href="/reels/"]',
        'a[href="/explore/"]'
      ],
      'facebook.com': ['[data-pagelet="Stories"]', '[aria-label="Reels"]'],
      'tiktok.com': ['[data-e2e="nav-foryou"]']
    }
  },

  {
    id: 'suggestions',
    label: 'Suggestions, trends and who to follow',
    sites: {
      'youtube.com': [
        'ytd-watch-next-secondary-results-renderer',
        '#related',
        '.ytp-endscreen-content',
        '.ytp-ce-element'
      ],
      'reddit.com': ['shreddit-sidebar', '[data-testid="trending-carousel"]'],
      'x.com': ['[data-testid="sidebarColumn"]'],
      'linkedin.com': ['.feed-follows-module', 'aside .artdeco-card']
    }
  },

  {
    id: 'comments',
    label: 'Comments',
    sites: {
      'youtube.com': ['ytd-comments#comments'],
      'reddit.com': ['shreddit-comment-tree', '.commentarea']
    }
  }
];

// Defaults come straight from the catalog, so a new rule is declared once.
function defaultDeclutter() {
  const defaults = {};
  for (const rule of HIDE_RULES) defaults[rule.id] = Boolean(rule.on);
  return defaults;
}

// Settings saved under the old per-site ids still mean something: a group is
// on if any of its old ticks was on, and off if they were all turned off. A
// group nobody ever touched keeps its default.
const LEGACY_IDS = {
  'yt-home-feed': 'feeds',
  'rd-feed': 'feeds',
  'x-timeline': 'feeds',
  'ig-feed': 'feeds',
  'fb-feed': 'feeds',
  'li-feed': 'feeds',
  'tt-feed': 'feeds',
  'yt-shorts': 'reels',
  'ig-stories': 'reels',
  'ig-reels': 'reels',
  'fb-stories': 'reels',
  'yt-related': 'suggestions',
  'yt-endscreen': 'suggestions',
  'rd-sidebar': 'suggestions',
  'x-sidebar': 'suggestions',
  'yt-comments': 'comments'
};

function readDeclutterSettings(stored) {
  const enabled = defaultDeclutter();
  const legacy = {};
  for (const [id, on] of Object.entries(stored || {})) {
    if (id in enabled) {
      enabled[id] = Boolean(on);
    } else if (LEGACY_IDS[id]) {
      legacy[LEGACY_IDS[id]] = (legacy[LEGACY_IDS[id]] ?? false) || Boolean(on);
    }
  }
  for (const [group, on] of Object.entries(legacy)) {
    if (!(stored && group in stored)) enabled[group] = on;
  }
  return enabled;
}

// x.com and twitter.com serve the same app.
function siteKey(hostname) {
  const host = hostname.replace(/^www\./, '');
  const domains = new Set(HIDE_RULES.flatMap((rule) => Object.keys(rule.sites)));
  for (const domain of domains) {
    if (host === domain || host.endsWith(`.${domain}`)) return domain;
  }
  if (host === 'twitter.com' || host.endsWith('.twitter.com')) return 'x.com';
  return null;
}

// The groups that have anything to hide on this host.
function rulesForHost(hostname) {
  const site = siteKey(hostname);
  if (!site) return [];
  return HIDE_RULES
    .filter((rule) => rule.sites[site]?.length)
    .map((rule) => ({ id: rule.id, label: rule.label, css: rule.sites[site] }));
}
