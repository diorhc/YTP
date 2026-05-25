(function () {
  'use strict';

  const styleManager = window.YouTubeUtils?.StyleManager;
  if (!styleManager?.add) return;

  styleManager.add(
    'yt-plus-design-system',
    `
    :root{
      --yt-accent:#ff0000;
      --yt-accent-secondary:#1976d2;
      --yt-accent-secondary-light:#42a5f5;
      --yt-accent-secondary-ghost:rgba(25,118,210,0.28);
      --yt-accent-secondary-light-ghost:rgba(66,165,245,0.4);
      --yt-accent-secondary-shadow:rgba(25,118,210,0.25);
      --yt-primary-soft:rgba(33,150,243,.12);
      --yt-primary-soft-hover:rgba(33,150,243,.22);
      --yt-primary-border:rgba(33,150,243,.25);
      --yt-primary-text:#2196f3;
      --yt-surface-soft:rgba(255,255,255,.08);
      --yt-surface-active:rgba(255,255,255,.12);
      --yt-surface-active-strong:rgba(255,255,255,.14);
      --yt-surface-border-strong:rgba(255,255,255,.15);
      --yt-surface-overlay-soft:rgba(255,255,255,.1);
      --yt-surface-overlay-subtle:rgba(255,255,255,.04);
      --yt-surface-overlay-faint:rgba(255,255,255,.02);
      --yt-surface-overlay-border:rgba(255,255,255,.06);
      --yt-danger-soft:rgba(255,59,59,0.15);
      --yt-danger-soft-hover:rgba(255,59,59,0.25);
      --yt-danger-border:rgba(255,59,59,0.3);
      --yt-danger-text:#ff5c5c;
      --yt-danger-ghost:rgba(255,0,0,.12);
      --yt-danger-shadow:rgba(255,0,0,.3);
      --yt-danger-shadow-strong:rgba(255,0,0,.35);
      --yt-danger-card-bg-start:rgba(255,0,0,.28);
      --yt-danger-card-bg-end:rgba(255,0,0,.16);
      --yt-danger-card-border:rgba(255,0,0,.45);
      --yt-danger-card-inset:rgba(255,0,0,.22);
      --yt-success:#4caf50;
      --yt-success-soft:rgba(76,175,80,0.2);
      --yt-success-soft-hover:rgba(76,175,80,.22);
      --yt-danger:#f44336;
      --yt-warning:#ffc107;
      --yt-warning-soft:rgba(255,193,7,0.2);
      --yt-shadow-soft:rgba(0,0,0,.2);
      --yt-shadow-soft-strong:rgba(0,0,0,.3);
      --yt-shadow-inset-soft:rgba(0,0,0,.04);
      --yt-shadow-inset-strong:rgba(0,0,0,.35);
      --yt-shadow-flyout:rgba(0,0,0,.5);
       --yt-shadow-notification:rgba(0,0,0,.3);
       --yt-shadow-deep-1:rgba(0,0,0,.15);
       --yt-shadow-deep-2:rgba(0,0,0,.1);
       --yt-shadow-deep-3:rgba(0,0,0,.06);
       --yt-shadow-deep-4:rgba(0,0,0,.09);
       --yt-border-light:rgba(0,0,0,.25);
       --yt-overlay-strong:rgba(0,0,0,.55);
       --yt-overlay-deep:rgba(0,0,0,.2);
       --yt-overlay-faint:rgba(0,0,0,.15);
       --yt-tab-color-accent:#ff4533;
       --yt-scrollbar-outline:rgba(127,127,127,.5);
       --yt-panel-overlay-subtle:rgba(0,0,0,.05);
      --yt-scrollbar-thumb:rgba(144,144,144,.5);
      --yt-scrollbar-thumb-hover:rgba(170,170,170,.7);
      --yt-panel-overlay-weak:rgba(0,0,0,.02);
      --yt-badge-bg-light:rgba(255,255,255,.1);
      --yt-badge-bg-dark:rgba(0,0,0,.05);
      --yt-text-dark-primary:#0f0f0f;
      --yt-playall-accent-purple:#bf4bcc;
      --yt-playall-accent-blue:#2b66da;
      --yt-search-highlight-bg:rgba(255,99,71,.12);
      --yt-search-highlight-border:rgba(255,99,71,.25);
      --yt-search-highlight-border-strong:rgba(255,99,71,.4);
      --yt-search-highlight-faint:rgba(255,99,71,.1);
      --yt-search-highlight-hover:rgba(255,99,71,.22);
      --yt-search-highlight-accent:#ff5c5c;
      --yt-shorts-shadow-deep:rgba(0,0,0,.4);
      --yt-shorts-overlay-gray:rgba(155,155,155,.15);
      --yt-shorts-border-light:rgba(255,255,255,.2);
      --yt-shorts-shadow-blue:rgba(31,38,135,.37);
      --yt-shorts-feedback-bg-dark:rgba(34,34,34,.7);
      --yt-shorts-feedback-bg-light:rgba(255,255,255,.95);
      --yt-shorts-border-dark:rgba(0,0,0,.08);
      --yt-shorts-help-bg-light:rgba(255,255,255,.98);
      --yt-shorts-header-bg:rgba(255,255,255,.05);
      --yt-shorts-header-bg-light:rgba(0,0,0,.04);
      --yt-shorts-kbd-bg:rgba(255,255,255,.15);
      --yt-shorts-kbd-border:rgba(255,255,255,.2);
      --yt-shorts-kbd-bg-light:rgba(0,0,0,.06);
      --yt-shorts-kbd-hover:rgba(255,255,255,.22);
      --yt-shorts-text-secondary:rgba(255,255,255,.92);
      --yt-shorts-footer-bg:rgba(255,255,255,.05);
      --yt-shorts-footer-bg-light:rgba(0,0,0,.04);
      --yt-shorts-panel-header:rgba(255,255,255,.1);
      --yt-shorts-panel-header-bg:rgba(255,255,255,.05);
      --yt-shorts-feedback-bg:rgba(255,255,255,.15);
      --yt-shorts-feedback-border:rgba(255,255,255,.2);
      --yt-shorts-help-bg:rgba(255,255,255,.15);
      --yt-shorts-help-border:rgba(255,255,255,.2);
      --yt-shorts-kbd-non-editable:rgba(0,0,0,.08);
      --yt-muted-text:#666;
      --yt-success-accent:#10c56a;
      --yt-success-accent-soft:rgba(16,197,106,0.15);
      --yt-surface-contrast:#111;
      --yt-progress-track:#e0e0e0;
      --yt-progress-fill:#1a73e8;
      --yt-modal-surface:rgba(20,20,20,.64);
      --yt-radius-xs:6px;
      --yt-radius-sm:10px;
      --yt-radius-md:14px;
      --yt-radius-lg:20px;
      --yt-space-sm:8px;
      --yt-space-md:16px;
      --yt-space-lg:24px;
      --yt-transition-fast:all .14s cubic-bezier(.2,.8,.2,1);
      --yt-transition-default:all .24s cubic-bezier(.2,.8,.2,1);
      --yt-glass-blur:blur(18px) saturate(180%);
      --yt-glass-blur-light:blur(12px) saturate(160%);
      --yt-glass-blur-heavy:blur(24px) saturate(200%);
      --yt-z-overlay:1000;
      --yt-z-flyout:20000;
      --yt-z-modal:100000;
      --yt-stats-icon-views-bg:rgba(59,130,246,0.15);
      --yt-stats-icon-views:#3b82f6;
      --yt-stats-icon-likes-bg:rgba(34,197,94,0.15);
      --yt-stats-icon-likes:#22c55e;
      --yt-stats-icon-dislikes-bg:rgba(239,68,68,0.15);
      --yt-stats-icon-dislikes:#ef4444;
      --yt-stats-icon-comments-bg:rgba(168,85,247,0.15);
      --yt-stats-icon-comments:#a855f7;
      --yt-stats-icon-viewers-bg:rgba(234,179,8,0.15);
      --yt-stats-icon-viewers:#eab308;
      --yt-stats-icon-subscribers-bg:rgba(236,72,153,0.15);
      --yt-stats-icon-subscribers:#ec4899;
      --yt-stats-icon-videos-bg:rgba(14,165,233,0.15);
      --yt-stats-icon-videos:#0ea5e9;
      --yt-stats-card-bg-dark:rgba(255,255,255,0.05);
      --yt-stats-card-bg-light:rgba(0,0,0,0.03);
      --yt-stats-card-border-dark:rgba(255,255,255,0.08);
      --yt-stats-card-border-light:rgba(0,0,0,0.1);
      --yt-stats-text-secondary-dark:rgba(255,255,255,0.65);
      --yt-stats-text-secondary-light:rgba(0,0,0,0.6);
      --yt-stats-text-label:rgba(255,255,255,0.72);
      --yt-stats-text-exact-dark:rgba(255,255,255,0.5);
      --yt-stats-text-exact-light:rgba(0,0,0,0.5);
      --yt-stats-text-value-dark:#fff;
      --yt-stats-text-value-light:#111;
      --yt-stats-error:#ff6b6b;
      --yt-stats-link-color:#0b61d6;
      --yt-stats-link-hover:#e6f0ff;
      --yt-stats-link-hover-dark:#0647a6;
      --yt-stats-loader-text-dark:#fff;
      --yt-stats-loader-text-light:#666;
      --yt-stats-shadow-hover:rgba(0,0,0,0.3);
      --yt-stats-shadow-deep:rgba(0,0,0,0.32);
      --yt-stats-modal-shadow:rgba(0,0,0,0.45);
      --yt-stats-bg-overlay-dark:rgba(28,28,28,0.75);
      --yt-stats-img-border-dark:rgba(255,255,255,0.06);
      --yt-stats-img-border-light:rgba(0,0,0,0.06);
      --yt-stats-button-bg-dark:rgba(24,24,24,0.68);
      --yt-stats-button-border-dark:rgba(255,255,255,0.08);
      --yt-stats-button-border-light:rgba(0,0,0,0.06);
      --yt-stats-button-bg-light:rgba(255,255,255,0.12);
      --yt-stats-author-name-bright:rgba(255,255,255,0.9);
      --yt-stats-author-name-light:rgba(0,0,0,0.8);
      --yt-stats-channel-button-bg:rgba(0,0,0,0.4);
      --yt-stats-channel-button-border:rgba(255,255,255,0.1);
      --yt-stats-channel-button-hover:rgba(0,0,0,0.6);
      --yt-stats-channel-button-hover-border:rgba(255,255,255,0.3);
      --yt-stats-channel-menu-bg:rgba(28,28,28,0.75);
      --yt-stats-channel-menu-border:rgba(255,255,255,0.08);
      --yt-stats-channel-menu-item-bg:rgba(255,255,255,0.02);
      --yt-stats-channel-label-text:#eee;
      --yt-stats-channel-input-bg:rgba(255,255,255,0.1);
      --yt-stats-channel-input-hover:rgba(255,255,255,0.15);
      --yt-stats-channel-select-option-bg:#333;
      --yt-stats-channel-range-bg:rgba(255,255,255,0.2);
      --yt-stats-channel-range-thumb:#3ea6ff;
      --yt-stats-channel-checkbox-border:rgba(255,255,255,0.4);
      --yt-stats-channel-text-value:#bbb;
      --yt-stats-channel-text-shadow:rgba(0,0,0,0.3);
      --yt-stats-link-color:#0b61d6;
      --yt-stats-link-hover-dark:#0647a6;
      --yt-stats-positive-indicator:#1ed760;
      --yt-stats-negative-indicator:#f3727f;
      --yt-stats-channel-filter-shadow:rgba(0,0,0,0.5);
      --yt-timecode-panel-bg-dark:rgba(34,34,34,0.75);
      --yt-timecode-panel-bg-light:rgba(255,255,255,0.95);
      --yt-timecode-panel-border-dark:rgba(255,255,255,0.12);
      --yt-timecode-panel-border-light:rgba(0,0,0,0.08);
      --yt-timecode-panel-color-dark:#fff;
      --yt-timecode-panel-color-light:#222;
      --yt-timecode-panel-shadow:rgba(0,0,0,0.45);
      --yt-timecode-active-bg-start:rgba(255,68,68,0.12);
      --yt-timecode-active-bg-end:rgba(255,68,68,0.04);
      --yt-timecode-active-border:#ff6666;
      --yt-timecode-active-inset:rgba(255,68,68,0.03);
      --yt-timecode-chapter:#ff4444;
      --yt-timecode-toggle-active-start:#ff6b6b;
      --yt-timecode-export-success-bg:rgba(0,220,0,0.8);
      --yt-update-card-shadow:rgba(6,10,20,0.45);
      --yt-update-available-dot:#ff4444;
      --yt-update-available-text:#ff6666;
      --yt-update-install-bg-start:#ff4500;
      --yt-update-install-bg-end:#ff6b35;
      --yt-update-install-shadow:rgba(255,69,0,0.3);
      --yt-thumbnail-overlay-idle:rgba(0,0,0,0.3);
      --yt-thumbnail-overlay-hover:rgba(0,0,0,0.7);
      --yt-thumbnail-overlay-active:rgba(0,0,0,0.9);
    }

    html[dark],html:not([dark]):not([light]){
      --yt-bg-primary:rgba(15,15,15,.85);
      --yt-bg-secondary:rgba(28,28,28,.85);
      --yt-bg-tertiary:rgba(34,34,34,.85);
      --yt-text-primary:#fff;
      --yt-text-secondary:#aaa;
      --yt-border-color:rgba(255,255,255,.2);
      --yt-hover-bg:rgba(255,255,255,.1);
      --yt-shadow:0 4px 12px rgba(0,0,0,.25);
      --yt-glass-bg:rgba(50,50,50,.5);
      --yt-glass-border:rgba(255,255,255,.2);
      --yt-glass-shadow:0 8px 32px rgba(0,0,0,.2);
      --yt-modal-bg:rgba(0,0,0,.75);
      --yt-notification-bg:rgba(28,28,28,.9);
      --yt-panel-bg:rgba(34,34,34,.3);
      --yt-header-bg:rgba(20,20,20,.6);
      --yt-input-bg:rgba(255,255,255,.1);
      --yt-button-bg:rgba(255,255,255,.2);
      --yt-text-stroke:#fff;
    }

    html[light]{
      --yt-bg-primary:rgba(255,255,255,.85);
      --yt-bg-secondary:rgba(248,248,248,.85);
      --yt-bg-tertiary:rgba(240,240,240,.85);
      --yt-text-primary:#030303;
      --yt-text-secondary:#606060;
      --yt-border-color:rgba(0,0,0,.2);
      --yt-hover-bg:rgba(0,0,0,.05);
      --yt-shadow:0 4px 12px rgba(0,0,0,.15);
      --yt-glass-bg:rgba(255,255,255,.7);
      --yt-glass-border:rgba(0,0,0,.1);
      --yt-glass-shadow:0 8px 32px rgba(0,0,0,.1);
      --yt-modal-bg:rgba(0,0,0,.5);
      --yt-notification-bg:rgba(255,255,255,.95);
      --yt-panel-bg:rgba(255,255,255,.7);
      --yt-header-bg:rgba(248,248,248,.8);
      --yt-input-bg:rgba(0,0,0,.05);
      --yt-button-bg:rgba(0,0,0,.1);
      --yt-text-stroke:#030303;
    }

    .ytp-plus-btn{
      padding:var(--yt-space-sm) var(--yt-space-md);
      border-radius:18px;
      border:1px solid var(--yt-glass-border);
      font-size:14px;
      font-weight:500;
      cursor:pointer;
      color:var(--yt-text-primary);
      background:var(--yt-button-bg);
      transition:var(--yt-transition-default);
    }
    .ytp-plus-btn:hover{
      transform:translateY(-1px);
      box-shadow:var(--yt-shadow);
      background:var(--yt-hover-bg);
    }
    .ytp-plus-btn--primary{
      background:transparent;
    }
    .ytp-plus-btn--primary:hover{
      background:var(--yt-accent);
      color:#fff;
      box-shadow:0 6px 16px rgba(255,0,0,.35);
    }

    .ytp-plus-panel{
      background:var(--yt-glass-bg);
      border:1px solid var(--yt-glass-border);
      border-radius:var(--yt-radius-md);
      box-shadow:var(--yt-glass-shadow);
      color:var(--yt-text-primary);
    }

    .ytp-plus-modal-overlay{
      position:fixed;
      inset:0;
      background:var(--yt-modal-bg);
      display:flex;
      align-items:center;
      justify-content:center;
      z-index:var(--yt-z-modal);
      backdrop-filter:blur(8px) saturate(140%);
      -webkit-backdrop-filter:blur(8px) saturate(140%);
      animation:ytEnhanceFadeIn .25s ease-out;
    }

    .ytp-plus-modal-content{
      background:var(--yt-glass-bg);
      border:1.5px solid var(--yt-glass-border);
      border-radius:24px;
      color:var(--yt-text-primary);
      box-shadow:0 12px 40px rgba(0,0,0,.45);
      backdrop-filter:blur(14px) saturate(140%);
      -webkit-backdrop-filter:blur(14px) saturate(140%);
      animation:ytEnhanceScaleIn .28s cubic-bezier(.4,0,.2,1);
    }

    @keyframes ytEnhanceFadeIn{from{opacity:0;}to{opacity:1;}}
    @keyframes ytEnhanceScaleIn{from{opacity:0;transform:scale(.92) translateY(10px);}to{opacity:1;transform:scale(1) translateY(0);}}
    @keyframes fadeInModal{from{opacity:0}to{opacity:1}}
    @keyframes scaleInModal{from{transform:scale(0.95);opacity:0}to{transform:scale(1);opacity:1}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes dash{0%{stroke-dashoffset:80}50%{stroke-dashoffset:10}100%{stroke-dashoffset:80}}
    @keyframes slideInFromBottom{from{transform:translateY(100%);opacity:0;}to{transform:translateY(0);opacity:1;}}
    @keyframes slideOutToBottom{from{transform:translateY(0);opacity:1;}to{transform:translateY(100%);opacity:0;}}

    @keyframes ytp-resume-fadein{from{opacity:0;}to{opacity:1;}}

    @media (prefers-reduced-motion: reduce){
      *,*::before,*::after{
        animation:none !important;
        transition:none !important;
      }
    }
  `
  );
})();

(function () {
  'use strict';

  /**
   * Initialize a glass dropdown and sync selected value to a hidden native select.
   * @param {{ dropdown: HTMLElement | string | null, hiddenSelect: HTMLSelectElement | string | null }} config
   * @returns {() => void}
   */
  function initGlassDropdown(config) {
    /**
     * @param {HTMLElement | HTMLSelectElement | string | null | undefined} target
     * @returns {Element | null}
     */
    const resolveElement = target => {
      if (!target) return null;
      if (typeof target === 'string') return document.querySelector(target);
      return target;
    };

    const dropdown = /** @type {HTMLElement | null} */ (resolveElement(config?.dropdown));
    const hiddenSelect = /** @type {HTMLSelectElement | null} */ (
      resolveElement(config?.hiddenSelect)
    );
    if (!dropdown || !hiddenSelect) {
      return () => {};
    }

    const toggle = /** @type {HTMLElement | null} */ (
      dropdown.querySelector('.glass-dropdown__toggle')
    );
    const list = /** @type {HTMLElement | null} */ (
      dropdown.querySelector('.glass-dropdown__list')
    );
    const label = /** @type {HTMLElement | null} */ (
      dropdown.querySelector('.glass-dropdown__label')
    );
    if (!toggle || !list || !label) {
      return () => {};
    }

    /** @type {HTMLElement[]} */
    let items = Array.from(list.querySelectorAll('.glass-dropdown__item'));
    let idx = items.findIndex(it => it.getAttribute('aria-selected') === 'true');
    if (idx < 0) idx = 0;

    const closeList = () => {
      dropdown.setAttribute('aria-expanded', 'false');
      list.style.display = 'none';
    };

    const openList = () => {
      dropdown.setAttribute('aria-expanded', 'true');
      list.style.display = 'block';
      items = Array.from(list.querySelectorAll('.glass-dropdown__item'));
    };

    closeList();

    const selectedItem = items[idx];
    if (selectedItem) {
      hiddenSelect.value = selectedItem.getAttribute('data-value') || '';
      label.textContent = selectedItem.textContent || '';
    }

    const handleToggleClick = () => {
      const expanded = dropdown.getAttribute('aria-expanded') === 'true';
      if (expanded) closeList();
      else openList();
    };

    /** @param {Event} e */
    const handleDocumentClick = e => {
      const target = /** @type {Node | null} */ (e.target);
      if (!target || dropdown.contains(target)) return;
      closeList();
    };

    /** @param {MouseEvent} e */
    const handleListClick = e => {
      const source = e.target instanceof Element ? e.target : null;
      const item = source?.closest('.glass-dropdown__item');
      if (!(item instanceof HTMLElement)) return;

      const value = item.getAttribute('data-value') || '';
      hiddenSelect.value = value;

      list
        .querySelectorAll('.glass-dropdown__item')
        .forEach(li => li.removeAttribute('aria-selected'));

      item.setAttribute('aria-selected', 'true');
      idx = items.indexOf(item);
      label.textContent = item.textContent || '';
      hiddenSelect.dispatchEvent(new Event('change', { bubbles: true }));
      closeList();
    };

    /** @param {KeyboardEvent} e */
    const handleKeyDown = e => {
      const expanded = dropdown.getAttribute('aria-expanded') === 'true';
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!expanded) openList();
        idx = Math.min(idx + 1, items.length - 1);
        items.forEach(it => it.removeAttribute('aria-selected'));
        items[idx]?.setAttribute('aria-selected', 'true');
        items[idx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!expanded) openList();
        idx = Math.max(idx - 1, 0);
        items.forEach(it => it.removeAttribute('aria-selected'));
        items[idx]?.setAttribute('aria-selected', 'true');
        items[idx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!expanded) {
          openList();
          return;
        }

        const item = items[idx];
        if (!item) return;
        hiddenSelect.value = item.getAttribute('data-value') || '';
        hiddenSelect.dispatchEvent(new Event('change', { bubbles: true }));
        label.textContent = item.textContent || '';
        closeList();
      } else if (e.key === 'Escape') {
        closeList();
      }
    };

    toggle.addEventListener('click', handleToggleClick);
    list.addEventListener('click', handleListClick);
    dropdown.addEventListener('keydown', handleKeyDown);

    if (window.YouTubeUtils?.cleanupManager?.registerListener) {
      window.YouTubeUtils.cleanupManager.registerListener(document, 'click', handleDocumentClick);
    } else {
      document.addEventListener('click', handleDocumentClick);
    }

    return () => {
      toggle.removeEventListener('click', handleToggleClick);
      list.removeEventListener('click', handleListClick);
      dropdown.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleDocumentClick);
    };
  }

  if (typeof window !== 'undefined') {
    window.YouTubePlusDesignSystem = {
      ...(window.YouTubePlusDesignSystem || {}),
      initGlassDropdown,
    };
  }
})();
