# CLAUDE.md

Guidance for Claude when working in this repository.

## Project overview

Justin (Junyoung) Park's personal portfolio. It's a static site with no build step and no dependencies: open `index.html` and it runs. The remote is `git@github.com:junjpark/portfolio-new.git` (Justin pushes over SSH).

The hero sits on top of **The River Fisher**, a hand-painted, anime-style river scene drawn entirely in code (Canvas 2D) on a fixed full-screen canvas. Visitors fish in it, and every catch shows a fun fact about Justin. A "reel-up" arrow at the bottom of the hero gets hooked by the fisher, who hauls the selected-work board up into view. Each board tile opens a case-study page.

## Repository layout

| Path                    | Purpose |
|-------------------------|---------|
| `index.html`            | The main page: inline CSS, the hero, the work board, the reel-up arrow, the `RiverFisher.init` call with the facts, and the `WORK` array that renders the board |
| `river-fisher.js`       | The scene, the game, the catches and the fact cards (~3,300 lines, one self-contained IIFE exposing `window.RiverFisher`) |
| `work/`                 | Board images, one per project, listed in `WORK` (see `work/README.md`) |
| `projects/<slug>.html`  | Case-study pages, one per project (9 total) |
| `projects/project.css`  | Shared styles for every case-study page |
| `projects/slideshow.js` | Photo slideshow used on every case-study page |
| `projects/img/<slug>/`  | Extra slideshow photos (`2.jpg`, `3.jpg`, …). Photo 1 is the board image from `work/` |
| `catches/`              | Image-based catches, listed under `catchImages` (see `catches/README.md`). Currently `overwatch.svg` |
| `icons/`                | White logos for the hero's icon buttons: `github.svg`, `linkedin.png`, `mail.svg` (see `icons/README.md`) |
| `resume.pdf`            | Resume, linked from the "View Resume" button |

## Running locally

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Visual language

Everything outside the canvas borrows from the scene's fact card and how-to bubble. Reuse these values instead of inventing new ones (they're the `:root` variables in `projects/project.css`):

- **Ground:** `#f6f3ee` (work section and case-study pages). **Card / paper:** `#fffaf0`.
- **Ink text:** `#25302f`, softer `#3a403d`, muted `#5f5a52`.
- **Ink outline:** `rgba(46,30,24,.8)` at 1.3–1.6px, drawn with `box-shadow: 0 0 0 1.5px …`. Cards use slightly uneven radii (e.g. `14px 16px 13px 16px`).
- **Hairlines:** `rgba(46,30,24,.16)`, 1px.
- **Kickers (small labels):** 11.5–13px, weight 600–700, uppercase, letter-spacing .09–.12em, amber `#9a6430`.
- **Links:** `#b4562c`. **Gold accent** (current / featured): `#c99a48` dot, `rgba(201,154,72,.85)` hairline ring. Keep the accent quiet; Justin asked for less loud highlights.
- **Type:** headings in `ui-serif, Georgia, serif` (600); body in `ui-sans-serif, system-ui, sans-serif`.
- **Buttons:** pill shape. The hero uses a cream CTA on the dark scene; light pages use an ink-filled primary and a thin-ink-ring secondary. Round icon buttons have a thin white ring on the hero.

## How the page works

### Hero
`<h1>Hi, I'm Justin.</h1>`, the `.lede` "I like building cool things.", a `.focus` label reading "Backend · Cloud · AI" (written in sentence case and uppercased by CSS so screen readers read the words; wording may change as Justin's focus shifts), and an `.actions` row: the `.cta` resume button plus round `.icon-btn` links (GitHub, LinkedIn, Email → `mailto:junjpark02@gmail.com`). New icon buttons follow the same markup: `<a class="icon-btn" ... aria-label="…" title="…"><img class="logo" src="icons/…" alt=""></a>`.

### Work board
`WORK` in `index.html` is an array of `{ src, w, h, kicker, title, href, badge }`, in reading order (top-left to bottom-right). `w`/`h` must match the image's real pixel size. Tiles are dealt round-robin into 1–3 columns by width, so the order reads row by row. `href` turns a tile into a link: case studies (`projects/<slug>.html`) open in the same tab, external `http(s)` URLs in a new one. `badge` adds a thin gold ring and a small label; League of Legends is badged "Current project".

Current order: People's Voice Survey Dashboard, Mobility Project, tailor, GrubU, League of Legends Game Review (badged), Revitalizing Filipino Heritage Through AR, ReBalance, LeetCode 1v1, cory.

### Case-study pages
Every page shares the same markup, top to bottom:

1. A bar with "← Back to work" (`../index.html#work`) and "Justin Park" (home).
2. `.intro`: `.kicker` (plus `.badge` for the current project), `<h1>`, `.summary`, and `.links` with the GitHub (`.btn.primary`) and demo (`.btn`) buttons. A button is left out when there's no link; an HTML comment on each page shows the button markup.
3. `figure.slides`: the slideshow. Arrows, dots (darker = current), ←/→ keys when focused, and swipe; it wraps around. The controls hide when there's only one photo. Add photos as `<img>` tags inside `.track` (files in `projects/img/<slug>/`, with `width`, `height`, `alt` and `loading="lazy"`). The frame's aspect ratio comes from `--ratio` (the first photo's `w / h`); other photos letterbox inside it.
4. `dl.meta`: Role, Timeline, Stack (`.chips`).
5. `.block` sections: Overview, What I built, Outcome (optionally a `.stats` row of big numbers).
6. `nav.more`: previous / next project, in `WORK` order, wrapping.

Placeholders are `<span class="todo">…</span>`, rendered as dashed boxes reading "To fill in: …". Find them with `grep -n 'class="todo"' projects/*.html`.

Slugs: `peoples-voice-dashboard`, `mobility-project`, `tailor`, `grubu`, `league-game-review`, `filipino-heritage-ar`, `rebalance`, `leetcode-1v1`, `cory`.

Content status:
- **People's Voice Survey Dashboard:** filled from the resume; "Visit the site" → `https://quest.wustl.edu/pvs`; 4 slideshow photos (map, single-country bar chart, US vs UK comparison). Still needs Role and Overview.
- **League of Legends Game Review** and **LeetCode 1v1:** filled from the resume. Still need Role, extra Overview detail and GitHub/demo links.
- **The other six:** title, kicker and image only. Everything else is a placeholder. Known facts: tailor is an AI-powered clothing iOS app; ReBalance is mainly an LLM API project; the Filipino Heritage AR project is a proof-of-concept proposal (no codebase); Mobility Project is from WashU Digital Transformation.

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
- Image catches (`catchImages`) are added to `CATCHES` only once their image loads, so a missing file never breaks anything. `overwatch` is one.
- A fact is a string, or `{ text, linkText, link }`: the `linkText` part of `text` becomes a link (new tab), and stays plain bold text while `link` is empty.
- Every fact is drawn once, shuffled, before any repeats.
- Current facts: jjajangmyeon (favorite food), bottle (food blog in progress, no link), viola (10+ years, Debussy String Quartet), overwatch (semi-pro, top 50 in the US), tinikling (links to the performance video), hongkong (studying AI/ML at HKUST).
- `facts.fish` is `[]`, so every catch is a treasure. The hint bubble still shows a fish as a possible catch.

### Click passthrough and accessibility
Links, buttons, inputs, labels and anything with `data-rf-ignore` keep normal clicks and cursor. The custom cursor applies only above the bottom of the hero. The fact card is real DOM text with `aria-live`. `prefers-reduced-motion` or `interactive: false` gives a passive 60-second loop with no game; on case-study pages it makes the slideshow switch instantly. Space reels during the fight.

## Ground rules

- **Never invent personal facts, project details, metrics or links.** Use what's in this file, `resume.pdf` or what Justin provides; otherwise leave a `todo` placeholder and ask.
- **Keep it static.** Plain HTML, CSS and JavaScript, no frameworks, no bundler, no build step. Small shared files for the case-study pages (`project.css`, `slideshow.js`) are fine.
- **Keep `river-fisher.js` self-contained** and the scene drawn in code. Don't split it into modules or add image assets to the scene without asking.
- **Don't draw company logos or known characters yourself.** Use official files Justin supplies (as with the GitHub, LinkedIn and Overwatch logos).
- **Keep the reduced-motion path and keyboard support working.**
- **Performance:** the canvas runs on every page load; keep per-frame work light and respect `quality: 'low'`.
- **Images:** resize to 2000px wide, flatten transparency onto white and save as JPEG (quality ~86–88) unless a PNG is needed. Keep `w`/`h` attributes in sync with the real size.
- **Git:** small commits with clear messages. If git leaves `.git/*.lock` files behind (it can on mounted folders), delete them after committing.

## Roadmap

### Open questions for Justin
- **Experience section:** four directions were mocked up on a Claude design canvas ("Portfolio Experience Section"), each sitting above the project board: A Ledger (quiet ruled list), B Field notes (tilted cream cards like the fact card), C River line (job cards hanging from a fishing line with bobs), D Split column (big serif summary, education and awards on the left, jobs on the right). None chosen yet. Content comes from the resume: FRB St. Louis cloud engineering intern, Proximity LLC principal software engineer, WashU OOP teaching assistant, plus "Now: AI/ML at HKUST".
- Is tailor the AI clothing try-on app that won 1st place at Google DevFest (from the resume's awards)? If so, add it to tailor's Outcome.
- Confirm the food-blog wording and the email address (both are live now).

### Phase 1: Content
- [x] Tinikling link and food-blog fact.
- [x] Hero line, "Backend · Cloud · AI" label and email button.
- [x] Case-study template, all 9 pages, slideshow, and tile links.
- [ ] Fill in the case-study placeholders (role, overview, what was built, outcome, stack, dates) and GitHub/demo links, project by project as Justin sends content.
- [ ] Add more slideshow photos (People's Voice has 4; the rest have 1).
- [ ] Build the Experience section once a direction is chosen.
- [ ] Replace weak board images: Filipino Heritage AR and Mobility Project (title slides), tailor (logo only), ReBalance (reads as a New Balance product page).

### Phase 2: Ship
- [ ] Add a favicon and Open Graph/Twitter tags with a preview image (for LinkedIn shares) on `index.html` and every case-study page. Case-study pages already have `<meta name="description">`; `index.html` doesn't.
- [ ] Give `resume.pdf` a document title.
- [ ] Deploy (GitHub Pages, Vercel or Netlify; optional custom domain).
- [ ] Test on real phones and run Lighthouse.

### Phase 3: Polish
- [ ] Make the game work well on touch: touch-appropriate hint icons, and holding to reel without triggering scroll or long-press.
- [ ] Resolve the fish question: add fish facts, or remove the fish from the hint bubble.
- [ ] Convert board and slideshow images to WebP (keep JPG/PNG fallbacks if needed).
- [ ] Update the README and the header comment in `river-fisher.js` (missing Tinikling, Hong Kong, `catchImages`, linked facts, badges, `hint`, case-study pages).
- [ ] Remove the unused `body.dark-text` / `body.no-text` CSS.
- [ ] Optional: add HKUST study abroad to the resume, since the Hong Kong fact mentions it.

## Manual test checklist

No automated tests. After changes, check:

- [ ] Cast, hook and reel in a catch; a fact card appears; "Keep fishing →" dismisses it.
- [ ] Facts don't repeat until all have been shown; linked facts open in a new tab.
- [ ] Holding Space works as well as holding the mouse.
- [ ] The reel-up arrow brings the board into view and fades out once scrolled.
- [ ] Hero buttons and board tiles click normally with a normal cursor; tiles open their case study in the same tab.
- [ ] Each case-study page loads; "Back to work" returns to the board; previous/next links work.
- [ ] Slideshow: arrows, dots, ←/→ keys and swipe all move between photos and wrap around; one-photo pages show no controls.
- [ ] Reduced motion on: passive loop, no game; the slideshow switches without sliding.
- [ ] Layout holds at phone width (≤720px) and on wide screens.
