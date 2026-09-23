// The paid plan a visitor picked on the pricing page, carried through
// sign-up so they land in checkout for it instead of on the dashboard.
//
// localStorage rather than the URL because sign-up can detour through a
// confirmation email, which opens the app again in a fresh tab. Storage can
// be blocked (private windows, cleared site data); the intent is then simply
// lost and the author picks the plan again on the Billing page.

const KEY = "bp_checkout_plan";
const PAID_PLANS = ["author", "author_pro", "publisher"];

export function remember(plan) {
  if (!PAID_PLANS.includes(plan)) return;
  try {
    localStorage.setItem(KEY, plan);
  } catch {
    /* see above */
  }
}

export function peek() {
  try {
    const plan = localStorage.getItem(KEY);
    return PAID_PLANS.includes(plan) ? plan : null;
  } catch {
    return null;
  }
}

/** Read the intent once; it is cleared so it never fires twice. */
export function take() {
  const plan = peek();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* see above */
  }
  return plan;
}
