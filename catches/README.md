# Image catches

Extra things the fisher can reel in, drawn from an image file. Each one is listed under `catchImages` in `index.html`
and paired with a fact under `facts`:

```js
catchImages: { overwatch: { src: 'catches/overwatch.svg', label: 'an Overwatch emblem', size: 36 } },
facts: { overwatch: ['…'] },
```

A catch only joins the pool once its image file loads, so a missing file never breaks anything.

- `overwatch.svg`: the Overwatch circle logo (public domain), from
  https://commons.wikimedia.org/wiki/File:Overwatch_circle_logo.svg ("Download" → original file).
  Credit: Blizzard Entertainment, public domain, via Wikimedia Commons.
