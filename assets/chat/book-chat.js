// BookPilot book guide — floating widget. No cookies, no storage; the
// conversation lives only in this page's memory and is gone on reload.
(() => {
  if (document.getElementById('bc-launch')) return;
  const LOGO = '/assets/brand/logo-mark.svg';
  const el = (t, a = {}, ...kids) => { const n = document.createElement(t); for (const [k, v] of Object.entries(a)) k === 'text' ? n.textContent = v : n.setAttribute(k, v); n.append(...kids); return n; };
  const css = el('link', { rel: 'stylesheet', href: '/assets/chat/book-chat.css' }); document.head.append(css);
  const launch = el('button', { id: 'bc-launch', class: 'bc-launch', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'bc-panel' }, el('img', { src: LOGO, alt: '' }), el('span', { text: 'Find your book' }));
  launch.setAttribute('aria-label', 'Open the book guide');
  const log = el('div', { class: 'bc-log', role: 'log', 'aria-live': 'polite' });
  const input = el('input', { type: 'text', maxlength: '500', placeholder: 'What are you looking for?', 'aria-label': 'Tell the book guide what you are looking for', autocomplete: 'off' });
  const form = el('form', { class: 'bc-form' }, input, el('button', { type: 'submit', text: 'Send' }));
  const close = el('button', { type: 'button', 'aria-label': 'Close the book guide', text: '×' });
  const note = el('p', { class: 'bc-note' }); note.innerHTML = 'Suggestions come only from Zirlandia Milkovic’s own books, picked by AI. Chats aren’t stored. <a href="/privacy.html#book-guide">Privacy</a>';
  const panel = el('div', { id: 'bc-panel', class: 'bc-panel', role: 'dialog', 'aria-label': 'BookPilot book guide', hidden: '' },
    el('div', { class: 'bc-head' }, el('img', { src: LOGO, alt: '' }), el('h2', { text: 'BookPilot book guide' }), close), log, form, note);
  document.body.append(launch, panel);
  // Keep the launcher (and panel) above the cookie notice while it is visible.
  const lift = () => {
    const n = document.querySelector('.bpcn');
    const vis = n && !n.hidden && n.offsetParent !== null && getComputedStyle(n).display !== 'none';
    const off = vis ? Math.max(0, window.innerHeight - n.getBoundingClientRect().top) + 10 : 0;
    launch.style.bottom = off ? off + 'px' : '';
    panel.style.bottom = off ? (off + 60) + 'px' : '';
  };
  new MutationObserver(lift).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  window.addEventListener('resize', lift); lift(); setTimeout(lift, 600); setTimeout(lift, 2000);
  const history = [];
  const say = (text, who) => { const m = el('div', { class: 'bc-msg bc-msg--' + who, text }); log.append(m); log.scrollTop = log.scrollHeight; return m; };
  const book = (b) => {
    const acts = el('div', { class: 'bc-acts' });
    acts.append(el('a', { class: 'bc-buy', href: b.buy, target: b.buy.startsWith('http') ? '_blank' : '_self', rel: 'noopener sponsored', text: b.free ? 'Get it free' : 'Buy' }));
    if (b.page !== b.buy) acts.append(el('a', { class: 'bc-more', href: b.page, text: 'Details' }));
    const c = el('div', { class: 'bc-book' + (b.id === 'chatgpt-web' ? ' bc-book--star' : '') }, el('h3', { text: (b.id === 'chatgpt-web' ? '★ ' : '') + b.title }), el('p', { text: b.why || b.subtitle }), el('p', { text: b.meta }), acts);
    log.append(c);
  };
  let started = false;
  function start() {
    if (started) return; started = true;
    say('Hi! Tell me what you’d like to read about or learn, and I’ll suggest books from Zirlandia Milkovic’s catalog.', 'bot');
    const chips = el('div', { class: 'bc-chips' });
    for (const s of ['Learn ChatGPT for web dev', 'GDPR for my small business', 'Protect my privacy from AI', 'Mindset & money']) {
      const b = el('button', { type: 'button', text: s }); b.onclick = () => { chips.remove(); send(s); }; chips.append(b);
    }
    log.append(chips);
  }
  const open = (v) => { panel.hidden = !v; launch.setAttribute('aria-expanded', String(v)); if (v) { start(); input.focus(); } else launch.focus(); };
  launch.onclick = () => open(panel.hidden);
  close.onclick = () => open(false);
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
  let busy = false;
  async function send(text) {
    if (busy || !text.trim()) return; busy = true;
    say(text, 'me'); history.push({ role: 'user', content: text });
    const wait = say('Looking through the shelf…', 'bot');
    try {
      const r = await fetch('/api/book-chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: history.slice(-6) }) });
      const d = await r.json();
      wait.textContent = d.reply || 'Sorry, something went wrong.';
      (d.picks || []).forEach(book);
      history.push({ role: 'assistant', content: (d.reply || '') + ((d.picks || []).length ? ' [Suggested: ' + d.picks.map((p) => p.title).join('; ') + ']' : '') });
    } catch { wait.textContent = 'Sorry, I couldn’t reach the book guide. You can browse all books at /books/.'; }
    log.scrollTop = log.scrollHeight; busy = false;
  }
  form.onsubmit = (e) => { e.preventDefault(); const v = input.value; input.value = ''; send(v); };
})();
