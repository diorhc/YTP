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

  // Use centralized i18n for report module
  const _globalI18n_report =
    typeof window !== 'undefined' && window.YouTubePlusI18n ? window.YouTubePlusI18n : null;
  /**
   * Translation function for this module
   * Delegates to global i18n when available, otherwise performs simple param replacement
   */
  function t(key, params = {}) {
    try {
      if (_globalI18n_report && typeof _globalI18n_report.t === 'function') {
        return _globalI18n_report.t(key, params);
      }
      if (
        typeof window !== 'undefined' &&
        window.YouTubeUtils &&
        typeof window.YouTubeUtils.t === 'function'
      ) {
        return window.YouTubeUtils.t(key, params);
      }
    } catch {
      // fallback
    }
    if (!key || typeof key !== 'string') return '';
    // Fallback to embedded English strings when global i18n not available
    const FALLBACK_EN = {
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
    };

    let template = FALLBACK_EN[key] || key;
    if (Object.keys(params).length === 0) return template;
    for (const [k, v] of Object.entries(params)) {
      template = template.split(`{${k}}`).join(String(v));
    }
    return template;
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
   * Get fallback debug info on error
   * @returns {Object} Minimal debug info
   */
  function getFallbackDebugInfo() {
    return {
      version: 'unknown',
      userAgent: 'unknown',
      url: 'unknown',
      language: 'unknown',
      settings: null,
      error: 'Failed to collect debug info',
    };
  }

  /**
   * Get version from debug info
   * @returns {string} Version string
   */
  function getVersion() {
    return /** @type {any} */ (window.YouTubePlusDebug || {}).version || 'unknown';
  }

  /**
   * Get settings snapshot
   * @returns {Object|null} Settings object or null
   */
  function getSettings() {
    return typeof Y.SettingsManager === 'object' ? Y.SettingsManager.load() : null;
  }

  /**
   * Get document language
   * @returns {string} Language code
   */
  function getLanguage() {
    return document.documentElement.lang || navigator.language || 'unknown';
  }

  /**
   * Collect debug information for reports
   * @returns {Object} Debug information object
   */
  function getDebugInfo() {
    try {
      return {
        version: getVersion(),
        userAgent: navigator.userAgent || 'unknown',
        url: location.href || 'unknown',
        language: getLanguage(),
        settings: getSettings(),
      };
    } catch (err) {
      if (Y && typeof Y.logError === 'function') {
        Y.logError('Report', 'Failed to collect debug info', err);
      }
      return getFallbackDebugInfo();
    }
  }

  /**
   * Get type label from type string
   * @param {string} type - Type string (bug/feature/other)
   * @returns {string} Translated label
   */
  function getTypeLabel(type) {
    const typeMap = {
      bug: t('typeBug'),
      feature: t('typeFeature'),
      other: t('typeOther'),
    };
    return typeMap[type] || typeMap.other;
  }

  /**
   * Get issue title prefix from type
   * @param {string} type - Type string
   * @returns {string} Title prefix
   */
  function getTitlePrefix(type) {
    const prefixMap = {
      bug: '[Bug]',
      feature: '[Feature]',
      other: '[YouTube+][Report]',
    };
    return prefixMap[type] || prefixMap.other;
  }

  /**
   * Create minimal debug info on stringify error
   * @param {Object} debug - Full debug object
   * @returns {string} JSON string
   */
  function createMinimalDebugJson(debug) {
    const minimalDebug = {
      version: debug.version || 'unknown',
      userAgent: debug.userAgent || 'unknown',
      url: debug.url || 'unknown',
    };
    try {
      return JSON.stringify(minimalDebug, null, 2);
    } catch {
      return '{ "error": "Failed to stringify debug info" }';
    }
  }

  /**
   * Stringify debug info with fallback
   * @param {Object} debug - Debug object
   * @returns {string} JSON string
   */
  function stringifyDebugInfo(debug) {
    try {
      return JSON.stringify(debug, null, 2);
    } catch (err) {
      if (Y && typeof Y.logError === 'function') {
        Y.logError('Report', 'Failed to stringify debug info', err);
      }
      return createMinimalDebugJson(debug);
    }
  }

  /**
   * Add debug section to lines
   * @param {Array<string>} lines - Lines array
   * @param {Object} debug - Debug object
   */
  function addDebugSection(lines, debug) {
    lines.push('\n---\n**Debug info**\n');
    lines.push('```json');
    lines.push(stringifyDebugInfo(debug));
    lines.push('```');
    lines.push('\n_Please do not include sensitive personal data._');
  }

  /**
   * Build issue body lines
   * @param {Object} params - Report parameters
   * @returns {Array<string>} Body lines
   */
  function buildBodyLines({ type, description, email, includeDebug }) {
    const debug = includeDebug ? getDebugInfo() : null;
    const lines = [];

    lines.push(`**Type:** ${getTypeLabel(type)}`);
    if (email) lines.push(`**Reporter email (optional):** ${email}`);
    lines.push('\n**Description:**\n');
    lines.push(description || '(no description)');

    if (debug) {
      addDebugSection(lines, debug);
    }

    return lines;
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
  function buildIssuePayload(params) {
    const { type, title } = params;
    const lines = buildBodyLines(params);
    const body = lines.join('\n');
    const issueTitle = `${getTitlePrefix(type)} ${title || ''}`.trim();
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
   * Create type selection dropdown
   * @returns {HTMLElement} Type select element
   */
  function createTypeSelect() {
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
    return typeSelect;
  }

  /**
   * Create form input elements
   * @returns {{titleInput: HTMLElement, emailInput: HTMLElement, descInput: HTMLElement}}
   */
  function createFormInputs() {
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
      style: `${inputStyle}resize:vertical;font-family:inherit;`,
    });

    return { titleInput, emailInput, descInput };
  }

  /**
   * Create debug checkbox with label
   * @returns {{includeDebug: HTMLElement, debugCheckboxInput: HTMLElement}}
   */
  function createDebugCheckbox() {
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
      [debugCheckboxInput, ` ${t('includeDebug')}`]
    );
    return { includeDebug, debugCheckboxInput };
  }

  /**
   * Create action buttons for form
   * @returns {{actions: HTMLElement, submitBtn: HTMLElement, copyBtn: HTMLElement, emailBtn: HTMLElement}}
   */
  function createActionButtons() {
    const actions = mk('div', {
      style: 'display:flex;gap:var(--yt-space-sm);margin-top:var(--yt-space-sm);flex-wrap:wrap;',
    });
    const submitBtn = mk('button', { class: 'glass-button' }, [t('openGitHub')]);
    const copyBtn = mk('button', { class: 'glass-button' }, [t('copyReport')]);
    const emailBtn = mk('button', { class: 'glass-button' }, [t('prepareEmail')]);

    actions.appendChild(submitBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(emailBtn);

    return { actions, submitBtn, copyBtn, emailBtn };
  }

  /**
   * Create debug preview area
   * @returns {HTMLElement} Debug preview element
   */
  function createDebugPreview() {
    return mk(
      'div',
      {
        class: 'glass-card',
        style:
          'overflow:auto;max-height:240px;font-size:11px;display:none;margin-top:var(--yt-space-sm);padding:8px;box-sizing:border-box;',
      },
      []
    );
  }

  /**
   * Render report section in settings modal with glassmorphism styling
   * @param {HTMLElement} modal - Settings modal element
   */
  /**
   * Render report section in settings modal
   * Refactored to use helper functions and reduce complexity
   * @param {HTMLElement} modal - Settings modal element
   */
  function renderReportSection(modal) {
    if (!modal || !modal.querySelector) return;

    const section = modal.querySelector('.ytp-plus-settings-section[data-section="report"]');
    if (!section) return;

    // Use report handlers module. In test or CommonJS environments the handlers
    // may not have been loaded yet, so try to require the module as a fallback.
    let handlers = window.YouTubeReportHandlers || {};
    if (!handlers.gatherFormData) {
      try {
        // In node/jest environment require will load and attach handlers to window
        require('./report-handlers.js');
      } catch (err) {
        // ignore - we'll handle missing handlers below; reference err to satisfy linters
        if (err) {
          /* intentionally empty */
        }
      }
      handlers = window.YouTubeReportHandlers || {};
      if (!handlers.gatherFormData) {
        if (Y.logError) {
          Y.logError('Report', 'YouTubeReportHandlers not loaded', new Error('Missing handlers'));
        }
        return;
      }
    }

    // Clear existing content and build form
    section.innerHTML = '';

    const form = mk('div', {
      style:
        'display:flex;flex-direction:column;gap:var(--yt-space-sm);margin-top:var(--yt-space-md);',
    });

    // Create form elements
    const typeSelect = createTypeSelect();
    const { titleInput, emailInput, descInput } = createFormInputs();
    const { includeDebug, debugCheckboxInput } = createDebugCheckbox();
    const { actions, submitBtn, copyBtn, emailBtn } = createActionButtons();
    const debugPreview = createDebugPreview();

    // Assemble form
    form.appendChild(typeSelect);
    form.appendChild(titleInput);
    form.appendChild(emailInput);
    form.appendChild(descInput);
    form.appendChild(includeDebug);
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

    // Gather form data function
    const gather = () =>
      handlers.gatherFormData(
        { typeSelect, titleInput, descInput, emailInput, debugCheckbox: debugCheckboxInput },
        t,
        { validateTitle, validateDescription, isValidEmail }
      );

    // Wire up checkbox to debug preview
    debugCheckboxInput.addEventListener('change', () =>
      handlers.updateDebugPreview(debugCheckboxInput, debugPreview, getDebugInfo, mk)
    );

    // Wire up event handlers
    submitBtn.addEventListener('click', e =>
      handlers.handleGitHubSubmit(e, { submitBtn }, gather, buildIssuePayload, openGitHubIssue, t)
    );

    copyBtn.addEventListener('click', e =>
      handlers.handleCopyReport(e, { copyBtn }, gather, buildIssuePayload, copyToClipboard, t)
    );

    emailBtn.addEventListener('click', e =>
      handlers.handleEmailReport(e, { emailBtn }, gather, buildIssuePayload, t)
    );
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
