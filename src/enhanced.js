// Enhanced Tabviews
(function () {
  'use strict';

  // Configuration
  const config = {
    enabled: true,
    storageKey: 'youtube_top_button_settings',
  };

  let activeScrollContainer = null;
  let activeScrollListenerKey = null;
  let activeResizeObserver = null;
  let activeMutationObserver = null;

  const teardownActiveContainer = () => {
    if (activeScrollListenerKey) {
      YouTubeUtils.cleanupManager.unregisterListener(activeScrollListenerKey);
      activeScrollListenerKey = null;
    }
    if (activeResizeObserver) {
      YouTubeUtils.cleanupManager.unregisterObserver(activeResizeObserver);
      activeResizeObserver = null;
    }
    if (activeMutationObserver) {
      YouTubeUtils.cleanupManager.unregisterObserver(activeMutationObserver);
      activeMutationObserver = null;
    }
    activeScrollContainer = null;
  };

  // Styles
  const addStyles = () => {
    if (document.getElementById('custom-styles')) return;

    // ✅ Use StyleManager instead of createElement('style')
    const styles = `
      :root{--scrollbar-width:8px;--scrollbar-track:transparent;--scrollbar-thumb:rgba(144,144,144,.5);--scrollbar-thumb-hover:rgba(170,170,170,.7);--scrollbar-thumb-active:rgba(190,190,190,.9);}
      ::-webkit-scrollbar{width:var(--scrollbar-width)!important;height:var(--scrollbar-width)!important;}
      ::-webkit-scrollbar-track{background:var(--scrollbar-track)!important;border-radius:4px!important;}
      ::-webkit-scrollbar-thumb{background:var(--scrollbar-thumb)!important;border-radius:4px!important;transition:background .2s!important;}
      ::-webkit-scrollbar-thumb:hover{background:var(--scrollbar-thumb-hover)!important;}
      ::-webkit-scrollbar-thumb:active{background:var(--scrollbar-thumb-active)!important;}
      ::-webkit-scrollbar-corner{background:transparent!important;}
      *{scrollbar-width:thin;scrollbar-color:var(--scrollbar-thumb) var(--scrollbar-track);}
      html[dark]{--scrollbar-thumb:rgba(144,144,144,.4);--scrollbar-thumb-hover:rgba(170,170,170,.6);--scrollbar-thumb-active:rgba(190,190,190,.8);}
      .top-button{position:absolute;bottom:16px;right:16px;width:44px;height:44px;background:var(--yt-glass-bg);color:var(--yt-text-primary);border:1px solid var(--yt-glass-border);border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1000;opacity:0;visibility:hidden;transition:all .3s cubic-bezier(.4,0,.2,1);backdrop-filter:var(--yt-glass-blur-light);-webkit-backdrop-filter:var(--yt-glass-blur-light);box-shadow:var(--yt-glass-shadow);}
      .top-button:hover{background:var(--yt-hover-bg);transform:translateY(-2px) scale(1.08);box-shadow:0 12px 40px rgba(0,0,0,.3);}
      .top-button[data-disabled="true"]{opacity:0;visibility:hidden;pointer-events:none;}
      .top-button.visible{opacity:1;visibility:visible;}
      .top-button svg{transition:transform .2s cubic-bezier(.4,0,.2,1);}
      .top-button:hover svg{transform:translateY(-2px) scale(1.1);}
      html[dark]{--yt-top-btn-bg:var(--yt-glass-bg);--yt-top-btn-color:#fff;--yt-top-btn-border:var(--yt-glass-border);--yt-top-btn-hover:var(--yt-hover-bg);}
      html:not([dark]){--yt-top-btn-bg:var(--yt-glass-bg);--yt-top-btn-color:#222;--yt-top-btn-border:var(--yt-glass-border);--yt-top-btn-hover:var(--yt-hover-bg);}
        `;
    YouTubeUtils.StyleManager.add('custom-styles', styles);
  };

  // Button functionality
  const handleScroll = (scrollContainer) => {
    const button = document.getElementById('right-tabs-top-button');
    if (!button || !scrollContainer) return;

    if (!scrollContainer.isConnected) {
      teardownActiveContainer();
      button.classList.remove('visible');
      button.setAttribute('data-disabled', 'true');
      return;
    }

    const canScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight > 24;

    if (!canScroll) {
      button.classList.remove('visible');
      button.setAttribute('data-disabled', 'true');
      return;
    }

    button.removeAttribute('data-disabled');
    button.classList.toggle('visible', scrollContainer.scrollTop > 100);
  };

  const setupScrollListener = () => {
    const button = document.getElementById('right-tabs-top-button');
    const scrollContainer = YouTubeUtils.querySelector(
      '#right-tabs .tab-content-cld:not(.tab-content-hidden)'
    );

    if (!scrollContainer) {
      teardownActiveContainer();
      if (button) {
        button.classList.remove('visible');
        button.setAttribute('data-disabled', 'true');
      }
      return;
    }

    if (activeScrollContainer !== scrollContainer) {
      teardownActiveContainer();
      activeScrollContainer = scrollContainer;

      const updateVisibility = () => handleScroll(scrollContainer);
      const throttledScroll = YouTubeUtils.throttle(updateVisibility, 100);
      const observerUpdate = YouTubeUtils.throttle(updateVisibility, 150);

      activeScrollListenerKey = YouTubeUtils.cleanupManager.registerListener(
        scrollContainer,
        'scroll',
        throttledScroll,
        { passive: true }
      );

      if (typeof ResizeObserver === 'function') {
        activeResizeObserver = new ResizeObserver(() => observerUpdate());
        activeResizeObserver.observe(scrollContainer);
        YouTubeUtils.cleanupManager.registerObserver(activeResizeObserver);
      }

      activeMutationObserver = new MutationObserver(() => observerUpdate());
      activeMutationObserver.observe(scrollContainer, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      YouTubeUtils.cleanupManager.registerObserver(activeMutationObserver);
    }

    handleScroll(scrollContainer);
  };

  const scheduleScrollSetup = (delay = 100) => {
    const timeoutId = setTimeout(() => {
      YouTubeUtils.cleanupManager.unregisterTimeout(timeoutId);
      setupScrollListener();
    }, delay);
    YouTubeUtils.cleanupManager.registerTimeout(timeoutId);
  };

  const createButton = () => {
    // ✅ Use cached querySelector
    const rightTabs = YouTubeUtils.querySelector('#right-tabs');
    if (!rightTabs || document.getElementById('right-tabs-top-button')) return;
    if (!config.enabled) return;

    const button = document.createElement('button');
    button.id = 'right-tabs-top-button';
    button.className = 'top-button';
    button.title = 'Scroll to top';
    button.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

    button.addEventListener('click', () => {
      // ✅ Use cached querySelector
      const activeTab = YouTubeUtils.querySelector(
        '#right-tabs .tab-content-cld:not(.tab-content-hidden)'
      );
      if (activeTab) activeTab.scrollTo({ top: 0, behavior: 'smooth' });
    });

    rightTabs.style.position = 'relative';
    rightTabs.appendChild(button);
    setupScrollListener();
    scheduleScrollSetup(200);
  };

  // Observers
  const observeTabChanges = () => {
    const observer = new MutationObserver((mutations) => {
      let shouldRescan = false;

      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'class' &&
          mutation.target.classList.contains('tab-content-cld')
        ) {
          shouldRescan = true;
          break;
        }

        if (mutation.type === 'childList') {
          const added = Array.from(mutation.addedNodes || []);
          if (
            added.some(
              (node) =>
                node instanceof HTMLElement &&
                (node.classList.contains('tab-content-cld') || node.closest?.('.tab-content-cld'))
            )
          ) {
            shouldRescan = true;
            break;
          }
        }
      }

      if (shouldRescan) {
        scheduleScrollSetup();
      }
    });

    // ✅ Register observer in cleanupManager
    YouTubeUtils.cleanupManager.registerObserver(observer);

    // ✅ Use cached querySelector
    const rightTabs = YouTubeUtils.querySelector('#right-tabs');
    if (rightTabs) {
      observer.observe(rightTabs, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['class'],
      });
    }
  };

  // Events
  const setupEvents = () => {
    // ✅ Register global click listener in cleanupManager
    const clickHandler = (e) => {
      if (e.target.closest('.tab-btn[tyt-tab-content]')) {
        scheduleScrollSetup();
      }
    };
    YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler, true);

    if (typeof window !== 'undefined') {
      YouTubeUtils.cleanupManager.registerListener(window, 'resize', () => scheduleScrollSetup(60));
      YouTubeUtils.cleanupManager.registerListener(window, 'yt-navigate-finish', () =>
        scheduleScrollSetup(150)
      );
    }
  };

  // Initialize
  const init = () => {
    addStyles();
    setupEvents();

    const checkForTabs = () => {
      // ✅ Use cached querySelector
      if (YouTubeUtils.querySelector('#right-tabs')) {
        createButton();
        observeTabChanges();
      } else {
        setTimeout(checkForTabs, 500);
      }
    };

    checkForTabs();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
