"use strict";
/* ============================================================
   BlacTec Technologies Ltd. — Front-end interaction layer
   Strict TypeScript · no runtime libraries · compiled to dist/main.js

   Principles this file follows (Apple "fluid interfaces"):
   - respond on press, never wait for release
   - animate from the live (presentation) value, never from the target
   - gestures are tracked 1:1, released with their own velocity
   - springs for anything a finger can grab; critically damped by default
   - nothing is locked out while it moves
   ============================================================ */
/** Approximate market rate — one number for the whole site. The static UGX fallbacks in index.html are derived from it. */
const UGX_PER_USD = 4100;
function formatUgx(value) {
    return `UGX ${Math.round(value).toLocaleString('en-US')}`;
}
function formatUsd(value) {
    return `$${value.toFixed(2)}`;
}
function formatMoney(value, currency) {
    return currency === 'UGX' ? formatUgx(value) : formatUsd(value);
}
/** Splits a price into currency label + amount so premium price displays can style each part. */
function formatMoneyParts(value, currency) {
    return currency === 'UGX'
        ? { prefix: 'UGX', amount: Math.round(value).toLocaleString('en-US'), isSymbol: false }
        : { prefix: '$', amount: value.toFixed(2), isSymbol: true };
}
/** Converts a plan's native price into the requested display currency. */
function convertPrice(plan, target) {
    if (plan.currency === target) {
        return plan.price;
    }
    return plan.currency === 'UGX' ? plan.price / UGX_PER_USD : plan.price * UGX_PER_USD;
}
function usdTo(value, target) {
    return target === 'USD' ? value : value * UGX_PER_USD;
}
/* ---------- Tiny DOM helpers (null-narrowing) ---------- */
function qs(selector, root = document) {
    return root.querySelector(selector);
}
function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
}
function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function scrollBehavior() {
    return prefersReducedMotion() ? 'auto' : 'smooth';
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function formatPrice(value) {
    return value.toFixed(2);
}
/**
 * Critically damped spring (damping ratio 1.0 — no overshoot) from `from` to `to`, starting at `velocity` px/s.
 * Closed-form, so it is exact at any frame rate and can be re-targeted from the live value + live velocity.
 */
function springTo(from, to, velocity, response, onUpdate, onDone) {
    const w = (2 * Math.PI) / response;
    const a = from - to;
    const b = velocity + w * a;
    const start = performance.now();
    let raf = 0;
    let cancelled = false;
    const tick = (now) => {
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
        cancel() {
            cancelled = true;
            window.cancelAnimationFrame(raf);
        },
    };
}
/** Where a gesture released at `velocity` px/s would come to rest (scroll-deceleration model). */
function project(velocity, decelerationRate = 0.998) {
    return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}
/** Progressive resistance past a boundary — things slow down before they stop. */
function rubberband(overshoot, dimension, constant = 0.55) {
    return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
/* ============================================================
   Currency — one shared preference for the whole page
   ============================================================ */
class CurrencyStore {
    constructor() {
        this.current = 'UGX';
        this.listeners = [];
        try {
            const saved = window.localStorage.getItem('blactecCurrency');
            if (saved === 'UGX' || saved === 'USD') {
                this.current = saved;
            }
        }
        catch {
            /* storage unavailable (private mode) — default is fine */
        }
    }
    get value() {
        return this.current;
    }
    set(currency) {
        if (currency === this.current) {
            return;
        }
        this.current = currency;
        try {
            window.localStorage.setItem('blactecCurrency', currency);
        }
        catch {
            /* ignore */
        }
        this.listeners.forEach((listener) => listener(currency));
    }
    subscribe(listener) {
        this.listeners.push(listener);
    }
}
const currencyStore = new CurrencyStore();
/* ============================================================
   Toast — shared notifier + scroll-to-contact
   ============================================================ */
class Toast {
    constructor(el) {
        this.quoteForm = null;
        this.el = el;
    }
    /** Wired after QuoteForm exists so lead buttons can prefill it. */
    attachQuoteForm(form) {
        this.quoteForm = form;
    }
    show(message) {
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
    fireLead(context) {
        this.show('Great choice — tell us a little about your project below.');
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
    constructor(form, toast) {
        this.fallback = null;
        this.form = form;
        this.toast = toast;
        this.nameInput = qs('#quoteName', form);
        this.emailInput = qs('#quoteEmail', form);
        this.phoneInput = qs('#quotePhone', form);
        this.serviceSelect = qs('#quoteService', form);
        this.messageInput = qs('#quoteMessage', form);
        this.bind();
    }
    /** Called by lead buttons across the page to pre-fill context before the form comes into view. */
    prefill(context) {
        if (context && this.messageInput.value.trim().length === 0) {
            this.messageInput.value = context;
        }
        window.setTimeout(() => this.nameInput.focus({ preventScroll: true }), 500);
    }
    bind() {
        this.form.addEventListener('submit', (event) => {
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
    compose() {
        const name = this.nameInput.value.trim();
        const email = this.emailInput.value.trim();
        const phone = this.phoneInput.value.trim();
        const service = this.serviceSelect.value;
        const message = this.messageInput.value.trim();
        const subject = `Quote request from ${name} — ${service}`;
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
    submit() {
        [this.nameInput, this.emailInput].forEach((input) => {
            if (input.validity.valid) {
                input.removeAttribute('aria-invalid');
            }
            else {
                input.setAttribute('aria-invalid', 'true');
            }
        });
        if (!this.form.reportValidity()) {
            return;
        }
        const { subject, body } = this.compose();
        this.showFallback(subject, body);
        this.toast.show('Opening your email app — if nothing happens, use the options below the form.');
        window.location.href = `mailto:info@blactec.ug?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }
    showFallback(subject, body) {
        if (!this.fallback) {
            const box = document.createElement('div');
            box.className = 'quote__fallback';
            box.setAttribute('role', 'status');
            const note = qs('.quote__note', this.form);
            if (note) {
                note.after(box);
            }
            else {
                this.form.append(box);
            }
            this.fallback = box;
        }
        const text = `${subject}\n\n${body}`;
        this.fallback.hidden = false;
        this.fallback.innerHTML = `
      <p><strong>Didn’t your email app open?</strong> Your details are still here — send the same request another way:</p>
      <div class="quote__fallback-actions">
        <a class="btn btn--primary" href="https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Send on WhatsApp</a>
        <button class="btn btn--secondary" type="button" data-copy>Copy details</button>
      </div>`;
        const copyBtn = qs('[data-copy]', this.fallback);
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                void this.copy(text, copyBtn);
            });
        }
    }
    async copy(text, button) {
        let ok = false;
        try {
            await navigator.clipboard.writeText(text);
            ok = true;
        }
        catch {
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.append(area);
            area.select();
            try {
                ok = document.execCommand('copy');
            }
            catch {
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
function timedFetch(url, init, ms, parent) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), ms);
    const onParentAbort = () => controller.abort();
    if (parent) {
        if (parent.aborted) {
            controller.abort();
        }
        else {
            parent.addEventListener('abort', onParentAbort, { once: true });
        }
    }
    return fetch(url, { ...init, signal: controller.signal }).finally(() => {
        window.clearTimeout(timer);
        parent?.removeEventListener('abort', onParentAbort);
    });
}
async function checkGtldAvailability(fullDomain, signal) {
    const res = await timedFetch(`https://rdap.org/domain/${encodeURIComponent(fullDomain)}`, { headers: { Accept: 'application/rdap+json' } }, 8000, signal);
    if (res.status === 404) {
        return true;
    }
    if (res.ok) {
        return false;
    }
    throw new Error(`rdap_http_${res.status}`);
}
async function checkUgAvailability(domain, tld, signal) {
    const url = `${UG_WHOIS_PROXY_URL}/?domain=${encodeURIComponent(domain)}&tld=${encodeURIComponent(tld)}`;
    const res = await timedFetch(url, {}, 8000, signal);
    const data = (await res.json().catch(() => null));
    if (!res.ok || !data || typeof data.available !== 'boolean') {
        throw new Error((data && data.error) || `whois_proxy_http_${res.status}`);
    }
    return data.available;
}
function checkAvailability(domain, tld, signal) {
    return UG_TLDS.includes(tld) ? checkUgAvailability(domain, tld, signal) : checkGtldAvailability(domain + tld, signal);
}
class DomainChecker {
    constructor(form) {
        this.runId = 0;
        this.controller = null;
        this.form = form;
        this.input = qs('#domainInput', form);
        this.select = qs('#tldSelect', form);
        this.result = document.getElementById('domainResult');
        this.tlds = qsa('option', this.select).map((opt) => ({
            tld: opt.value,
            priceUsd: Number(opt.dataset['price'] ?? '0'),
        }));
        this.tldButtons = qsa('.domain__eg');
        this.bind();
        this.syncTldButtons();
    }
    bind() {
        this.form.addEventListener('submit', (event) => {
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
                }
                else {
                    this.input.focus();
                }
            });
        });
    }
    syncTldButtons() {
        this.tldButtons.forEach((btn) => {
            btn.setAttribute('aria-pressed', String(btn.dataset['tld'] === this.select.value));
        });
    }
    sanitize(raw) {
        return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    }
    priceFor(tld) {
        const match = this.tlds.find((t) => t.tld === tld);
        return match ? match.priceUsd : 0;
    }
    money(priceUsd) {
        return formatMoney(usdTo(priceUsd, currencyStore.value), currencyStore.value);
    }
    /** Checks the other listed TLDs in parallel and keeps up to 3 that came back available. */
    async findAvailableAlternatives(domain, excludeTld, signal) {
        const candidates = this.tlds.filter((t) => t.tld !== excludeTld);
        const settled = await Promise.allSettled(candidates.map(async (t) => ({ t, available: await checkAvailability(domain, t.tld, signal) })));
        const available = [];
        for (const outcome of settled) {
            if (outcome.status === 'fulfilled' && outcome.value.available) {
                available.push(outcome.value.t);
            }
        }
        return available.slice(0, 3);
    }
    async run() {
        const domain = this.sanitize(this.input.value);
        if (domain.length === 0) {
            this.input.focus();
            this.renderError('Type a name to search — your business name works well.');
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
        }
        catch (err) {
            if (id !== this.runId) {
                return;
            }
            this.renderCheckError(domain + tld, err);
        }
    }
    renderError(message) {
        this.result.innerHTML = `<div class="result-card result-card--taken"><p class="result-card__name">${escapeHtml(message)}</p></div>`;
    }
    /** The lookup itself failed (network, proxy down, timeout) — distinct from a real "taken" result. */
    renderCheckError(full, err) {
        console.error('Domain availability check failed:', err);
        const context = escapeHtml(`I searched for ${full} but the checker couldn't confirm it — please check availability and get back to me.`);
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
    renderLoading() {
        this.result.innerHTML = `
      <div class="skeleton" role="status" aria-label="Checking availability">
        <div class="skeleton__line skeleton__line--short"></div>
        <div class="skeleton__line"></div>
        <div class="skeleton__line skeleton__line--btn"></div>
      </div>`;
    }
    renderResult(data) {
        const full = `${data.domain}${data.tld}`;
        if (data.status === 'available') {
            const context = escapeHtml(`I'd like to register ${full} (${this.money(data.priceUsd)}/yr).`);
            this.result.innerHTML = `
        <div class="result-card result-card--ok">
          <div class="result-card__top">
            <span class="result-card__name">${escapeHtml(full)}</span>
            <span class="result-card__status">Available</span>
          </div>
          <div class="result-card__top">
            <span class="result-card__price"><span data-usd="${formatPrice(data.priceUsd)}">${this.money(data.priceUsd)}</span> <small>/ year</small></span>
            <button class="btn btn--primary" data-lead data-lead-context="${context}" type="button">Request this domain</button>
          </div>
        </div>`;
            return;
        }
        const transferContext = escapeHtml(`I'd like to transfer ${full} to BlacTec.`);
        const supportContext = escapeHtml(`I have a question about ${full}.`);
        this.result.innerHTML = `
      <div class="result-card result-card--taken">
        <div class="result-card__top">
          <span class="result-card__name">${escapeHtml(full)}</span>
          <span class="result-card__status">Taken</span>
        </div>
        <p class="result-card__note">That domain is already registered — transfer it to us, or see what’s free below.</p>
        <div class="result-card__actions">
          <button class="btn btn--primary" data-lead data-lead-context="${transferContext}" type="button">Transfer it to us</button>
          <button class="btn btn--secondary" data-lead data-lead-context="${supportContext}" type="button">Contact support</button>
        </div>
        <div class="alts" data-alts>
          <span class="alts__title">Checking other extensions…</span>
        </div>
      </div>`;
    }
    renderAlternatives(domain, alternatives) {
        const holder = qs('[data-alts]', this.result);
        if (!holder) {
            return;
        }
        if (alternatives.length === 0) {
            holder.innerHTML = '<span class="alts__title">No other extensions are free for that name — try a variation.</span>';
            return;
        }
        const rows = alternatives
            .map((alt) => {
            const altFull = `${domain}${alt.tld}`;
            const context = escapeHtml(`I'd like to register ${altFull} (${this.money(alt.priceUsd)}/yr).`);
            return `
          <div class="alt">
            <span class="alt__name">${escapeHtml(domain)}<b>${escapeHtml(alt.tld)}</b></span>
            <span class="alt__price"><span data-usd="${formatPrice(alt.priceUsd)}">${this.money(alt.priceUsd)}</span>/yr</span>
            <button class="alt__add" data-lead data-lead-context="${context}" type="button">Request</button>
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
    constructor(list) {
        this.index = 0;
        this.list = list;
        this.tabs = qsa('[role="tab"]', list);
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
    bind() {
        this.tabs.forEach((tab, index) => {
            // Respond on press, not release.
            tab.addEventListener('pointerdown', (event) => {
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
            tab.addEventListener('keydown', (event) => this.onKey(event, index));
        });
    }
    onKey(event, index) {
        let next = index;
        if (event.key === 'ArrowRight') {
            next = (index + 1) % this.tabs.length;
        }
        else if (event.key === 'ArrowLeft') {
            next = (index - 1 + this.tabs.length) % this.tabs.length;
        }
        else if (event.key === 'Home') {
            next = 0;
        }
        else if (event.key === 'End') {
            next = this.tabs.length - 1;
        }
        else {
            return;
        }
        event.preventDefault();
        this.activate(next, true);
    }
    layout() {
        const active = this.tabs[this.index];
        if (!active) {
            return;
        }
        this.list.style.setProperty('--x', `${active.offsetLeft}px`);
        this.list.style.setProperty('--y', `${active.offsetTop}px`);
        this.list.style.setProperty('--w', `${active.offsetWidth}px`);
        this.list.style.setProperty('--h', `${active.offsetHeight}px`);
    }
    activate(index, focus) {
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
                    }
                    else {
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
const PRICING = {
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
        { name: 'Workplace Standard', desc: 'Complete collaboration suite — best value.', currency: 'USD', price: 3.30, unit: 'user/month', popular: true, features: ['30 GB mail + 100 GB team storage', 'WorkDrive, Writer, Sheet & Show', 'Cliq chat, Meeting & Vault', 'AI assistant (Zia) & Trident desktop app'] },
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
        { name: 'EV SSL Certificate', desc: 'Extended Validation — green trust bar.', currency: 'USD', price: 177.40, unit: 'year', features: ['Highest level of validation', 'Green trust bar treatment', 'Maximum buyer confidence'] },
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
            name: 'Business Website', desc: 'Our most-booked package — a growth-ready site with fast, free monthly updates handled for you.',
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
            name: 'Full Redesign', desc: 'A ground-up rebuild — new design, new build, your content migrated for you.',
            currency: 'UGX', price: 2000000, unit: 'one-time', popular: true,
            features: ['Up to 12 pages rebuilt', 'Brand-new custom design', 'Content migrated from your old site', 'Free monthly content updates', 'On-page SEO improvements', '2 rounds of revisions', 'Delivered in 3–4 weeks'],
        },
        {
            name: 'Platform Migration & Redesign', desc: 'Move off an outdated platform entirely — redesigned, rebuilt and relaunched with zero data loss.',
            currency: 'UGX', price: 3500000, unit: 'one-time',
            features: ['Full rebuild on a modern stack', 'E-commerce & database migration', '301 redirects to protect your search rankings', 'Staging preview before go-live', 'Zero-downtime launch', '3 rounds of revisions', 'Delivered in 5–7 weeks'],
        },
    ],
};
const CHECK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="rgba(21,122,70,.12)"/><path d="M7 12.5l3.2 3.2L17 9" stroke="var(--success-strong)" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function unitLabel(unit) {
    switch (unit) {
        case 'user/year': return '/ user / year';
        case 'user/month': return '/ user / month';
        case 'month': return '/ month';
        case 'one-time': return 'one-time';
        default: return '/ year';
    }
}
class PricingRenderer {
    constructor() {
        this.slots = [];
        currencyStore.subscribe(() => this.updatePrices());
    }
    /** Cards are rendered once; a currency change updates the numbers in place (no scroll reset, no re-bind). */
    render() {
        Object.keys(PRICING).forEach((key) => {
            const container = qs(`[data-cards="${key}"]`);
            if (!container) {
                return;
            }
            container.innerHTML = PRICING[key].map((plan) => this.cardHtml(plan)).join('');
            qsa('.plan-slot', container).forEach((el, index) => {
                this.slots.push({ el, plan: PRICING[key][index] });
            });
        });
    }
    contextFor(plan, currency) {
        const priceLabel = formatMoney(convertPrice(plan, currency), currency);
        return `I'm interested in the ${plan.name} plan (${priceLabel} ${unitLabel(plan.unit)}).`;
    }
    updatePrices() {
        const currency = currencyStore.value;
        this.slots.forEach(({ el, plan }) => {
            const { prefix, amount, isSymbol } = formatMoneyParts(convertPrice(plan, currency), currency);
            const cur = qs('.plan__currency', el);
            const amt = qs('.plan__amount', el);
            const btn = qs('[data-lead]', el);
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
    cardHtml(plan) {
        const currency = currencyStore.value;
        const ribbon = plan.popular ? '<span class="plan__ribbon">Most popular</span>' : '';
        const btnClass = plan.popular ? 'btn btn--secondary' : 'btn btn--primary';
        const features = plan.features
            .map((feat) => `<li>${CHECK_SVG}<span>${escapeHtml(feat)}</span></li>`)
            .join('');
        const { prefix, amount, isSymbol } = formatMoneyParts(convertPrice(plan, currency), currency);
        const context = escapeHtml(this.contextFor(plan, currency));
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
        <button class="${btnClass}" data-lead data-lead-context="${context}" type="button">
          <span>Choose plan</span>
          <svg class="plan__cta-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </article>
      </div>`;
    }
}
/** Static prices written into the HTML (home plans shelf, domain chips) follow the same shared currency. */
class StaticPrices {
    constructor() {
        this.byName = new Map();
        Object.values(PRICING).forEach((plans) => {
            plans.forEach((plan) => this.byName.set(plan.name, plan));
        });
        currencyStore.subscribe(() => this.update());
        this.update();
    }
    update() {
        const currency = currencyStore.value;
        qsa('[data-plan-price]').forEach((el) => {
            const plan = this.byName.get(el.dataset['planPrice'] ?? '');
            if (plan) {
                el.textContent = formatMoney(convertPrice(plan, currency), currency);
            }
        });
        qsa('[data-usd]').forEach((el) => {
            const usd = Number(el.dataset['usd'] ?? '0');
            el.textContent = formatMoney(usdTo(usd, currency), currency);
        });
    }
}
class CurrencyToggle {
    constructor(root) {
        this.buttons = qsa('.currency-toggle__btn', root);
        this.buttons.forEach((btn) => {
            btn.addEventListener('click', () => {
                currencyStore.set(btn.dataset['currency'] === 'USD' ? 'USD' : 'UGX');
            });
        });
        currencyStore.subscribe((currency) => this.sync(currency));
        this.sync(currencyStore.value);
    }
    sync(active) {
        this.buttons.forEach((btn) => {
            const selected = btn.dataset['currency'] === active;
            btn.classList.toggle('is-active', selected);
            btn.setAttribute('aria-pressed', String(selected));
        });
    }
}
/** A single "Show prices in USD" link-button for places without room for the full toggle. */
class CurrencyFlip {
    constructor(button) {
        this.button = button;
        button.addEventListener('click', () => {
            currencyStore.set(currencyStore.value === 'UGX' ? 'USD' : 'UGX');
        });
        currencyStore.subscribe(() => this.sync());
        this.sync();
    }
    sync() {
        const other = currencyStore.value === 'UGX' ? 'USD' : 'UGX';
        this.button.textContent = `Show prices in ${other}`;
    }
}
/* ============================================================
   Testimonial switcher (accessible tabs: client -> quote)
   ============================================================ */
class TestimonialSwitcher {
    constructor(tablist) {
        this.tabs = qsa('.trust__tab', tablist);
        this.panels = this.tabs
            .map((tab) => {
            const id = tab.getAttribute('aria-controls');
            return id ? document.getElementById(id) : null;
        })
            .filter((el) => el !== null);
        this.bind();
    }
    bind() {
        this.tabs.forEach((tab, index) => {
            tab.addEventListener('click', () => this.activate(index));
            tab.addEventListener('keydown', (event) => this.onKey(event, index));
        });
    }
    onKey(event, index) {
        let next = index;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
            next = (index + 1) % this.tabs.length;
        }
        else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
            next = (index - 1 + this.tabs.length) % this.tabs.length;
        }
        else if (event.key === 'Home') {
            next = 0;
        }
        else if (event.key === 'End') {
            next = this.tabs.length - 1;
        }
        else {
            return;
        }
        event.preventDefault();
        this.activate(next);
        this.tabs[next].focus();
    }
    activate(index) {
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
            }
            else {
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
    constructor(root, stepMs = 1400) {
        const imgs = qsa('.wsmock__img', root);
        if (imgs.length < 2 || prefersReducedMotion() || !('IntersectionObserver' in window)) {
            return;
        }
        let index = 0;
        const run = () => {
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
    constructor(root) {
        qsa('img', root).forEach((img) => {
            if (img.complete) {
                if (img.naturalWidth === 0) {
                    this.fallback(img);
                }
            }
            else {
                img.addEventListener('error', () => this.fallback(img));
                img.addEventListener('load', () => {
                    if (img.naturalWidth === 0) {
                        this.fallback(img);
                    }
                });
            }
        });
    }
    fallback(img) {
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
    constructor(resolveTrack, prevBtn, nextBtn, watch) {
        this.resolveTrack = resolveTrack;
        this.ticking = false;
        this.prevBtn = prevBtn;
        this.nextBtn = nextBtn;
        prevBtn?.addEventListener('click', () => this.page(-1));
        nextBtn?.addEventListener('click', () => this.page(1));
        const schedule = () => {
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
    page(direction) {
        const track = this.resolveTrack();
        if (!track) {
            return;
        }
        const card = track.firstElementChild;
        const gap = Number.parseFloat(getComputedStyle(track).columnGap || '0') || 0;
        const step = card ? card.getBoundingClientRect().width + gap : track.clientWidth;
        track.scrollBy({ left: direction * step, behavior: scrollBehavior() });
    }
    update() {
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
    constructor() {
        const items = qsa('.reveal');
        if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
            items.forEach((el) => this.release(el));
            this.observer = null;
            return;
        }
        // Items inside a horizontal scroller can't wait for the viewport to "see" them.
        const scrollers = '.pillars__track, .showcase__grid, .tab-panel';
        this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
        items.forEach((el) => {
            if (el.closest(scrollers)) {
                this.release(el);
            }
            else {
                this.observer?.observe(el);
            }
        });
    }
    release(el) {
        el.classList.remove('reveal', 'is-in');
        el.style.transitionDelay = '';
    }
    onIntersect(entries) {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) {
                return;
            }
            const el = entry.target;
            const siblings = el.parentElement ? qsa('.reveal', el.parentElement).filter((s) => s.parentElement === el.parentElement) : [el];
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
    constructor() {
        const nums = qsa('.stat__num');
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
    onIntersect(entries) {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                this.animate(entry.target);
                this.observer?.unobserve(entry.target);
            }
        });
    }
    animate(el) {
        const target = Number(el.dataset['count'] ?? '0');
        const suffix = el.dataset['suffix'] ?? '';
        const decimals = Number(el.dataset['decimals'] ?? '0');
        const duration = 1200;
        const start = performance.now();
        const step = (now) => {
            const progress = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = (target * eased).toFixed(decimals) + suffix;
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
            else {
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
    constructor(header, progress, toTop) {
        this.offsets = [];
        this.scrollable = 0;
        this.ticking = false;
        this.header = header;
        this.progress = progress;
        this.toTop = toTop;
        this.navLinks = qsa('.nav__link[href^="#"]');
        this.sections = this.navLinks
            .map((link) => document.getElementById((link.getAttribute('href') ?? '').slice(1)))
            .filter((el) => el !== null);
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
    measure() {
        const doc = document.documentElement;
        this.scrollable = doc.scrollHeight - doc.clientHeight;
        this.offsets = this.sections.map((section) => section.getBoundingClientRect().top + window.scrollY);
        this.update();
    }
    onScroll() {
        if (this.ticking) {
            return;
        }
        this.ticking = true;
        window.requestAnimationFrame(() => {
            this.update();
            this.ticking = false;
        });
    }
    update() {
        const y = window.scrollY;
        this.header.classList.toggle('is-stuck', y > 8);
        this.toTop.classList.toggle('is-visible', y > 600);
        const pct = this.scrollable > 0 ? Math.min(1, Math.max(0, y / this.scrollable)) : 0;
        this.progress.style.transform = `scaleX(${pct})`;
        this.spy(y);
    }
    spy(y) {
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
            }
            else {
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
    constructor(root, group) {
        qsa('.acc', root).forEach((item, i) => {
            const button = qs('.acc__q', item);
            const answer = qs('.acc__a', item);
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
    constructor(item) {
        this.pinned = false;
        this.item = item;
        this.trigger = qs('.nav__trigger', item);
        this.mega = qs('.mega', item);
        if (!this.mega.id) {
            this.mega.id = 'mega-services';
        }
        this.trigger.setAttribute('aria-controls', this.mega.id);
        this.trigger.removeAttribute('aria-haspopup');
        this.mega.removeAttribute('role');
        this.bind();
    }
    isOpen() {
        return this.mega.classList.contains('is-open');
    }
    open() {
        this.cancelTimer();
        this.mega.classList.add('is-open');
        this.trigger.setAttribute('aria-expanded', 'true');
    }
    close() {
        this.cancelTimer();
        this.pinned = false;
        this.mega.classList.remove('is-open');
        this.trigger.setAttribute('aria-expanded', 'false');
    }
    cancelTimer() {
        if (this.timer !== undefined) {
            window.clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
    schedule(open, ms) {
        this.cancelTimer();
        this.timer = window.setTimeout(() => (open ? this.open() : this.close()), ms);
    }
    bind() {
        this.trigger.addEventListener('click', (event) => {
            event.preventDefault();
            if (this.isOpen() && this.pinned) {
                this.close();
            }
            else {
                // First click while hover-open (or closed) pins it, so a click never fights the hover.
                this.open();
                this.pinned = true;
            }
        });
        this.item.addEventListener('pointerenter', (event) => {
            if (event.pointerType === 'mouse') {
                this.schedule(true, 70);
            }
        });
        this.item.addEventListener('pointerleave', (event) => {
            if (event.pointerType === 'mouse' && !this.pinned) {
                this.schedule(false, 140);
            }
        });
        this.mega.addEventListener('click', (event) => {
            if (event.target.closest('a')) {
                this.close();
            }
        });
        this.item.addEventListener('focusout', (event) => {
            const next = event.relatedTarget;
            if (next && !this.item.contains(next)) {
                this.close();
            }
        });
        document.addEventListener('click', (event) => {
            if (!this.item.contains(event.target)) {
                this.close();
            }
        });
        document.addEventListener('keydown', (event) => {
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
    constructor(menu, hamburger, closeBtn) {
        this.lastFocused = null;
        this.x = 0;
        this.target = 0;
        this.spring = null;
        this.opened = false;
        this.menu = menu;
        this.hamburger = hamburger;
        this.closeBtn = closeBtn;
        this.bind();
        this.bindDrag();
    }
    bind() {
        this.hamburger.addEventListener('click', () => this.open());
        this.closeBtn.addEventListener('click', () => this.close());
        qsa('a', this.menu).forEach((link) => {
            link.addEventListener('click', () => this.close());
        });
        document.addEventListener('keydown', (event) => {
            if (!this.opened) {
                return;
            }
            if (event.key === 'Escape') {
                this.close();
            }
            else if (event.key === 'Tab') {
                this.trapFocus(event);
            }
        });
        // Leaving the mobile layout while the sheet is open: just tidy up.
        window.matchMedia('(min-width: 861px)').addEventListener('change', (event) => {
            if (event.matches && this.opened) {
                this.close(true);
            }
        });
    }
    width() {
        return this.menu.offsetWidth || window.innerWidth;
    }
    focusable() {
        return qsa('a[href], button:not([disabled]), summary', this.menu);
    }
    markOpen() {
        this.opened = true;
        this.lastFocused = document.activeElement;
        this.menu.classList.add('is-open');
        this.menu.setAttribute('aria-hidden', 'false');
        this.hamburger.classList.add('is-open');
        this.hamburger.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
    }
    markClosed() {
        this.opened = false;
        this.menu.setAttribute('aria-hidden', 'true');
        this.hamburger.classList.remove('is-open');
        this.hamburger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
        if (this.lastFocused) {
            this.lastFocused.focus();
        }
    }
    render(x) {
        this.x = x;
        this.menu.style.transform = `translateX(${x}px)`;
    }
    release() {
        this.spring = null;
        this.menu.classList.remove('is-driven');
        this.menu.style.transform = '';
        if (this.target !== 0) {
            this.menu.classList.remove('is-open');
        }
    }
    /** Spring the sheet to `to`, continuing from its live position and velocity. */
    drive(to, velocity) {
        if (this.spring) {
            this.spring.cancel();
        }
        this.target = to;
        this.menu.classList.add('is-driven');
        this.spring = springTo(this.x, to, velocity, 0.42, (x) => this.render(x), () => this.release());
    }
    open() {
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
    close(immediate = false) {
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
    trapFocus(event) {
        const nodes = this.focusable();
        if (nodes.length === 0) {
            return;
        }
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        }
        else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
    bindDrag() {
        let pointerId = -1;
        let startX = 0;
        let startY = 0;
        let baseX = 0;
        let dragging = false;
        let interrupted = false;
        let samples = [];
        this.menu.addEventListener('pointerdown', (event) => {
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
        this.menu.addEventListener('pointermove', (event) => {
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
                }
                catch {
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
        const end = (event) => {
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
class TechHeroCanvas {
    constructor(canvas) {
        this.nodes = [];
        this.packets = [];
        this.width = 0;
        this.height = 0;
        this.dpr = 1;
        this.rafId = null;
        this.isVisible = false;
        this.pointer = { x: -9999, y: -9999, active: false };
        this.resizeObserver = null;
        this.intersectionObserver = null;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        const parent = canvas.closest('section, header, .hero2, .hero');
        this.host = parent ?? canvas.parentElement ?? document.body;
        if (!this.ctx) {
            return;
        }
        this.init();
    }
    init() {
        this.handleResize();
        if (typeof IntersectionObserver !== 'undefined') {
            this.intersectionObserver = new IntersectionObserver((entries) => {
                const entry = entries[0];
                if (entry) {
                    this.isVisible = entry.isIntersecting;
                    if (this.isVisible) {
                        this.start();
                    }
                    else {
                        this.stop();
                    }
                }
            }, { threshold: 0.02 });
            this.intersectionObserver.observe(this.host);
        }
        else {
            this.isVisible = true;
            this.start();
        }
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                this.handleResize();
            });
            this.resizeObserver.observe(this.host);
        }
        else {
            window.addEventListener('resize', () => this.handleResize(), { passive: true });
        }
        this.host.addEventListener('pointermove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.pointer.x = e.clientX - rect.left;
            this.pointer.y = e.clientY - rect.top;
            this.pointer.active = true;
        }, { passive: true });
        this.host.addEventListener('pointerleave', () => {
            this.pointer.active = false;
            this.pointer.x = -9999;
            this.pointer.y = -9999;
        }, { passive: true });
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        media.addEventListener?.('change', () => {
            if (prefersReducedMotion()) {
                this.stop();
                this.renderStatic();
            }
            else if (this.isVisible) {
                this.start();
            }
        });
        if (prefersReducedMotion()) {
            this.renderStatic();
        }
        else {
            this.start();
        }
    }
    handleResize() {
        const rect = this.host.getBoundingClientRect();
        this.width = Math.max(300, Math.floor(rect.width));
        this.height = Math.max(200, Math.floor(rect.height));
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.floor(this.width * this.dpr);
        this.canvas.height = Math.floor(this.height * this.dpr);
        if (this.ctx) {
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            this.ctx.scale(this.dpr, this.dpr);
        }
        this.spawnElements();
        if (prefersReducedMotion()) {
            this.renderStatic();
        }
    }
    spawnElements() {
        const area = this.width * this.height;
        const targetCount = Math.max(20, Math.min(52, Math.floor(area / 22000)));
        const colors = [
            '#3373e0', // BlacTec primary blue
            '#3373e0',
            '#22a55e', // live network emerald
            '#f4821f', // warm server amber
        ];
        this.nodes = [];
        for (let i = 0; i < targetCount; i++) {
            const isBeacon = i % 7 === 0;
            this.nodes.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                vx: (Math.random() - 0.5) * 0.42,
                vy: (Math.random() - 0.5) * 0.42,
                radius: isBeacon ? 2.8 : 1.4 + Math.random() * 1.4,
                color: colors[i % colors.length] ?? '#3373e0',
                baseAlpha: 0.35 + Math.random() * 0.4,
                isBeacon,
                beaconTimer: Math.random() * 200,
            });
        }
        const packetCount = Math.max(4, Math.floor(targetCount * 0.28));
        this.packets = [];
        for (let i = 0; i < packetCount; i++) {
            this.packets.push(this.createPacket());
        }
    }
    createPacket() {
        const s = Math.floor(Math.random() * this.nodes.length);
        let t = Math.floor(Math.random() * this.nodes.length);
        if (t === s && this.nodes.length > 1) {
            t = (t + 1) % this.nodes.length;
        }
        const color = Math.random() > 0.35 ? '#3373e0' : '#22a55e';
        return {
            sourceIndex: s,
            targetIndex: t,
            progress: Math.random(),
            speed: 0.006 + Math.random() * 0.008,
            color,
        };
    }
    start() {
        if (this.rafId !== null || prefersReducedMotion()) {
            return;
        }
        const loop = () => {
            this.update();
            this.draw();
            this.rafId = window.requestAnimationFrame(loop);
        };
        this.rafId = window.requestAnimationFrame(loop);
    }
    stop() {
        if (this.rafId !== null) {
            window.cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }
    update() {
        const maxDist = 135;
        const maxDistSq = maxDist * maxDist;
        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            if (!node)
                continue;
            node.x += node.vx;
            node.y += node.vy;
            if (node.x < -10)
                node.x = this.width + 10;
            else if (node.x > this.width + 10)
                node.x = -10;
            if (node.y < -10)
                node.y = this.height + 10;
            else if (node.y > this.height + 10)
                node.y = -10;
            if (this.pointer.active) {
                const dx = this.pointer.x - node.x;
                const dy = this.pointer.y - node.y;
                const dSq = dx * dx + dy * dy;
                if (dSq < 160 * 160 && dSq > 1) {
                    const d = Math.sqrt(dSq);
                    const factor = (1 - d / 160) * 0.06;
                    node.x += (dx / d) * factor * 6;
                    node.y += (dy / d) * factor * 6;
                }
            }
            if (node.isBeacon) {
                node.beaconTimer += 1;
            }
        }
        for (let p = 0; p < this.packets.length; p++) {
            const pkt = this.packets[p];
            if (!pkt)
                continue;
            pkt.progress += pkt.speed;
            const a = this.nodes[pkt.sourceIndex];
            const b = this.nodes[pkt.targetIndex];
            if (!a || !b) {
                this.packets[p] = this.createPacket();
                continue;
            }
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distSq = dx * dx + dy * dy;
            if (pkt.progress >= 1 || distSq > maxDistSq * 1.5) {
                this.packets[p] = this.createPacket();
            }
        }
    }
    draw() {
        if (!this.ctx)
            return;
        this.ctx.clearRect(0, 0, this.width, this.height);
        // 1. Subtle tech coordinate grid
        const gridSize = 64;
        this.ctx.strokeStyle = 'rgba(14, 15, 19, 0.038)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        for (let x = gridSize; x < this.width; x += gridSize) {
            for (let y = gridSize; y < this.height; y += gridSize) {
                this.ctx.moveTo(x - 3, y);
                this.ctx.lineTo(x + 3, y);
                this.ctx.moveTo(x, y - 3);
                this.ctx.lineTo(x, y + 3);
            }
        }
        this.ctx.stroke();
        // 2. Interactive mouse ambient glow & aura
        if (this.pointer.active && this.pointer.x > 0 && this.pointer.y > 0) {
            const pGrad = this.ctx.createRadialGradient(this.pointer.x, this.pointer.y, 0, this.pointer.x, this.pointer.y, 160);
            pGrad.addColorStop(0, 'rgba(51, 115, 224, 0.08)');
            pGrad.addColorStop(1, 'rgba(51, 115, 224, 0)');
            this.ctx.fillStyle = pGrad;
            this.ctx.beginPath();
            this.ctx.arc(this.pointer.x, this.pointer.y, 160, 0, Math.PI * 2);
            this.ctx.fill();
        }
        // 3. Network links between nodes
        const maxDist = 135;
        const maxDistSq = maxDist * maxDist;
        this.ctx.lineWidth = 1;
        for (let i = 0; i < this.nodes.length; i++) {
            const a = this.nodes[i];
            if (!a)
                continue;
            for (let j = i + 1; j < this.nodes.length; j++) {
                const b = this.nodes[j];
                if (!b)
                    continue;
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const distSq = dx * dx + dy * dy;
                if (distSq < maxDistSq) {
                    const dist = Math.sqrt(distSq);
                    const alpha = (1 - dist / maxDist) * 0.22;
                    this.ctx.strokeStyle = `rgba(51, 115, 224, ${alpha.toFixed(3)})`;
                    this.ctx.beginPath();
                    this.ctx.moveTo(a.x, a.y);
                    this.ctx.lineTo(b.x, b.y);
                    this.ctx.stroke();
                }
            }
            if (this.pointer.active) {
                const dx = this.pointer.x - a.x;
                const dy = this.pointer.y - a.y;
                const dSq = dx * dx + dy * dy;
                if (dSq < 140 * 140) {
                    const dist = Math.sqrt(dSq);
                    const alpha = (1 - dist / 140) * 0.32;
                    this.ctx.strokeStyle = `rgba(51, 115, 224, ${alpha.toFixed(3)})`;
                    this.ctx.beginPath();
                    this.ctx.moveTo(a.x, a.y);
                    this.ctx.lineTo(this.pointer.x, this.pointer.y);
                    this.ctx.stroke();
                }
            }
        }
        // 4. Data packets traveling along lines
        for (let p = 0; p < this.packets.length; p++) {
            const pkt = this.packets[p];
            if (!pkt)
                continue;
            const a = this.nodes[pkt.sourceIndex];
            const b = this.nodes[pkt.targetIndex];
            if (!a || !b)
                continue;
            const px = a.x + (b.x - a.x) * pkt.progress;
            const py = a.y + (b.y - a.y) * pkt.progress;
            this.ctx.fillStyle = pkt.color;
            this.ctx.beginPath();
            this.ctx.arc(px, py, 2.2, 0, Math.PI * 2);
            this.ctx.fill();
        }
        // 5. Node dots and ping beacon rings
        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            if (!node)
                continue;
            if (node.isBeacon) {
                const cycle = (node.beaconTimer % 180) / 180;
                const ringRadius = node.radius + cycle * 22;
                const ringAlpha = (1 - cycle) * 0.40;
                this.ctx.strokeStyle = `rgba(34, 165, 94, ${ringAlpha.toFixed(3)})`;
                this.ctx.lineWidth = 1.1;
                this.ctx.beginPath();
                this.ctx.arc(node.x, node.y, ringRadius, 0, Math.PI * 2);
                this.ctx.stroke();
            }
            this.ctx.fillStyle = node.color;
            this.ctx.globalAlpha = node.baseAlpha;
            this.ctx.beginPath();
            this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.globalAlpha = 1.0;
        }
    }
    renderStatic() {
        if (!this.ctx)
            return;
        this.draw();
    }
}
/* ============================================================
   Bootstrap
   ============================================================ */
function bootstrap() {
    document.documentElement.classList.add('js');
    const toastEl = document.getElementById('toast');
    const toast = new Toast(toastEl);
    // One delegated handler for every "lead" button — including ones rendered later.
    document.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-lead]');
        if (btn) {
            toast.fireLead(btn.dataset['leadContext']);
        }
    });
    const quoteForm = qs('#quoteForm');
    if (quoteForm) {
        toast.attachQuoteForm(new QuoteForm(quoteForm, toast));
    }
    // Cards render before the static-price pass and the tab wiring.
    new PricingRenderer().render();
    new StaticPrices();
    const domainForm = qs('#domainForm');
    if (domainForm) {
        new DomainChecker(domainForm);
    }
    qsa('.wsmock').forEach((el) => new ImageLoop(el));
    qsa('[role="tablist"]').forEach((list) => {
        if (list.id === 'trustTabs') {
            new TestimonialSwitcher(list);
        }
        else {
            new Tabs(list);
        }
    });
    qsa('.currency-toggle').forEach((el) => new CurrencyToggle(el));
    qsa('[data-currency-flip]').forEach((el) => new CurrencyFlip(el));
    const logoWall = document.getElementById('logoWall');
    if (logoWall) {
        new LogoWall(logoWall);
    }
    const pillarsTrack = document.getElementById('pillarsTrack');
    if (pillarsTrack) {
        new ScrollCarousel(() => pillarsTrack, qs('#pillarsPrev'), qs('#pillarsNext'), [pillarsTrack]);
    }
    const showcaseTrack = document.getElementById('showcaseTrack');
    if (showcaseTrack) {
        new ScrollCarousel(() => showcaseTrack, qs('#showcasePrev'), qs('#showcaseNext'), [showcaseTrack]);
    }
    // Pricing carousels resolve the *active* tab panel on every use.
    qsa('.pricing__carousel').forEach((carousel) => {
        const panels = qsa('.tab-panel', carousel);
        new ScrollCarousel(() => qs('.tab-panel.is-active', carousel), qs('.pricing__nav--prev', carousel), qs('.pricing__nav--next', carousel), panels);
    });
    new RevealOnScroll();
    new StatsCounter();
    const header = document.getElementById('header');
    const progress = document.getElementById('scrollProgress');
    const toTop = document.getElementById('toTop');
    if (header && progress && toTop) {
        new StickyHeader(header, progress, toTop);
    }
    qsa('.accordion').forEach((accordion, group) => new Accordion(accordion, group));
    const megaItem = qs('.has-mega');
    if (megaItem) {
        new MegaMenu(megaItem);
    }
    const mobileMenu = document.getElementById('mobileMenu');
    const hamburger = document.getElementById('hamburger');
    const mobileClose = document.getElementById('mobileClose');
    if (mobileMenu && hamburger && mobileClose) {
        new MobileMenu(mobileMenu, hamburger, mobileClose);
    }
    qsa('.hero__tech-canvas').forEach((canvas) => new TechHeroCanvas(canvas));
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
}
else {
    bootstrap();
}
