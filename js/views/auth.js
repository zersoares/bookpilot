// Sign in, sign up, password reset.
//
// These screens replace the shell entirely — there is no navigation to
// show until there's an account.

import { html, raw, $, formData, setBusy } from "../core/dom.js";
import * as auth from "../core/auth.js";
import { notify } from "../core/toast.js";
import * as store from "../core/store.js";
import { isDemo } from "../core/api.js";
import * as planIntent from "../core/plan-intent.js";

function shell(title, body, footer) {
  return html`
    <div class="bp-auth">
      <div class="bp-auth__card">
        <a class="bp-auth__brand" href="/">
          <span class="bp-sidebar__mark" aria-hidden="true"></span> BookPilot <span class="bp-logo__ai">AI</span>
        </a>
        <h1 style="font-size:1.35rem;text-align:center;margin-bottom:var(--bp-2)">${title}</h1>
        ${raw(body)}
        ${raw(footer || "")}
      </div>
    </div>
  `;
}

function googleButton(enabled) {
  if (!enabled) return "";
  return `
    <button type="button" class="bp-btn bp-btn--secondary bp-btn--block" id="google-btn">
      Continue with Google
    </button>
    <div class="bp-row" style="margin:var(--bp-4) 0">
      <div class="bp-divider bp-flex-1" style="margin:0"></div>
      <span class="bp-tiny bp-subtle">or</span>
      <div class="bp-divider bp-flex-1" style="margin:0"></div>
    </div>`;
}

function unavailableNotice() {
  return `
    <div class="bp-alert bp-alert--info" style="margin-bottom:var(--bp-5)">
      <span class="bp-alert__icon">◆</span>
      <div>
        <div class="bp-alert__title">Accounts aren't switched on here yet</div>
        <div class="bp-small">
          This deployment has no database connected, so sign-up is unavailable. You can still
          explore the whole product in the demo workspace.
        </div>
        <a class="bp-btn bp-btn--primary bp-btn--sm" style="margin-top:var(--bp-3)" href="/app.html?demo=1#/overview">
          Open the demo
        </a>
      </div>
    </div>`;
}

export function render(root, mode, query) {
  // From a "Choose <plan>" button on the pricing page.
  planIntent.remember(query?.get("plan"));
  const afterAuth = planIntent.peek() ? "#/billing" : null;
  const configured = auth.isConfigured();
  const googleEnabled = configured && store.get("config")?.flags?.google_oauth;
  const target = root.id === "app-root" ? root : document.body;

  if (mode === "signup") {
    target.innerHTML = shell(
      "Create your account",
      `${configured ? "" : unavailableNotice()}
       ${googleButton(googleEnabled)}
       <form id="auth-form" novalidate>
         <div class="bp-field">
           <label class="bp-label" for="name">Your name</label>
           <input class="bp-input" id="name" name="fullName" autocomplete="name" required>
         </div>
         <div class="bp-field">
           <label class="bp-label" for="email">Email</label>
           <input class="bp-input" id="email" name="email" type="email" autocomplete="email" required>
         </div>
         <div class="bp-field">
           <label class="bp-label" for="password">Password</label>
           <input class="bp-input" id="password" name="password" type="password" autocomplete="new-password" minlength="8" required>
           <div class="bp-hint">At least 8 characters.</div>
         </div>
         <label class="bp-checkbox" style="margin-bottom:var(--bp-5)">
           <input type="checkbox" name="terms" required>
           <span class="bp-small">
             I agree to the <a href="/terms.html">terms of service</a> and the
             <a href="/privacy.html">privacy policy</a>.
           </span>
         </label>
         <button type="submit" class="bp-btn bp-btn--primary bp-btn--block" ${configured ? "" : "disabled"}>
           Create account
         </button>
       </form>`,
      `<p class="bp-small bp-center bp-muted" style="margin-top:var(--bp-5)">
         Already have an account? <a href="#/signin">Sign in</a>
       </p>`
    );
  } else if (mode === "reset") {
    target.innerHTML = shell(
      "Reset your password",
      `<p class="bp-small bp-muted bp-center" style="margin-bottom:var(--bp-5)">
         We'll email you a link to choose a new one.
       </p>
       <form id="auth-form">
         <div class="bp-field">
           <label class="bp-label" for="email">Email</label>
           <input class="bp-input" id="email" name="email" type="email" autocomplete="email" required>
         </div>
         <button type="submit" class="bp-btn bp-btn--primary bp-btn--block" ${configured ? "" : "disabled"}>
           Send reset link
         </button>
       </form>`,
      `<p class="bp-small bp-center bp-muted" style="margin-top:var(--bp-5)"><a href="#/signin">Back to sign in</a></p>`
    );
  } else {
    target.innerHTML = shell(
      "Welcome back",
      `${configured ? "" : unavailableNotice()}
       ${googleButton(googleEnabled)}
       <form id="auth-form">
         <div class="bp-field">
           <label class="bp-label" for="email">Email</label>
           <input class="bp-input" id="email" name="email" type="email" autocomplete="email" required>
         </div>
         <div class="bp-field">
           <label class="bp-label" for="password">Password</label>
           <input class="bp-input" id="password" name="password" type="password" autocomplete="current-password" required>
         </div>
         <button type="submit" class="bp-btn bp-btn--primary bp-btn--block" ${configured ? "" : "disabled"}>
           Sign in
         </button>
       </form>`,
      `<p class="bp-small bp-center bp-muted" style="margin-top:var(--bp-5)">
         <a href="#/reset">Forgot your password?</a>
       </p>
       <p class="bp-small bp-center bp-muted">
         New here? <a href="#/signup">Create an account</a> ·
         <a href="/app.html?demo=1#/overview">Try the demo</a>
       </p>`
    );
  }

  $("#google-btn")?.addEventListener("click", () => {
    try {
      auth.signInWithGoogle();
    } catch (err) {
      notify.error(err.message);
    }
  });

  const form = $("#auth-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formData(form);
    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true, "Just a moment…");
    try {
      if (mode === "signup") {
        if (!form.querySelector('[name="terms"]').checked) {
          throw new Error("Please accept the terms to continue.");
        }
        const { needsConfirmation } = await auth.signUp(values);
        if (needsConfirmation) {
          form.innerHTML = `
            <div class="bp-alert bp-alert--success">
              <span class="bp-alert__icon">✓</span>
              <div>
                <div class="bp-alert__title">Check your inbox</div>
                <div class="bp-small">We've sent a confirmation link. Open it and you'll land straight in your workspace.</div>
              </div>
            </div>`;
          return;
        }
        location.hash = afterAuth || "#/onboarding";
        location.reload();
      } else if (mode === "reset") {
        await auth.requestPasswordReset(values.email);
        notify.success("If that email has an account, a reset link is on its way.");
      } else {
        await auth.signIn(values);
        location.hash = afterAuth || "#/overview";
        location.reload();
      }
    } catch (err) {
      notify.error(err.message);
      setBusy(button, false);
    }
  });

  // Demo visitors reach these screens from the "create an account"
  // prompt; make the way back obvious.
  if (isDemo()) {
    const card = target.querySelector(".bp-auth__card");
    card?.insertAdjacentHTML(
      "beforeend",
      `<p class="bp-tiny bp-center bp-subtle" style="margin-top:var(--bp-4)">
         <a href="/app.html?demo=1#/overview">Back to the demo workspace</a>
       </p>`
    );
  }
}
