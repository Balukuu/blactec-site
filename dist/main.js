"use strict";
/* ============================================================
   BlacTec Technologies Ltd. — Front-end interaction layer
   Strict TypeScript · no runtime libraries · compiled to dist/main.js
   ============================================================ */
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
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
function formatPrice(value) {
    return value.toFixed(2);
}
/* ============================================================
   Toast — shared notifier + scroll-to-contact
   ============================================================ */
class Toast {
    constructor(el) {
        this.el = el;
    }
    show(message) {
        this.el.textContent = message;
        this.el.classList.add('is-visible');
        if (this.timer !== undefined) {
            window.clearTimeout(this.timer);
        }
        this.timer = window.setTimeout(() => {
            this.el.classList.remove('is-visible');
        }, 3200);
    }
    /** Standard conversion cue: toast + smooth scroll to the contact section. */
    fireLead() {
        this.show('Great choice — tell us about your project below 👇');
        const contact = document.getElementById('contact');
        if (contact) {
            contact.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
        }
    }
}
/* ============================================================
   Domain Checker (simulated, deterministic)
   ============================================================ */
class DomainChecker {
    constructor(form, toast) {
        this.form = form;
        this.toast = toast;
        this.input = qs('#domainInput', form);
        this.select = qs('#tldSelect', form);
        this.result = document.getElementById('domainResult');
        this.tlds = qsa('option', this.select).map((opt) => ({
            tld: opt.value,
            priceUsd: Number(opt.dataset['price'] ?? '0'),
        }));
        this.bind();
    }
    bind() {
        this.form.addEventListener('submit', (event) => {
            event.preventDefault();
            this.run();
        });
        // "Popular example" quick fills
        qsa('.domain__eg').forEach((btn) => {
            btn.addEventListener('click', () => {
                const example = btn.dataset['eg'] ?? '';
                const tld = (btn.textContent ?? '').trim();
                this.input.value = example;
                if (this.tlds.some((t) => t.tld === tld)) {
                    this.select.value = tld;
                }
                this.run();
            });
        });
    }
    sanitize(raw) {
        return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    }
    /** Deterministic status from a char-code sum hash. */
    resolveStatus(key) {
        let sum = 0;
        for (let i = 0; i < key.length; i += 1) {
            sum += key.charCodeAt(i);
        }
        return sum % 3 === 0 ? 'taken' : 'available';
    }
    priceFor(tld) {
        const match = this.tlds.find((t) => t.tld === tld);
        return match ? match.priceUsd : 0;
    }
    buildResult(domain, tld) {
        const status = this.resolveStatus(domain + tld);
        const alternatives = this.tlds
            .filter((t) => t.tld !== tld && this.resolveStatus(domain + t.tld) === 'available')
            .slice(0, 3);
        return { domain, tld, status, priceUsd: this.priceFor(tld), alternatives };
    }
    run() {
        const domain = this.sanitize(this.input.value);
        if (domain.length === 0) {
            this.input.focus();
            this.renderError('Please enter a domain name to search.');
            return;
        }
        this.input.value = domain;
        const tld = this.select.value;
        this.renderLoading();
        window.setTimeout(() => {
            const data = this.buildResult(domain, tld);
            this.renderResult(data);
        }, 900);
    }
    renderError(message) {
        this.result.innerHTML = `<div class="result-card result-card--taken"><p class="result-card__name">${escapeHtml(message)}</p></div>`;
    }
    renderLoading() {
        this.result.innerHTML = `
      <div class="skeleton" aria-label="Checking availability">
        <div class="skeleton__line skeleton__line--short"></div>
        <div class="skeleton__line"></div>
        <div class="skeleton__line skeleton__line--btn"></div>
      </div>`;
    }
    renderResult(data) {
        const full = `${data.domain}${data.tld}`;
        if (data.status === 'available') {
            this.result.innerHTML = `
        <div class="result-card result-card--ok">
          <div class="result-card__top">
            <span class="result-card__name">✅ ${escapeHtml(full)}</span>
            <span class="result-card__status">Available</span>
          </div>
          <div class="result-card__top">
            <span class="result-card__price">$${formatPrice(data.priceUsd)} <small>/ year</small></span>
            <button class="btn btn--primary" data-lead type="button">Add to Cart</button>
          </div>
        </div>`;
        }
        else {
            const alts = data.alternatives
                .map((alt) => `
          <div class="alt">
            <span class="alt__name">${escapeHtml(data.domain)}<b>${escapeHtml(alt.tld)}</b></span>
            <span class="alt__price">$${formatPrice(alt.priceUsd)}/yr</span>
            <button class="alt__add" data-lead type="button">Add</button>
          </div>`)
                .join('');
            this.result.innerHTML = `
        <div class="result-card result-card--taken">
          <div class="result-card__top">
            <span class="result-card__name">❌ ${escapeHtml(full)}</span>
            <span class="result-card__status">Taken</span>
          </div>
          <p class="result-card__price" style="font-weight:400;color:var(--ink-500);font-size:.9rem;margin:0">That domain is already registered — transfer it to us or grab an alternative below.</p>
          <div class="result-card__actions">
            <button class="btn btn--primary" data-lead type="button">Initiate Transfer</button>
            <button class="btn btn--secondary" data-lead type="button">Contact Support</button>
          </div>
          <div class="alts">
            <span class="alts__title">Available alternatives</span>
            ${alts}
          </div>
        </div>`;
        }
        qsa('[data-lead]', this.result).forEach((btn) => {
            btn.addEventListener('click', () => this.toast.fireLead());
        });
    }
}
/* ============================================================
   Pricing — data-driven cards + accessible tabs
   ============================================================ */
const PRICING = {
    hosting: [
        { name: 'Economy', desc: 'A tidy home for your first website.', priceUsd: 17.75, unit: 'year', features: ['1 GB SSD storage', 'cPanel control panel', 'Unlimited bandwidth', '1 domain'] },
        { name: 'Deluxe', desc: 'Room to grow with extra protection.', priceUsd: 28.40, unit: 'year', features: ['5 GB SSD storage', 'Enhanced security pack', 'Unlimited bandwidth', '3 domains'] },
        { name: 'Premium', desc: 'Our best-value performance tier.', priceUsd: 42.60, unit: 'year', popular: true, features: ['10 GB SSD storage', 'Optimized server-side speed', 'Unlimited bandwidth'] },
        { name: 'Ultra', desc: 'Dedicated resources for busy sites.', priceUsd: 53.25, unit: 'year', features: ['15 GB SSD storage', 'Dedicated resources', 'Maximum performance'] },
        { name: 'Corporate', desc: 'Elite NVMe with priority support.', priceUsd: 81.60, unit: 'year', features: ['20 GB premium NVMe storage', 'Elite performance configuration', 'Priority SLA support'] },
    ],
    workspace: [
        { name: 'Business Starter', desc: 'Professional email for your team.', priceUsd: 113.25, unit: 'user/year', features: ['Professional custom business email', '30 GB secure cloud storage per user', 'HD video meetings up to 100 participants'] },
        { name: 'Business Standard', desc: 'More storage and richer collaboration.', priceUsd: 226.50, unit: 'user/year', popular: true, features: ['Professional custom email', '2 TB cloud storage per user', 'Enhanced video collaboration (150 participants + cloud recording)'] },
        { name: 'Business Plus', desc: 'Advanced security, vault & compliance.', priceUsd: 356.15, unit: 'user/year', features: ['Advanced email suite + eDiscovery / retention', '5 TB enterprise storage per user', 'Elite security / Vault controls', 'Meetings up to 250 participants with attendance data'] },
    ],
    reseller: [
        { name: 'Basic Reseller', desc: 'Launch your own hosting brand.', priceUsd: 177.40, unit: 'year', features: ['10 GB SSD allocations', 'Up to 5 white-label WordPress sites', 'Powered by LiteSpeed Web Server'] },
        { name: 'Premium Reseller', desc: 'Full toolkit with daily backups.', priceUsd: 354.80, unit: 'year', popular: true, features: ['20 GB SSD allocations', 'Full WordPress optimization toolkit', 'Automated daily cloud backups'] },
        { name: 'Supreme Reseller', desc: 'Unlimited clients, global reach.', priceUsd: 532.20, unit: 'year', features: ['30 GB SSD allocations', 'Unlimited corporate client accounts', 'Integrated global CDN'] },
    ],
    security: [
        { name: 'DV SSL Certificate', desc: 'Domain Validation encryption.', priceUsd: 17.75, unit: 'year', features: ['Domain-validated HTTPS', 'Fast automated issuance', 'Browser padlock trust'] },
        { name: 'OV SSL Certificate', desc: 'Organization Validation trust.', priceUsd: 88.70, unit: 'year', features: ['Verified organization identity', 'Stronger customer assurance', 'Ideal for business sites'] },
        { name: 'EV SSL Certificate', desc: 'Extended Validation — green trust bar.', priceUsd: 177.40, unit: 'year', features: ['Highest level of validation', 'Green trust bar treatment', 'Maximum buyer confidence'] },
        { name: 'Automated Cloud Backup', desc: 'Acronis-powered backup pipeline.', priceUsd: 42.60, unit: 'year', features: ['25 GB Acronis sandbox', 'Automated backup pipeline', 'Rapid restore & recovery'] },
    ],
};
const CHECK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="rgba(0,176,144,.14)"/><path d="M7 12.5l3.2 3.2L17 9" stroke="var(--success)" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
class PricingRenderer {
    render() {
        Object.keys(PRICING).forEach((key) => {
            const container = qs(`[data-cards="${key}"]`);
            if (!container) {
                return;
            }
            container.innerHTML = PRICING[key].map((plan) => this.cardHtml(plan)).join('');
        });
    }
    cardHtml(plan) {
        const unitLabel = plan.unit === 'user/year' ? '/ user / year' : '/ year';
        const ribbon = plan.popular ? '<span class="plan__ribbon">★ Most popular</span>' : '';
        const btnClass = plan.popular ? 'btn btn--secondary' : 'btn btn--primary';
        const features = plan.features
            .map((feat) => `<li>${CHECK_SVG}<span>${escapeHtml(feat)}</span></li>`)
            .join('');
        return `
      <article class="plan${plan.popular ? ' plan--popular' : ''}">
        ${ribbon}
        <h3 class="plan__name">${escapeHtml(plan.name)}</h3>
        <p class="plan__desc">${escapeHtml(plan.desc)}</p>
        <div class="plan__price">
          <span class="plan__amount">$${formatPrice(plan.priceUsd)}</span>
          <span class="plan__unit">${unitLabel}</span>
        </div>
        <ul class="plan__features">${features}</ul>
        <button class="${btnClass}" data-lead type="button">Choose plan</button>
      </article>`;
    }
}
class PricingTabs {
    constructor(tablist, toast) {
        this.toast = toast;
        this.tabs = qsa('.tab', tablist);
        this.bind();
        this.bindLeadButtons();
    }
    bind() {
        this.tabs.forEach((tab, index) => {
            tab.addEventListener('click', () => this.activate(index));
            tab.addEventListener('keydown', (event) => this.onKey(event, index));
        });
    }
    /** Cards are rendered after tabs init, so bind lead buttons across every panel. */
    bindLeadButtons() {
        qsa('.tab-panel [data-lead]').forEach((btn) => {
            btn.addEventListener('click', () => this.toast.fireLead());
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
        this.activate(next);
        this.tabs[next].focus();
    }
    activate(index) {
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
   Reveal on scroll (staggered)
   ============================================================ */
class RevealOnScroll {
    constructor() {
        const items = qsa('.reveal');
        if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
            items.forEach((el) => el.classList.add('is-in'));
            this.observer = new IntersectionObserver(() => undefined);
            return;
        }
        this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
        items.forEach((el) => this.observer.observe(el));
    }
    onIntersect(entries) {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) {
                return;
            }
            const el = entry.target;
            const siblings = el.parentElement ? qsa('.reveal', el.parentElement) : [el];
            const index = Math.max(0, siblings.indexOf(el));
            el.style.transitionDelay = `${Math.min(index, 6) * 80}ms`;
            el.classList.add('is-in');
            this.observer.unobserve(el);
        });
    }
}
/* ============================================================
   Stats counter (count-up, once)
   ============================================================ */
class StatsCounter {
    constructor() {
        this.nums = qsa('.stat__num');
        this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), { threshold: 0.5 });
        this.nums.forEach((el) => this.observer.observe(el));
    }
    onIntersect(entries) {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                this.animate(entry.target);
                this.observer.unobserve(entry.target);
            }
        });
    }
    animate(el) {
        const target = Number(el.dataset['count'] ?? '0');
        const suffix = el.dataset['suffix'] ?? '';
        const decimals = Number(el.dataset['decimals'] ?? '0');
        if (prefersReducedMotion()) {
            el.textContent = target.toFixed(decimals) + suffix;
            return;
        }
        const duration = 1400;
        const start = performance.now();
        const step = (now) => {
            const progress = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            const value = target * eased;
            el.textContent = value.toFixed(decimals) + suffix;
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
   Sticky header + scroll spy + scroll progress + back to top
   ============================================================ */
class StickyHeader {
    constructor(header, progress, toTop) {
        this.ticking = false;
        this.header = header;
        this.progress = progress;
        this.toTop = toTop;
        this.navLinks = qsa('.nav__link[href^="#"]');
        this.sections = this.navLinks
            .map((link) => document.getElementById(link.getAttribute('href').slice(1)))
            .filter((el) => el !== null);
        window.addEventListener('scroll', () => this.onScroll(), { passive: true });
        this.toTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        });
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
        this.header.classList.toggle('is-stuck', y > 40);
        this.toTop.classList.toggle('is-visible', y > 600);
        const doc = document.documentElement;
        const scrollable = doc.scrollHeight - doc.clientHeight;
        const pct = scrollable > 0 ? (y / scrollable) * 100 : 0;
        this.progress.style.width = `${pct}%`;
        this.spy(y);
    }
    spy(y) {
        const marker = y + window.innerHeight * 0.3;
        let activeId = '';
        this.sections.forEach((section) => {
            if (section.offsetTop <= marker) {
                activeId = section.id;
            }
        });
        this.navLinks.forEach((link) => {
            link.classList.toggle('is-active', link.getAttribute('href') === `#${activeId}`);
        });
    }
}
/* ============================================================
   Accordion (one open at a time, height-animated)
   ============================================================ */
class Accordion {
    constructor(root) {
        this.items = qsa('.acc', root);
        this.bind();
    }
    bind() {
        this.items.forEach((item) => {
            const button = qs('.acc__q', item);
            const answer = qs('.acc__a', item);
            if (!button || !answer) {
                return;
            }
            button.addEventListener('click', () => this.toggle(item, button, answer));
        });
    }
    toggle(item, button, answer) {
        const willOpen = !item.classList.contains('is-open');
        this.items.forEach((other) => this.close(other));
        if (willOpen) {
            item.classList.add('is-open');
            button.setAttribute('aria-expanded', 'true');
            answer.style.maxHeight = `${answer.scrollHeight}px`;
        }
    }
    close(item) {
        const button = qs('.acc__q', item);
        const answer = qs('.acc__a', item);
        item.classList.remove('is-open');
        if (button) {
            button.setAttribute('aria-expanded', 'false');
        }
        if (answer) {
            answer.style.maxHeight = '0px';
        }
    }
}
/* ============================================================
   Mega menu (keyboard + click on desktop)
   ============================================================ */
class MegaMenu {
    constructor(item) {
        this.item = item;
        this.trigger = qs('.nav__trigger', item);
        this.mega = qs('.mega', item);
        this.bind();
    }
    bind() {
        this.trigger.addEventListener('click', (event) => {
            event.preventDefault();
            const open = this.mega.classList.toggle('is-open');
            this.trigger.setAttribute('aria-expanded', String(open));
        });
        document.addEventListener('click', (event) => {
            if (!this.item.contains(event.target)) {
                this.mega.classList.remove('is-open');
                this.trigger.setAttribute('aria-expanded', 'false');
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                this.mega.classList.remove('is-open');
                this.trigger.setAttribute('aria-expanded', 'false');
            }
        });
    }
}
/* ============================================================
   Mobile menu (focus-trapped overlay, ESC to close)
   ============================================================ */
class MobileMenu {
    constructor(menu, hamburger, closeBtn) {
        this.lastFocused = null;
        this.menu = menu;
        this.hamburger = hamburger;
        this.closeBtn = closeBtn;
        this.bind();
    }
    bind() {
        this.hamburger.addEventListener('click', () => this.open());
        this.closeBtn.addEventListener('click', () => this.close());
        qsa('a', this.menu).forEach((link) => {
            link.addEventListener('click', () => this.close());
        });
        document.addEventListener('keydown', (event) => {
            if (!this.isOpen()) {
                return;
            }
            if (event.key === 'Escape') {
                this.close();
            }
            else if (event.key === 'Tab') {
                this.trapFocus(event);
            }
        });
    }
    isOpen() {
        return this.menu.classList.contains('is-open');
    }
    focusable() {
        return qsa('a[href], button:not([disabled]), summary', this.menu);
    }
    open() {
        this.lastFocused = document.activeElement;
        this.menu.classList.add('is-open');
        this.menu.setAttribute('aria-hidden', 'false');
        this.hamburger.classList.add('is-open');
        this.hamburger.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
        const first = this.focusable()[0];
        if (first) {
            first.focus();
        }
    }
    close() {
        this.menu.classList.remove('is-open');
        this.menu.setAttribute('aria-hidden', 'true');
        this.hamburger.classList.remove('is-open');
        this.hamburger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
        if (this.lastFocused) {
            this.lastFocused.focus();
        }
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
}
/* ============================================================
   Bootstrap
   ============================================================ */
function bootstrap() {
    const toastEl = document.getElementById('toast');
    const toast = new Toast(toastEl);
    // Pricing cards must render before we wire their lead buttons.
    new PricingRenderer().render();
    const domainForm = qs('#domainForm');
    if (domainForm) {
        new DomainChecker(domainForm, toast);
    }
    const tablist = document.getElementById('pricingTabs');
    if (tablist) {
        new PricingTabs(tablist, toast);
    }
    const trustTabs = document.getElementById('trustTabs');
    if (trustTabs) {
        new TestimonialSwitcher(trustTabs);
    }
    const logoWall = document.getElementById('logoWall');
    if (logoWall) {
        new LogoWall(logoWall);
    }
    new RevealOnScroll();
    new StatsCounter();
    const header = document.getElementById('header');
    const progress = document.getElementById('scrollProgress');
    const toTop = document.getElementById('toTop');
    if (header && progress && toTop) {
        new StickyHeader(header, progress, toTop);
    }
    const accordion = document.getElementById('accordion');
    if (accordion) {
        new Accordion(accordion);
    }
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
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
}
else {
    bootstrap();
}
