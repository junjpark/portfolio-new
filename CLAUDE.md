# CLAUDE.md

Guidance for Claude when working in this repository.

## Project overview

Justin (Junyoung) Park's personal portfolio. It's a static site with no build step and no dependencies: open `index.html` and it runs.

The hero sits on top of **The River Fisher**, a hand-painted, anime-style river scene drawn entirely in code (Canvas 2D) on a fixed full-screen canvas. Visitors fish in it, and every catch shows a fun fact about Justin. A "reel-up" arrow at the bottom of the hero gets hooked by the fisher, who hauls the selected-work board up into view.

## Repository layout

| Path              | Purpose |
|-------------------|---------|
| `index.html`      | The whole page: inline CSS, the hero, the work board, the reel-up arrow, the `RiverFisher.init` call with the facts, and the `WORK` array that renders the board |
| `river-fisher.js` | The scene, the game, the catches and the fact cards (~3,300 lines, one self-contained IIFE exposing `window.RiverFisher`) |
| `work/`           | Project images for the board, listed in `WORK` (see `work/README.md`) |
| `catches/`        | Image-based catches, listed under `catchImages` (see `catches/README.md`). Currently `overwatch.svg` |
| `icons/`          | White logos for the hero's icon buttons: `github.svg`, `linkedin.png`, `mail.svg` (see `icons/README.md`) |
| `projects/`       | Case-study pages, one per project (`<slug>.html`), all styled by `projects/project.css`. Placeholders still to fill are marked `<span class="todo">` |
| `resume.pdf`      | Resume, linked from the "View Resume" button |

## Running locally

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## How the page works

### Hero
`<h1>`, a one-line `.lede`, and an `.actions` row: the `.cta` resume button plus round `.icon-btn` links (GitHub, LinkedIn, Email). New icon buttons follow the same markup: `<a class="icon-btn" ... aria-label="…" title="…"><img class="logo" src="icons/…" alt=""></a>`.

### Work board
`WORK` in `index.html` is an array of `{ src, w, h, kicker, title, href, badge }`, in reading order. `w`/`h` must match the image's real pixel size. `href` turns a tile into a link: case studies (`projects/<slug>.html`) open in the same tab, external `http(s)` URLs in a new one. `badge` adds a gold ring and a label (League of Legends is badged "Current project"). The board deals tiles into 1–3 columns by width.

### River Fisher API

```js
RiverFisher.init(canvas, {
  quality: 'high' | 'low', interactive: true, hideCursor: true, hint: true, parallax: true,
  facts,        // { kind: [fact, …] }
  catchImages,  // { kind: { src, label, size } }
  onCatch,      // (catch) => {}
  heroHeight,
});
RiverFisher.reelUp(button, { to });   // `to`: element or scroll position; returns a Promise
RiverFisher.pause(); RiverFisher.resume(); RiverFisher.destroy();
RiverFisher.create(canvas, options);  // independent instance
```

Treat these as a stable contract. If one changes, update `index.html`, the README and the header comment in `river-fisher.js` in the same change.

### Catches and facts
- Built-in catch kinds live in `CATCHES` in `river-fisher.js`: `fish`, `jjajangmyeon`, `bottle`, `viola`, `tinikling`, `hongkong`. Each non-fish kind has a draw function and an entry in `GRIP`.
- Image catches (`catchImages`) are added to `CATCHES` only once their image loads, so a missing file never breaks anything.
- A fact is a string, or `{ text, linkText, link }`: the `linkText` part of `text` becomes a link, and stays plain bold text while `link` is empty.
- Every fact is drawn once, shuffled, before any repeats.
- `facts.fish` is currently `[]`, so every catch is a treasure. Note the hint bubble still shows a fish as a possible catch.

### Click passthrough and accessibility
Links, buttons, inputs, labels and anything with `data-rf-ignore` keep normal clicks and cursor. The fact card is real DOM text with `aria-live`. `prefers-reduced-motion` or `interactive: false` gives a passive 60-second loop with no game. Space reels during the fight.

## Ground rules

- **Never invent personal facts, project details, metrics or links.** Use what's in this file, `resume.pdf` or what Justin provides; otherwise leave a clearly marked placeholder and ask.
- **Keep it static.** Plain HTML, CSS and JavaScript, no frameworks, no bundler, no build step. A small shared CSS file for the case-study pages is fine.
- **Keep `river-fisher.js` self-contained** and the scene drawn in code. Don't split it into modules or add image assets to the scene without asking.
- **Keep the reduced-motion path and keyboard support working.**
- **Performance:** the canvas runs on every page load; keep per-frame work light and respect `quality: 'low'`.

## Roadmap

### Decisions made
- **Tinikling fact link:** `https://www.youtube.com/watch?v=qcwGhEe47U8` (fill in `link` on the `tinikling` fact).
- **Food blog fact:** reword so it says Justin is *working on* a food blog, not that he has one. Make it a plain string with no link, e.g. `"I'm working on a food blog: recipe ideas, a food diary and more. Coming soon!"` (confirm wording).
- **Project details:** separate case-study pages, one per project, each with GitHub and/or demo links.
- **Email button:** add a third `.icon-btn` in the hero linking to `mailto:junjpark02@gmail.com` (the address on the resume; confirm it's the one to use). Add a white `icons/mail.svg` to match the other logos, with `aria-label="Email"`.
- **Hero line:** change the `.lede` to "I like building cool things." and add a small focus label under it reading "BACKEND · CLOUD · AI". Style the label like the work board's kickers (small, semibold, uppercase, wide letter-spacing, muted color) and keep it as real text so screen readers read it. Wording is "good for now"; the label may change as Justin's focus shifts.

### Phase 1: Content
- [x] Set the Tinikling link and reword the food-blog fact (see above).
- [x] Update the hero line and add the "BACKEND · CLOUD · AI" label (see above).
- [x] Add the email button.
- [ ] Build the case-study pages (template, all 9 pages and tile links done; League, LeetCode 1v1 and People's Voice filled from the resume; the rest need content, and every page still needs its role and GitHub/demo links. Find gaps with `grep -n todo projects/*.html`):
  - One page per project at `projects/<slug>.html`, sharing one template and `projects/project.css` so they look consistent with the main site (same palette and type).
  - Each page: title and kicker, a photo slideshow (`projects/slideshow.js`: arrows, dots, ←/→ keys and swipe; controls hide when there's one photo; add photos as `<img>` tags in the page's `.track`, files in `projects/img/<slug>/`), overview (the problem), Justin's role, tech stack, what was built, outcome/results, and buttons for GitHub and Demo (hide a button when there's no link). A "Back to work" link returns to `index.html#work`.
  - Set each `WORK` tile's `href` to its page and open it in the same tab (case studies are part of the site, not external links).
  - Slugs: `peoples-voice-dashboard`, `mobility-project`, `tailor`, `grubu`, `league-game-review`, `filipino-heritage-ar`, `rebalance`, `leetcode-1v1`, `cory`.
  - Resume details exist for League of Legends Game Review, LeetCode 1v1 and People's Voice Survey. Everything else needs content from Justin.
- [ ] Replace weak board images: Filipino Heritage AR and Mobility Project (title slides), tailor (logo only), ReBalance (reads as a New Balance product page).

### Phase 2: Ship
- [ ] Add a favicon, `<meta name="description">`, and Open Graph/Twitter tags with a preview image (for LinkedIn shares). Same for each case-study page.
- [ ] Give `resume.pdf` a document title.
- [ ] Deploy (GitHub Pages, Vercel or Netlify; optional custom domain).
- [ ] Test on real phones and run Lighthouse.

### Phase 3: Polish
- [ ] Make the game work well on touch: touch-appropriate hint icons, and holding to reel without triggering scroll or long-press.
- [ ] Resolve the fish question: add fish facts, or remove the fish from the hint bubble.
- [ ] Convert board images to WebP (keep JPG/PNG fallbacks if needed).
- [ ] Update the README and the header comment in `river-fisher.js` (missing Tinikling, Hong Kong, `catchImages`, linked facts, badges, `hint`).
- [ ] Remove the unused `body.dark-text` / `body.no-text` CSS.
- [ ] Optional: add HKUST study abroad to the resume, since the Hong Kong fact mentions it.

## Manual test checklist

No automated tests. After changes, check:

- [ ] Cast, hook and reel in a catch; a fact card appears; "Keep fishing →" dismisses it.
- [ ] Facts don't repeat until all have been shown; linked facts open in a new tab.
- [ ] Holding Space works as well as holding the mouse.
- [ ] The reel-up arrow brings the board into view and fades out once scrolled.
- [ ] Hero buttons and board tiles click normally with a normal cursor.
- [ ] Each case-study page loads, its links work, and "Back to work" returns to the board.
- [ ] Reduced motion on: passive loop, no game.
- [ ] Layout holds at phone width (≤720px) and on wide screens.
