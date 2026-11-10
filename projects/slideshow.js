/* Photo slideshow for the case-study pages.
 * Markup: <figure class="slides"><div class="viewport"><div class="track"><img>…</div></div>
 *           <button class="arrow prev"> <button class="arrow next"> <div class="dots"></div></figure>
 * Add photos by adding <img> tags to .track. Arrows, dots, the ← / → keys and swipe all move between them;
 * with a single photo the controls stay hidden. */
(function () {
  'use strict';
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.querySelectorAll('.slides').forEach((root) => {
    const track = root.querySelector('.track');
    const slides = Array.from(track.children).filter((el) => el.tagName === 'IMG');
    const prev = root.querySelector('.arrow.prev'), next = root.querySelector('.arrow.next');
    const dotsEl = root.querySelector('.dots');
    const n = slides.length;
    if (n < 2) { root.classList.add('single'); return; }

    const status = document.createElement('p');
    status.className = 'sr-only'; status.setAttribute('aria-live', 'polite');
    root.appendChild(status);

    const dots = slides.map((img, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'dot';
      b.setAttribute('aria-label', 'Show photo ' + (i + 1) + ' of ' + n);
      b.addEventListener('click', () => go(i));
      dotsEl.appendChild(b);
      return b;
    });

    let cur = 0;
    function go(i, announce = true) {
      cur = (i + n) % n;
      track.style.transform = 'translateX(' + (-cur * 100) + '%)';
      slides.forEach((s, k) => {
        s.setAttribute('aria-hidden', k === cur ? 'false' : 'true');
        // load the current photo and its neighbours (wrapping), so the next slide is ready
        if (k === cur || k === (cur + 1) % n || k === (cur - 1 + n) % n) s.loading = 'eager';
      });
      dots.forEach((d, k) => d.setAttribute('aria-current', k === cur ? 'true' : 'false'));
      if (announce) status.textContent = 'Photo ' + (cur + 1) + ' of ' + n;
    }

    prev.addEventListener('click', () => go(cur - 1));
    next.addEventListener('click', () => go(cur + 1));
    root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(cur - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(cur + 1); }
    });

    // swipe (touch / pen): follow the finger, then settle on the nearest photo
    const vp = root.querySelector('.viewport');
    let x0 = null, y0 = 0, dx = 0, horiz = null;
    vp.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      x0 = e.clientX; y0 = e.clientY; dx = 0; horiz = null;
    });
    vp.addEventListener('pointermove', (e) => {
      if (x0 === null) return;
      dx = e.clientX - x0;
      if (horiz === null && Math.hypot(dx, e.clientY - y0) > 8) horiz = Math.abs(dx) > Math.abs(e.clientY - y0);
      if (horiz) {
        track.classList.add('dragging');
        track.style.transform = 'translateX(calc(' + (-cur * 100) + '% + ' + dx + 'px))';
      }
    });
    const end = () => {
      if (x0 === null) return;
      track.classList.remove('dragging');
      if (horiz && Math.abs(dx) > vp.clientWidth * 0.18) go(cur + (dx < 0 ? 1 : -1)); else go(cur, false);
      x0 = null;
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);

    if (reduced) track.classList.add('instant');
    root.tabIndex = 0;
    root.setAttribute('aria-roledescription', 'slideshow');
    go(0, false);
  });
})();
