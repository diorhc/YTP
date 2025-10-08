// Commment Manager
(function () {
  'use strict';

  // Streamlined configuration
  const CONFIG = {
    selectors: {
      deleteButtons: 'div[class^="VfPpkd-Bz112c-"]',
      menuButton: '[aria-haspopup="menu"]',
    },
    classes: {
      checkbox: 'comment-checkbox',
      container: 'comment-controls-container',
    },
    debounceDelay: 100,
    deleteDelay: 200,
    enabled: true,
    storageKey: 'youtube_comment_manager_settings',
  };

  // State management
  const state = {
    observer: null,
    isProcessing: false,
    settingsNavListenerKey: null,
  };

  // Optimized settings
  const settings = {
    load: () => {
      try {
        const saved = localStorage.getItem(CONFIG.storageKey);
        if (saved) CONFIG.enabled = JSON.parse(saved).enabled ?? true;
      } catch (e) {}
    },
    save: () => {
      try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify({ enabled: CONFIG.enabled }));
      } catch (e) {}
    },
  };

  // Utility functions
  const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);

  // Core functionality
  const addCheckboxes = () => {
    if (!CONFIG.enabled || state.isProcessing) return;

    const deleteButtons = $$(CONFIG.selectors.deleteButtons);

    deleteButtons.forEach((button) => {
      if (
        button.closest(CONFIG.selectors.menuButton) ||
        button.parentNode.querySelector(`.${CONFIG.classes.checkbox}`)
      )
        return;

      const commentElement =
        button.closest('[class*="comment"]') ||
        button.closest('[role="article"]') ||
        button.parentNode;

      if (commentElement && !commentElement.hasAttribute('data-comment-text')) {
        commentElement.setAttribute('data-comment-text', commentElement.textContent.toLowerCase());
      }

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = CONFIG.classes.checkbox;
      checkbox.style.cssText =
        'appearance:none;width:20px;height:20px;border:2px solid rgba(221,221,221,0.5);border-radius:6px;cursor:pointer;transition:all 0.2s ease;background:rgba(0,0,0,0.9);position:relative;margin-right:8px;';

      checkbox.addEventListener('change', updateDeleteButtonState);
      checkbox.addEventListener('click', (e) => e.stopPropagation());

      // Optimized positioning
      const dateElement = commentElement.querySelector(
        '[class*="date"],[class*="time"],time,[title*="20"],[aria-label*="ago"]'
      );

      if (dateElement) {
        dateElement.style.cssText += 'position:relative;';
        checkbox.style.cssText += 'position:absolute;right:-30px;top:0px;';
        dateElement.appendChild(checkbox);
      } else {
        button.parentNode.insertBefore(checkbox, button);
      }
    });
  };

  const addControlButtons = () => {
    if (!CONFIG.enabled || $(`.${CONFIG.classes.container}`)) return;

    const deleteButtons = $$(CONFIG.selectors.deleteButtons);
    if (!deleteButtons.length) return;

    const container = deleteButtons[0].parentNode.parentNode;
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = CONFIG.classes.container;
    buttonsContainer.style.cssText =
      'position:fixed;top:50%;right:20px;transform:translateY(-50%);display:flex;flex-direction:column;gap:12px;z-index:9999;';

    const buttonStyles =
      'padding:16px 24px;border:none;border-radius:16px;cursor:pointer;font-weight:600;font-size:14px;transition:all 0.3s ease;min-width:180px;text-align:center;backdrop-filter:blur(15px);-webkit-backdrop-filter:blur(15px);';

    // Delete All Button
    const deleteAllButton = document.createElement('button');
    deleteAllButton.textContent = 'Delete Selected';
    deleteAllButton.className = 'delete-all-button';
    deleteAllButton.disabled = true;
    deleteAllButton.style.cssText =
      buttonStyles +
      'background:rgba(244,67,54,0.2);color:#f44336;border:1px solid rgba(244,67,54,0.3);';
    deleteAllButton.addEventListener('click', deleteSelectedComments);

    // Select All Button
    const selectAllButton = document.createElement('button');
    selectAllButton.textContent = 'Select All';
    selectAllButton.style.cssText =
      buttonStyles +
      'background:rgba(33,150,243,0.2);color:#2196f3;border:1px solid rgba(33,150,243,0.3);';
    selectAllButton.addEventListener('click', () => {
      $$(`.${CONFIG.classes.checkbox}`).forEach((cb) => (cb.checked = true));
      updateDeleteButtonState();
    });

    // Clear All Button
    const clearAllButton = document.createElement('button');
    clearAllButton.textContent = 'Clear All';
    clearAllButton.style.cssText =
      buttonStyles +
      'background:rgba(76,175,80,0.2);color:#4caf50;border:1px solid rgba(76,175,80,0.3);';
    clearAllButton.addEventListener('click', () => {
      $$(`.${CONFIG.classes.checkbox}`).forEach((cb) => (cb.checked = false));
      updateDeleteButtonState();
    });

    buttonsContainer.append(deleteAllButton, selectAllButton, clearAllButton);
    container.insertBefore(buttonsContainer, deleteButtons[0].parentNode);
  };

  const updateDeleteButtonState = () => {
    const deleteAllButton = $('.delete-all-button');
    if (!deleteAllButton) return;

    const hasChecked = Array.from($$(`.${CONFIG.classes.checkbox}`)).some((cb) => cb.checked);
    deleteAllButton.disabled = !hasChecked;
    deleteAllButton.style.opacity = hasChecked ? '1' : '0.6';
  };

  const deleteSelectedComments = () => {
    const checkedBoxes = Array.from($$(`.${CONFIG.classes.checkbox}`)).filter((cb) => cb.checked);

    if (!checkedBoxes.length || !confirm(`Delete ${checkedBoxes.length} comment(s)?`)) return;

    state.isProcessing = true;
    checkedBoxes.forEach((checkbox, index) => {
      setTimeout(() => {
        const deleteButton =
          checkbox.nextElementSibling ||
          checkbox.parentNode.querySelector(CONFIG.selectors.deleteButtons);
        deleteButton?.click();
      }, index * CONFIG.deleteDelay);
    });

    setTimeout(() => (state.isProcessing = false), checkedBoxes.length * CONFIG.deleteDelay + 1000);
  };

  const cleanup = () => {
    $$(`.${CONFIG.classes.checkbox}`).forEach((el) => el.remove());
    $(`.${CONFIG.classes.container}`)?.remove();
  };

  const initializeScript = () => {
    if (CONFIG.enabled) {
      addCheckboxes();
      addControlButtons();
      updateDeleteButtonState();
    } else {
      cleanup();
    }
  };

  // Enhanced styles with better performance
  const addStyles = () => {
    if ($('#comment-delete-styles')) return;

    // ✅ Use StyleManager instead of createElement('style')
    const styles = `
        .${CONFIG.classes.checkbox}:hover{border-color:rgba(33,150,243,0.7);background:rgba(245,245,245,0.3);transform:scale(1.1)}
        .${CONFIG.classes.checkbox}:checked{background:rgba(33,150,243,0.3);border-color:rgba(33,150,243,0.7);box-shadow:0 4px 12px rgba(33,150,243,0.2)}
        .${CONFIG.classes.checkbox}:checked::after{content:'✓';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#2196f3;font-size:14px;font-weight:bold}
        .delete-all-button:hover:not(:disabled){background:rgba(244,67,54,0.3)!important;transform:translateY(-3px);box-shadow:0 8px 24px rgba(244,67,54,0.2)}
      `;
    YouTubeUtils.StyleManager.add('comment-delete-styles', styles);
  };

  // Settings integration
  const addCommentManagerSettings = () => {
    const advancedSection = $('.ytp-plus-settings-section[data-section="advanced"]');
    if (!advancedSection || $('.comment-manager-settings-item')) return;

    const settingsItem = document.createElement('div');
    settingsItem.className = 'ytp-plus-settings-item comment-manager-settings-item';
    settingsItem.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">Comment Manager</label>
          <div class="ytp-plus-settings-item-description">Add bulk delete functionality for managing comments on YouTube</div>
        </div>
        <button class="ytp-plus-button" id="open-comment-history-page" style="margin:0 0 0 30px;padding:12px 16px;font-size:13px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="gray" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15,3 21,3 21,9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
      `;

    advancedSection.appendChild(settingsItem);

    $('#open-comment-history-page').addEventListener('click', () => {
      window.open('https://www.youtube.com/feed/history/comment_history', '_blank');
    });
  };

  // Optimized initialization
  const init = () => {
    settings.load();
    addStyles();

    // Setup observer with throttling
    state.observer?.disconnect();
    state.observer = new MutationObserver(debounce(initializeScript, CONFIG.debounceDelay));

    // ✅ Register observer in cleanupManager
    YouTubeUtils.cleanupManager.registerObserver(state.observer);
    state.observer.observe(document.body, { childList: true, subtree: true });

    // Initial setup
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeScript);
    } else {
      initializeScript();
    }

    // Settings modal integration
    const settingsObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.classList?.contains('ytp-plus-settings-modal')) {
            setTimeout(addCommentManagerSettings, 100);
            return;
          }
        }
      }
    });

    // ✅ Register observer in cleanupManager
    YouTubeUtils.cleanupManager.registerObserver(settingsObserver);
    settingsObserver.observe(document.body, { childList: true, subtree: true });

    const handleAdvancedNavClick = (e) => {
      if (e.target.dataset?.section === 'advanced') {
        setTimeout(addCommentManagerSettings, 50);
      }
    };

    if (!state.settingsNavListenerKey) {
      state.settingsNavListenerKey = YouTubeUtils.cleanupManager.registerListener(
        document,
        'click',
        handleAdvancedNavClick,
        { passive: true, capture: true }
      );
    }
  };

  init();
})();
