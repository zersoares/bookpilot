/* Landing page: series shelf arrows and the relationship-map selector.
   Both sections are complete without this file — it only adds the
   arrows (shown when the shelf overflows) and switching between
   characters. */

// ---- Relationship map: one entry visible at a time --------------------
const nodes = [...document.querySelectorAll('.bp-map__node')];
const panels = [...document.querySelectorAll('.bp-map__panel')];

function select(key) {
  for (const n of nodes) n.setAttribute('aria-pressed', String(n.dataset.char === key));
  for (const p of panels) p.hidden = p.dataset.panel !== key;
}
for (const n of nodes) n.addEventListener('click', () => select(n.dataset.char));

// ---- Languages: pause the drifting rows ---------------------------------
const langBand = document.getElementById('languages');
const langToggle = document.getElementById('lang-toggle');
if (langBand && langToggle) {
  langToggle.addEventListener('click', () => {
    const paused = langBand.classList.toggle('is-paused');
    langToggle.setAttribute('aria-pressed', String(paused));
    langToggle.textContent = paused ? 'Play' : 'Pause';
  });
}

// ---- Series shelf: arrows only when the books do not fit --------------
const row = document.getElementById('series-row');
const prev = document.querySelector('.bp-series__nav--prev');
const next = document.querySelector('.bp-series__nav--next');

if (row && prev && next) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  const sync = () => {
    const overflow = row.scrollWidth > row.clientWidth + 1;
    prev.hidden = next.hidden = !overflow;
    prev.disabled = row.scrollLeft <= 1;
    next.disabled = row.scrollLeft + row.clientWidth >= row.scrollWidth - 1;
  };
  const step = (dir) =>
    row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: reduce.matches ? 'auto' : 'smooth' });

  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  row.addEventListener('scroll', sync, { passive: true });
  new ResizeObserver(sync).observe(row);
  sync();
}
