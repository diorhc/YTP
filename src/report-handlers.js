/**
 * Report Form Handlers Module
 * Extracted form handlers to reduce complexity in report.js
 */
(function () {
  'use strict';

  const Y = /** @type {any} */ (window).YouTubeUtils || {};

  /**
   * Gather and validate form data
   * @param {Object} elements - Form elements
   * @param {HTMLSelectElement} elements.typeSelect - Type select element
   * @param {HTMLInputElement} elements.titleInput - Title input element
   * @param {HTMLTextAreaElement} elements.descInput - Description input element
   * @param {HTMLInputElement} elements.emailInput - Email input element
   * @param {HTMLInputElement} elements.debugCheckbox - Debug checkbox element
   * @param {Function} t - Translation function
   * @param {Object} validators - Validator functions
   * @returns {{type: string, title: string, description: string, email: string, includeDebug: boolean, errors: string[]}}
   */
  function gatherFormData(elements, t, validators) {
    const { typeSelect, titleInput, descInput, emailInput, debugCheckbox } = elements;
    const { validateTitle, validateDescription, isValidEmail } = validators;

    const type = typeSelect.value;
    const rawTitle = titleInput.value.trim();
    const rawDescription = descInput.value.trim();
    const rawEmail = emailInput.value.trim();
    const includeDebug = debugCheckbox.checked;

    const errors = validateFormData({ rawTitle, rawDescription, rawEmail }, t, {
      validateTitle,
      validateDescription,
      isValidEmail,
    });

    return {
      type,
      title: validateTitle(rawTitle),
      description: validateDescription(rawDescription),
      email: rawEmail && isValidEmail(rawEmail) ? rawEmail : '',
      includeDebug,
      errors,
    };
  }

  /**
   * Validate form data
   * @param {Object} data - Form data
   * @param {string} data.rawTitle - Raw title
   * @param {string} data.rawDescription - Raw description
   * @param {string} data.rawEmail - Raw email
   * @param {Function} t - Translation function
   * @param {Object} validators - Validator functions
   * @returns {string[]} Array of error messages
   */
  function validateFormData(data, t, validators) {
    const { rawTitle, rawDescription, rawEmail } = data;
    const { isValidEmail } = validators;
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

    return errors;
  }

  /**
   * Show validation errors to user
   * @param {string[]} errors - Array of error messages
   * @param {Function} t - Translation function
   */
  function showValidationErrors(errors, t) {
    const errorMsg = t('fixErrorsPrefix') + errors.join('\n• ');
    if (Y.NotificationManager && typeof Y.NotificationManager.show === 'function') {
      Y.NotificationManager.show(errorMsg, { duration: 4000, type: 'error' });
    } else {
      console.warn('[YouTube+][Report] Validation errors:', errors);
    }
  }

  /**
   * Update button state
   * @param {HTMLButtonElement} button - Button element
   * @param {boolean} disabled - Disabled state
   * @param {string} text - Button text
   */
  function updateButtonState(button, disabled, text) {
    button.disabled = disabled;
    button.textContent = text;
    button.style.opacity = disabled ? '0.6' : '1';
  }

  /**
   * Reset button after delay
   * @param {HTMLButtonElement} button - Button element
   * @param {string} originalText - Original button text
   * @param {number} delay - Delay in milliseconds
   */
  function resetButtonAfterDelay(button, originalText, delay = 2000) {
    setTimeout(() => {
      updateButtonState(button, false, originalText);
    }, delay);
  }

  /**
   * Handle GitHub issue submission
   * @param {Event} e - Click event
   * @param {Object} elements - Form elements
   * @param {HTMLButtonElement} elements.submitBtn - Submit button
   * @param {Function} gather - Gather function
   * @param {Function} buildPayload - Build payload function
   * @param {Function} openGitHub - Open GitHub function
   * @param {Function} t - Translation function
   */
  function handleGitHubSubmit(e, elements, gather, buildPayload, openGitHub, t) {
    e.preventDefault();
    const { submitBtn } = elements;

    if (submitBtn.disabled) return;

    try {
      const data = gather();

      if (data.errors && data.errors.length > 0) {
        showValidationErrors(data.errors, t);
        return;
      }

      const originalText = submitBtn.textContent;
      updateButtonState(submitBtn, true, t('opening'));

      const payload = buildPayload(data);
      openGitHub(payload);

      if (Y.NotificationManager && typeof Y.NotificationManager.show === 'function') {
        Y.NotificationManager.show(t('openingGithubNotification'), { duration: 2500 });
      }

      resetButtonAfterDelay(submitBtn, originalText);
    } catch (err) {
      if (Y.logError) Y.logError('Report', 'Failed to open GitHub issue', err);
      if (Y.NotificationManager && typeof Y.NotificationManager.show === 'function') {
        Y.NotificationManager.show(t('failedOpenGithub'), { duration: 3000, type: 'error' });
      }
      updateButtonState(submitBtn, false, t('openGitHub'));
    }
  }

  /**
   * Handle copy to clipboard
   * @param {Event} e - Click event
   * @param {Object} elements - Form elements
   * @param {HTMLButtonElement} elements.copyBtn - Copy button
   * @param {Function} gather - Gather function
   * @param {Function} buildPayload - Build payload function
   * @param {Function} copyToClipboard - Copy function
   * @param {Function} t - Translation function
   */
  /**
   * Show notification if manager is available
   * @param {string} message - Message to show
   * @param {Object} options - Notification options
   * @returns {void}
   */
  function showNotification(message, options = {}) {
    if (Y.NotificationManager && typeof Y.NotificationManager.show === 'function') {
      Y.NotificationManager.show(message, options);
    }
  }

  /**
   * Handle successful copy operation
   * @param {HTMLButtonElement} copyBtn - Copy button
   * @param {string} originalText - Original button text
   * @param {Function} t - Translation function
   * @returns {void}
   */
  function handleCopySuccess(copyBtn, originalText, t) {
    showNotification(t('reportCopied'), { duration: 2000 });
    copyBtn.textContent = t('copied');
    copyBtn.style.opacity = '1';
    resetButtonAfterDelay(copyBtn, originalText);
  }

  /**
   * Handle copy operation error
   * @param {Error} err - Error object
   * @param {HTMLButtonElement} copyBtn - Copy button
   * @param {string} originalText - Original button text
   * @param {Function} t - Translation function
   * @returns {void}
   */
  function handleCopyError(err, copyBtn, originalText, t) {
    if (Y && typeof Y.logError === 'function') {
      Y.logError('Report', 'copy failed', err);
    }

    if (Y && Y.NotificationManager && typeof Y.NotificationManager.show === 'function') {
      Y.NotificationManager.show(t('copyFailed'), { duration: 3000, type: 'error' });
    } else {
      console.warn('Copy failed; please copy manually', err);
    }

    updateButtonState(copyBtn, false, originalText);
  }

  /**
   * Validate gathered data for errors
   * @param {Object} data - Gathered data
   * @param {Function} t - Translation function
   * @returns {boolean} True if validation failed
   */
  function hasValidationErrors(data, t) {
    if (data.errors && data.errors.length > 0) {
      showValidationErrors(data.errors, t);
      return true;
    }
    return false;
  }

  /**
   * Build report text from payload
   * @param {Object} payload - Report payload
   * @returns {string} Full report text
   */
  function buildReportText(payload) {
    return `Title: ${payload.title}\n\n${payload.body}`;
  }

  /**
   * Handle copy report button click
   * @param {Event} e - Click event
   * @param {Object} elements - Form elements
   * @param {HTMLButtonElement} elements.copyBtn - Copy button
   * @param {Function} gather - Gather function
   * @param {Function} buildPayload - Build payload function
   * @param {Function} copyToClipboard - Copy to clipboard function
   * @param {Function} t - Translation function
   * @returns {void}
   */
  function handleCopyReport(e, elements, gather, buildPayload, copyToClipboard, t) {
    e.preventDefault();
    const { copyBtn } = elements;

    if (copyBtn.disabled) return;

    try {
      const data = gather();
      if (hasValidationErrors(data, t)) return;

      const originalText = copyBtn.textContent;
      updateButtonState(copyBtn, true, t('copying'));

      const payload = buildPayload(data);
      const reportText = buildReportText(payload);

      copyToClipboard(reportText)
        .then(() => handleCopySuccess(copyBtn, originalText, t))
        .catch(err => handleCopyError(err, copyBtn, originalText, t));
    } catch (err) {
      if (Y.logError) Y.logError('Report', 'Failed to copy report', err);
      updateButtonState(copyBtn, false, t('copyReport'));
    }
  }

  /**
   * Handle email preparation
   * @param {Event} e - Click event
   * @param {Object} elements - Form elements
   * @param {HTMLButtonElement} elements.emailBtn - Email button
   * @param {Function} gather - Gather function
   * @param {Function} buildPayload - Build payload function
   * @param {Function} t - Translation function
   */
  function handleEmailReport(e, elements, gather, buildPayload, t) {
    e.preventDefault();
    const { emailBtn } = elements;

    if (emailBtn.disabled) return;

    try {
      const data = gather();

      if (data.errors && data.errors.length > 0) {
        showValidationErrors(data.errors, t);
        return;
      }

      const originalText = emailBtn.textContent;
      updateButtonState(emailBtn, true, t('opening'));

      const payload = buildPayload(data);
      const subject = payload.title;
      const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
        payload.body
      )}`;
      window.location.href = mailto;

      resetButtonAfterDelay(emailBtn, originalText);
    } catch (err) {
      if (Y.logError) Y.logError('Report', 'Failed to prepare email', err);
      updateButtonState(emailBtn, false, t('prepareEmail'));
    }
  }

  /**
   * Update debug preview based on checkbox state
   * @param {HTMLInputElement} debugCheckbox - Debug checkbox element
   * @param {HTMLElement} debugPreview - Debug preview element
   * @param {Function} getDebugInfo - Get debug info function
   * @param {Function} mk - Element creator function
   */
  function updateDebugPreview(debugCheckbox, debugPreview, getDebugInfo, mk) {
    try {
      if (debugCheckbox.checked) {
        const d = getDebugInfo();
        debugPreview.innerHTML = '';

        // Create header with important fields
        const header = createDebugHeader(d, mk);
        debugPreview.appendChild(header);

        // Add collapsible sections
        if (d.settings) {
          debugPreview.appendChild(createSettingsSection(d.settings, mk));
        }
        debugPreview.appendChild(createFullDebugSection(d, mk));

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

  /**
   * Create debug header section
   * @param {Object} d - Debug info
   * @param {Function} mk - Element creator function
   * @returns {HTMLElement} Header element
   */
  function createDebugHeader(d, mk) {
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
    const urlEl = createUrlElement(urlStr, mk);
    header.appendChild(mk('div', {}, ['URL: ', urlEl]));

    header.appendChild(mk('div', {}, ['Language: ', mk('code', {}, [String(d.language || '')])]));

    return header;
  }

  /**
   * Create URL element (link or text)
   * @param {string} urlStr - URL string
   * @param {Function} mk - Element creator function
   * @returns {HTMLElement} URL element
   */
  function createUrlElement(urlStr, mk) {
    try {
      if (/^https?:\/\//i.test(urlStr)) {
        return mk(
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
      if (Y && typeof Y.logError === 'function') {
        Y.logError('Report', 'URL link creation failed', e);
      }
    }
    return mk('span', {}, [String(urlStr)]);
  }

  /**
   * Create settings section
   * @param {Object} settings - Settings object
   * @param {Function} mk - Element creator function
   * @returns {HTMLElement} Settings element
   */
  function createSettingsSection(settings, mk) {
    const settingsDetails = mk('details', {}, [mk('summary', {}, ['Settings'])]);
    settingsDetails.appendChild(
      mk('pre', { style: 'white-space:pre-wrap;margin:6px 0 0 0;font-size:11px;' }, [
        JSON.stringify(settings, null, 2),
      ])
    );
    return settingsDetails;
  }

  /**
   * Create full debug JSON section
   * @param {Object} d - Debug info
   * @param {Function} mk - Element creator function
   * @returns {HTMLElement} Full debug element
   */
  function createFullDebugSection(d, mk) {
    const fullDetails = mk('details', {}, [mk('summary', {}, ['Full debug JSON'])]);
    fullDetails.appendChild(
      mk('pre', { style: 'white-space:pre-wrap;margin:6px 0 0 0;font-size:11px;' }, [
        JSON.stringify(d, null, 2),
      ])
    );
    return fullDetails;
  }

  // Export handlers to global namespace
  if (typeof window !== 'undefined') {
    window.YouTubeReportHandlers = {
      gatherFormData,
      validateFormData,
      showValidationErrors,
      updateButtonState,
      resetButtonAfterDelay,
      handleGitHubSubmit,
      handleCopyReport,
      handleEmailReport,
      updateDebugPreview,
      createDebugHeader,
      createUrlElement,
      createSettingsSection,
      createFullDebugSection,
    };
  }
})();
