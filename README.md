# landnr — landonorris.com, rebuilt to run locally

A complete, dependency-free build of the Lando Norris homepage from a saved
capture of the live site (`source/landonorris-home.html`, captured
`Last Published: Tue Aug 11 2026`).

The capture is a Webflow export whose behaviour lives in OFF+BRAND's engine
bundle. That bundle is served from `lando.itsoffbrand.io`, which answers
`Access denied - Invalid referrer` to any origin that is not landonorris.com —
which is why an earlier version of this build showed a page with **no
animation at all**. `vendor/` now holds a byte-exact mirror of that engine and
of every file it fetches (Rive artboards, the page transition, the WebGL hero's
models, textures in both the desktop and mobile sets, HDRIs, the Draco and
Basis decoders, the Rive WASM), and the build rewires the bundle's five remote
URL literals to it. The genuine engine therefore runs from this origin: real
Lenis, real GSAP ScrollTrigger choreography, real Rive art, real WebGL helmet.

This repository keeps **100 % of the original markup, classes and inline CSS
embeds**. `src/js` remains as the fallback engine for the pages the capture
never contained, and for the case where the bundle cannot run at all.

```bash
npm run dev        # build + serve with watch  →  http://localhost:4173
npm run build      # source/ + src/ + vendor/  →  dist/
npm run verify     # every asset the engine asks for, requested over HTTP
npm run smoke      # boot the engine against the real build, 9 scenarios
npm run vendor     # re-harvest vendor/ (also runs as a GitHub workflow)
```

No `npm install` is needed — there are no dependencies. Node ≥ 20.11.

Open the page with **`/?engine`** for a live readout of which engine is
driving, how many Rive canvases are live, whether Lenis owns the scroll, and
anything the network refused.

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

---

## Deploying to Netlify

`dist/` is the whole site — static HTML, CSS and ES modules, no server, no
dependencies, nothing to install. Two ways to ship it:

**1. From this repository** (recommended — `netlify.toml` already says
everything): Netlify → *Add new site* → *Import an existing project* → pick
this repo and the branch you want. Build command `npm run build`, publish
directory `dist`. Netlify's post-processing is switched off in
`netlify.toml`, so nothing rewrites the capture's markup or the engine tags.

**2. Drag and drop**: run `npm run build`, then drag the `dist/` **folder**
(not a parent directory) onto <https://app.netlify.com/drop>. Netlify accepts
folders directly; a zip of the folder's *contents* works too.

Either way the deploy carries:

| File | Why |
| --- | --- |
| `netlify.toml` | build command, publish dir, Node 22, `skip_processing` |
| `dist/_headers` | `Referrer-Policy: no-referrer` (the OFF+BRAND hosts reject foreign referrers — this is what lets the real engine and its `.riv` files through), `X-Content-Type-Options: nosniff`, `Cache-Control: no-cache` (nothing in `dist/` is content-hashed, so a stale asset would mean a stale engine) |
| `dist/404.html` | Netlify's automatic custom 404 |

No `_redirects` are needed: routes are directories with an `index.html`, which
Netlify's pretty URLs serve at `/on-track`.

Two things to know before you deploy:

* **Absolute paths.** Assets are referenced as `/assets/…`, so the site must
  sit at a domain root — which is what Netlify gives you. Deploying into a
  subdirectory of some other host would need those rewritten.
* **The real engine is part of the deploy.** It is vendored into
  `dist/assets/vendor/` (≈18 MB: the bundle, seven Rive artboards, the page
  transition, the WebGL hero's models/textures/HDRIs and the Rive WASM), so a
  deploy needs no third-party host for anything that animates — only the
  Webflow CDN for photography and fonts. If the bundle is ever missing or
  refused, `src/js/engine.js` detects that it never took the scroll and boots
  the local engine instead: you lose the Rive art, not the site.
  `npm run build -- --local` ships the local engine only.

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
        │                             · removes GTM/gtag, Klaviyo, iubenda and
        │                               the dev-only scripts
        │                             · replaces the referrer-locked engine tag
        │                               with the vendored copy, in the same
        │                               place in <head>, with the same load
        │                               markers
        │                             · re-points jQuery, the Webflow runtime
        │                               and the published stylesheet at the
        │                               mirror (integrity attributes dropped —
        │                               they are the same bytes, served here)
        │                             · injects engine.css, the boot flag,
        │                               <noscript> fallback, failsafe and the
        │                               engine module tag
        │                             · derives the six stand-in routes by
        │                               deep-cloning the cleaned homepage
        │
        ├─ scripts/vendor/localize.mjs  vendor/ → dist/assets/vendor/
        │                             · rewrites the bundle's URL literals
        │                               (two Rive bases, the WebGL base, the
        │                               unpkg + jsdelivr WASM addresses)
        │                             · mirrors the gl/, rive/, css/, js/ trees
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

## Why the page had no animation

Worth stating precisely, because the fix is only as good as the diagnosis.

The capture's `<head>` loads the engine from
`lando.itsoffbrand.io/dev-js/lando.OFF+BRAND.gold-android-fix-03.js`. That host
answers `Access denied - Invalid referrer` to every origin that is not
landonorris.com, and a browser cannot spoof a `Referer`. An earlier version of
this build therefore substituted the mirror of the bundle that lives on
`assets.itsoffbrand.io` (no referrer lock) and let `src/js/engine.js` stand
down as soon as that script's `onload` fired.

But the bundle's own boot sequence is a chain of awaits — this is its tail,
verbatim:

```js
async function m_(){ return new Promise((A,Q)=>{ window.addEventListener("allriveloaded",()=>{A()}), kI() }) }
async function c_(){
  let A = await BL();                            // page-transition.riv  ← REJECTS on a 403
  await Promise.all([eM(), m_()]);               // WebGL hero + every Rive artboard
  let [Q,B] = await Promise.all([…GL…, …Lenis…]); // ← Lenis is constructed HERE
  CD()
}
c_();
```

`BL()` loads `https://lando.itsoffbrand.io/rive/page-transition.riv` — the
referrer-locked host again. So the first `await` rejected, `c_()` threw, and
**Lenis was never constructed**. No Lenis means no smooth scroll *and* no
GSAP ScrollTrigger ticks (their `init()` wires `lenis.on("scroll", …)` into
`ScrollTrigger.update()`), which is why the page did not merely lose its
preloader: every scroll-triggered reveal, pin, split and parallax on the site
went with it. Meanwhile `src/js/engine.js` had seen `onload`, concluded the
real engine owned the page, and switched itself off. A loaded `<script>` tag
was being treated as a running engine.

Two independent bugs, one symptom: a page that renders and never moves.

## What runs now

**1 · The real engine, served from here.** `scripts/vendor/fetch.sh` harvests
`vendor/` — the live bundle (asked for politely with a `landonorris.com`
Referer, which a runner may send and a browser may not), all seven Rive
artboards, `page-transition.riv`, the whole `gl/` tree (models, HDRIs, Draco,
Basis, MSDF fonts, `webp` for desktop *and* `ktx2` for mobile), the Webflow
stylesheet and runtime, jQuery, and `@rive-app/canvas-lite@2.26.4`'s WASM from
npm. `scripts/vendor/localize.mjs` copies it into `dist/assets/vendor/` and
rewrites the only five remote literals in the bundle:

| in the bundle | becomes |
| --- | --- |
| `"https://assets.itsoffbrand.io/lando/rive/"` | `/assets/vendor/offbrand/assets.itsoffbrand.io/lando/rive/` |
| `"https://lando.itsoffbrand.io/rive/"` | `/assets/vendor/offbrand/lando.itsoffbrand.io/rive/` |
| `"https://lando.itsoffbrand.io/gl"` | `/assets/vendor/offbrand/lando.itsoffbrand.io/gl` |
| `unpkg…concat(name,"@",version,"/rive.wasm")` | `/assets/vendor/npm/rive.wasm` |
| `cdn.jsdelivr.net/npm…rive_fallback.wasm` | `/assets/vendor/npm/rive_fallback.wasm` |

Not one byte of engine logic is touched. `npm run verify` then derives every
asset the built bundle can ask for — 68 of them, including both texture sets —
requests each over HTTP and fails the run on a 404, an empty body or a wrong
content type (`.wasm` must be `application/wasm`, `.glb` must be
`model/gltf-binary`, or the loaders fail silently in the browser).

**2 · Hand-over decided by evidence, not by `onload`.** `src/js/engine.js`
now waits for the globals the bundle leaves behind:

| signal | meaning |
| --- | --- |
| `window.landoGL` | the bundle evaluated (it is created while it runs) |
| `window.loadingComplete` | its Rive handshake finished |
| `window.lenis` | **it is driving the page** — only now does the local engine stand down |

No `landoGL` within 4 s, or no `lenis` within 45 s (the WebGL hero is ≈5 MB on
a cold cache), and the local engine boots and drives the page instead. Nothing
local touches the DOM while the decision is pending, so a late takeover cannot
collide with a half-built real engine — and `smooth-scroll.js` refuses to start
if `window.lenis` appears afterwards. As a nudge, if the bundle's
`allriveloaded` handshake has not completed after 2.5 s the engine dispatches
it, which unblocks a boot that is waiting on an artboard that will never
arrive.

**3 · The failsafe no longer mistakes the intro for a trap.** The inline
anti-trap in `<head>` used to hide a full-screen overlay after ~9 s — which is
exactly how long the genuine Rive intro takes. It now checks `window.landoGL`
first and gives a live engine 45 s. `html.ln-js` (the switch that turns on
every local-engine CSS rule) is no longer set in `<head>` when the build ships
the real engine, so the local preloader art never paints over the real one.

`npm run build -- --local` (or `LANDNR_ENGINE=local`) omits the bundle entirely
and ships the fallback engine on its own.

## The hero

This site belongs to someone who has never shown his face, so the hero says
that out loud: a black mannequin — ball-jointed, matte, featureless — stands
where a person would, and the picture he gives the world instead floats a
hand's breadth in front of it. Move the pointer over the picture and it
disintegrates: each fragment of the plane owns a noise threshold, and as the
dissolve front passes it the fragment is thrown outwards and up on a curl of
simplex noise, burning lime at the tear, until only the mannequin is left —
which turns, slowly, to face whatever is looking at it. Move away and the
picture settles back.

It is real 3D (`src/js/hero-ash.js`, three.js vendored byte-exact from npm at
`vendor/npm/three@0.186.0/`, served from `/assets/vendor/npm/three/`). The
mannequin is assembled from primitives, so the site ships nobody else's 3D
scan; the engine's own WebGL layer — a scan of Lando Norris's head and his
helmet models — is switched off at build time by leaving the bundle's GL
instance null, which every entry point into it already guards against
(`scripts/vendor/localize.mjs` → `DISABLE_LANDO_GL`).

**The portrait.** Drop any flat-background picture at `source/ash-hero.png`
(`.webp` / `.jpg` work too) and the build ships it; the hero keys the backdrop
out in the browser by region-growing from the image border — gradient-limited,
so a vignetted sweep still clears while white sleeves and eye-whites, which
merely share the backdrop's colour, survive. Already-transparent files pass
through untouched. With nothing dropped in, a procedurally drawn silhouette
stands in so the effect is demonstrable from a clean clone.

The keying has a unit test (`npm run test:key`) that runs the real algorithm
against a synthetic studio portrait with an enclosed white disc, a sleeve
cropped by the frame, and a vignetted backdrop — the three ways this kind of
key fails invisibly.

No WebGL2, no three.js, or a `prefers-reduced-motion` preference degrades to a
layered CSS hero (SVG mannequin, portrait lifting off it on hover) rather than
to nothing.

## The engine (fallback)

`src/js/` — fourteen ES modules, no framework, no build step. Boot order is in
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
| `diagnostics.js` | — | the `/?engine` panel: which engine is driving, Rive/Lenis/WebGL state, and every refused request |
| `engine.js` | the bundle | browser hints (`.is-safari`, `.is-iphone`), ordered init, the real-engine hand-over, debug API on `window.landnr` |

## Fidelity

| Live site | This build |
| --- | --- |
| OFF+BRAND engine bundle | **the same file**, vendored and re-pointed at the local mirror |
| Rive animations (helmet-reef, signature, circuits, arrow, hamburger, off-icons, collabs, phrases, page transition) | **the same `.riv` artboards**, vendored |
| WebGL hero, helmet hall of fame, track carousel, background wash | **the same `gl/` tree** — models, HDRIs, MSDF fonts, Draco/Basis, `webp` + `ktx2` textures, vendored |
| Lenis + GSAP + SplitText + ScrollTrigger | **theirs**, inside the bundle. `src/js` is the fallback: `smooth-scroll.js`, `split-text.js`, `reveals.js`, `horizontal.js` |
| jQuery + Webflow runtime | vendored from the same CDN paths, served locally (`window.Webflow.destroy()`/`.ready()` run inside the bundle's boot) |
| Seven video streams | the bundle mounts Vimeo players exactly as the live site does; the capture carried no video IDs for the fallback engine, which shows poster frames with hover scale instead |
| Photography + fonts | still the Webflow CDN (public, no referrer lock) |
| GTM, gtag, Klaviyo, iubenda | Removed — nothing is tracked, no cookies are set |

Everything that animates is served from this origin. The only remaining
third-party requests are images and fonts from `cdn.prod.website-files.com`,
the Vimeo players the bundle mounts, and outbound links.

## Testing

There is no browser in this sandbox, so `npm run smoke` boots the **real**
engine against the **real** built HTML inside Node, using
`scripts/dev/dom-shim.mjs`: a DOM slice (selectors, classList, dataset,
fragments, tree walkers, events, rAF, IntersectionObserver, canvas 2D) plus a
fake layout pass — block boxes fill their container, inline boxes wrap at the
viewport, declared flex rows lay their items side by side.

Nine scenarios (desktop, 1920, 1024, tablet, iPhone, touch desktop,
reduced-motion, remote hand-over, remote happy-path) each assert that split text produced
lines/words/chars, reveals reached `done`, every Rive canvas was replaced,
marquees duplicated, the ambient layer mounted, the preloader armed and
exited, `html.ln-ready` was set, the nav resolved a theme, the hero intro
played, and the horizontal pin engaged — plus that nothing threw. Below 992 px
the pin correctly reports itself inactive.

The `remote` scenario is the regression test for the bug above: it fakes a
successful bundle **load** (`window.__lnRemote.loaded`) and nothing else — no
`landoGL`, no `lenis` — and asserts that the local engine does *not* stand down
forever. It waits, leaves all 17 original Rive canvases and 70 `[split-text]`
elements untouched, keeps the failsafe armed, and then, past the 4 s
"did it even evaluate" deadline, takes the page over: `ln-js` back, text split
by us, `ln:ready` fired once the rescued preloader enters.

`remote-happy` is the other branch: `window.landoGL` and `window.lenis` exist
and the overlay is gone, so the hand-over happens, `ln-remote-live` is set, the
local engine never touches the DOM, and no failsafe is applied.

`npm run verify` covers the half the shim cannot: it reads the *built* bundle,
derives every asset it will request (Rive artboards under both mirror bases,
the page transition, models, HDRIs, MSDF fonts, decoders, both the `webp` and
`ktx2` texture sets, the Rive WASM), fetches all 68 over HTTP and checks status,
size and content type — plus that no cross-origin engine host survives in the
built file.

Neither harness can prove pixels: there is no browser in this sandbox. That is
what `/?engine` is for — it prints, in the page, which engine is driving, how
many Rive canvases are live, whether Lenis owns the scroll, and anything the
network refused.

## Layout

```
source/          the capture (homepage HTML, GTM runtime kept for reference)
vendor/          the mirror: the real engine + everything it fetches (committed)
  offbrand/<host>/<path>   byte-exact, same shape as the original URLs
  npm/@rive-app/…          the Rive WASM runtime, from npm
  fetch.sh · inspect.sh    the harvester and its report
  manifest.json            what was fetched, from where, how big
scripts/
  lib/html.mjs       tokenizer · tree · serializer · svg repair
  lib/transform.mjs  strip / inject / compose
  vendor/localize.mjs  mirror → dist/assets/vendor/, URL literals rewritten
  build.mjs          pipeline + checks + build-report.json
  dev/dom-shim.mjs   DOM + layout shim for Node
  dev/smoke.mjs      one scenario
  dev/smoke-all.mjs  every scenario
  dev/verify-engine.mjs  request every asset the built engine can ask for
src/css/engine.css   the additive stylesheet (fallback engine + diagnostics)
src/js/              the fallback engine (14 modules)
server.mjs           zero-dependency static server (0.0.0.0:4173, --watch)
.github/workflows/vendor-offbrand.yml   re-harvests vendor/ on demand
dist/                build output (git-ignored)
```

## Provenance

`vendor/` is a mirror of files that belong to OFF+BRAND, McLaren and Lando
Norris — the engine bundle, the Rive artboards, the 3D assets — harvested from
the hosts the live site uses and from the Wayback Machine, and kept here so
that this rebuild can run the animation it was designed around. It is not
licensed for redistribution: treat this repository as a private study of a
published site, keep it out of production, and delete `vendor/` (then build
with `--local`) if you want a version that ships nothing but your own code.

`window.landnr` exposes `report`, `scrollTo`, `openMenu`, `toggleMenu`,
`pauseMarquees`, `refreshAmbient`, `splitPending`, `disableSmoothScroll` and
`replay()` for poking at the running page.

---

Built from a saved copy of a public website for study and local development.
All content, imagery and branding belong to Lando Norris / OFF+BRAND; nothing
here is affiliated with or endorsed by them, and nothing is tracked.
