# landnr — landonorris.com, rebuilt to run locally

A complete, dependency-free build of the Lando Norris homepage from a saved
capture of the live site (`source/landonorris-home.html`, captured
`Last Published: Tue Aug 11 2026`).

The capture is a Webflow export whose behaviour lives in OFF+BRAND's engine
bundle. That bundle is served from `lando.itsoffbrand.io`, which answers
`Access denied - Invalid referrer` to any origin that is not
landonorris.com — so a local copy of the page loads as a frozen, invisible
document. This repository keeps **100 % of the original markup, classes and
inline CSS embeds** and replaces only the parts that cannot run: the engine,
the Rive art and the WebGL wash.

```bash
npm run dev        # build + serve with watch  →  http://localhost:4173
npm run build      # source/ + src/  →  dist/
npm run smoke      # boot the real engine against the real build, 7 viewports
```

No `npm install` is needed — there are no dependencies. Node ≥ 20.11.

---

## Routes

| Path | What it is |
| --- | --- |
| `/` | The homepage, verbatim from the capture, with the local engine attached |
| `/on-track/` `/off-track/` `/calendar/` `/partnerships/` | Stand-ins: real nav, footer, type scale and colour tokens, honest copy about what was captured |
| `/legal/privacy-policy/` `/legal/terms-conditions/` | Stand-ins (the live policy is linked through) |
| `/404.html` | Fallback for unknown routes |

Only the homepage existed in the capture. Every link in the nav, footer and
menu resolves: internal routes go to a stand-in, external ones
(`store.landonorris.com`, Instagram, YouTube, Twitch, TikTok) open the real
destination in a new tab.

## How the build works

```
source/landonorris-home.html   (326 kB saved page, 32 unclosed <svg>)
        │
        ├─ scripts/lib/html.mjs       tokenizer → tree → serializer
        │                             · repairs the 32 unclosed <svg>
        │                             · un-prettifies the saved whitespace
        │                               (keeps authored "\n" in pre-line text)
        │
        ├─ scripts/lib/transform.mjs  strips what cannot run, injects what can
        │                             · removes GTM/gtag, Klaviyo, iubenda,
        │                               the referrer-locked OFF+BRAND build
        │                               and dev-only scripts
        │                             · restores the two builds that sit on
        │                               the referrer-open assets host — the
        │                               app bundle and the Rive transition —
        │                               plus the jQuery/Webflow runtime they
        │                               call into
        │                             · injects engine.css, the ln-js boot
        │                               flag, <noscript> fallback, failsafe
        │                               and the engine module tag
        │                             · derives the six stand-in routes by
        │                               deep-cloning the cleaned homepage
        │
        └─ scripts/build.mjs          assets + checks → dist/
```

`npm run check` runs the same pipeline **without writing**, and fails on any
of these: a blocked script surviving, the published stylesheet or the engine
not being wired up, an `/assets/…` reference that does not exist, an internal
link that does not resolve, unbalanced `<svg>`, a missing `<noscript>`, a
leftover `data-start`, or a stand-in page missing its nav/footer. In remote
mode it also fails if the restored bundle has lost its load marker, if the
transition script / jQuery / Webflow runtime went missing from the homepage,
or if a stand-in page picked the remote engine up (those always run local —
they have no `.transition-w` and no Rive art to drive).

The published Webflow stylesheet stays exactly where it is
(`cdn.prod.website-files.com/…/lando-offbrand.shared.5b4e934f7.css`) — that CDN has
no referrer protection, so the browser loads it and every original class keeps
working. `src/css/engine.css` only *adds*: preloader, split text, reveals,
Rive stand-ins, menu, stub pages, reduced-motion — and every rule that touches
original markup is prefixed `html.ln-js`, so the whole stylesheet switches
itself off the moment the genuine engine takes the wheel.

## Two engines

Whoever saved the capture left a ladder of alternative builds in HTML comments:

```html
<!-- Production (No Gold
<script defer src="https://lando.itsoffbrand.io/dev-js/lando.OFF+BRAND.js"></script>
-->
<!-- Gold -->
<script defer src="https://lando.itsoffbrand.io/dev-js/lando.OFF+BRAND.gold-android-fix-03.js"></script>
<!--
<script defer src="https://assets.itsoffbrand.io/lando/dev-js/lando-by-OFF+BRAND.js"></script>
-->
```

The uncommented one — the build the live site actually runs — is on
`lando.itsoffbrand.io`, which answers `Access denied - Invalid referrer` to any
origin that is not landonorris.com. A browser will not let you spoof a
`Referer`, so from a local build that file can only ever be a 403.

The commented-out build on `assets.itsoffbrand.io` has **no** referrer lock, so
the build restores it — real Lenis, real GSAP, real Rive runtime and the
`allriveloaded` handshake that fetches every `.riv` file (helmet-reef,
signature, circuits, arrow, hamburger, off-icons, collabs, phrases) itself.
Alongside it go `transitions-rive-isolate.js` (the Rive page transition) and
the jQuery + Webflow runtime the bundle calls `Webflow.destroy()` on. All of
them carry `referrerpolicy="no-referrer"`, and the document gets
`<meta name="referrer" content="no-referrer">` so the `.riv` requests travel
the same way. Sending no referrer is the only lever available; if the host
still refuses, the request simply fails and the fallback below takes over.

`src/js/engine.js` picks a mode at boot:

| | signal | what happens |
| --- | --- | --- |
| **remote** | the bundle's `onload` fired | `html.ln-remote`, `ln-js` removed → our CSS stands down, no module touches the document. A watchdog polls for `window.lenis` / `window.landoGL`; if neither appears within 12 s (their boot waits on every `.riv` before starting Lenis) it re-adds `ln-js` and boots the local engine anyway |
| **local** | `onerror`, or `LANDNR_ENGINE=local` | `html.ln-js` → the thirteen modules below drive everything |

The bundle is `defer` and the engine is a module, so its load has already
succeeded or failed by the time we look — the hand-over is synchronous and
there is no flash of two engines fighting.

Force the local engine with `npm run build -- --local` (or
`LANDNR_ENGINE=local npm run build`).

## The engine (fallback)

`src/js/` — thirteen ES modules, no framework, no build step. Boot order is in
`engine.js`; every stage is wrapped so one failure can never leave the page
hidden or unscrollable.

| Module | Replaces | What it does |
| --- | --- | --- |
| `utils.js` | — | one rAF loop, one scroll model, brand-colour resolution from the published CSS variables (with fallbacks), `safe()`/`report()` telemetry |
| `icons.js` | Rive art files | hand-drawn SVGs (arrow, burger, racing-line circuit, helmet, LN monogram) plus the CDN asset map |
| `rive-fallbacks.js` | 17 `<canvas data-rive-*>` | reveals a sibling `[data-rive-placeholder]` when the capture ships one, otherwise injects the matching SVG/image |
| `split-text.js` | GSAP SplitText | 70 `[split-text]` elements → `.line > .ln-line-in > .word > .char`, in three batched phases (write → measure → write) so the page costs a handful of reflows, not seventy |
| `reveals.js` | ScrollTrigger | 40 `[data-anim-high]` highlights (clip-path mask, per-line stagger, directional sweep in lime / lime-off / dark-green-tint-1) and IntersectionObserver reveals for the cards, images and helmet grid |
| `nav.js` | — | samples the 11 `[data-nav-theme-target]` markers each frame to set `data-nav-theme`, opens/closes the full-screen menu, syncs the link→image collage, marks `w--current` |
| `smooth-scroll.js` | Lenis | wheel → lerp → `scrollTo`, driving the same `html.lenis*` classes the published CSS already expects. Mouse/fine-pointer only; nested scrollers and the browser's own edge behaviour win |
| `marquee.js` | — | duplicates each `[data-marquee-collection-target]` to the declared count and drifts it, nudged by scroll velocity, paused off-screen |
| `horizontal.js` | ScrollTrigger pin | the 8-column pinned section: spacer height = track width − viewport, sticky pin, `translateX` from scroll, background blended `dark-green → white`. Disables itself below 992 px |
| `ambient.js` | WebGL shaders | 2D-canvas light fields for `[data-gl="head"]`, `[data-gl="carousel"]` and `[data-gl="background"]`, blended by `data-gl-change-*` and the nav theme, rendered at 0.55× (they are gradients) with grain added in CSS |
| `sections.js` | — | hero intro + parallax, the "tap to lock" control, the sticky ON TRACK / OFF TRACK diptych, the draggable social filmstrip, video mounts, scroll indicator |
| `preloader.js` | Rive transition | turns `.transition-w` into a real loader: actual asset progress, arms the capture's own "Load Norris" button, auto-enters, then hands over to the hero intro and fires `ln:ready` |
| `engine.js` | the bundle | browser hints (`.is-safari`, `.is-iphone`), ordered init, debug API on `window.landnr` |

## Fidelity

| Live site | This build |
| --- | --- |
| Rive animations (`.riv` files, never referenced by URL in the capture) | SVG/image stand-ins in the same slots, or the capture's own `[data-rive-placeholder]` art |
| WebGL background | 2D-canvas light fields in the brand palette + CSS grain |
| Lenis | `smooth-scroll.js` (same classes, same feel, desktop pointer only) |
| GSAP + SplitText + ScrollTrigger | `split-text.js`, `reveals.js`, `horizontal.js` |
| Seven video streams | Poster frames with hover scale; drop a playable URL into `streamConfig` in `sections.js` to mount a real iframe |
| jQuery + Webflow runtime | Removed — the capture has zero `data-w-id` attributes and no interactive Webflow components, so they were dead weight |
| GTM, gtag, Klaviyo, iubenda | Removed — nothing is tracked, no cookies are set |

Images, fonts and the stylesheet still come from the original CDN, so the page
needs network access to look right. Everything structural and behavioural is
local.

## Testing

There is no browser in this sandbox, so `npm run smoke` boots the **real**
engine against the **real** built HTML inside Node, using
`scripts/dev/dom-shim.mjs`: a DOM slice (selectors, classList, dataset,
fragments, tree walkers, events, rAF, IntersectionObserver, canvas 2D) plus a
fake layout pass — block boxes fill their container, inline boxes wrap at the
viewport, declared flex rows lay their items side by side.

Eight scenarios (desktop, 1920, 1024, tablet, iPhone, touch desktop,
reduced-motion, remote hand-over) each assert that split text produced
lines/words/chars, reveals reached `done`, every Rive canvas was replaced,
marquees duplicated, the ambient layer mounted, the preloader armed and
exited, `html.ln-ready` was set, the nav resolved a theme, the hero intro
played, and the horizontal pin engaged — plus that nothing threw. Below 992 px
the pin correctly reports itself inactive.

The `remote` scenario fakes a successful bundle load (`window.__lnRemote`) and
asserts the opposite: `ln-remote` set, `ln-js` gone, our split-text and
preloader never ran, all 17 original Rive canvases and 70 `[split-text]`
elements left untouched, `ln:ready` still fired for the inline failsafe. It
then advances the clock past the deadline and checks the watchdog rescues the
page — `ln-js` back, text split by us after all.

The shim proves the engine runs and mutates the document correctly. It cannot
prove pixels: it has no stylesheet, so visual verification needs a browser.

## Layout

```
source/          the capture (homepage HTML, GTM runtime kept for reference)
scripts/
  lib/html.mjs       tokenizer · tree · serializer · svg repair
  lib/transform.mjs  strip / inject / compose
  build.mjs          pipeline + checks + build-report.json
  dev/dom-shim.mjs   DOM + layout shim for Node
  dev/smoke.mjs      one scenario
  dev/smoke-all.mjs  every scenario
src/css/engine.css   the additive stylesheet
src/js/              the engine (13 modules)
server.mjs           zero-dependency static server (0.0.0.0:4173, --watch)
dist/                build output (git-ignored)
```

`window.landnr` exposes `report`, `scrollTo`, `openMenu`, `toggleMenu`,
`pauseMarquees`, `refreshAmbient`, `splitPending`, `disableSmoothScroll` and
`replay()` for poking at the running page.

---

Built from a saved copy of a public website for study and local development.
All content, imagery and branding belong to Lando Norris / OFF+BRAND; nothing
here is affiliated with or endorsed by them, and nothing is tracked.
