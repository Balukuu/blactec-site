/* ============================================================
   BlacTec Technologies Ltd. — Front-end interaction layer
   Strict TypeScript · no runtime libraries · compiled to dist/main.js
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
  alternatives: TldOption[];
}

type PriceUnit = 'year' | 'user/year' | 'month' | 'user/month';

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

type PanelKey = 'hosting' | 'vps' | 'dedicated' | 'workspace' | 'microsoft365' | 'zoho' | 'reseller' | 'security';

/** Approximate market rate — update as the shilling moves against the dollar. */
const UGX_PER_USD = 3700;

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatPrice(value: number): string {
  return value.toFixed(2);
}

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
    }, 3200);
  }

  /** Standard conversion cue: toast + prefill + smooth scroll to the quote form. */
  public fireLead(context?: string): void {
    this.show('Great choice — tell us about your project below 👇');
    if (this.quoteForm) {
      this.quoteForm.prefill(context);
    }
    const contact = document.getElementById('contact');
    if (contact) {
      contact.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  }
}

/* ============================================================
   Quote form — client-side lead capture, no backend required.
   Submits via mailto: so requests are never lost; swap `submit()`
   for a real endpoint (Formspree, serverless function, etc.) once one exists.
   ============================================================ */

class QuoteForm {
  private readonly form: HTMLFormElement;
  private readonly nameInput: HTMLInputElement;
  private readonly emailInput: HTMLInputElement;
  private readonly phoneInput: HTMLInputElement;
  private readonly serviceSelect: HTMLSelectElement;
  private readonly messageInput: HTMLTextAreaElement;
  private readonly toast: Toast;

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
  }

  private submit(): void {
    if (!this.form.reportValidity()) {
      return;
    }
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
      .filter((line) => line.length > 0)
      .join('\n');

    window.location.href = `mailto:info@blactec.ug?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    this.toast.show('Opening your email app — send it through and we’ll reply shortly 👋');
    this.form.reset();
  }
}

/* ============================================================
   Domain Checker (simulated, deterministic)
   ============================================================ */

class DomainChecker {
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly select: HTMLSelectElement;
  private readonly result: HTMLElement;
  private readonly toast: Toast;
  private readonly tlds: TldOption[];

  constructor(form: HTMLFormElement, toast: Toast) {
    this.form = form;
    this.toast = toast;
    this.input = qs<HTMLInputElement>('#domainInput', form) as HTMLInputElement;
    this.select = qs<HTMLSelectElement>('#tldSelect', form) as HTMLSelectElement;
    this.result = document.getElementById('domainResult') as HTMLElement;
    this.tlds = qsa<HTMLOptionElement>('option', this.select).map((opt) => ({
      tld: opt.value,
      priceUsd: Number(opt.dataset['price'] ?? '0'),
    }));

    this.bind();
  }

  private bind(): void {
    this.form.addEventListener('submit', (event: SubmitEvent) => {
      event.preventDefault();
      this.run();
    });

    // "Popular example" quick fills
    qsa<HTMLButtonElement>('.domain__eg').forEach((btn) => {
      btn.addEventListener('click', () => {
        const example = btn.dataset['eg'] ?? '';
        const tld = btn.dataset['tld'] ?? (btn.textContent ?? '').trim();
        this.input.value = example;
        if (this.tlds.some((t) => t.tld === tld)) {
          this.select.value = tld;
        }
        this.run();
      });
    });
  }

  private sanitize(raw: string): string {
    return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  }

  /** Deterministic status from a char-code sum hash. */
  private resolveStatus(key: string): DomainStatus {
    let sum = 0;
    for (let i = 0; i < key.length; i += 1) {
      sum += key.charCodeAt(i);
    }
    return sum % 3 === 0 ? 'taken' : 'available';
  }

  private priceFor(tld: string): number {
    const match = this.tlds.find((t) => t.tld === tld);
    return match ? match.priceUsd : 0;
  }

  private buildResult(domain: string, tld: string): DomainResult {
    const status = this.resolveStatus(domain + tld);
    const alternatives = this.tlds
      .filter((t) => t.tld !== tld && this.resolveStatus(domain + t.tld) === 'available')
      .slice(0, 3);
    return { domain, tld, status, priceUsd: this.priceFor(tld), alternatives };
  }

  private run(): void {
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

  private renderError(message: string): void {
    this.result.innerHTML = `<div class="result-card result-card--taken"><p class="result-card__name">${escapeHtml(message)}</p></div>`;
  }

  private renderLoading(): void {
    this.result.innerHTML = `
      <div class="skeleton" aria-label="Checking availability">
        <div class="skeleton__line skeleton__line--short"></div>
        <div class="skeleton__line"></div>
        <div class="skeleton__line skeleton__line--btn"></div>
      </div>`;
  }

  private renderResult(data: DomainResult): void {
    const full = `${data.domain}${data.tld}`;
    if (data.status === 'available') {
      const context = escapeHtml(`I'd like to register ${full} ($${formatPrice(data.priceUsd)}/yr).`);
      this.result.innerHTML = `
        <div class="result-card result-card--ok">
          <div class="result-card__top">
            <span class="result-card__name">✅ ${escapeHtml(full)}</span>
            <span class="result-card__status">Available</span>
          </div>
          <div class="result-card__top">
            <span class="result-card__price">$${formatPrice(data.priceUsd)} <small>/ year</small></span>
            <button class="btn btn--primary" data-lead data-lead-context="${context}" type="button">Add to Cart</button>
          </div>
        </div>`;
    } else {
      const transferContext = escapeHtml(`I'd like to transfer ${full} to BlacTec.`);
      const supportContext = escapeHtml(`I have a question about ${full}.`);
      const alts = data.alternatives
        .map((alt) => {
          const altFull = `${data.domain}${alt.tld}`;
          const altContext = escapeHtml(`I'd like to register ${altFull} ($${formatPrice(alt.priceUsd)}/yr).`);
          return `
          <div class="alt">
            <span class="alt__name">${escapeHtml(data.domain)}<b>${escapeHtml(alt.tld)}</b></span>
            <span class="alt__price">$${formatPrice(alt.priceUsd)}/yr</span>
            <button class="alt__add" data-lead data-lead-context="${altContext}" type="button">Add</button>
          </div>`;
        })
        .join('');
      this.result.innerHTML = `
        <div class="result-card result-card--taken">
          <div class="result-card__top">
            <span class="result-card__name">❌ ${escapeHtml(full)}</span>
            <span class="result-card__status">Taken</span>
          </div>
          <p class="result-card__price" style="font-weight:400;color:var(--ink-500);font-size:.9rem;margin:0">That domain is already registered — transfer it to us or grab an alternative below.</p>
          <div class="result-card__actions">
            <button class="btn btn--primary" data-lead data-lead-context="${transferContext}" type="button">Initiate Transfer</button>
            <button class="btn btn--secondary" data-lead data-lead-context="${supportContext}" type="button">Contact Support</button>
          </div>
          <div class="alts">
            <span class="alts__title">Available alternatives</span>
            ${alts}
          </div>
        </div>`;
    }

    qsa<HTMLButtonElement>('[data-lead]', this.result).forEach((btn) => {
      btn.addEventListener('click', () => this.toast.fireLead(btn.dataset['leadContext']));
    });
  }
}

/* ============================================================
   Hero carousel — auto-rotating slides + dot navigation
   ============================================================ */

class Carousel {
  private readonly root: HTMLElement;
  private readonly slides: HTMLElement[];
  private readonly dots: HTMLButtonElement[];
  private index = 0;
  private timer: number | undefined;
  private readonly intervalMs = 6500;
  private readonly reduceMotion: boolean;

  constructor(root: HTMLElement) {
    this.root = root;
    this.slides = qsa<HTMLElement>('.herox__slide', root);
    this.dots = qsa<HTMLButtonElement>('.herox__dot', root);
    this.reduceMotion = prefersReducedMotion();
    this.bind();
    if (!this.reduceMotion) {
      this.play();
    }
  }

  private bind(): void {
    this.dots.forEach((dot, i) => {
      dot.addEventListener('click', () => this.activate(i, true));
      dot.addEventListener('keydown', (event: KeyboardEvent) => this.onKey(event, i));
    });
    this.root.addEventListener('mouseenter', () => this.pause());
    this.root.addEventListener('mouseleave', () => {
      if (!this.reduceMotion) {
        this.play();
      }
    });
    this.root.addEventListener('focusin', () => this.pause());
    this.root.addEventListener('focusout', () => {
      if (!this.reduceMotion) {
        this.play();
      }
    });
  }

  private onKey(event: KeyboardEvent, index: number): void {
    let next = index;
    if (event.key === 'ArrowRight') {
      next = (index + 1) % this.dots.length;
    } else if (event.key === 'ArrowLeft') {
      next = (index - 1 + this.dots.length) % this.dots.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = this.dots.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    this.activate(next, true);
    this.dots[next].focus();
  }

  private play(): void {
    this.pause();
    this.timer = window.setInterval(() => {
      this.activate((this.index + 1) % this.slides.length, false);
    }, this.intervalMs);
  }

  private pause(): void {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private activate(index: number, userTriggered: boolean): void {
    this.index = index;
    this.slides.forEach((slide, i) => {
      const selected = i === index;
      slide.classList.toggle('is-active', selected);
      if (selected) {
        slide.removeAttribute('hidden');
      } else {
        slide.setAttribute('hidden', '');
      }
    });
    this.dots.forEach((dot, i) => {
      const selected = i === index;
      dot.classList.toggle('is-active', selected);
      dot.setAttribute('aria-selected', String(selected));
      dot.tabIndex = selected ? 0 : -1;
    });
    if (userTriggered && !this.reduceMotion) {
      this.play();
    }
  }
}

/* ============================================================
   Pricing — data-driven cards + accessible tabs
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
    { name: 'Starter Google Workspace', desc: 'Custom business email with core Google tools.', currency: 'USD', price: 6.99, unit: 'user/month', features: ['30 GB storage per mailbox', 'Video meetings up to 100 participants', 'Security controls', 'Standard support'] },
    { name: 'Standard Google Workspace', desc: 'More storage and richer collaboration.', currency: 'USD', price: 13.99, unit: 'user/month', popular: true, features: ['2 TB storage per mailbox', 'Meetings up to 150 participants with recording', 'Appointment booking & email layouts', 'Standard support'] },
    { name: 'Plus Google Workspace', desc: 'Advanced security, Vault & compliance.', currency: 'USD', price: 21.99, unit: 'user/month', features: ['5 TB storage per mailbox', 'Meetings up to 500 participants with recording', 'Enhanced security & Vault controls', 'Advanced endpoint management'] },
  ],
  microsoft365: [
    { name: 'Business Basic', desc: 'Web & mobile Office apps with Exchange email.', currency: 'USD', price: 6.00, unit: 'user/month', features: ['50 GB Exchange mailbox', '1 TB OneDrive storage', 'Teams chat & meetings', 'Standard security'] },
    { name: 'Business Standard', desc: 'Desktop apps with advanced collaboration.', currency: 'USD', price: 12.50, unit: 'user/month', popular: true, features: ['Everything in Basic', 'Desktop Word, Excel & Outlook', 'Teams webinars & registration', 'Microsoft Loop workspaces'] },
    { name: 'Business Premium', desc: 'Enterprise-grade security & device management.', currency: 'USD', price: 22.00, unit: 'user/month', features: ['Everything in Standard', 'Advanced cyber threat protection', 'Device management', 'Microsoft Defender for Business'] },
  ],
  zoho: [
    { name: 'Mail Lite', desc: 'Essential custom email.', currency: 'USD', price: 1.00, unit: 'user/month', features: ['5–10 GB mail storage', 'Shared calendars & contacts', 'Mobile & desktop apps', 'Aliases & group routing'] },
    { name: 'Workplace Standard', desc: 'Complete collaboration suite.', currency: 'USD', price: 3.00, unit: 'user/month', popular: true, features: ['30 GB mail storage', '100 GB shared WorkDrive', 'Zoho Cliq team chat', 'Writer, Sheet & Show + Meetings'] },
    { name: 'Mail Premium', desc: 'Advanced email archiving.', currency: 'USD', price: 4.00, unit: 'user/month', features: ['50 GB mail storage', 'Email retention & eDiscovery', 'S/MIME & encryption', 'Account backup & recovery'] },
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
};

const CHECK_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="rgba(34,165,94,.14)"/><path d="M7 12.5l3.2 3.2L17 9" stroke="var(--success)" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

class PricingRenderer {
  private readonly toast: Toast;
  private currency: Currency = 'UGX';

  constructor(toast: Toast) {
    this.toast = toast;
  }

  public getCurrency(): Currency {
    return this.currency;
  }

  public setCurrency(currency: Currency): void {
    if (this.currency === currency) {
      return;
    }
    this.currency = currency;
    this.render();
  }

  public render(): void {
    (Object.keys(PRICING) as PanelKey[]).forEach((key) => {
      const container = qs<HTMLElement>(`[data-cards="${key}"]`);
      if (!container) {
        return;
      }
      container.innerHTML = PRICING[key].map((plan) => this.cardHtml(plan)).join('');
    });
    this.bindLeadButtons();
  }

  /** Cards are re-rendered on every currency switch, so lead buttons must be rebound each time. */
  private bindLeadButtons(): void {
    qsa<HTMLButtonElement>('.tab-panel [data-lead]').forEach((btn) => {
      btn.addEventListener('click', () => this.toast.fireLead(btn.dataset['leadContext']));
    });
  }

  private cardHtml(plan: PricingPlan): string {
    const unitLabel = plan.unit === 'user/year' ? '/ user / year' : plan.unit === 'user/month' ? '/ user / month' : plan.unit === 'month' ? '/ month' : '/ year';
    const ribbon = plan.popular ? '<span class="plan__ribbon">★ Most popular</span>' : '';
    const btnClass = plan.popular ? 'btn btn--secondary' : 'btn btn--primary';
    const features = plan.features
      .map((feat) => `<li>${CHECK_SVG}<span>${escapeHtml(feat)}</span></li>`)
      .join('');
    const amountValue = convertPrice(plan, this.currency);
    const priceLabel = formatMoney(amountValue, this.currency);
    const { prefix, amount, isSymbol } = formatMoneyParts(amountValue, this.currency);
    const context = escapeHtml(`I'm interested in the ${plan.name} plan (${priceLabel} ${unitLabel}).`);
    return `
      <div class="plan-slot">
      ${ribbon}
      <article class="plan${plan.popular ? ' plan--popular' : ''}">
        <h3 class="plan__name">${escapeHtml(plan.name)}</h3>
        <p class="plan__desc">${escapeHtml(plan.desc)}</p>
        <div class="plan__price">
          <span class="plan__price-row">
            <span class="plan__currency${isSymbol ? ' plan__currency--symbol' : ''}">${prefix}</span>
            <span class="plan__amount">${amount}</span>
          </span>
          <span class="plan__unit">${unitLabel}</span>
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

class CurrencyToggle {
  private readonly buttons: HTMLButtonElement[];
  private readonly renderer: PricingRenderer;

  constructor(root: HTMLElement, renderer: PricingRenderer) {
    this.renderer = renderer;
    this.buttons = qsa<HTMLButtonElement>('.currency-toggle__btn', root);
    this.bind();
    this.sync(renderer.getCurrency());
  }

  private bind(): void {
    this.buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const currency = btn.dataset['currency'] === 'USD' ? 'USD' : 'UGX';
        this.renderer.setCurrency(currency);
        this.sync(currency);
      });
    });
  }

  private sync(active: Currency): void {
    this.buttons.forEach((btn) => {
      const selected = btn.dataset['currency'] === active;
      btn.classList.toggle('is-active', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
  }
}

class PricingTabs {
  private readonly tabs: HTMLButtonElement[];

  constructor(tablist: HTMLElement) {
    this.tabs = qsa<HTMLButtonElement>('.tab', tablist);
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
    this.activate(next);
    this.tabs[next].focus();
  }

  private activate(index: number): void {
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
   Scroll carousel — prev/next buttons that page a scroll-snap track
   ============================================================ */

class ScrollCarousel {
  private readonly track: HTMLElement;
  private readonly loop: boolean;

  constructor(track: HTMLElement, prevBtn: HTMLButtonElement | null, nextBtn: HTMLButtonElement | null, loop = false) {
    this.track = track;
    this.loop = loop;
    prevBtn?.addEventListener('click', () => this.page(-1));
    nextBtn?.addEventListener('click', () => this.page(1));
  }

  private page(direction: 1 | -1): void {
    const card = this.track.firstElementChild as HTMLElement | null;
    const gap = Number.parseFloat(getComputedStyle(this.track).columnGap || '0');
    const step = card ? card.getBoundingClientRect().width + gap : this.track.clientWidth;
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';

    if (this.loop) {
      const maxScroll = this.track.scrollWidth - this.track.clientWidth;
      if (direction === 1 && this.track.scrollLeft >= maxScroll - 2) {
        this.track.scrollTo({ left: 0, behavior });
        return;
      }
      if (direction === -1 && this.track.scrollLeft <= 2) {
        this.track.scrollTo({ left: maxScroll, behavior });
        return;
      }
    }

    this.track.scrollBy({ left: direction * step, behavior });
  }
}

/** Same paging behaviour as ScrollCarousel, but resolves the active pricing tab-panel on every click since the track swaps with the selected category. */
class PricingCarousel {
  constructor(prevBtn: HTMLButtonElement | null, nextBtn: HTMLButtonElement | null) {
    prevBtn?.addEventListener('click', () => this.page(-1));
    nextBtn?.addEventListener('click', () => this.page(1));
  }

  private page(direction: 1 | -1): void {
    const track = qs<HTMLElement>('.tab-panel.is-active');
    if (!track) {
      return;
    }
    const card = track.firstElementChild as HTMLElement | null;
    const gap = Number.parseFloat(getComputedStyle(track).columnGap || '0');
    const step = card ? card.getBoundingClientRect().width + gap : track.clientWidth;
    track.scrollBy({ left: direction * step, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }
}

/* ============================================================
   Reveal on scroll (staggered)
   ============================================================ */

class RevealOnScroll {
  private readonly observer: IntersectionObserver;

  constructor() {
    const items = qsa<HTMLElement>('.reveal');
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('is-in'));
      this.observer = new IntersectionObserver(() => undefined);
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => this.onIntersect(entries),
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    items.forEach((el) => this.observer.observe(el));
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }
      const el = entry.target as HTMLElement;
      const siblings = el.parentElement ? qsa<HTMLElement>('.reveal', el.parentElement) : [el];
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
  private readonly nums: HTMLElement[];
  private readonly observer: IntersectionObserver;

  constructor() {
    this.nums = qsa<HTMLElement>('.stat__num');
    this.observer = new IntersectionObserver(
      (entries) => this.onIntersect(entries),
      { threshold: 0.5 },
    );
    this.nums.forEach((el) => this.observer.observe(el));
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        this.animate(entry.target as HTMLElement);
        this.observer.unobserve(entry.target);
      }
    });
  }

  private animate(el: HTMLElement): void {
    const target = Number(el.dataset['count'] ?? '0');
    const suffix = el.dataset['suffix'] ?? '';
    const decimals = Number(el.dataset['decimals'] ?? '0');

    if (prefersReducedMotion()) {
      el.textContent = target.toFixed(decimals) + suffix;
      return;
    }

    const duration = 1400;
    const start = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = target * eased;
      el.textContent = value.toFixed(decimals) + suffix;
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
   Sticky header + scroll spy + scroll progress + back to top
   ============================================================ */

class StickyHeader {
  private readonly header: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly toTop: HTMLElement;
  private readonly navLinks: HTMLAnchorElement[];
  private readonly sections: HTMLElement[];
  private ticking = false;

  constructor(header: HTMLElement, progress: HTMLElement, toTop: HTMLElement) {
    this.header = header;
    this.progress = progress;
    this.toTop = toTop;
    this.navLinks = qsa<HTMLAnchorElement>('.nav__link[href^="#"]');
    this.sections = this.navLinks
      .map((link) => document.getElementById(link.getAttribute('href')!.slice(1)))
      .filter((el): el is HTMLElement => el !== null);

    window.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.toTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
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
    this.header.classList.toggle('is-stuck', y > 40);
    this.toTop.classList.toggle('is-visible', y > 600);

    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - doc.clientHeight;
    const pct = scrollable > 0 ? (y / scrollable) * 100 : 0;
    this.progress.style.width = `${pct}%`;

    this.spy(y);
  }

  private spy(y: number): void {
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
  private readonly items: HTMLElement[];

  constructor(root: HTMLElement) {
    this.items = qsa<HTMLElement>('.acc', root);
    this.bind();
  }

  private bind(): void {
    this.items.forEach((item) => {
      const button = qs<HTMLButtonElement>('.acc__q', item);
      const answer = qs<HTMLElement>('.acc__a', item);
      if (!button || !answer) {
        return;
      }
      button.addEventListener('click', () => this.toggle(item, button, answer));
    });
  }

  private toggle(item: HTMLElement, button: HTMLButtonElement, answer: HTMLElement): void {
    const willOpen = !item.classList.contains('is-open');
    this.items.forEach((other) => this.close(other));
    if (willOpen) {
      item.classList.add('is-open');
      button.setAttribute('aria-expanded', 'true');
      answer.style.maxHeight = `${answer.scrollHeight}px`;
    }
  }

  private close(item: HTMLElement): void {
    const button = qs<HTMLButtonElement>('.acc__q', item);
    const answer = qs<HTMLElement>('.acc__a', item);
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
  private readonly trigger: HTMLButtonElement;
  private readonly mega: HTMLElement;
  private readonly item: HTMLElement;

  constructor(item: HTMLElement) {
    this.item = item;
    this.trigger = qs<HTMLButtonElement>('.nav__trigger', item) as HTMLButtonElement;
    this.mega = qs<HTMLElement>('.mega', item) as HTMLElement;
    this.bind();
  }

  private bind(): void {
    this.trigger.addEventListener('click', (event) => {
      event.preventDefault();
      const open = this.mega.classList.toggle('is-open');
      this.trigger.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (event) => {
      if (!this.item.contains(event.target as Node)) {
        this.mega.classList.remove('is-open');
        this.trigger.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (event: KeyboardEvent) => {
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
  private readonly menu: HTMLElement;
  private readonly hamburger: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private lastFocused: HTMLElement | null = null;

  constructor(menu: HTMLElement, hamburger: HTMLButtonElement, closeBtn: HTMLButtonElement) {
    this.menu = menu;
    this.hamburger = hamburger;
    this.closeBtn = closeBtn;
    this.bind();
  }

  private bind(): void {
    this.hamburger.addEventListener('click', () => this.open());
    this.closeBtn.addEventListener('click', () => this.close());
    qsa<HTMLAnchorElement>('a', this.menu).forEach((link) => {
      link.addEventListener('click', () => this.close());
    });
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if (!this.isOpen()) {
        return;
      }
      if (event.key === 'Escape') {
        this.close();
      } else if (event.key === 'Tab') {
        this.trapFocus(event);
      }
    });
  }

  private isOpen(): boolean {
    return this.menu.classList.contains('is-open');
  }

  private focusable(): HTMLElement[] {
    return qsa<HTMLElement>('a[href], button:not([disabled]), summary', this.menu);
  }

  private open(): void {
    this.lastFocused = document.activeElement as HTMLElement | null;
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

  private close(): void {
    this.menu.classList.remove('is-open');
    this.menu.setAttribute('aria-hidden', 'true');
    this.hamburger.classList.remove('is-open');
    this.hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (this.lastFocused) {
      this.lastFocused.focus();
    }
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
}

/* ============================================================
   Bootstrap
   ============================================================ */

function bootstrap(): void {
  const toastEl = document.getElementById('toast');
  const toast = new Toast(toastEl as HTMLElement);

  const quoteForm = qs<HTMLFormElement>('#quoteForm');
  if (quoteForm) {
    toast.attachQuoteForm(new QuoteForm(quoteForm, toast));
  }

  // Pricing cards must render before we wire their lead buttons.
  const pricingRenderer = new PricingRenderer(toast);
  pricingRenderer.render();

  const domainForm = qs<HTMLFormElement>('#domainForm');
  if (domainForm) {
    new DomainChecker(domainForm, toast);
  }

  const heroCarousel = document.getElementById('heroCarousel');
  if (heroCarousel) {
    new Carousel(heroCarousel);
  }

  const tablist = document.getElementById('pricingTabs');
  if (tablist) {
    new PricingTabs(tablist);
  }

  const serviceTabs = document.getElementById('serviceTabs');
  if (serviceTabs) {
    new PricingTabs(serviceTabs);
  }

  const currencyToggle = document.getElementById('currencyToggle');
  if (currencyToggle) {
    new CurrencyToggle(currencyToggle, pricingRenderer);
  }

  const trustTabs = document.getElementById('trustTabs');
  if (trustTabs) {
    new TestimonialSwitcher(trustTabs);
  }

  const logoWall = document.getElementById('logoWall');
  if (logoWall) {
    new LogoWall(logoWall);
  }

  const solutionsTrack = document.getElementById('solutionsTrack');
  if (solutionsTrack) {
    new ScrollCarousel(
      solutionsTrack,
      qs<HTMLButtonElement>('#solutionsPrev'),
      qs<HTMLButtonElement>('#solutionsNext'),
    );
  }

  const showcaseTrack = document.getElementById('showcaseTrack');
  if (showcaseTrack) {
    new ScrollCarousel(
      showcaseTrack,
      qs<HTMLButtonElement>('#showcasePrev'),
      qs<HTMLButtonElement>('#showcaseNext'),
      true,
    );
  }

  const pricingPrev = qs<HTMLButtonElement>('#pricingPrev');
  const pricingNext = qs<HTMLButtonElement>('#pricingNext');
  if (pricingPrev || pricingNext) {
    new PricingCarousel(pricingPrev, pricingNext);
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
