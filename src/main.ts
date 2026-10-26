/* ============================================================
   BlacTec — Front-end interaction layer
   Strict TypeScript · no runtime libraries · compiled to dist/main.js

   Principles this file follows (Apple "fluid interfaces"):
   - respond on press, never wait for release
   - animate from the live (presentation) value, never from the target
   - gestures are tracked 1:1, released with their own velocity
   - springs for anything a finger can grab; critically damped by default
   - nothing is locked out while it moves
   ============================================================ */

/* ---------- Shared types ---------- */

type DomainStatus = 'available' | 'taken';

interface TldOption {
  tld: string;
  priceUsd: number;
}

interface DomainResult {
  domain: string;
  tld: string;
  status: DomainStatus;
  priceUsd: number;
}

type PriceUnit = 'year' | 'user/year' | 'month' | 'user/month' | 'one-time';

type Currency = 'UGX' | 'USD';

interface PricingPlan {
  name: string;
  desc: string;
  currency: Currency;
  price: number;
  unit: PriceUnit;
  features: string[];
  popular?: boolean;
}

type PanelKey = 'hosting' | 'vps' | 'dedicated' | 'workspace' | 'microsoft365' | 'zoho' | 'reseller' | 'security' | 'webdesign' | 'webredesign';

/** Approximate market rate — one number for the whole site. The static UGX fallbacks in index.html are derived from it. */
const UGX_PER_USD = 4100;

function formatUgx(value: number): string {
  return `UGX ${Math.round(value).toLocaleString('en-US')}`;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatMoney(value: number, currency: Currency): string {
  return currency === 'UGX' ? formatUgx(value) : formatUsd(value);
}

/** Splits a price into currency label + amount so premium price displays can style each part. */
function formatMoneyParts(value: number, currency: Currency): { prefix: string; amount: string; isSymbol: boolean } {
  return currency === 'UGX'
    ? { prefix: 'UGX', amount: Math.round(value).toLocaleString('en-US'), isSymbol: false }
    : { prefix: '$', amount: value.toFixed(2), isSymbol: true };
}

/** Converts a plan's native price into the requested display currency. */
function convertPrice(plan: Pick<PricingPlan, 'currency' | 'price'>, target: Currency): number {
  if (plan.currency === target) {
    return plan.price;
  }
  return plan.currency === 'UGX' ? plan.price / UGX_PER_USD : plan.price * UGX_PER_USD;
}

function usdTo(value: number, target: Currency): number {
  return target === 'USD' ? value : value * UGX_PER_USD;
}

/* ---------- Tiny DOM helpers (null-narrowing) ---------- */

function qs<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

function qsa<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPrice(value: number): string {
  return value.toFixed(2);
}

/* ============================================================
   Billing portal — where accounts are created and orders are placed
   ============================================================
   Every "buy" button on this site hands off to the client portal. Links carry
   UTM tags so each placement can be told apart in the portal's analytics. */

const BILLING_URL = 'https://billing.blactec.ug';

/** A plan name on this site → the slug of the matching product's order page in the portal. */
const BILLING_PRODUCTS: Record<string, string> = {
  'Starter Hosting': 'starter-hosting',
  'Business Hosting': 'business-hosting',
  'Enterprise Hosting': 'enterprise-hosting',
  'Starter Website': 'starter-website',
  'Business Website': 'business-website',
  'Premium / E-commerce': 'premium-e-commerce',
  'Refresh': 'website-refresh',
  'Full Redesign': 'full-website-redesign',
  'Platform Migration & Redesign': 'platform-migration-redesign',
  'DV SSL Certificate': 'dv-ssl-certificate',
  'OV SSL Certificate': 'ov-ssl-certificate',
  'Wildcard SSL Certificate': 'wildcard-ssl-certificate',
  'EV SSL Certificate': 'ev-ssl-certificate',
  'Starter Google Workspace': 'starter-google-workspace',
  'Standard Google Workspace': 'standard-google-workspace',
  'Plus Google Workspace': 'plus-google-workspace',
  'Business Basic': 'microsoft-365-business-basic',
  'Business Standard': 'microsoft-365-business-standard',
  'Business Premium': 'microsoft-365-business-premium',
  'Mail Lite': 'zoho-mail-lite',
  'Workplace Standard': 'zoho-workplace-standard',
  'Mail Premium': 'zoho-mail-premium',
  'Workplace Professional': 'zoho-workplace-professional',
};

/** Which part of the site a hosting/website/domain button lives in, for the utm_campaign tag. */
const BILLING_PLACEMENT: Record<string, string> = {
  hosting: 'hosting-plans',
  webdesign: 'webdesign-plans',
  webredesign: 'webredesign-plans',
  security: 'ssl-plans',
  workspace: 'workspace-plans',
  microsoft365: 'microsoft365-plans',
  zoho: 'zoho-plans',
};

/**
 * The portal now asks the .ug registry itself, so its domain search offers a "Register"
 * button for .ug and .co.ug names. Set this back to false if the portal stops being
 * able to check them; .ug requests then stay with us as a quote request.
 */
const PORTAL_REGISTERS_UG = true;

function billingUrl(path: string, placement: string, params: Record<string, string> = {}): string {
  const url = new URL(path, BILLING_URL);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set('utm_source', 'blactec.ug');
  url.searchParams.set('utm_medium', 'website');
  url.searchParams.set('utm_campaign', placement);
  return url.toString();
}

/** The order page for a plan, or null when the portal does not sell it (those stay a quote request). */
function planOrderUrl(planName: string, placement: string): string | null {
  const slug = BILLING_PRODUCTS[planName];
  return slug ? billingUrl(`/client/store/configure/${slug}`, placement) : null;
}

/** Extensions the portal has prices for. .org.ug and .ac.ug are not among them, so those stay a request. */
const PORTAL_GLOBAL_TLDS = ['.com', '.net', '.org'];
const PORTAL_UG_TLDS = ['.ug', '.co.ug'];

/** Whether the portal can take an order for this domain extension right now. */
function portalSellsTld(tld: string): boolean {
  return PORTAL_GLOBAL_TLDS.includes(tld) || (PORTAL_REGISTERS_UG && PORTAL_UG_TLDS.includes(tld));
}

/* ============================================================
   Motion primitives
   ============================================================ */

interface SpringHandle {
  cancel(): void;
}

/**
 * Critically damped spring (damping ratio 1.0 — no overshoot) from `from` to `to`, starting at `velocity` px/s.
 * Closed-form, so it is exact at any frame rate and can be re-targeted from the live value + live velocity.
 */
function springTo(
  from: number,
  to: number,
  velocity: number,
  response: number,
  onUpdate: (x: number, v: number) => void,
  onDone: () => void,
): SpringHandle {
  const w = (2 * Math.PI) / response;
  const a = from - to;
  const b = velocity + w * a;
  const start = performance.now();
  let raf = 0;
  let cancelled = false;

  const tick = (now: number): void => {
    if (cancelled) {
      return;
    }
    const t = (now - start) / 1000;
    const decay = Math.exp(-w * t);
    const x = to + (a + b * t) * decay;
    const v = (b - w * (a + b * t)) * decay;
    if (Math.abs(x - to) < 0.4 && Math.abs(v) < 12) {
      onUpdate(to, 0);
      onDone();
      return;
    }
    onUpdate(x, v);
    raf = window.requestAnimationFrame(tick);
  };

  raf = window.requestAnimationFrame(tick);
  return {
    cancel(): void {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    },
  };
}

/** Where a gesture released at `velocity` px/s would come to rest (scroll-deceleration model). */
function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive resistance past a boundary — things slow down before they stop. */
function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/* ============================================================
   Currency — one shared preference for the whole page
   ============================================================ */

class CurrencyStore {
  private current: Currency = 'UGX';
  private readonly listeners: Array<(currency: Currency) => void> = [];

  constructor() {
    try {
      const saved = window.localStorage.getItem('blactecCurrency');
      if (saved === 'UGX' || saved === 'USD') {
        this.current = saved;
      }
    } catch {
      /* storage unavailable (private mode) — default is fine */
    }
  }

  public get value(): Currency {
    return this.current;
  }

  public set(currency: Currency): void {
    if (currency === this.current) {
      return;
    }
    this.current = currency;
    try {
      window.localStorage.setItem('blactecCurrency', currency);
    } catch {
      /* ignore */
    }
    this.listeners.forEach((listener) => listener(currency));
  }

  public subscribe(listener: (currency: Currency) => void): void {
    this.listeners.push(listener);
  }
}

const currencyStore = new CurrencyStore();

/* ============================================================
   Toast — shared notifier + scroll-to-contact
   ============================================================ */

class Toast {
  private readonly el: HTMLElement;
  private timer: number | undefined;
  private quoteForm: QuoteForm | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  /** Wired after QuoteForm exists so lead buttons can prefill it. */
  public attachQuoteForm(form: QuoteForm): void {
    this.quoteForm = form;
  }

  public show(message: string): void {
    this.el.textContent = message;
    this.el.classList.add('is-visible');
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
    }
    this.timer = window.setTimeout(() => {
      this.el.classList.remove('is-visible');
    }, 4200);
  }

  /** Standard conversion cue: toast + prefill + smooth scroll to the quote form. */
  public fireLead(context?: string): void {
    this.show('Great choice. Tell us a little about your project below.');
    if (this.quoteForm) {
      this.quoteForm.prefill(context);
    }
    const contact = document.getElementById('contact');
    if (contact) {
      contact.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    }
  }
}

/* ============================================================
   Quote form — client-side lead capture, no backend required.
   Submitting opens the visitor's mail app (mailto:). Because that can silently
   do nothing (no mail client configured), we NEVER clear what they typed and
   always offer two other ways to send the same request.
   ============================================================ */

const WHATSAPP_NUMBER = '256750870755';

class QuoteForm {
  private readonly form: HTMLFormElement;
  private readonly nameInput: HTMLInputElement;
  private readonly emailInput: HTMLInputElement;
  private readonly phoneInput: HTMLInputElement;
  private readonly serviceSelect: HTMLSelectElement;
  private readonly messageInput: HTMLTextAreaElement;
  private readonly toast: Toast;
  private fallback: HTMLElement | null = null;

  constructor(form: HTMLFormElement, toast: Toast) {
    this.form = form;
    this.toast = toast;
    this.nameInput = qs<HTMLInputElement>('#quoteName', form) as HTMLInputElement;
    this.emailInput = qs<HTMLInputElement>('#quoteEmail', form) as HTMLInputElement;
    this.phoneInput = qs<HTMLInputElement>('#quotePhone', form) as HTMLInputElement;
    this.serviceSelect = qs<HTMLSelectElement>('#quoteService', form) as HTMLSelectElement;
    this.messageInput = qs<HTMLTextAreaElement>('#quoteMessage', form) as HTMLTextAreaElement;
    this.bind();
  }

  /** Called by lead buttons across the page to pre-fill context before the form comes into view. */
  public prefill(context?: string): void {
    if (context && this.messageInput.value.trim().length === 0) {
      this.messageInput.value = context;
    }
    window.setTimeout(() => this.nameInput.focus({ preventScroll: true }), 500);
  }

  private bind(): void {
    this.form.addEventListener('submit', (event: SubmitEvent) => {
      event.preventDefault();
      this.submit();
    });
    // Validate inline: clear the error state the moment the field is valid again.
    [this.nameInput, this.emailInput].forEach((input) => {
      input.addEventListener('input', () => {
        if (input.validity.valid) {
          input.removeAttribute('aria-invalid');
        }
      });
    });
  }

  private compose(): { subject: string; body: string } {
    const name = this.nameInput.value.trim();
    const email = this.emailInput.value.trim();
    const phone = this.phoneInput.value.trim();
    const service = this.serviceSelect.value;
    const message = this.messageInput.value.trim();

    const subject = `Quote request from ${name}: ${service}`;
    const body = [
      `Name: ${name}`,
      `Email: ${email}`,
      phone.length > 0 ? `Phone: ${phone}` : '',
      `Service: ${service}`,
      '',
      message.length > 0 ? message : '(no additional details provided)',
    ]
      .filter((line, index) => line.length > 0 || index === 4)
      .join('\n');
    return { subject, body };
  }

  private submit(): void {
    [this.nameInput, this.emailInput].forEach((input) => {
      if (input.validity.valid) {
        input.removeAttribute('aria-invalid');
      } else {
        input.setAttribute('aria-invalid', 'true');
      }
    });
    if (!this.form.reportValidity()) {
      return;
    }
    const { subject, body } = this.compose();
    this.showFallback(subject, body);
    this.toast.show('Opening your email app. If nothing happens, use the options below the form.');
    window.location.href = `mailto:info@blactec.ug?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  private showFallback(subject: string, body: string): void {
    if (!this.fallback) {
      const box = document.createElement('div');
      box.className = 'quote__fallback';
      box.setAttribute('role', 'status');
      const note = qs<HTMLElement>('.quote__note', this.form);
      if (note) {
        note.after(box);
      } else {
        this.form.append(box);
      }
      this.fallback = box;
    }
    const text = `${subject}\n\n${body}`;
    this.fallback.hidden = false;
    this.fallback.innerHTML = `
      <p><strong>Didn’t your email app open?</strong> Your details are still here. Send the same request another way:</p>
      <div class="quote__fallback-actions">
        <a class="btn btn--primary" href="https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Send on WhatsApp</a>
        <button class="btn btn--secondary" type="button" data-copy>Copy details</button>
      </div>`;
    const copyBtn = qs<HTMLButtonElement>('[data-copy]', this.fallback);
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        void this.copy(text, copyBtn);
      });
    }
  }

  private async copy(text: string, button: HTMLButtonElement): Promise<void> {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      area.remove();
    }
    button.textContent = ok ? 'Copied ✓' : 'Press Ctrl/⌘+C to copy';
    window.setTimeout(() => {
      button.textContent = 'Copy details';
    }, 2400);
  }
}

/* ============================================================
   Domain availability — live lookups
   ============================================================
   .com / .org / .net (and any other gTLD) run RDAP over HTTP, so we can query
   the public rdap.org bootstrap directly from the browser — it responds with
   CORS enabled. Uganda's registry has no public API reachable from a browser,
   so .ug/.co.ug/.org.ug/.ac.ug go through a small Cloudflare Worker that relays
   the registrar portal's own domain-search endpoint server-side.
   See cloudflare-worker/README.md for how it works. */

const UG_TLDS = ['.ug', '.co.ug', '.org.ug', '.ac.ug'];

const UG_WHOIS_PROXY_URL = 'https://blactec-ug-whois.blactec.workers.dev';

/** A lookup that can never hang the UI: it has its own deadline and honours a parent abort. */
function timedFetch(url: string, init: RequestInit, ms: number, parent?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  const onParentAbort = (): void => controller.abort();
  if (parent) {
    if (parent.aborted) {
      controller.abort();
    } else {
      parent.addEventListener('abort', onParentAbort, { once: true });
    }
  }
  return fetch(url, { ...init, signal: controller.signal }).finally(() => {
    window.clearTimeout(timer);
    parent?.removeEventListener('abort', onParentAbort);
  });
}

async function checkGtldAvailability(fullDomain: string, signal?: AbortSignal): Promise<boolean> {
  const res = await timedFetch(
    `https://rdap.org/domain/${encodeURIComponent(fullDomain)}`,
    { headers: { Accept: 'application/rdap+json' } },
    8000,
    signal,
  );
  if (res.status === 404) {
    return true;
  }
  if (res.ok) {
    return false;
  }
  throw new Error(`rdap_http_${res.status}`);
}

async function checkUgAvailability(domain: string, tld: string, signal?: AbortSignal): Promise<boolean> {
  const url = `${UG_WHOIS_PROXY_URL}/?domain=${encodeURIComponent(domain)}&tld=${encodeURIComponent(tld)}`;
  const res = await timedFetch(url, {}, 8000, signal);
  const data = (await res.json().catch(() => null)) as { available?: boolean; error?: string } | null;
  if (!res.ok || !data || typeof data.available !== 'boolean') {
    throw new Error((data && data.error) || `whois_proxy_http_${res.status}`);
  }
  return data.available;
}

function checkAvailability(domain: string, tld: string, signal?: AbortSignal): Promise<boolean> {
  return UG_TLDS.includes(tld) ? checkUgAvailability(domain, tld, signal) : checkGtldAvailability(domain + tld, signal);
}

class DomainChecker {
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly select: HTMLSelectElement;
  private readonly result: HTMLElement;
  private readonly tlds: TldOption[];
  private readonly tldButtons: HTMLButtonElement[];
  private runId = 0;
  private controller: AbortController | null = null;

  constructor(form: HTMLFormElement) {
    this.form = form;
    this.input = qs<HTMLInputElement>('#domainInput', form) as HTMLInputElement;
    this.select = qs<HTMLSelectElement>('#tldSelect', form) as HTMLSelectElement;
    this.result = document.getElementById('domainResult') as HTMLElement;
    this.tlds = qsa<HTMLOptionElement>('option', this.select).map((opt) => ({
      tld: opt.value,
      priceUsd: Number(opt.dataset['price'] ?? '0'),
    }));
    this.tldButtons = qsa<HTMLButtonElement>('.domain__eg');
    this.bind();
    this.syncTldButtons();
  }

  private bind(): void {
    this.form.addEventListener('submit', (event: SubmitEvent) => {
      event.preventDefault();
      void this.run();
    });

    this.select.addEventListener('change', () => this.syncTldButtons());

    // Price chips choose an extension. They never overwrite what the visitor typed.
    this.tldButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tld = btn.dataset['tld'] ?? '';
        if (this.tlds.some((t) => t.tld === tld)) {
          this.select.value = tld;
          this.syncTldButtons();
        }
        if (this.sanitize(this.input.value).length > 0) {
          void this.run();
        } else {
          this.input.focus();
        }
      });
    });
  }

  private syncTldButtons(): void {
    this.tldButtons.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset['tld'] === this.select.value));
    });
  }

  private sanitize(raw: string): string {
    return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  }

  private priceFor(tld: string): number {
    const match = this.tlds.find((t) => t.tld === tld);
    return match ? match.priceUsd : 0;
  }

  private money(priceUsd: number): string {
    return formatMoney(usdTo(priceUsd, currencyStore.value), currencyStore.value);
  }

  /** Checks the other listed TLDs in parallel and keeps up to 3 that came back available. */
  private async findAvailableAlternatives(domain: string, excludeTld: string, signal: AbortSignal): Promise<TldOption[]> {
    const candidates = this.tlds.filter((t) => t.tld !== excludeTld);
    const settled = await Promise.allSettled(
      candidates.map(async (t) => ({ t, available: await checkAvailability(domain, t.tld, signal) })),
    );
    const available: TldOption[] = [];
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled' && outcome.value.available) {
        available.push(outcome.value.t);
      }
    }
    return available.slice(0, 3);
  }

  private async run(): Promise<void> {
    const domain = this.sanitize(this.input.value);
    if (domain.length === 0) {
      this.input.focus();
      this.renderError('Type a name to search. Your business name works well.');
      return;
    }
    this.input.value = domain;
    const tld = this.select.value;

    // A newer search supersedes this one: abort in-flight lookups and ignore late answers.
    const id = ++this.runId;
    if (this.controller) {
      this.controller.abort();
    }
    const controller = new AbortController();
    this.controller = controller;
    this.renderLoading();

    try {
      const available = await checkAvailability(domain, tld, controller.signal);
      if (id !== this.runId) {
        return;
      }
      // Show the answer the moment we have it; alternatives stream in afterwards.
      this.renderResult({ domain, tld, status: available ? 'available' : 'taken', priceUsd: this.priceFor(tld) });
      if (!available) {
        const alternatives = await this.findAvailableAlternatives(domain, tld, controller.signal);
        if (id !== this.runId) {
          return;
        }
        this.renderAlternatives(domain, alternatives);
      }
    } catch (err) {
      if (id !== this.runId) {
        return;
      }
      this.renderCheckError(domain + tld, err);
    }
  }

  private renderError(message: string): void {
    this.result.innerHTML = `<div class="result-card result-card--taken"><p class="result-card__name">${escapeHtml(message)}</p></div>`;
  }

  /** The lookup itself failed (network, proxy down, timeout) — distinct from a real "taken" result. */
  private renderCheckError(full: string, err: unknown): void {
    console.error('Domain availability check failed:', err);
    const context = escapeHtml(`I searched for ${full} but the checker couldn't confirm it. Please check availability and get back to me.`);
    this.result.innerHTML = `
      <div class="result-card result-card--taken">
        <div class="result-card__top">
          <span class="result-card__name">${escapeHtml(full)}</span>
          <span class="result-card__status" style="background:var(--ink-500)">Couldn’t verify</span>
        </div>
        <p class="result-card__note">We couldn’t reach the registry just now. Try again in a moment, or let us confirm it for you.</p>
        <div class="result-card__actions">
          <button class="btn btn--primary" data-lead data-lead-context="${context}" type="button">Ask us to confirm</button>
        </div>
      </div>`;
  }

  private renderLoading(): void {
    this.result.innerHTML = `
      <div class="skeleton" role="status" aria-label="Checking availability">
        <div class="skeleton__line skeleton__line--short"></div>
        <div class="skeleton__line"></div>
        <div class="skeleton__line skeleton__line--btn"></div>
      </div>`;
  }

  /** Registering a name: straight into the portal's cart where it can take the order, otherwise a request to us. */
  private registerAction(domain: string, tld: string, priceUsd: number, cls: string, label: string): string {
    if (portalSellsTld(tld)) {
      const href = billingUrl('/client/domain-search', 'hero-search', { domain, tld });
      return `<a class="${cls}" href="${escapeHtml(href)}">${label}</a>`;
    }
    const context = escapeHtml(`I'd like to register ${domain}${tld} (${this.money(priceUsd)}/yr).`);
    return `<button class="${cls}" data-lead data-lead-context="${context}" type="button">${label}</button>`;
  }

  private renderResult(data: DomainResult): void {
    const full = `${data.domain}${data.tld}`;
    if (data.status === 'available') {
      this.result.innerHTML = `
        <div class="result-card result-card--ok">
          <div class="result-card__top">
            <span class="result-card__name">${escapeHtml(full)}</span>
            <span class="result-card__status">Available</span>
          </div>
          <div class="result-card__top">
            <span class="result-card__price"><span data-usd="${formatPrice(data.priceUsd)}">${this.money(data.priceUsd)}</span> <small>/ year</small></span>
            ${this.registerAction(data.domain, data.tld, data.priceUsd, 'btn btn--primary', portalSellsTld(data.tld) ? 'Register this domain' : 'Request this domain')}
          </div>
        </div>`;
      return;
    }
    const supportContext = escapeHtml(`I have a question about ${full}.`);
    const transfer = portalSellsTld(data.tld)
      ? `<a class="btn btn--primary" href="${escapeHtml(billingUrl('/client/domains/transfer', 'hero-search', { domain: full }))}">Transfer it to us</a>`
      : `<button class="btn btn--primary" data-lead data-lead-context="${escapeHtml(`I'd like to transfer ${full} to BlacTec.`)}" type="button">Transfer it to us</button>`;
    this.result.innerHTML = `
      <div class="result-card result-card--taken">
        <div class="result-card__top">
          <span class="result-card__name">${escapeHtml(full)}</span>
          <span class="result-card__status">Taken</span>
        </div>
        <p class="result-card__note">That domain is already registered. Transfer it to us, or see what’s free below.</p>
        <div class="result-card__actions">
          ${transfer}
          <button class="btn btn--secondary" data-lead data-lead-context="${supportContext}" type="button">Contact support</button>
        </div>
        <div class="alts" data-alts>
          <span class="alts__title">Checking other extensions…</span>
        </div>
      </div>`;
  }

  private renderAlternatives(domain: string, alternatives: TldOption[]): void {
    const holder = qs<HTMLElement>('[data-alts]', this.result);
    if (!holder) {
      return;
    }
    if (alternatives.length === 0) {
      holder.innerHTML = '<span class="alts__title">No other extensions are free for that name. Try a variation.</span>';
      return;
    }
    const rows = alternatives
      .map((alt) => {
        return `
          <div class="alt">
            <span class="alt__name">${escapeHtml(domain)}<b>${escapeHtml(alt.tld)}</b></span>
            <span class="alt__price"><span data-usd="${formatPrice(alt.priceUsd)}">${this.money(alt.priceUsd)}</span>/yr</span>
            ${this.registerAction(domain, alt.tld, alt.priceUsd, 'alt__add', portalSellsTld(alt.tld) ? 'Register' : 'Request')}
          </div>`;
      })
      .join('');
    holder.innerHTML = `<span class="alts__title">Available alternatives</span>${rows}`;
  }
}

/* ============================================================
   Tabs — accessible, with a thumb that slides on a spring
   Used for: pricing categories, the home plans shelf, hosting hero stack.
   ============================================================ */

class Tabs {
  private readonly list: HTMLElement;
  private readonly tabs: HTMLElement[];
  private readonly thumb: HTMLElement;
  private index = 0;

  constructor(list: HTMLElement) {
    this.list = list;
    this.tabs = qsa<HTMLElement>('[role="tab"]', list);
    this.thumb = document.createElement('span');
    this.thumb.className = 'tabs__thumb';
    this.thumb.setAttribute('aria-hidden', 'true');
    list.prepend(this.thumb);
    list.classList.add('tabs--thumb');
    if (window.getComputedStyle(list).position === 'static') {
      list.style.position = 'relative';
    }
    const initial = this.tabs.findIndex((tab) => tab.classList.contains('is-active') || tab.getAttribute('aria-selected') === 'true');
    this.index = initial >= 0 ? initial : 0;
    this.bind();
    this.layout();
    // Enable the spring only after the first layout, so the thumb never "slides in" on load.
    window.requestAnimationFrame(() => list.classList.add('tabs--ready'));
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => this.layout()).observe(list);
    }
    if (document.fonts && document.fonts.ready) {
      void document.fonts.ready.then(() => this.layout());
    }
  }

  private bind(): void {
    this.tabs.forEach((tab, index) => {
      // Respond on press, not release.
      tab.addEventListener('pointerdown', (event: PointerEvent) => {
        if (event.pointerType === 'mouse' && event.button !== 0) {
          return;
        }
        if (index !== this.index) {
          this.activate(index, false);
        }
      });
      tab.addEventListener('click', () => {
        if (index !== this.index) {
          this.activate(index, false);
        }
      });
      tab.addEventListener('keydown', (event: KeyboardEvent) => this.onKey(event, index));
    });
  }

  private onKey(event: KeyboardEvent, index: number): void {
    let next = index;
    if (event.key === 'ArrowRight') {
      next = (index + 1) % this.tabs.length;
    } else if (event.key === 'ArrowLeft') {
      next = (index - 1 + this.tabs.length) % this.tabs.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = this.tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    this.activate(next, true);
  }

  private layout(): void {
    const active = this.tabs[this.index];
    if (!active) {
      return;
    }
    this.list.style.setProperty('--x', `${active.offsetLeft}px`);
    this.list.style.setProperty('--y', `${active.offsetTop}px`);
    this.list.style.setProperty('--w', `${active.offsetWidth}px`);
    this.list.style.setProperty('--h', `${active.offsetHeight}px`);
  }

  private activate(index: number, focus: boolean): void {
    this.index = index;
    this.tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panelId = tab.getAttribute('aria-controls');
      if (panelId) {
        const panel = document.getElementById(panelId);
        if (panel) {
          panel.classList.toggle('is-active', selected);
          if (selected) {
            panel.removeAttribute('hidden');
          } else {
            panel.setAttribute('hidden', '');
          }
        }
      }
    });
    this.layout();
    const active = this.tabs[index];
    if (focus) {
      active.focus();
    }
    // A horizontally scrolling tab strip keeps the active tab in view — without scrolling the page.
    if (this.list.scrollWidth > this.list.clientWidth + 2) {
      const left = active.offsetLeft - (this.list.clientWidth - active.offsetWidth) / 2;
      this.list.scrollTo({ left, behavior: scrollBehavior() });
    }
    this.list.dispatchEvent(new CustomEvent('tabs:change', { bubbles: true, detail: { index } }));
  }
}

/* ============================================================
   Pricing — data-driven cards
   ============================================================ */

const PRICING: Record<PanelKey, PricingPlan[]> = {
  hosting: [
    {
      name: 'Starter Hosting', desc: 'Perfect for personal websites and small businesses.',
      currency: 'UGX', price: 100000, unit: 'year',
      features: ['1 GB SSD storage', '10 GB monthly bandwidth', '1 website', '5 email accounts', '1 MySQL database', 'Free SSL certificate', 'cPanel control panel', 'Standard technical support'],
    },
    {
      name: 'Basic Hosting', desc: 'Ideal for growing business websites.',
      currency: 'UGX', price: 150000, unit: 'year',
      features: ['5 GB SSD storage', '50 GB monthly bandwidth', '1 website', '20 email accounts', '5 MySQL databases', 'Free SSL certificate', 'cPanel control panel', 'Standard technical support'],
    },
    {
      name: 'Business Hosting', desc: 'Suitable for business websites with higher resource needs.',
      currency: 'UGX', price: 200000, unit: 'year', popular: true,
      features: ['10 GB SSD storage', '100 GB monthly bandwidth', '1 website', '50 email accounts', '10 MySQL databases', 'Free SSL certificate', 'cPanel control panel', 'Priority technical support'],
    },
    {
      name: 'Professional Hosting', desc: 'Designed for corporate websites and online platforms.',
      currency: 'UGX', price: 250000, unit: 'year',
      features: ['15 GB SSD storage', '200 GB monthly bandwidth', '1 website', '100 email accounts', 'Unlimited MySQL databases', 'Free SSL certificate', 'cPanel control panel', 'Priority technical support'],
    },
    {
      name: 'Enterprise Hosting', desc: 'For organizations requiring more resources and reliability.',
      currency: 'UGX', price: 350000, unit: 'year',
      features: ['20 GB SSD storage', 'Unlimited bandwidth (fair usage policy)', '1 website', 'Unlimited email accounts', 'Unlimited MySQL databases', 'Free .ug domain (first year)', 'Free SSL certificate', 'cPanel control panel', 'Premium technical support'],
    },
  ],
  vps: [
    {
      name: 'Starter VPS', desc: 'Entry-level root-access power for small apps and test environments.',
      currency: 'UGX', price: 360000, unit: 'month',
      features: ['1 vCPU core', '2 GB RAM', '60 GB NVMe SSD', '100 Mbps unmetered bandwidth', 'Full root access', 'Free dedicated IPv4', 'Choice of Linux OS', 'Weekly snapshot backups'],
    },
    {
      name: 'Business VPS', desc: 'Balanced resources for production sites and growing workloads.',
      currency: 'UGX', price: 720000, unit: 'month', popular: true,
      features: ['3 vCPU cores', '4 GB RAM', '100 GB NVMe SSD', '200 Mbps unmetered bandwidth', 'Full root access', 'Free dedicated IPv4', 'Choice of Linux OS', 'Daily snapshot backups'],
    },
    {
      name: 'Professional VPS', desc: 'Serious compute for busy applications and databases.',
      currency: 'UGX', price: 960000, unit: 'month',
      features: ['4 vCPU cores', '8 GB RAM', '160 GB NVMe SSD', '300 Mbps unmetered bandwidth', 'Full root access', 'Free dedicated IPv4', 'Choice of Linux OS', 'Daily snapshot backups'],
    },
    {
      name: 'Advanced VPS', desc: 'Maximum VPS resources for demanding, high-traffic platforms.',
      currency: 'UGX', price: 1680000, unit: 'month',
      features: ['4 vCPU cores', '16 GB RAM', '240 GB NVMe SSD', '500 Mbps unmetered bandwidth', 'Full root access', 'Free dedicated IPv4', 'Choice of Linux OS', 'Daily snapshot backups'],
    },
  ],
  dedicated: [
    {
      name: 'Deploy Xeon E3', desc: 'Reliable entry-level dedicated power, fully managed.',
      currency: 'UGX', price: 500000, unit: 'month',
      features: ['Intel Xeon E3-1230 v3 CPU', '16 GB RAM', '64 GB SSD storage', '20 TB bandwidth on a 1 Gbps port', 'Fully managed service', 'DDoS protection included', 'Choice of OS', 'Root / admin access'],
    },
    {
      name: 'Deploy Xeon E3 Plus', desc: 'More storage headroom on the same reliable platform.',
      currency: 'UGX', price: 700000, unit: 'month',
      features: ['Intel Xeon E3-1230 v3 CPU', '16 GB RAM', '256 GB SSD storage', '20 TB bandwidth on a 1 Gbps port', 'Fully managed service', 'DDoS protection included', 'Choice of OS', 'Root / admin access'],
    },
    {
      name: 'Xeon E-2136', desc: 'Hexa-core performance for demanding production workloads.',
      currency: 'UGX', price: 1000000, unit: 'month', popular: true,
      features: ['3.3 GHz Hexa-Core Xeon E-2136', '48 GB RAM', '240 GB SSD storage', '20 TB bandwidth on a 1 Gbps port', 'Fully managed service', 'DDoS protection included', 'Choice of OS', 'Root / admin access'],
    },
    {
      name: 'Xeon E-2236', desc: 'Our most powerful server, built for heavy enterprise traffic.',
      currency: 'UGX', price: 1450000, unit: 'month',
      features: ['3.4 GHz Hexa-Core Xeon E-2236', '48 GB RAM', '480 GB SSD storage', '20 TB bandwidth on a 1 Gbps port', 'Fully managed service', 'DDoS protection included', 'Choice of OS', 'Root / admin access'],
    },
  ],
  workspace: [
    { name: 'Starter Google Workspace', desc: 'Custom business email with core Google tools.', currency: 'USD', price: 7.00, unit: 'user/month', features: ['30 GB pooled storage per user', 'Video meetings up to 100 participants', 'Security controls', 'Standard support'] },
    { name: 'Standard Google Workspace', desc: 'More storage and richer collaboration.', currency: 'USD', price: 14.00, unit: 'user/month', popular: true, features: ['2 TB pooled storage per user', 'Meetings up to 150 participants with recording', 'Appointment booking & email layouts', 'Standard support'] },
    { name: 'Plus Google Workspace', desc: 'Advanced security, Vault & compliance.', currency: 'USD', price: 22.00, unit: 'user/month', features: ['5 TB pooled storage per user', 'Meetings up to 500 participants with recording', 'Enhanced security & Vault controls', 'Advanced endpoint management'] },
  ],
  microsoft365: [
    { name: 'Business Basic', desc: 'Web & mobile Office apps with Exchange email.', currency: 'USD', price: 7.00, unit: 'user/month', features: ['50 GB Exchange mailbox', '1 TB OneDrive storage', 'Teams chat & meetings', 'Standard security'] },
    { name: 'Business Standard', desc: 'Desktop apps with advanced collaboration.', currency: 'USD', price: 14.00, unit: 'user/month', popular: true, features: ['Everything in Basic', 'Desktop Word, Excel & Outlook', 'Teams webinars & registration', 'Microsoft Loop workspaces'] },
    { name: 'Business Premium', desc: 'Enterprise-grade security & device management.', currency: 'USD', price: 22.00, unit: 'user/month', features: ['Everything in Standard', 'Advanced cyber threat protection', 'Device management', 'Microsoft Defender for Business'] },
  ],
  // Zoho Workplace — Zoho list price (annual billing, per user/month) + 10% BlacTec markup.
  zoho: [
    { name: 'Mail Lite', desc: 'Essential custom email for your domain.', currency: 'USD', price: 1.10, unit: 'user/month', features: ['5–10 GB mail storage per user', 'AI assistant (Zia)', 'Mail, Calendar, ToDo & Directory', 'Billed annually'] },
    { name: 'Workplace Standard', desc: 'Complete collaboration suite. Best value.', currency: 'USD', price: 3.30, unit: 'user/month', popular: true, features: ['30 GB mail + 100 GB team storage', 'WorkDrive, Writer, Sheet & Show', 'Cliq chat, Meeting & Vault', 'AI assistant (Zia) & Trident desktop app'] },
    { name: 'Mail Premium', desc: 'Email with retention and eDiscovery.', currency: 'USD', price: 4.40, unit: 'user/month', features: ['50 GB mail + 50 GB retention storage', 'Email retention & eDiscovery', 'eProtect email security', 'Billed annually'] },
    { name: 'Workplace Professional', desc: 'Maximum storage with intranet tools.', currency: 'USD', price: 6.60, unit: 'user/month', features: ['100 GB mail + 100 GB retention storage', '1 TB team storage', 'Email retention, eProtect & eDiscovery', 'Zoho Connect intranet'] },
  ],
  reseller: [
    { name: 'Basic Reseller', desc: 'Launch your own hosting brand.', currency: 'USD', price: 177.40, unit: 'year', features: ['10 GB SSD allocations', 'Up to 5 white-label WordPress sites', 'Powered by LiteSpeed Web Server'] },
    { name: 'Premium Reseller', desc: 'Full toolkit with daily backups.', currency: 'USD', price: 354.80, unit: 'year', popular: true, features: ['20 GB SSD allocations', 'Full WordPress optimization toolkit', 'Automated daily cloud backups'] },
    { name: 'Supreme Reseller', desc: 'Unlimited clients, global reach.', currency: 'USD', price: 532.20, unit: 'year', features: ['30 GB SSD allocations', 'Unlimited corporate client accounts', 'Integrated global CDN'] },
  ],
  security: [
    { name: 'DV SSL Certificate', desc: 'Domain Validation encryption.', currency: 'USD', price: 17.75, unit: 'year', features: ['Domain-validated HTTPS', 'Fast automated issuance', 'Browser padlock trust'] },
    { name: 'OV SSL Certificate', desc: 'Organization Validation trust.', currency: 'USD', price: 88.70, unit: 'year', features: ['Verified organization identity', 'Stronger customer assurance', 'Ideal for business sites'] },
    { name: 'Wildcard SSL Certificate', desc: 'One certificate for your domain and all its subdomains.', currency: 'USD', price: 103, unit: 'year', features: ['Secures your domain and every subdomain', 'Domain-validated (DNS validation)', 'One certificate to manage'] },
    { name: 'EV SSL Certificate', desc: 'Extended Validation with the strictest identity checks.', currency: 'USD', price: 177.40, unit: 'year', features: ['Highest level of validation', 'Company details shown when the certificate is inspected', 'Maximum buyer confidence'] },
    { name: 'Automated Cloud Backup', desc: 'Acronis-powered backup pipeline.', currency: 'USD', price: 42.60, unit: 'year', features: ['25 GB Acronis sandbox', 'Automated backup pipeline', 'Rapid restore & recovery'] },
    { name: 'Website Security Basic', desc: 'Daily malware scanning for a single small site.', currency: 'UGX', price: 50000, unit: 'month', features: ['Scans up to 25 pages daily', 'Malware & blacklist monitoring', 'Automated alert emails'] },
    { name: 'Website Security Professional', desc: 'Deeper scanning with automatic malware removal.', currency: 'UGX', price: 80000, unit: 'month', popular: true, features: ['Scans up to 100 pages daily', 'Automatic malware removal', 'SQLi & XSS vulnerability scans'] },
    { name: 'Website Security Premium', desc: 'Full protection with a website firewall for high-traffic sites.', currency: 'UGX', price: 120000, unit: 'month', features: ['Scans up to 500 pages daily', 'Web application firewall', 'DDoS mitigation for your website'] },
  ],
  webdesign: [
    {
      name: 'Starter Website', desc: 'A clean, professional online presence for small businesses and personal brands.',
      currency: 'UGX', price: 1200000, unit: 'one-time',
      features: ['Up to 5 pages', 'Custom mobile-responsive design', 'Contact & inquiry form', 'Basic on-page SEO setup', 'Free SSL certificate', '1 round of revisions', 'Delivered in 10–14 days'],
    },
    {
      name: 'Business Website', desc: 'Our most-booked package: a growth-ready site with fast, free monthly updates handled for you.',
      currency: 'UGX', price: 2500000, unit: 'one-time', popular: true,
      features: ['Up to 12 pages', 'Fully custom design, no templates', 'Free monthly content updates', 'Blog / news section', 'WhatsApp click-to-chat', 'Google Analytics & Search Console setup', '2 rounds of revisions', 'Delivered in 3–4 weeks'],
    },
    {
      name: 'Premium / E-commerce', desc: 'A full online store or advanced platform, built to convert and built to scale.',
      currency: 'UGX', price: 4800000, unit: 'one-time',
      features: ['Unlimited pages & products', 'Online store with Mobile Money & card checkout', 'Inventory & order management', 'Advanced SEO & speed optimisation', 'Staff accounts & admin dashboard', '3 rounds of revisions', 'Delivered in 5–7 weeks'],
    },
  ],
  webredesign: [
    {
      name: 'Refresh', desc: 'A visual and performance refresh for a site that just needs modernising, not rebuilding.',
      currency: 'UGX', price: 1000000, unit: 'one-time',
      features: ['Up to 5 pages restyled', 'Keep your existing content & structure', 'Mobile responsiveness fixes', 'Speed & Core Web Vitals tuning', 'Basic SEO clean-up', '1 round of revisions', 'Delivered in 7–10 days'],
    },
    {
      name: 'Full Redesign', desc: 'A ground-up rebuild: new design, new build, your content migrated for you.',
      currency: 'UGX', price: 2000000, unit: 'one-time', popular: true,
      features: ['Up to 12 pages rebuilt', 'Brand-new custom design', 'Content migrated from your old site', 'Free monthly content updates', 'On-page SEO improvements', '2 rounds of revisions', 'Delivered in 3–4 weeks'],
    },
    {
      name: 'Platform Migration & Redesign', desc: 'Move off an outdated platform entirely: redesigned, rebuilt and relaunched with zero data loss.',
      currency: 'UGX', price: 3500000, unit: 'one-time',
      features: ['Full rebuild on a modern stack', 'E-commerce & database migration', '301 redirects to protect your search rankings', 'Staging preview before go-live', 'Zero-downtime launch', '3 rounds of revisions', 'Delivered in 5–7 weeks'],
    },
  ],
};

const CHECK_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="rgba(21,122,70,.12)"/><path d="M7 12.5l3.2 3.2L17 9" stroke="var(--success-strong)" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function unitLabel(unit: PriceUnit): string {
  switch (unit) {
    case 'user/year': return '/ user / year';
    case 'user/month': return '/ user / month';
    case 'month': return '/ month';
    case 'one-time': return 'one-time';
    default: return '/ year';
  }
}

class PricingRenderer {
  private readonly slots: Array<{ el: HTMLElement; plan: PricingPlan }> = [];

  constructor() {
    currencyStore.subscribe(() => this.updatePrices());
  }

  /** Cards are rendered once; a currency change updates the numbers in place (no scroll reset, no re-bind). */
  public render(): void {
    (Object.keys(PRICING) as PanelKey[]).forEach((key) => {
      const container = qs<HTMLElement>(`[data-cards="${key}"]`);
      if (!container) {
        return;
      }
      container.innerHTML = PRICING[key].map((plan) => this.cardHtml(plan, key)).join('');
      qsa<HTMLElement>('.plan-slot', container).forEach((el, index) => {
        this.slots.push({ el, plan: PRICING[key][index] });
      });
    });
  }

  private contextFor(plan: PricingPlan, currency: Currency): string {
    const priceLabel = formatMoney(convertPrice(plan, currency), currency);
    return `I'm interested in the ${plan.name} plan (${priceLabel} ${unitLabel(plan.unit)}).`;
  }

  private updatePrices(): void {
    const currency = currencyStore.value;
    this.slots.forEach(({ el, plan }) => {
      const { prefix, amount, isSymbol } = formatMoneyParts(convertPrice(plan, currency), currency);
      const cur = qs<HTMLElement>('.plan__currency', el);
      const amt = qs<HTMLElement>('.plan__amount', el);
      const btn = qs<HTMLButtonElement>('[data-lead]', el);
      if (cur) {
        cur.textContent = prefix;
        cur.classList.toggle('plan__currency--symbol', isSymbol);
      }
      if (amt) {
        amt.textContent = amount;
        amt.classList.remove('is-flipping');
        void amt.offsetWidth; // restart the little settle animation
        amt.classList.add('is-flipping');
      }
      if (btn) {
        btn.dataset['leadContext'] = this.contextFor(plan, currency);
      }
    });
  }

  private cardHtml(plan: PricingPlan, key: PanelKey): string {
    const currency = currencyStore.value;
    const ribbon = plan.popular ? '<span class="plan__ribbon">Most popular</span>' : '';
    const btnClass = plan.popular ? 'btn btn--secondary' : 'btn btn--primary';
    const features = plan.features
      .map((feat) => `<li>${CHECK_SVG}<span>${escapeHtml(feat)}</span></li>`)
      .join('');
    const { prefix, amount, isSymbol } = formatMoneyParts(convertPrice(plan, currency), currency);
    const context = escapeHtml(this.contextFor(plan, currency));
    // Plans the portal sells are ordered there; the rest (VPS, dedicated, email suites…) stay a request.
    const placement = BILLING_PLACEMENT[key];
    const orderUrl = placement ? planOrderUrl(plan.name, placement) : null;
    const arrow = '<svg class="plan__cta-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    const cta = orderUrl
      ? `<a class="${btnClass}" href="${escapeHtml(orderUrl)}"><span>Order now</span>${arrow}</a>`
      : `<button class="${btnClass}" data-lead data-lead-context="${context}" type="button"><span>Choose plan</span>${arrow}</button>`;
    // A website project is a bigger decision than a hosting plan, so keep a human option next to checkout.
    const talk = orderUrl && key !== 'hosting'
      ? `<button class="plan__ask" data-lead data-lead-context="${context}" type="button">Talk to us first</button>`
      : '';
    return `
      <div class="plan-slot${plan.popular ? ' plan-slot--popular' : ''}">
      ${ribbon}
      <article class="plan${plan.popular ? ' plan--popular' : ''}">
        <h3 class="plan__name">${escapeHtml(plan.name)}</h3>
        <p class="plan__desc">${escapeHtml(plan.desc)}</p>
        <div class="plan__price">
          <span class="plan__price-row">
            <span class="plan__currency${isSymbol ? ' plan__currency--symbol' : ''}">${prefix}</span>
            <span class="plan__amount">${amount}</span>
          </span>
          <span class="plan__unit">${unitLabel(plan.unit)}</span>
        </div>
        <ul class="plan__features">${features}</ul>
        ${cta}
        ${talk}
      </article>
      </div>`;
  }
}

/** Static prices written into the HTML (home plans shelf, domain chips) follow the same shared currency. */
class StaticPrices {
  private readonly byName = new Map<string, PricingPlan>();

  constructor() {
    (Object.values(PRICING) as PricingPlan[][]).forEach((plans) => {
      plans.forEach((plan) => this.byName.set(plan.name, plan));
    });
    currencyStore.subscribe(() => this.update());
    this.update();
  }

  public update(): void {
    const currency = currencyStore.value;
    qsa<HTMLElement>('[data-plan-price]').forEach((el) => {
      const plan = this.byName.get(el.dataset['planPrice'] ?? '');
      if (plan) {
        el.textContent = formatMoney(convertPrice(plan, currency), currency);
      }
    });
    qsa<HTMLElement>('[data-usd]').forEach((el) => {
      const usd = Number(el.dataset['usd'] ?? '0');
      el.textContent = formatMoney(usdTo(usd, currency), currency);
    });
  }
}

class CurrencyToggle {
  private readonly buttons: HTMLButtonElement[];

  constructor(root: HTMLElement) {
    this.buttons = qsa<HTMLButtonElement>('.currency-toggle__btn', root);
    this.buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        currencyStore.set(btn.dataset['currency'] === 'USD' ? 'USD' : 'UGX');
      });
    });
    currencyStore.subscribe((currency) => this.sync(currency));
    this.sync(currencyStore.value);
  }

  private sync(active: Currency): void {
    this.buttons.forEach((btn) => {
      const selected = btn.dataset['currency'] === active;
      btn.classList.toggle('is-active', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
  }
}

/** A single "Show prices in USD" link-button for places without room for the full toggle. */
class CurrencyFlip {
  private readonly button: HTMLButtonElement;

  constructor(button: HTMLButtonElement) {
    this.button = button;
    button.addEventListener('click', () => {
      currencyStore.set(currencyStore.value === 'UGX' ? 'USD' : 'UGX');
    });
    currencyStore.subscribe(() => this.sync());
    this.sync();
  }

  private sync(): void {
    const other = currencyStore.value === 'UGX' ? 'USD' : 'UGX';
    this.button.textContent = `Show prices in ${other}`;
  }
}

/* ============================================================
   Testimonial switcher (accessible tabs: client -> quote)
   ============================================================ */

class TestimonialSwitcher {
  private readonly tabs: HTMLButtonElement[];
  private readonly panels: HTMLElement[];

  constructor(tablist: HTMLElement) {
    this.tabs = qsa<HTMLButtonElement>('.trust__tab', tablist);
    this.panels = this.tabs
      .map((tab) => {
        const id = tab.getAttribute('aria-controls');
        return id ? document.getElementById(id) : null;
      })
      .filter((el): el is HTMLElement => el !== null);
    this.bind();
  }

  private bind(): void {
    this.tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => this.activate(index));
      tab.addEventListener('keydown', (event: KeyboardEvent) => this.onKey(event, index));
    });
  }

  private onKey(event: KeyboardEvent, index: number): void {
    let next = index;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      next = (index + 1) % this.tabs.length;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      next = (index - 1 + this.tabs.length) % this.tabs.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = this.tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    this.activate(next);
    this.tabs[next].focus();
  }

  private activate(index: number): void {
    this.tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    this.panels.forEach((panel, i) => {
      const selected = i === index;
      panel.classList.toggle('is-active', selected);
      if (selected) {
        panel.removeAttribute('hidden');
      } else {
        panel.setAttribute('hidden', '');
      }
    });
  }
}

/* ============================================================
   Image loop — walks once through a stack of product screenshots
   when it scrolls into view, then rests on the last frame.
   Finite and under 5 seconds, so it never becomes unstoppable motion.
   ============================================================ */

class ImageLoop {
  constructor(root: HTMLElement, stepMs = 1400) {
    const imgs = qsa<HTMLElement>('.wsmock__img', root);
    if (imgs.length < 2 || prefersReducedMotion() || !('IntersectionObserver' in window)) {
      return;
    }
    let index = 0;
    const run = (): void => {
      const timer = window.setInterval(() => {
        if (index >= imgs.length - 1) {
          window.clearInterval(timer);
          return;
        }
        imgs[index].classList.remove('is-active');
        index += 1;
        imgs[index].classList.add('is-active');
      }, stepMs);
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        run();
      }
    }, { threshold: 0.5 });
    observer.observe(root);
  }
}

/* ============================================================
   Logo wall — graceful text wordmark until real logos exist
   ============================================================ */

class LogoWall {
  constructor(root: HTMLElement) {
    qsa<HTMLImageElement>('img', root).forEach((img) => {
      if (img.complete) {
        if (img.naturalWidth === 0) {
          this.fallback(img);
        }
      } else {
        img.addEventListener('error', () => this.fallback(img));
        img.addEventListener('load', () => {
          if (img.naturalWidth === 0) {
            this.fallback(img);
          }
        });
      }
    });
  }

  private fallback(img: HTMLImageElement): void {
    const parent = img.parentElement;
    if (!parent || parent.querySelector('.logowall__fallback')) {
      return;
    }
    const name = img.dataset['name'] ?? img.alt;
    const span = document.createElement('span');
    span.className = 'logowall__fallback';
    span.textContent = name;
    img.replaceWith(span);
  }
}

/* ============================================================
   Scroll carousel — prev/next buttons that page a scroll-snap track.
   Native scrolling does the physics (momentum, rubber-banding);
   the buttons disappear at the ends instead of wrapping.
   ============================================================ */

class ScrollCarousel {
  private readonly prevBtn: HTMLButtonElement | null;
  private readonly nextBtn: HTMLButtonElement | null;
  private ticking = false;

  constructor(private readonly resolveTrack: () => HTMLElement | null, prevBtn: HTMLButtonElement | null, nextBtn: HTMLButtonElement | null, watch: HTMLElement[]) {
    this.prevBtn = prevBtn;
    this.nextBtn = nextBtn;
    prevBtn?.addEventListener('click', () => this.page(-1));
    nextBtn?.addEventListener('click', () => this.page(1));
    const schedule = (): void => {
      if (this.ticking) {
        return;
      }
      this.ticking = true;
      window.requestAnimationFrame(() => {
        this.ticking = false;
        this.update();
      });
    };
    watch.forEach((el) => el.addEventListener('scroll', schedule, { passive: true }));
    window.addEventListener('resize', schedule);
    document.addEventListener('tabs:change', schedule);
    this.update();
  }

  private page(direction: 1 | -1): void {
    const track = this.resolveTrack();
    if (!track) {
      return;
    }
    const card = track.firstElementChild as HTMLElement | null;
    const gap = Number.parseFloat(getComputedStyle(track).columnGap || '0') || 0;
    const step = card ? card.getBoundingClientRect().width + gap : track.clientWidth;
    track.scrollBy({ left: direction * step, behavior: scrollBehavior() });
  }

  private update(): void {
    const track = this.resolveTrack();
    if (!track) {
      return;
    }
    const max = track.scrollWidth - track.clientWidth;
    const hasOverflow = max > 2;
    if (this.prevBtn) {
      this.prevBtn.disabled = !hasOverflow || track.scrollLeft <= 2;
    }
    if (this.nextBtn) {
      this.nextBtn.disabled = !hasOverflow || track.scrollLeft >= max - 2;
    }
  }
}

/* ============================================================
   Reveal on scroll (staggered). Elements are only ever hidden when JS is running
   (see `.js .reveal`), and once revealed they are *released*: the class and the
   stagger delay are removed so hover/press transitions behave normally.
   ============================================================ */

class RevealOnScroll {
  private readonly observer: IntersectionObserver | null;

  constructor() {
    const items = qsa<HTMLElement>('.reveal');
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      items.forEach((el) => this.release(el));
      this.observer = null;
      return;
    }
    // Items inside a horizontal scroller can't wait for the viewport to "see" them.
    const scrollers = '.pillars__track, .showcase__grid, .tab-panel';
    this.observer = new IntersectionObserver(
      (entries) => this.onIntersect(entries),
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    items.forEach((el) => {
      if (el.closest(scrollers)) {
        this.release(el);
      } else {
        this.observer?.observe(el);
      }
    });
  }

  private release(el: HTMLElement): void {
    el.classList.remove('reveal', 'is-in');
    el.style.transitionDelay = '';
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }
      const el = entry.target as HTMLElement;
      const siblings = el.parentElement ? qsa<HTMLElement>('.reveal', el.parentElement).filter((s) => s.parentElement === el.parentElement) : [el];
      const index = Math.max(0, siblings.indexOf(el));
      const delay = Math.min(index, 5) * 70;
      el.style.transitionDelay = `${delay}ms`;
      el.classList.add('is-in');
      this.observer?.unobserve(el);
      window.setTimeout(() => this.release(el), delay + 800);
    });
  }
}

/* ============================================================
   Stats counter (count-up, once). Real values live in the HTML;
   we only rewind them to 0 when we are about to animate.
   ============================================================ */

class StatsCounter {
  private readonly observer: IntersectionObserver | null;

  constructor() {
    const nums = qsa<HTMLElement>('.stat__num');
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      this.observer = null;
      return;
    }
    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), { threshold: 0.5 });
    nums.forEach((el) => {
      const decimals = Number(el.dataset['decimals'] ?? '0');
      el.textContent = (0).toFixed(decimals) + (el.dataset['suffix'] ?? '');
      this.observer?.observe(el);
    });
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        this.animate(entry.target as HTMLElement);
        this.observer?.unobserve(entry.target);
      }
    });
  }

  private animate(el: HTMLElement): void {
    const target = Number(el.dataset['count'] ?? '0');
    const suffix = el.dataset['suffix'] ?? '';
    const decimals = Number(el.dataset['decimals'] ?? '0');
    const duration = 1200;
    const start = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = (target * eased).toFixed(decimals) + suffix;
      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        el.textContent = target.toFixed(decimals) + suffix;
      }
    };
    window.requestAnimationFrame(step);
  }
}

/* ============================================================
   Sticky header + scroll spy + scroll progress + back to top.
   Layout is measured on resize, not on every scroll frame;
   the progress bar only ever changes `transform`.
   ============================================================ */

class StickyHeader {
  private readonly header: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly toTop: HTMLElement;
  private readonly navLinks: HTMLAnchorElement[];
  private readonly sections: HTMLElement[];
  private offsets: number[] = [];
  private scrollable = 0;
  private ticking = false;

  constructor(header: HTMLElement, progress: HTMLElement, toTop: HTMLElement) {
    this.header = header;
    this.progress = progress;
    this.toTop = toTop;
    this.navLinks = qsa<HTMLAnchorElement>('.nav__link[href^="#"]');
    this.sections = this.navLinks
      .map((link) => document.getElementById((link.getAttribute('href') ?? '').slice(1)))
      .filter((el): el is HTMLElement => el !== null);

    window.addEventListener('scroll', () => this.onScroll(), { passive: true });
    window.addEventListener('resize', () => this.measure());
    window.addEventListener('load', () => this.measure());
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => this.measure()).observe(document.body);
    }
    this.toTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
    });
    this.measure();
  }

  private measure(): void {
    const doc = document.documentElement;
    this.scrollable = doc.scrollHeight - doc.clientHeight;
    this.offsets = this.sections.map((section) => section.getBoundingClientRect().top + window.scrollY);
    this.update();
  }

  private onScroll(): void {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    window.requestAnimationFrame(() => {
      this.update();
      this.ticking = false;
    });
  }

  private update(): void {
    const y = window.scrollY;
    this.header.classList.toggle('is-stuck', y > 8);
    this.toTop.classList.toggle('is-visible', y > 600);
    const pct = this.scrollable > 0 ? Math.min(1, Math.max(0, y / this.scrollable)) : 0;
    this.progress.style.transform = `scaleX(${pct})`;
    this.spy(y);
  }

  private spy(y: number): void {
    if (this.navLinks.length === 0) {
      return;
    }
    const marker = y + window.innerHeight * 0.3;
    // The current section is the one whose top is nearest above the marker — regardless of nav order.
    let activeId = '';
    let best = -Infinity;
    this.sections.forEach((section, i) => {
      if (this.offsets[i] <= marker && this.offsets[i] > best) {
        best = this.offsets[i];
        activeId = section.id;
      }
    });
    this.navLinks.forEach((link) => {
      const active = link.getAttribute('href') === `#${activeId}`;
      link.classList.toggle('is-active', active);
      if (active) {
        link.setAttribute('aria-current', 'location');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }
}

/* ============================================================
   Accordion — independent items (you decide what stays open).
   The height animation is pure CSS (grid rows), so there is no measured
   height to go stale when the window resizes.
   ============================================================ */

class Accordion {
  constructor(root: HTMLElement, group: number) {
    qsa<HTMLElement>('.acc', root).forEach((item, i) => {
      const button = qs<HTMLButtonElement>('.acc__q', item);
      const answer = qs<HTMLElement>('.acc__a', item);
      if (!button || !answer) {
        return;
      }
      const base = `acc-${group}-${i}`;
      button.id = button.id || `${base}-q`;
      answer.id = answer.id || `${base}-a`;
      button.setAttribute('aria-controls', answer.id);
      answer.setAttribute('role', 'region');
      answer.setAttribute('aria-labelledby', button.id);
      button.addEventListener('click', () => {
        const open = !item.classList.contains('is-open');
        item.classList.toggle('is-open', open);
        button.setAttribute('aria-expanded', String(open));
      });
    });
  }
}

/* ============================================================
   Mega menu
   - mouse: opens on hover *intent* (short delay), click pins it open
   - touch/keyboard: click toggles
   - closes on: outside click, Escape, focus leaving, choosing a link
   ============================================================ */

class MegaMenu {
  private readonly trigger: HTMLButtonElement;
  private readonly mega: HTMLElement;
  private readonly item: HTMLElement;
  private pinned = false;
  private timer: number | undefined;

  constructor(item: HTMLElement) {
    this.item = item;
    this.trigger = qs<HTMLButtonElement>('.nav__trigger', item) as HTMLButtonElement;
    this.mega = qs<HTMLElement>('.mega', item) as HTMLElement;
    if (!this.mega.id) {
      this.mega.id = 'mega-services';
    }
    this.trigger.setAttribute('aria-controls', this.mega.id);
    this.trigger.removeAttribute('aria-haspopup');
    this.mega.removeAttribute('role');
    this.bind();
  }

  private isOpen(): boolean {
    return this.mega.classList.contains('is-open');
  }

  private open(): void {
    this.cancelTimer();
    this.mega.classList.add('is-open');
    this.trigger.setAttribute('aria-expanded', 'true');
  }

  private close(): void {
    this.cancelTimer();
    this.pinned = false;
    this.mega.classList.remove('is-open');
    this.trigger.setAttribute('aria-expanded', 'false');
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private schedule(open: boolean, ms: number): void {
    this.cancelTimer();
    this.timer = window.setTimeout(() => (open ? this.open() : this.close()), ms);
  }

  private bind(): void {
    this.trigger.addEventListener('click', (event) => {
      event.preventDefault();
      if (this.isOpen() && this.pinned) {
        this.close();
      } else {
        // First click while hover-open (or closed) pins it, so a click never fights the hover.
        this.open();
        this.pinned = true;
      }
    });
    this.item.addEventListener('pointerenter', (event: PointerEvent) => {
      if (event.pointerType === 'mouse') {
        this.schedule(true, 70);
      }
    });
    this.item.addEventListener('pointerleave', (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && !this.pinned) {
        this.schedule(false, 140);
      }
    });
    this.mega.addEventListener('click', (event) => {
      if ((event.target as Element).closest('a')) {
        this.close();
      }
    });
    this.item.addEventListener('focusout', (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && !this.item.contains(next)) {
        this.close();
      }
    });
    document.addEventListener('click', (event) => {
      if (!this.item.contains(event.target as Node)) {
        this.close();
      }
    });
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.isOpen()) {
        const hadFocus = this.item.contains(document.activeElement);
        this.close();
        if (hadFocus) {
          this.trigger.focus();
        }
      }
    });
  }
}

/* ============================================================
   Mobile menu — a sheet you can grab.
   Opens/closes on a critically damped spring; while open you can drag it
   toward the right edge (1:1, with rubber-banding the other way). On release it
   keeps the finger's velocity and rests wherever the *projected* position says.
   Grabbing it mid-flight stops it where it is.
   ============================================================ */

class MobileMenu {
  private readonly menu: HTMLElement;
  private readonly hamburger: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private lastFocused: HTMLElement | null = null;
  private x = 0;
  private target = 0;
  private spring: SpringHandle | null = null;
  private opened = false;

  constructor(menu: HTMLElement, hamburger: HTMLButtonElement, closeBtn: HTMLButtonElement) {
    this.menu = menu;
    this.hamburger = hamburger;
    this.closeBtn = closeBtn;
    this.bind();
    this.bindDrag();
  }

  private bind(): void {
    this.hamburger.addEventListener('click', () => this.open());
    this.closeBtn.addEventListener('click', () => this.close());
    qsa<HTMLAnchorElement>('a', this.menu).forEach((link) => {
      link.addEventListener('click', () => this.close());
    });
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if (!this.opened) {
        return;
      }
      if (event.key === 'Escape') {
        this.close();
      } else if (event.key === 'Tab') {
        this.trapFocus(event);
      }
    });
    // Leaving the mobile layout while the sheet is open: just tidy up.
    window.matchMedia('(min-width: 1141px)').addEventListener('change', (event) => {
      if (event.matches && this.opened) {
        this.close(true);
      }
    });
  }

  private width(): number {
    return this.menu.offsetWidth || window.innerWidth;
  }

  private focusable(): HTMLElement[] {
    return qsa<HTMLElement>('a[href], button:not([disabled]), summary', this.menu);
  }

  private markOpen(): void {
    this.opened = true;
    this.lastFocused = document.activeElement as HTMLElement | null;
    this.menu.classList.add('is-open');
    this.menu.setAttribute('aria-hidden', 'false');
    this.hamburger.classList.add('is-open');
    this.hamburger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  private markClosed(): void {
    this.opened = false;
    this.menu.setAttribute('aria-hidden', 'true');
    this.hamburger.classList.remove('is-open');
    this.hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (this.lastFocused) {
      this.lastFocused.focus();
    }
  }

  private render(x: number): void {
    this.x = x;
    this.menu.style.transform = `translateX(${x}px)`;
  }

  private release(): void {
    this.spring = null;
    this.menu.classList.remove('is-driven');
    this.menu.style.transform = '';
    if (this.target !== 0) {
      this.menu.classList.remove('is-open');
    }
  }

  /** Spring the sheet to `to`, continuing from its live position and velocity. */
  private drive(to: number, velocity: number): void {
    if (this.spring) {
      this.spring.cancel();
    }
    this.target = to;
    this.menu.classList.add('is-driven');
    this.spring = springTo(this.x, to, velocity, 0.42, (x) => this.render(x), () => this.release());
  }

  public open(): void {
    if (this.opened && this.target === 0) {
      return;
    }
    const wasClosed = !this.opened;
    if (wasClosed) {
      this.markOpen();
    }
    const first = this.focusable()[0];
    if (prefersReducedMotion()) {
      this.target = 0;
      this.release();
      first?.focus();
      return;
    }
    if (wasClosed && !this.spring) {
      this.render(this.width());
    }
    this.drive(0, 0);
    first?.focus({ preventScroll: true });
  }

  public close(immediate = false): void {
    if (!this.opened) {
      return;
    }
    this.markClosed();
    if (immediate || prefersReducedMotion()) {
      if (this.spring) {
        this.spring.cancel();
      }
      this.target = this.width();
      this.release();
      return;
    }
    this.drive(this.width(), 0);
  }

  private trapFocus(event: KeyboardEvent): void {
    const nodes = this.focusable();
    if (nodes.length === 0) {
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private bindDrag(): void {
    let pointerId = -1;
    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let dragging = false;
    let interrupted = false;
    let samples: Array<{ x: number; t: number }> = [];

    this.menu.addEventListener('pointerdown', (event: PointerEvent) => {
      if (!this.opened || event.pointerType === 'mouse') {
        return;
      }
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      dragging = false;
      samples = [{ x: event.clientX, t: event.timeStamp }];
      // Grabbing a moving sheet stops it right where it is — no waiting for it to land.
      interrupted = this.spring !== null;
      if (this.spring) {
        this.spring.cancel();
        this.spring = null;
      }
      baseX = this.x;
    });

    this.menu.addEventListener('pointermove', (event: PointerEvent) => {
      if (event.pointerId !== pointerId) {
        return;
      }
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
          return; // hysteresis: wait until intent is clear
        }
        if (Math.abs(dy) > Math.abs(dx)) {
          pointerId = -1; // a vertical scroll — the page's, not ours
          if (interrupted) {
            this.drive(this.target, 0);
          }
          return;
        }
        dragging = true;
        this.menu.classList.add('is-driven');
        try {
          this.menu.setPointerCapture(event.pointerId);
        } catch {
          /* pointer already released */
        }
      }
      const raw = baseX + dx;
      this.render(raw < 0 ? -rubberband(-raw, this.width()) : raw);
      samples.push({ x: event.clientX, t: event.timeStamp });
      while (samples.length > 2 && event.timeStamp - samples[0].t > 100) {
        samples.shift();
      }
    });

    const end = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) {
        return;
      }
      pointerId = -1;
      if (!dragging) {
        if (interrupted) {
          this.drive(this.target, 0);
        }
        return;
      }
      dragging = false;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = Math.max(1, last.t - first.t);
      const velocity = ((last.x - first.x) / dt) * 1000; // px/s
      const projected = this.x + project(velocity);
      const closing = projected > this.width() * 0.5;
      if (closing) {
        this.markClosed();
      }
      this.drive(closing ? this.width() : 0, velocity);
    };
    this.menu.addEventListener('pointerup', end);
    this.menu.addEventListener('pointercancel', end);
  }
}

/* ============================================================
   Bootstrap
   ============================================================ */

function bootstrap(): void {
  document.documentElement.classList.add('js');

  const toastEl = document.getElementById('toast');
  const toast = new Toast(toastEl as HTMLElement);

  // One delegated handler for every "lead" button — including ones rendered later.
  document.addEventListener('click', (event) => {
    const btn = (event.target as Element).closest<HTMLElement>('[data-lead]');
    if (btn) {
      toast.fireLead(btn.dataset['leadContext']);
    }
  });

  const quoteForm = qs<HTMLFormElement>('#quoteForm');
  if (quoteForm) {
    toast.attachQuoteForm(new QuoteForm(quoteForm, toast));
  }

  // Cards render before the static-price pass and the tab wiring.
  new PricingRenderer().render();
  new StaticPrices();

  const domainForm = qs<HTMLFormElement>('#domainForm');
  if (domainForm) {
    new DomainChecker(domainForm);
  }

  qsa<HTMLElement>('.wsmock').forEach((el) => new ImageLoop(el));

  qsa<HTMLElement>('[role="tablist"]').forEach((list) => {
    if (list.id === 'trustTabs') {
      new TestimonialSwitcher(list);
    } else {
      new Tabs(list);
    }
  });

  qsa<HTMLElement>('.currency-toggle').forEach((el) => new CurrencyToggle(el));
  qsa<HTMLButtonElement>('[data-currency-flip]').forEach((el) => new CurrencyFlip(el));

  const logoWall = document.getElementById('logoWall');
  if (logoWall) {
    new LogoWall(logoWall);
  }

  const pillarsTrack = document.getElementById('pillarsTrack');
  if (pillarsTrack) {
    new ScrollCarousel(() => pillarsTrack, qs<HTMLButtonElement>('#pillarsPrev'), qs<HTMLButtonElement>('#pillarsNext'), [pillarsTrack]);
  }

  const showcaseTrack = document.getElementById('showcaseTrack');
  if (showcaseTrack) {
    new ScrollCarousel(() => showcaseTrack, qs<HTMLButtonElement>('#showcasePrev'), qs<HTMLButtonElement>('#showcaseNext'), [showcaseTrack]);
  }

  // Pricing carousels resolve the *active* tab panel on every use.
  qsa<HTMLElement>('.pricing__carousel').forEach((carousel) => {
    const panels = qsa<HTMLElement>('.tab-panel', carousel);
    new ScrollCarousel(
      () => qs<HTMLElement>('.tab-panel.is-active', carousel),
      qs<HTMLButtonElement>('.pricing__nav--prev', carousel),
      qs<HTMLButtonElement>('.pricing__nav--next', carousel),
      panels,
    );
  });

  new RevealOnScroll();
  new StatsCounter();

  const header = document.getElementById('header');
  const progress = document.getElementById('scrollProgress');
  const toTop = document.getElementById('toTop');
  if (header && progress && toTop) {
    new StickyHeader(header, progress, toTop);
  }

  qsa<HTMLElement>('.accordion').forEach((accordion, group) => new Accordion(accordion, group));

  const megaItem = qs<HTMLElement>('.has-mega');
  if (megaItem) {
    new MegaMenu(megaItem);
  }

  const mobileMenu = document.getElementById('mobileMenu');
  const hamburger = document.getElementById('hamburger');
  const mobileClose = document.getElementById('mobileClose');
  if (mobileMenu && hamburger && mobileClose) {
    new MobileMenu(mobileMenu, hamburger as HTMLButtonElement, mobileClose as HTMLButtonElement);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
