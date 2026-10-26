// Declutter rules: things to hide on sites you still want to use.
// Shared verbatim by the content script and the popup, so it is a plain
// global rather than a module (MV3 content scripts can't import).
//
// Each site maps to a list of toggles. `css` holds selectors hidden when the
// toggle is on. Selectors are deliberately broad: a stale one hides nothing,
// which is the safe way to fail.
const DECLUTTER_RULES = {
  'youtube.com': {
    label: 'YouTube',
    rules: [
      {
        id: 'yt-shorts',
        label: 'Shorts (and send /shorts links to the normal player)',
        on: true,
        css: [
          'ytd-rich-shelf-renderer[is-shorts]',
          'ytd-reel-shelf-renderer',
          'ytm-shorts-lockup-view-model',
          'grid-shelf-view-model',
          'ytd-video-renderer:has(a[href*="/shorts/"])',
          'ytd-rich-item-renderer:has(a[href*="/shorts/"])',
          'ytd-guide-entry-renderer:has([title="Shorts"])',
          'ytd-mini-guide-entry-renderer[aria-label="Shorts"]'
        ]
      },
      {
        id: 'yt-home-feed',
        label: 'Home page feed',
        css: ['ytd-browse[page-subtype="home"] #contents']
      },
      {
        id: 'yt-related',
        label: 'Suggestions beside the video',
        css: ['ytd-watch-next-secondary-results-renderer', '#related']
      },
      {
        id: 'yt-endscreen',
        label: 'End-of-video suggestion cards',
        css: ['.ytp-endscreen-content', '.ytp-ce-element']
      },
      {
        id: 'yt-comments',
        label: 'Comments',
        css: ['ytd-comments#comments']
      }
    ]
  },

  'reddit.com': {
    label: 'Reddit',
    rules: [
      {
        id: 'rd-feed',
        label: 'Home / popular feed',
        css: [
          'shreddit-feed',
          '[data-testid="frontpage-feed"]',
          'body.listing-page.front-page #siteTable'
        ]
      },
      {
        id: 'rd-sidebar',
        label: 'Trending and recommended communities',
        css: ['shreddit-sidebar', '[data-testid="trending-carousel"]']
      }
    ]
  },

  'x.com': {
    label: 'X / Twitter',
    rules: [
      {
        id: 'x-timeline',
        label: 'The timeline',
        css: ['[data-testid="primaryColumn"] [aria-label^="Timeline"]']
      },
      {
        id: 'x-sidebar',
        label: 'Trends and who to follow',
        css: ['[data-testid="sidebarColumn"]']
      }
    ]
  },

  'instagram.com': {
    label: 'Instagram',
    rules: [
      { id: 'ig-feed', label: 'The feed', css: ['main article'] },
      { id: 'ig-stories', label: 'Stories tray', css: ['[data-pagelet="story_tray"]'] },
      {
        id: 'ig-reels',
        label: 'Reels and Explore links',
        css: ['a[href="/reels/"]', 'a[href="/explore/"]']
      }
    ]
  },

  'facebook.com': {
    label: 'Facebook',
    rules: [
      { id: 'fb-feed', label: 'News feed', css: ['[role="feed"]'] },
      {
        id: 'fb-stories',
        label: 'Stories and Reels',
        css: ['[data-pagelet="Stories"]', '[aria-label="Reels"]']
      }
    ]
  },

  'linkedin.com': {
    label: 'LinkedIn',
    rules: [
      {
        id: 'li-feed',
        label: 'The feed',
        css: ['main .scaffold-finite-scroll', 'main .feed-outlet']
      }
    ]
  },

  'tiktok.com': {
    label: 'TikTok',
    rules: [
      {
        id: 'tt-feed',
        label: 'For You feed',
        css: ['[data-e2e="recommend-list-item-container"]']
      }
    ]
  }
};

// Defaults come straight from the catalog, so a new rule only has to be
// declared in one place.
function defaultDeclutter() {
  const defaults = {};
  for (const site of Object.values(DECLUTTER_RULES)) {
    for (const rule of site.rules) defaults[rule.id] = Boolean(rule.on);
  }
  return defaults;
}

function rulesForHost(hostname) {
  const host = hostname.replace(/^www\./, '');
  for (const [domain, site] of Object.entries(DECLUTTER_RULES)) {
    if (host === domain || host.endsWith(`.${domain}`)) return site.rules;
  }
  // x.com and twitter.com serve the same app.
  if (host === 'twitter.com' || host.endsWith('.twitter.com')) {
    return DECLUTTER_RULES['x.com'].rules;
  }
  return [];
}
