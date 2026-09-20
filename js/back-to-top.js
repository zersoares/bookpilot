// Landing page: a "back to top" button that appears once the visitor has
// scrolled past the first screens. The page is complete without it.
const btn = document.getElementById('to-top');

if (btn) {
  btn.hidden = false;
  const sync = () => btn.classList.toggle('is-visible', window.scrollY > 700);
  window.addEventListener('scroll', sync, { passive: true });
  btn.addEventListener('click', () => {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
  });
  sync();
}
