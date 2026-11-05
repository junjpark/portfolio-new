# Portfolio: The River Fisher

A hand-painted, anime-style river scene drawn entirely in code (Canvas 2D, no image assets) that sits behind the portfolio hero, and that visitors can fish in.

- **Fishing game:** the cursor is the bob. Click the water to cast. When the float plunges, click to hook, then hold the mouse (or Space) to keep the fish inside the green bar.
- **Fun facts:** every catch is a fun fact. Most catches are fish, and every so often a bowl of jjajangmyeon, a note in a bottle or an old viola turns up instead. Each fact comes up once before any repeats.
- **Reel-up arrow:** the arrow at the bottom of the hero gets hooked, and after a struggle the fisher hauls the page content up into view.
- **Reduced motion:** visitors with reduced motion turned on, or `interactive: false`, get a passive 60-second loop.

## Files

| File | What it is |
|---|---|
| `index.html` | The page: hero, project section and the reel-up arrow |
| `river-fisher.js` | The scene, the game and the fact cards (one self-contained file) |

## Run it

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Your fun facts

The facts in `index.html` are placeholders in `[brackets]`. Replace them with your own:

```js
RiverFisher.init(document.getElementById('river'), {
  facts: {
    fish: ['…', '…', '…'],     // one fish per fact
    jjajangmyeon: ['…'],
    bottle: ['…'],
    viola: ['…'],
  },
});
```

## API

```js
RiverFisher.init(canvas, { quality: 'high' | 'low', interactive: true, hideCursor: true, facts, onCatch, heroHeight })
RiverFisher.reelUp(button, { to })   // `to`: an element or a scroll position (default: bottom of the hero)
RiverFisher.pause(); RiverFisher.resume(); RiverFisher.destroy();
```

Links, buttons, inputs and anything marked `data-rf-ignore` keep normal clicks and cursor.
