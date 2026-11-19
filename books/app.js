// Progressive enhancement for the sales page: filtering, search and the
// details dialog. The page is complete without this file.
(() => {
  const grid = document.getElementById('grid');
  if (!grid) return;

  const cards = [...grid.querySelectorAll('.card')];
  const chips = [...document.querySelectorAll('.chip')];
  const q = document.getElementById('q');
  const count = document.getElementById('count');
  const empty = document.getElementById('empty');
  const clear = document.getElementById('clear');
  const dlg = document.getElementById('dlg');
  const dlgBody = document.getElementById('dlg-body');
  const dlgClose = document.getElementById('dlg-close');
  const total = cards.length;

  const labelFor = (cat) => {
    const chip = chips.find((c) => c.dataset.cat === cat);
    return chip ? chip.firstChild.textContent.trim() : cat;
  };

  const state = { cat: 'all', text: '' };

  // Show the catalogue in pages so 118 cards are not all laid out at once.
  // Every card stays in the HTML (search engines, no-JS visitors, deep links);
  // this only hides the overflow, and only once this script is running.
  const PAGE = 24;
  let limit = PAGE;
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'btn btn--ghost more';
  more.hidden = true;
  grid.after(more);
  more.addEventListener('click', () => {
    const first = cards.filter((c) => !c.hidden).length;
    limit += PAGE;
    render();
    const next = cards.filter((c) => !c.hidden)[first];
    if (next) next.querySelector('a, button')?.focus({ preventScroll: false });
  });

  function matches(card) {
    if (state.cat === 'free' && card.dataset.free !== '1') return false;
    if (state.cat !== 'all' && state.cat !== 'free' && card.dataset.cat !== state.cat && card.dataset.set !== state.cat) return false;
    if (!state.text) return true;
    const hay = card.dataset.search;
    return state.text.split(/\s+/).every((word) => hay.includes(word));
  }

  function render() {
    let shown = 0;
    let visible = 0;
    for (const card of cards) {
      const ok = matches(card);
      if (ok) shown++;
      card.hidden = !ok || shown > limit;
      if (!card.hidden) visible++;
    }
    const left = shown - visible;
    more.hidden = left <= 0;
    more.textContent = `Show ${Math.min(PAGE, left)} more (${left} left)`;
    for (const chip of chips) chip.setAttribute('aria-pressed', String(chip.dataset.cat === state.cat));
    empty.hidden = shown !== 0;
    const filtered = state.cat !== 'all' || state.text;
    count.textContent = !filtered
      ? (left > 0 ? `Showing ${visible} of ${total} titles` : `Showing all ${total} titles`)
      : `Showing ${visible} of ${shown} titles` +
        (state.cat !== 'all' ? ` in ${labelFor(state.cat)}` : '') +
        (state.text ? ` matching “${q.value.trim()}”` : '') +
        ` (${total} in all)`;
    syncUrl();
  }

  function syncUrl() {
    try {
      const url = new URL(location.href);
      state.cat === 'all' ? url.searchParams.delete('c') : url.searchParams.set('c', state.cat);
      state.text ? url.searchParams.set('q', state.text) : url.searchParams.delete('q');
      history.replaceState(null, '', url);
    } catch { /* file:// or sandboxed frames may refuse; the filter still works */ }
  }

  chips.forEach((chip) =>
    chip.addEventListener('click', () => {
      state.cat = chip.dataset.cat;
      limit = PAGE;
      render();
    }),
  );

  let timer;
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.text = q.value.trim().toLowerCase();
      limit = PAGE;
      render();
    }, 120);
  });

  clear.addEventListener('click', () => {
    state.cat = 'all';
    state.text = '';
    q.value = '';
    limit = PAGE;
    render();
    q.focus();
  });

  // ------------------------------------------------------------ dialog
  let lastFocus = null;

  function openBook(id, { pushHash = true } = {}) {
    const card = document.getElementById('b-' + id);
    const tpl = card && card.querySelector('template');
    if (!tpl) return;
    dlgBody.replaceChildren(tpl.content.cloneNode(true));
    dlgBody.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; });
    lastFocus = document.activeElement;
    if (!dlg.open) dlg.showModal();
    // Start at the top and keep focus inside, whether opened by click or by a deep link on load.
    dlgClose.focus({ preventScroll: true });
    dlg.scrollTop = 0;
    requestAnimationFrame(() => {
      if (dlg.open) dlgClose.focus({ preventScroll: true }); // after any fragment-navigation focus reset
      dlg.scrollTop = 0;
    });
    document.body.classList.add('is-locked');
    if (pushHash) {
      try { history.replaceState(null, '', '#b-' + id); } catch { /* ignore */ }
    }
  }

  function closeDialog() {
    if (dlg.open) dlg.close();
  }

  dlg.addEventListener('close', () => {
    if (dlg.open) return; // reopened for another book before this event ran
    document.body.classList.remove('is-locked');
    try {
      const url = new URL(location.href);
      url.hash = '';
      history.replaceState(null, '', url);
    } catch { /* ignore */ }
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  });

  dlgClose.addEventListener('click', closeDialog);
  // Native <dialog> already closes on Esc; handling it too keeps it working
  // in embedded browsers that swallow the cancel event.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dlg.open) {
      e.preventDefault();
      closeDialog();
    }
  });
  // Click on the backdrop (the dialog element itself, outside its content) closes.
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) closeDialog();
  });

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-open]');
    if (trigger) openBook(trigger.dataset.open);
  });

  // ------------------------------------------------------- back to top
  const toTop = document.getElementById('to-top');
  if (toTop) {
    toTop.hidden = false;
    const sync = () => toTop.classList.toggle('is-visible', window.scrollY > 700);
    window.addEventListener('scroll', sync, { passive: true });
    toTop.addEventListener('click', () => {
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
    });
    sync();
  }

  // ---------------------------------------------------------- start-up
  const params = new URLSearchParams(location.search);
  const c = params.get('c');
  if (c && chips.some((chip) => chip.dataset.cat === c)) state.cat = c;
  const text = params.get('q');
  if (text) {
    state.text = text.trim().toLowerCase();
    q.value = text;
  }
  render();

  // Deep links: #b-<id> opens that book's details, on load and on later hash changes.
  const openFromHash = () => {
    const m = location.hash.match(/^#b-(.+)$/);
    if (m) openBook(decodeURIComponent(m[1]), { pushHash: false });
  };
  window.addEventListener('hashchange', openFromHash);
  openFromHash();
  // Instagram has no web share link: copy the book's link, then open Instagram.
  let toast;
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.share__btn[data-copy]');
    if (!btn) return;
    const url = btn.dataset.copy;
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch {}
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'share-toast';
      toast.setAttribute('role', 'status');
      document.body.append(toast);
    }
    toast.textContent = copied ? 'Link copied. Paste it into your Instagram story or bio.' : `Copy this link for Instagram: ${url}`;
    toast.classList.add('is-visible');
    btn.classList.add('is-copied');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { toast.classList.remove('is-visible'); btn.classList.remove('is-copied'); }, 3200);
    window.open('https://www.instagram.com/', '_blank', 'noopener');
  });

  // A deep link opens before the page has finished loading; reset once it has.
  window.addEventListener('load', () => { if (dlg.open) dlg.scrollTop = 0; });
})();
