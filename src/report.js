/* Report module: populates the settings 'report' section and provides report submission helpers.
 * Features:
 * - Small reporting form (type, title, description, email optional)
 * - Prepares debug info (version, UA, page URL, settings snapshot)
 * - Opens a prefilled GitHub issue in a new tab or copies the report to clipboard
 * - Designed to work in a userscript (no server required)
 */
(function () {
  'use strict';

  // Minimal guards for shared utils
  const Y = /** @type {any} */ (window).YouTubeUtils || {};

  // Internationalization for report module
  const i18n = {
    en: {
      shortTitle: 'Short title (one line)',
      emailOptional: 'Your email (optional)',
      descriptionPlaceholder: 'Describe the issue, steps to reproduce, expected vs actual',
      includeDebug: 'Include debug info (version, URL, settings)',
      openGitHub: 'Open GitHub Issue',
      copyReport: 'Copy Report',
      prepareEmail: 'Prepare Email',
      privacy:
        'By submitting you agree to include the provided information. Do not include passwords or personal tokens.',
      typeBug: 'Bug / Error',
      typeFeature: 'Feature Request',
      typeOther: 'Other',
      titleRequired: 'Title is required',
      titleMin: 'Title must be at least 5 characters',
      descRequired: 'Description is required',
      descMin: 'Description must be at least 10 characters',
      invalidEmail: 'Invalid email format',
      fixErrorsPrefix: 'Please fix the following errors:\n• ',
      opening: 'Opening...',
      copying: 'Copying...',
      copied: 'Copied!',
      openingGithubNotification: 'Opening GitHub in a new tab',
      failedOpenGithub: 'Failed to open GitHub issue',
      reportCopied: 'Report copied to clipboard',
      copyFailed: 'Copy failed — please copy manually',
    },
    ru: {
      shortTitle: 'Краткий заголовок (в одну строку)',
      emailOptional: 'Ваш email (необязательно)',
      descriptionPlaceholder:
        'Опишите проблему, шаги для воспроизведения, ожидаемое и фактическое поведение',
      includeDebug: 'Включить отладочную информацию (версия, URL, настройки)',
      openGitHub: 'Открыть заявку на GitHub',
      copyReport: 'Копировать отчет',
      prepareEmail: 'Подготовить письмо',
      privacy:
        'Отправляя, вы соглашаетесь включить указанную информацию. Не включайте пароли или личные токены.',
      typeBug: 'Ошибка',
      typeFeature: 'Запрос функции',
      typeOther: 'Другое',
      titleRequired: 'Требуется заголовок',
      titleMin: 'Заголовок должен быть не менее 5 символов',
      descRequired: 'Требуется описание',
      descMin: 'Описание должно быть не менее 10 символов',
      invalidEmail: 'Неправильный формат email',
      fixErrorsPrefix: 'Пожалуйста, исправьте следующие ошибки:\n• ',
      opening: 'Открываю...',
      copying: 'Копирую...',
      copied: 'Скопировано!',
      openingGithubNotification: 'Открываю GitHub в новой вкладке',
      failedOpenGithub: 'Не удалось открыть заявку на GitHub',
      reportCopied: 'Отчет скопирован в буфер обмена',
      copyFailed: 'Копирование не удалось — пожалуйста, скопируйте вручную',
    },
  };

  // Get browser language
  function getLanguage() {
    const lang = document.documentElement.lang || navigator.language || 'en';
    return lang.startsWith('ru') ? 'ru' : 'en';
  }

  /**
   * Translation function
   * @param {string} key - Translation key
   * @returns {string} Translated text
   */
  function t(key) {
    const lang = getLanguage();
    return i18n[lang]?.[key] || i18n.en[key] || key;
  }

  /**
   * Create DOM element with properties and children
   * @param {string} tag - HTML tag name
   * @param {Object} props - Element properties
   * @param {Array} children - Child elements or text
   * @returns {HTMLElement} Created element
   */
  function mk(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === 'class') {
        el.className = /** @type {string} */ (v);
      } else if (k === 'html') {
        el.innerHTML = /** @type {string} */ (v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.substring(2).toLowerCase(), /** @type {EventListener} */ (v));
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
   * Sanitize HTML to prevent XSS attacks
   * @param {string} html - HTML string to sanitize
   * @returns {string} Sanitized HTML
   */
  function sanitizeHTML(html) {
    if (Y.sanitizeHTML && typeof Y.sanitizeHTML === 'function') {
      return Y.sanitizeHTML(html);
    }
    // Fallback sanitizer
    if (typeof html !== 'string') return '';
    const map = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;',
      '`': '&#x60;',
      '=': '&#x3D;',
    };
    return html.replace(/[<>&"'\/`=]/g, char => map[char] || char);
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
  function getDebugInfo() {
    try {
      const debug = {
        version: /** @type {any} */ (window.YouTubePlusDebug || {}).version || 'unknown',
        userAgent: navigator.userAgent || 'unknown',
        url: location.href || 'unknown',
        language: document.documentElement.lang || navigator.language || 'unknown',
        settings: typeof Y.SettingsManager === 'object' ? Y.SettingsManager.load() : null,
      };
      return debug;
    } catch (err) {
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
        if (Y && typeof Y.logError === 'function') {
          Y.logError('Report', 'Failed to stringify debug info', err);
        }
        // Fallback to minimal debug info
        const minimalDebug = {
          version: debug.version || 'unknown',
          userAgent: debug.userAgent || 'unknown',
          url: debug.url || 'unknown',
        };
        try {
          lines.push(JSON.stringify(minimalDebug, null, 2));
        } catch {
          lines.push('{ "error": "Failed to stringify debug info" }');
        }
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
   * Open GitHub issue in a new tab
   * @param {{title: string, body: string}} payload - Issue payload
   */
  function openGitHubIssue(payload) {
    try {
      // Repository configured for issue creation
      const repoOwner = 'diorhc';
      const repo = 'YTP';
      const url = `https://github.com/${repoOwner}/${repo}/issues/new?title=${encodeURIComponent(
        payload.title
      )}&body=${encodeURIComponent(payload.body)}`;
      window.open(url, '_blank');
    } catch (err) {
      if (Y && typeof Y.logError === 'function') {
        Y.logError('Report', 'Failed to open GitHub issue', err);
      }
      throw err;
    }
  }

  /**
   * Copy text to clipboard with fallback
   * @param {string} text - Text to copy
   * @returns {Promise<void>} Promise that resolves when copied
   */
  function copyToClipboard(text) {
    // Modern clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
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
    if (!modal || !modal.querySelector) return;

    const section = modal.querySelector('.ytp-plus-settings-section[data-section="report"]');
    if (!section) return;

    // Clear existing content and build a small form
    section.innerHTML = '';

    const form = mk('div', {
      style:
        'display:flex;flex-direction:column;gap:var(--yt-space-sm);margin-top:var(--yt-space-md);',
    });

    const typeSelect = mk(
      'select',
      {
        style:
          'padding:var(--yt-space-sm);border-radius:var(--yt-radius-sm);background:var(--yt-input-bg);color:var(--yt-text-primary);border:1px solid var(--yt-glass-border);backdrop-filter:var(--yt-glass-blur-light);-webkit-backdrop-filter:var(--yt-glass-blur-light);font-size:14px;cursor:pointer;transition:var(--yt-transition);',
      },
      []
    );
    [
      { v: 'bug', l: t('typeBug') },
      { v: 'feature', l: t('typeFeature') },
      { v: 'other', l: t('typeOther') },
    ].forEach(opt => {
      const o = mk('option', { value: opt.v }, [opt.l]);
      typeSelect.appendChild(o);
    });

    const inputStyle =
      'padding:var(--yt-space-sm);border-radius:var(--yt-radius-sm);background:var(--yt-input-bg);color:var(--yt-text-primary);border:1px solid var(--yt-glass-border);backdrop-filter:var(--yt-glass-blur-light);-webkit-backdrop-filter:var(--yt-glass-blur-light);font-size:14px;transition:var(--yt-transition);box-sizing:border-box;';

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
      style: inputStyle + 'resize:vertical;font-family:inherit;',
    });

    // checkbox input is created separately so we can listen to changes and show a preview
    const debugCheckboxInput = mk('input', {
      type: 'checkbox',
      class: 'ytp-plus-settings-checkbox',
    });
    const includeDebug = mk(
      'label',
      {
        style:
          'font-size:13px;display:flex;gap:var(--yt-space-sm);align-items:center;color:var(--yt-text-primary);cursor:pointer;align-self:center;',
      },
      [debugCheckboxInput, ' ' + t('includeDebug')]
    );

    const actions = mk('div', {
      style: 'display:flex;gap:var(--yt-space-sm);margin-top:var(--yt-space-sm);flex-wrap:wrap;',
    });
    const submitBtn = mk('button', { class: 'glass-button' }, [t('openGitHub')]);
    const copyBtn = mk('button', { class: 'glass-button' }, [t('copyReport')]);
    const emailBtn = mk('button', { class: 'glass-button' }, [t('prepareEmail')]);

    actions.appendChild(submitBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(emailBtn);

    form.appendChild(typeSelect);
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
        class: 'ytp-plus-settings-item-description',
        style: 'margin-top:var(--yt-space-sm);font-size:12px;color:var(--yt-text-secondary);',
      },
      [t('privacy')]
    );

    section.appendChild(form);
    section.appendChild(privacy);

    // (debugPreview is appended inside the form, directly under the checkbox)

    /**
     * Update debug preview based on checkbox state
     */
    function updateDebugPreview() {
      try {
        if (debugCheckboxInput.checked) {
          const d = getDebugInfo();

          // Clear previous content
          debugPreview.innerHTML = '';

          // Header with important fields
          const header = mk(
            'div',
            { style: 'display:flex;flex-direction:column;gap:6px;margin-bottom:6px;' },
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
          try {
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
          } catch (e) {
            // leave as plain text if anything odd and log
            if (Y && typeof Y.logError === 'function') {
              Y.logError('Report', 'URL link creation failed', e);
            }
            urlEl = mk('span', {}, [String(urlStr)]);
          }
          header.appendChild(mk('div', {}, ['URL: ', urlEl]));
          header.appendChild(
            mk('div', {}, ['Language: ', mk('code', {}, [String(d.language || '')])])
          );

          debugPreview.appendChild(header);

          // Settings (if available) – collapsible
          if (d.settings) {
            const settingsDetails = mk('details', {}, [mk('summary', {}, ['Settings'])]);
            settingsDetails.appendChild(
              mk('pre', { style: 'white-space:pre-wrap;margin:6px 0 0 0;font-size:11px;' }, [
                JSON.stringify(d.settings, null, 2),
              ])
            );
            debugPreview.appendChild(settingsDetails);
          }

          // Full debug JSON (collapsible)
          const fullDetails = mk('details', {}, [mk('summary', {}, ['Full debug JSON'])]);
          fullDetails.appendChild(
            mk('pre', { style: 'white-space:pre-wrap;margin:6px 0 0 0;font-size:11px;' }, [
              JSON.stringify(d, null, 2),
            ])
          );
          debugPreview.appendChild(fullDetails);

          debugPreview.style.display = 'block';
        } else {
          debugPreview.innerHTML = '';
          debugPreview.style.display = 'none';
        }
      } catch (err) {
        if (Y && typeof Y.logError === 'function') {
          Y.logError('Report', 'updateDebugPreview failed', err);
        }
      }
    }

    // wire up checkbox to preview
    debugCheckboxInput.addEventListener('change', updateDebugPreview);

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

    submitBtn.addEventListener('click', e => {
      e.preventDefault();
      if (submitBtn.disabled) return; // Prevent double-click

      try {
        const data = gather();

        // Check for validation errors
        if (data.errors && data.errors.length > 0) {
          const errorMsg = t('fixErrorsPrefix') + data.errors.join('\n• ');
          if (Y.NotificationManager && typeof Y.NotificationManager.show === 'function') {
            Y.NotificationManager.show(errorMsg, { duration: 4000, type: 'error' });
          } else {
            console.warn('[Report] Validation errors:', data.errors);
          }
          return;
        }

        // Add loading state
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = t('opening');
        submitBtn.style.opacity = '0.6';

        const payload = buildIssuePayload(data);
        openGitHubIssue(payload);

        if (Y.NotificationManager && typeof Y.NotificationManager.show === 'function') {
          Y.NotificationManager.show(t('openingGithubNotification'), { duration: 2500 });
        }

        // Reset button after a delay
        setTimeout(() => {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
          submitBtn.style.opacity = '1';
        }, 2000);
      } catch (err) {
        if (Y.logError) Y.logError('Report', 'Failed to open GitHub issue', err);
        if (Y.NotificationManager && typeof Y.NotificationManager.show === 'function') {
          Y.NotificationManager.show(t('failedOpenGithub'), {
            duration: 3000,
            type: 'error',
          });
        }
        submitBtn.disabled = false;
        submitBtn.textContent = t('openGitHub');
        submitBtn.style.opacity = '1';
      }
    });

    copyBtn.addEventListener('click', e => {
      e.preventDefault();
      if (copyBtn.disabled) return; // Prevent double-click

      try {
        const data = gather();

        // Check for validation errors
        if (data.errors && data.errors.length > 0) {
          const errorMsg = t('fixErrorsPrefix') + data.errors.join('\n• ');
          if (Y.NotificationManager && typeof Y.NotificationManager.show === 'function') {
            Y.NotificationManager.show(errorMsg, { duration: 4000, type: 'error' });
          } else {
            console.warn('[Report] Validation errors:', data.errors);
          }
          return;
        }

        // Add loading state
        const originalText = copyBtn.textContent;
        copyBtn.disabled = true;
        copyBtn.textContent = t('copying');
        copyBtn.style.opacity = '0.6';

        const payload = buildIssuePayload(data);
        const full = `Title: ${payload.title}\n\n${payload.body}`;

        copyToClipboard(full)
          .then(() => {
            if (Y.NotificationManager && typeof Y.NotificationManager.show === 'function') {
              Y.NotificationManager.show(t('reportCopied'), { duration: 2000 });
            }
            copyBtn.textContent = t('copied');
            copyBtn.style.opacity = '1';
            setTimeout(() => {
              copyBtn.disabled = false;
              copyBtn.textContent = originalText;
            }, 2000);
          })
          .catch(err => {
            if (Y && typeof Y.logError === 'function') Y.logError('Report', 'copy failed', err);
            if (Y && Y.NotificationManager && typeof Y.NotificationManager.show === 'function') {
              Y.NotificationManager.show(t('copyFailed'), {
                duration: 3000,
                type: 'error',
              });
            } else {
              console.warn('Copy failed; please copy manually', err);
            }
            copyBtn.disabled = false;
            copyBtn.textContent = originalText;
            copyBtn.style.opacity = '1';
          });
      } catch (err) {
        if (Y.logError) Y.logError('Report', 'Failed to copy report', err);
        copyBtn.disabled = false;
        copyBtn.textContent = t('copyReport');
        copyBtn.style.opacity = '1';
      }
    });

    emailBtn.addEventListener('click', e => {
      e.preventDefault();
      if (emailBtn.disabled) return; // Prevent double-click

      try {
        const data = gather();

        // Check for validation errors
        if (data.errors && data.errors.length > 0) {
          const errorMsg = t('fixErrorsPrefix') + data.errors.join('\n• ');
          if (Y.NotificationManager && typeof Y.NotificationManager.show === 'function') {
            Y.NotificationManager.show(errorMsg, { duration: 4000, type: 'error' });
          } else {
            console.warn('[Report] Validation errors:', data.errors);
          }
          return;
        }

        const originalText = emailBtn.textContent;
        emailBtn.disabled = true;
        emailBtn.textContent = t('opening');
        emailBtn.style.opacity = '0.6';

        const payload = buildIssuePayload(data);
        const subject = payload.title;
        // No dedicated mail address in userscript; open mail client with prefilled body
        const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
          payload.body
        )}`;
        window.location.href = mailto;

        setTimeout(() => {
          emailBtn.disabled = false;
          emailBtn.textContent = originalText;
          emailBtn.style.opacity = '1';
        }, 2000);
      } catch (err) {
        if (Y.logError) Y.logError('Report', 'Failed to prepare email', err);
        emailBtn.disabled = false;
        emailBtn.textContent = t('prepareEmail');
        emailBtn.style.opacity = '1';
      }
    });
  }

  // Expose render function
  try {
    /** @type {any} */ (window).youtubePlusReport =
      /** @type {any} */ (window).youtubePlusReport || {};
    /** @type {any} */ (window).youtubePlusReport.render = renderReportSection;
  } catch (e) {
    if (Y.logError) Y.logError('Report', 'Failed to attach report module to window', e);
  }
})();
