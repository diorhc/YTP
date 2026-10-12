// Report: report submission for the settings modal.
//
// Responsibility: populates the settings 'report' section and provides
//   report submission helpers. Prepares debug info (version, UA, page URL,
//   settings snapshot) and opens a prefilled GitHub issue or copies to
//   clipboard.
// Public surface: window.YouTubePlusReport (settings section provider).
(function () {
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    window.YouTubeUtils?.logSuppressed?.(_err, _label || 'Report');
  const setTimeout_ = setTimeout;

  // Minimal guards for shared utils
  const Y = window.YouTubeUtils || {};

  /** Show a notification when the shared notification manager is available; returns true when shown. */
  const showNotification_ = (
    /** @type {string} */ message,
    /** @type {{ duration?: number, type?: string } | undefined} */ opts
  ) => {
    const manager = Y?.NotificationManager;
    if (manager && typeof manager.show === 'function') {
      manager.show(message, opts);
      return true;
    }
    return false;
  };

  /** Issue-kind for the payload URL routing. */
  const issueKindFor = (/** @type {string} */ type) =>
    type === 'feature' ? 'feature' : type === 'other' ? 'other' : 'bug';

  // Translation helper from centralized i18n
  const t = Y.t || (key => key || '');

  /**
   * @typedef {{ version: string; userAgent: string; url: string; language: string; settings: Record<string, unknown> | null; error?: string }} DebugInfo
   */

  /**
   * Create DOM element with properties and children
   * @param {string} tag - HTML tag name
   * @param {Record<string, unknown>} props - Element properties
   * @param {Array<Node | string>} children - Child elements or text
   * @returns {HTMLElement} Created element
   */
  function mk(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === 'class') {
        el.className = /** @type {string} */ (v);
      } else if (k === 'html') {
        window.YouTubeUtils?.setSafeHTML?.(el, /** @type {string} */ (v), true);
      } else if (k.startsWith('on') && typeof v === 'function') {
        window.YouTubePlusCleanupManager?.registerListener?.(
          el,
          k.substring(2).toLowerCase(),
          /** @type {EventListener} */ (v),
          undefined,
          false
        );
      } else {
        el.setAttribute(k, String(v));
      }
    });
    children.forEach(c =>
      typeof c === 'string' ? el.appendChild(document.createTextNode(c)) : el.appendChild(c)
    );
    return el;
  }

  /**
   * Sanitize HTML to prevent XSS attacks.
   *
   * Delegates to the sanitizer `YouTubeSafeDOM.sanitizeHTML`. There is
   * intentionally NO fallback to `textContent → innerHTML` because that
   * would be an escape, not a sanitization: if the safe-DOM helper
   * is unavailable here, that's a load-order bug worth surfacing rather
   * than silently masking.
   * @param {string} html - HTML string to sanitize
   * @returns {string} Sanitized HTML
   */
  function sanitizeHTML(html) {
    if (window.YouTubeSafeDOM?.sanitizeHTML) {
      return window.YouTubeSafeDOM.sanitizeHTML(html);
    }
    if (Y?.sanitizeHTML && typeof Y.sanitizeHTML === 'function') {
      return Y.sanitizeHTML(html);
    }
    if (typeof html !== 'string') return '';
    // No safe-DOM helper is available: refuse rather than silently
    // fall through to a no-op escape that would change semantics.
    throw new Error('[report] sanitizeHTML called before YouTubeSafeDOM was ready');
  }

  /**
   * Validate email address format
   * @param {string} email - Email to validate
   * @returns {boolean} Whether email is valid
   */
  function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    // Basic email regex - simple but effective
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254; // RFC 5321
  }

  /**
   * Validate and sanitize title input
   * @param {string} title - Title to validate
   * @returns {string} Sanitized title
   */
  function validateTitle(title) {
    if (!title || typeof title !== 'string') return '';
    // Limit length and sanitize
    return sanitizeHTML(title.trim().substring(0, 200));
  }

  /**
   * Validate and sanitize description input
   * @param {string} description - Description to validate
   * @returns {string} Sanitized description
   */
  function validateDescription(description) {
    if (!description || typeof description !== 'string') return '';
    // Limit length and sanitize
    return sanitizeHTML(description.trim().substring(0, 5000));
  }

  /**
   * Collect debug information for reports
   * @returns {Object} Debug information object
   */
  /**
   * @returns {DebugInfo}
   */
  function getDebugInfo() {
    try {
      const debug = {
        version: window.YouTubePlusDebug?.version || 'unknown',
        userAgent: navigator?.userAgent || 'unknown',
        url: location?.href || 'unknown',
        language: document.documentElement?.lang || navigator?.language || 'unknown',
        settings: typeof Y?.SettingsManager === 'object' ? Y.SettingsManager.load() : null,
      };
      return debug;
    } catch (err) {
      logS(err);
      if (Y && typeof Y.logError === 'function') {
        Y.logError('Report', 'Failed to collect debug info', err);
      }
      return {
        version: 'unknown',
        userAgent: 'unknown',
        url: 'unknown',
        language: 'unknown',
        settings: null,
        error: 'Failed to collect debug info',
      };
    }
  }

  /**
   * Build GitHub issue payload from report data
   * @param {Object} params - Report parameters
   * @param {string} params.type - Report type (bug/feature/other)
   * @param {string} params.title - Report title
   * @param {string} params.description - Report description
   * @param {string} params.email - Optional email
   * @param {boolean} params.includeDebug - Include debug info
   * @returns {{title: string, body: string}} Issue payload
   */
  function buildIssuePayload({ type, title, description, email, includeDebug }) {
    const debug = includeDebug ? getDebugInfo() : null;

    const lines = [];
    const typeLabel =
      type === 'bug' ? t('typeBug') : type === 'feature' ? t('typeFeature') : t('typeOther');
    lines.push(`**Type:** ${typeLabel}`);
    if (email) lines.push(`**Reporter email (optional):** ${email}`);
    lines.push('\n**Description:**\n');
    lines.push(description || '(no description)');
    if (debug) {
      lines.push('\n---\n**Debug info**\n');
      lines.push('```json');
      try {
        lines.push(JSON.stringify(debug, null, 2));
      } catch (err) {
        logS(err);
        // Ship the scalar fields when the settings snapshot is unserializable.
        lines.push(
          JSON.stringify(
            {
              version: debug.version || 'unknown',
              userAgent: debug.userAgent || 'unknown',
              url: debug.url || 'unknown',
            },
            null,
            2
          )
        );
      }
      lines.push('```');
      lines.push('\n_Please do not include sensitive personal data._');
    }

    const body = lines.join('\n');
    const issueTitle =
      `${type === 'bug' ? '[Bug]' : type === 'feature' ? '[Feature]' : '[Report]'} ${title || ''}`.trim();
    return { title: issueTitle, body };
  }

  /**
   * Open GitHub issue/discussion in a new tab
   * @param {{title: string, body: string}} payload - Issue payload
   * @param {'bug'|'feature'|'other'} type - Report type
   */
  function openGitHubIssue(payload, type) {
    const repoOwner = 'diorhc';
    const repo = 'YTP';

    // Route feature suggestions to GitHub Discussions, others to Issues.
    const url =
      type === 'feature'
        ? `https://github.com/${repoOwner}/${repo}/discussions/new?category=ideas&title=${encodeURIComponent(
            payload.title
          )}&body=${encodeURIComponent(payload.body)}`
        : `https://github.com/${repoOwner}/${repo}/issues/new?title=${encodeURIComponent(
            payload.title
          )}&body=${encodeURIComponent(payload.body)}`;
    if (Y?.openSafe) {
      Y.openSafe(url, '_blank');
    } else {
      window.open(url, '_blank');
    }
  }

  /**
   * Copy text to clipboard with fallback
   * @param {string} text - Text to copy
   * @returns {Promise<void>} Promise that resolves when copied
   */
  function copyToClipboard(text) {
    // Modern clipboard API
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback for older browsers
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      try {
        ta.select();
        ta.setSelectionRange(0, text.length);
        const success = document.execCommand('copy');
        document.body.removeChild(ta);
        if (success) {
          resolve();
        } else {
          reject(new Error('execCommand failed'));
        }
      } catch (err) {
        logS(err);
        document.body.removeChild(ta);
        reject(err);
      }
    });
  }

  /**
   * Render report section in settings modal with glassmorphism styling
   * @param {HTMLElement} modal - Settings modal element
   */
  function renderReportSection(modal) {
    if (!modal?.querySelector) return;

    const section = modal.querySelector('.yp-settings-section[data-section="report"]');
    if (!section) return;

    // Clear existing content and build a small form
    section.replaceChildren();

    const form = mk('div', {
      style:
        'display:flex;flex-direction:column;gap:var(--yt-space-sm);margin-top:var(--yt-space-md);',
    });

    // Hidden native select (kept for form value access); visible UI will be a custom glass-dropdown
    const typeSelect = mk('select', { style: 'display:none;' }, []);
    const typeOptions = [
      { v: 'bug', l: t('typeBug') },
      { v: 'feature', l: t('typeFeature') },
      { v: 'other', l: t('typeOther') },
    ];
    typeOptions.forEach(opt => {
      const o = mk('option', { value: opt.v }, [opt.l]);
      typeSelect.appendChild(o);
    });

    // Build visible glass-dropdown using shared styles
    const typeDropdown = mk('div', {
      class: 'glass-dropdown',
      id: 'report-type-dropdown',
    });

    const defaultLabel = typeOptions[0].l;
    const toggleBtn = mk(
      'button',
      {
        class: 'glass-dropdown__toggle',
        id: 'report-type-toggle',
        type: 'button',
        'aria-haspopup': 'listbox',
        'aria-expanded': 'false',
      },
      [mk('span', { class: 'glass-dropdown__label' }, [defaultLabel])]
    );

    // add chevron svg to toggle
    toggleBtn.appendChild(
      mk(
        'svg',
        {
          class: 'glass-dropdown__chev',
          width: '12',
          height: '12',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '2',
        },
        [mk('polyline', { points: '6 9 12 15 18 9' }, [])]
      )
    );

    const listEl = mk(
      'ul',
      { class: 'glass-dropdown__list', role: 'listbox', 'aria-labelledby': 'report-type-toggle' },
      []
    );
    typeOptions.forEach((opt, i) => {
      const li = mk('li', { class: 'glass-dropdown__item', 'data-value': opt.v, role: 'option' }, [
        opt.l,
      ]);
      if (i === 0) li.setAttribute('aria-selected', 'true');
      listEl.appendChild(li);
    });

    typeDropdown.appendChild(toggleBtn);
    typeDropdown.appendChild(listEl);

    const inputStyle =
      'padding:var(--yt-space-sm);border-radius:var(--yt-radius-sm);background:var(--yt-input-bg);color:var(--yt-text-primary);border:1px solid var(--yt-glass-border);backdrop-filter:var(--yt-glass-blur-light);-webkit-backdrop-filter:var(--yt-glass-blur-light);font-size:14px;transition:border-color .2s ease,box-shadow .2s ease;box-sizing:border-box;';

    const titleInput = mk('input', {
      placeholder: t('shortTitle'),
      style: inputStyle,
    });
    const emailInput = mk('input', {
      placeholder: t('emailOptional'),
      type: 'email',
      style: inputStyle,
    });
    const descInput = mk('textarea', {
      placeholder: t('descriptionPlaceholder'),
      rows: 6,
      style: `${inputStyle}resize:vertical;font-family:inherit;`,
    });

    // checkbox input is created separately so we can listen to changes and show a preview
    const debugCheckboxInput = mk('input', {
      type: 'checkbox',
      class: 'yp-settings-checkbox',
    });
    const includeDebug = mk(
      'label',
      {
        style:
          'font-size:13px;display:flex;gap:var(--yt-space-sm);align-items:center;color:var(--yt-text-primary);cursor:pointer;align-self:center;',
      },
      [debugCheckboxInput, ` ${t('includeDebug')}`]
    );

    const actions = mk('div', {
      style:
        'display:flex;gap:var(--yt-space-sm);margin-top:var(--yt-space-sm);flex-wrap:wrap;justify-content:center;',
    });
    const submitBtn = /** @type {HTMLButtonElement} */ (
      mk('button', { class: 'glass-button' }, [t('openGitHub')])
    );
    const copyBtn = /** @type {HTMLButtonElement} */ (
      mk('button', { class: 'glass-button' }, [t('copyReport')])
    );
    const emailBtn = /** @type {HTMLButtonElement} */ (
      mk('button', { class: 'glass-button' }, [t('prepareEmail')])
    );

    actions.appendChild(submitBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(emailBtn);

    // append hidden select and visible dropdown
    form.appendChild(typeSelect);
    form.appendChild(typeDropdown);
    form.appendChild(titleInput);
    form.appendChild(emailInput);
    form.appendChild(descInput);
    form.appendChild(includeDebug);
    // Debug preview area: hidden by default, placed directly under the includeDebug checkbox
    // Use a container `div` so we can build structured, safe DOM (header + collapsible JSON)
    const debugPreview = mk(
      'div',
      {
        class: 'glass-card',
        style:
          'overflow:auto;max-height:240px;font-size:11px;display:none;margin-top:var(--yt-space-sm);padding:8px;box-sizing:border-box;',
      },
      []
    );
    form.appendChild(debugPreview);

    form.appendChild(actions);

    const privacy = mk(
      'div',
      {
        class: 'yp-settings-item-description',
        style: 'margin-top:var(--yt-space-sm);font-size:12px;color:var(--yt-text-secondary);',
      },
      [t('privacy')]
    );

    section.appendChild(form);
    section.appendChild(privacy);

    window.YouTubePlusDesignSystem?.initGlassDropdown?.({
      dropdown: typeDropdown,
      hiddenSelect: typeSelect,
    });

    // (debugPreview is appended inside the form, directly under the checkbox)

    /**
     * Fill the debug preview card: header fields, settings detail and full JSON.
     * @param {HTMLElement} previewEl
     * @param {DebugInfo} d
     */
    function buildDebugPreviewContent_(previewEl, d) {
      previewEl.replaceChildren();

      // Header with important fields
      const header = mk(
        'div',
        {
          style: 'display:flex;flex-direction:column;gap:6px;margin-bottom:6px;',
        },
        []
      );
      header.appendChild(
        mk('div', {}, ['Version: ', mk('strong', {}, [String(d.version || 'unknown')])])
      );
      header.appendChild(
        mk('div', {}, [
          'User agent: ',
          mk('code', { style: 'font-size:11px;color:var(--yt-text-secondary);' }, [
            String(d.userAgent || ''),
          ]),
        ])
      );

      const urlStr = String(d.url || 'unknown');
      let urlEl = mk('span', {}, [urlStr]);
      if (/^https?:\/\//i.test(urlStr)) {
        urlEl = mk(
          'a',
          {
            href: urlStr,
            target: '_blank',
            rel: 'noopener noreferrer',
            style: 'color:var(--yt-accent);word-break:break-all;',
          },
          [urlStr]
        );
      }
      header.appendChild(mk('div', {}, ['URL: ', urlEl]));
      header.appendChild(mk('div', {}, ['Language: ', mk('code', {}, [String(d.language || '')])]));

      previewEl.appendChild(header);

      // Settings (if available) – collapsible
      if (d.settings) {
        const settingsDetails = mk('details', {}, [mk('summary', {}, ['Settings'])]);
        settingsDetails.appendChild(
          mk(
            'pre',
            {
              style: 'white-space:pre-wrap;margin:6px 0 0 0;font-size:11px;',
            },
            [JSON.stringify(d.settings, null, 2)]
          )
        );
        previewEl.appendChild(settingsDetails);
      }

      // Full debug JSON (collapsible)
      const fullDetails = mk('details', {}, [mk('summary', {}, ['Full debug JSON'])]);
      fullDetails.appendChild(
        mk(
          'pre',
          {
            style: 'white-space:pre-wrap;margin:6px 0 0 0;font-size:11px;',
          },
          [JSON.stringify(d, null, 2)]
        )
      );
      previewEl.appendChild(fullDetails);

      previewEl.style.display = 'block';
    }

    /**
     * Update debug preview based on checkbox state
     */
    function updateDebugPreview() {
      if (/** @type {HTMLInputElement} */ (debugCheckboxInput).checked) {
        buildDebugPreviewContent_(debugPreview, getDebugInfo());
      } else {
        debugPreview.replaceChildren();
        debugPreview.style.display = 'none';
      }
    }

    // wire up checkbox to preview
    window.YouTubePlusCleanupManager?.registerListener?.(
      debugCheckboxInput,
      'change',
      updateDebugPreview,
      undefined,
      false
    );

    /**
     * Gather and validate form data
     * @returns {{type: string, title: string, description: string, email: string, includeDebug: boolean, errors: string[]}}
     */
    function gather() {
      const type = /** @type {HTMLSelectElement} */ (typeSelect).value;
      const rawTitle = /** @type {HTMLInputElement} */ (titleInput).value.trim();
      const rawDescription = /** @type {HTMLTextAreaElement} */ (descInput).value.trim();
      const rawEmail = /** @type {HTMLInputElement} */ (emailInput).value.trim();
      const includeDebugValue = /** @type {HTMLInputElement} */ (
        includeDebug.querySelector('input')
      ).checked;

      const errors = [];

      // Validate title
      if (!rawTitle) {
        errors.push(t('titleRequired'));
      } else if (rawTitle.length < 5) {
        errors.push(t('titleMin'));
      }

      // Validate description
      if (!rawDescription) {
        errors.push(t('descRequired'));
      } else if (rawDescription.length < 10) {
        errors.push(t('descMin'));
      }

      // Validate email if provided
      if (rawEmail && !isValidEmail(rawEmail)) {
        errors.push(t('invalidEmail'));
      }

      return {
        type,
        title: validateTitle(rawTitle),
        description: validateDescription(rawDescription),
        email: rawEmail && isValidEmail(rawEmail) ? rawEmail : '',
        includeDebug: includeDebugValue,
        errors,
      };
    }

    /**
     * Handle validation errors uniformly across all buttons
     * @param {{ errors?: string[] }} data - gather() result containing errors array
     * @returns {boolean} true if errors exist (and were shown), false otherwise
     */
    function handleValidationErrors(data) {
      if (data.errors && data.errors.length > 0) {
        const errorMsg = t('fixErrorsPrefix') + data.errors.join('\n• ');
        if (
          !showNotification_(errorMsg, {
            duration: 4000,
            type: 'error',
          })
        ) {
          window.YouTubeUtils?.logger?.warn?.('Report', 'Validation errors', data.errors);
        }
        return true;
      }
      return false;
    }

    /**
     * Set button to loading state (disabled, dimmed, with loading text)
     * @param {HTMLButtonElement} btn - Button element
     * @param {string} loadingLabel - Loading text to display (e.g., t('opening'))
     * @returns {string} Original text content
     */
    function setButtonLoading(btn, loadingLabel) {
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = loadingLabel;
      btn.style.opacity = '0.6';
      return originalText;
    }

    /**
     * Reset button after action (restore text, re-enable, fade back in after 2 seconds)
     * @param {HTMLButtonElement} btn - Button element
     * @param {string} originalText - Original text to restore
     */
    function resetButton(btn, originalText) {
      setTimeout_(() => {
        btn.disabled = false;
        btn.textContent = originalText;
        btn.style.opacity = '1';
      }, 2000);
    }

    window.YouTubePlusCleanupManager?.registerListener?.(
      submitBtn,
      'click',
      e => {
        e.preventDefault();
        if (submitBtn.disabled) return; // Prevent double-click

        try {
          const data = gather();
          if (handleValidationErrors(data)) return;

          const originalText = setButtonLoading(submitBtn, t('opening'));

          const payload = buildIssuePayload(data);
          openGitHubIssue(payload, issueKindFor(data.type));

          showNotification_(t('openingGithubNotification'), {
            duration: 2500,
          });

          resetButton(submitBtn, originalText);
        } catch (err) {
          logS(err);
          if (Y.logError) Y.logError('Report', 'Failed to open GitHub issue', err);
          showNotification_(t('failedOpenGithub'), {
            duration: 3000,
            type: 'error',
          });
          submitBtn.disabled = false;
          submitBtn.textContent = t('openGitHub');
          submitBtn.style.opacity = '1';
        }
      },
      undefined,
      false
    );

    window.YouTubePlusCleanupManager?.registerListener?.(
      copyBtn,
      'click',
      e => {
        e.preventDefault();
        if (copyBtn.disabled) return; // Prevent double-click

        try {
          const data = gather();
          if (handleValidationErrors(data)) return;

          const originalText = setButtonLoading(copyBtn, t('copying'));

          const payload = buildIssuePayload(data);
          const full = `Title: ${payload.title}\n\n${payload.body}`;

          copyToClipboard(full)
            .then(() => {
              showNotification_(t('reportCopied'), {
                duration: 2000,
              });
              copyBtn.textContent = t('copied');
              copyBtn.style.opacity = '1';
              resetButton(copyBtn, originalText);
            })
            .catch(err => {
              if (Y && typeof Y.logError === 'function') Y.logError('Report', 'copy failed', err);
              if (
                !showNotification_(t('copyFailed'), {
                  duration: 3000,
                  type: 'error',
                })
              ) {
                window.YouTubeUtils?.logger?.warn?.(
                  'Report',
                  'Copy failed; please copy manually',
                  err
                );
              }
              copyBtn.disabled = false;
              copyBtn.textContent = originalText;
              copyBtn.style.opacity = '1';
            });
        } catch (err) {
          logS(err);
          if (Y.logError) Y.logError('Report', 'Failed to copy report', err);
          copyBtn.disabled = false;
          copyBtn.textContent = t('copyReport');
          copyBtn.style.opacity = '1';
        }
      },
      undefined,
      false
    );

    window.YouTubePlusCleanupManager?.registerListener?.(
      emailBtn,
      'click',
      e => {
        e.preventDefault();
        if (emailBtn.disabled) return; // Prevent double-click

        try {
          const data = gather();
          if (handleValidationErrors(data)) return;

          const originalText = setButtonLoading(emailBtn, t('opening'));

          const payload = buildIssuePayload(data);
          const subject = payload.title;
          // No dedicated mail address in userscript; open mail client with prefilled body
          const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
            payload.body
          )}`;
          openMailClient(mailto);

          resetButton(emailBtn, originalText);
        } catch (err) {
          logS(err);
          if (Y.logError) Y.logError('Report', 'Failed to prepare email', err);
          emailBtn.disabled = false;
          emailBtn.textContent = t('prepareEmail');
          emailBtn.style.opacity = '1';
        }
      },
      undefined,
      false
    );
  }

  /** @param {string} url */
  function openMailClient(url) {
    const link = document.createElement('a');
    link.href = url;
    link.rel = 'noopener noreferrer';
    link.click();
  }

  // Public facade export.
  window.YouTubePlusReport = window.YouTubePlusReport || {
    render: renderReportSection,
  };
})();
