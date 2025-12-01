/**
 * Modal Utility Module
 * Extracted utilities for modal creation and handling
 */

window.YouTubePlusModalUtils = (() => {
  'use strict';

  /**
   * Create modal backdrop
   * @returns {HTMLElement}
   */
  function createBackdrop() {
    const DOMUtils = window.YouTubePlusDOMUtils;

    const backdrop =
      DOMUtils && DOMUtils.createElement
        ? DOMUtils.createElement('div', { className: 'ytp-modal-backdrop' })
        : document.createElement('div');

    if (!DOMUtils) {
      backdrop.className = 'ytp-modal-backdrop';
    }

    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) {
        closeModal(backdrop.nextElementSibling);
      }
    });

    return backdrop;
  }

  /**
   * Create modal header
   * @param {string} title - Modal title
   * @param {boolean} closeable - Show close button
   * @returns {HTMLElement}
   */
  function createModalHeader(title, closeable = true) {
    const DOMUtils = window.YouTubePlusDOMUtils;

    const header =
      DOMUtils && DOMUtils.createElement
        ? DOMUtils.createElement('div', { className: 'ytp-modal-header' })
        : document.createElement('div');

    if (!DOMUtils) {
      header.className = 'ytp-modal-header';
    }

    const titleEl = document.createElement('h3');
    titleEl.textContent = title;
    header.appendChild(titleEl);

    if (closeable) {
      const closeBtn =
        DOMUtils && DOMUtils.createButton
          ? DOMUtils.createButton({
              text: '×',
              className: 'ytp-modal-close',
              ariaLabel: 'Close',
            })
          : document.createElement('button');

      if (!DOMUtils) {
        closeBtn.className = 'ytp-modal-close';
        closeBtn.textContent = '×';
        closeBtn.setAttribute('aria-label', 'Close');
      }

      closeBtn.addEventListener('click', () => {
        const modal = header.closest('.ytp-modal');
        if (modal) closeModal(modal);
      });

      header.appendChild(closeBtn);
    }

    return header;
  }

  /**
   * Create modal body
   * @param {string|HTMLElement} content - Modal content
   * @returns {HTMLElement}
   */
  function createModalBody(content) {
    const DOMUtils = window.YouTubePlusDOMUtils;

    const body =
      DOMUtils && DOMUtils.createElement
        ? DOMUtils.createElement('div', { className: 'ytp-modal-body' })
        : document.createElement('div');

    if (!DOMUtils) {
      body.className = 'ytp-modal-body';
    }

    if (typeof content === 'string') {
      body.textContent = content;
    } else if (content instanceof HTMLElement) {
      body.appendChild(content);
    }

    return body;
  }

  /**
   * Create modal footer
   * @param {Array<Object>} buttons - Array of button configs
   * @returns {HTMLElement}
   */
  function createModalFooter(buttons = []) {
    const DOMUtils = window.YouTubePlusDOMUtils;

    const footer =
      DOMUtils && DOMUtils.createElement
        ? DOMUtils.createElement('div', { className: 'ytp-modal-footer' })
        : document.createElement('div');

    if (!DOMUtils) {
      footer.className = 'ytp-modal-footer';
    }

    buttons.forEach(btnConfig => {
      const btn =
        DOMUtils && DOMUtils.createButton
          ? DOMUtils.createButton({
              text: btnConfig.text,
              className: btnConfig.className || 'ytp-btn',
              onClick: btnConfig.onClick,
            })
          : document.createElement('button');

      if (!DOMUtils) {
        btn.className = btnConfig.className || 'ytp-btn';
        btn.textContent = btnConfig.text;
        if (btnConfig.onClick) {
          btn.addEventListener('click', btnConfig.onClick);
        }
      }

      footer.appendChild(btn);
    });

    return footer;
  }

  /**
   * Create modal element
   * @param {Object} options - Modal options
   * @returns {HTMLElement}
   */
  function createModal({
    title = '',
    content = '',
    buttons = [],
    className = '',
    closeable = true,
  } = {}) {
    const DOMUtils = window.YouTubePlusDOMUtils;

    const modal =
      DOMUtils && DOMUtils.createElement
        ? DOMUtils.createElement('div', { className: `ytp-modal ${className}` })
        : document.createElement('div');

    if (!DOMUtils) {
      modal.className = `ytp-modal ${className}`;
    }

    if (title) {
      modal.appendChild(createModalHeader(title, closeable));
    }

    if (content) {
      modal.appendChild(createModalBody(content));
    }

    if (buttons.length > 0) {
      modal.appendChild(createModalFooter(buttons));
    }

    return modal;
  }

  /**
   * Show modal
   * @param {HTMLElement} modal - Modal element
   * @param {boolean} withBackdrop - Show backdrop
   */
  function showModal(modal, withBackdrop = true) {
    if (!modal) return;

    if (withBackdrop) {
      const backdrop = createBackdrop();
      document.body.appendChild(backdrop);
    }

    document.body.appendChild(modal);
    modal.classList.add('ytp-modal-visible');

    // Focus first focusable element
    const focusable = modal.querySelector('button, input, textarea, select');
    if (focusable) {
      focusable.focus();
    }

    // Handle escape key
    const handleEscape = e => {
      if (e.key === 'Escape') {
        closeModal(modal);
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  }

  /**
   * Close modal
   * @param {HTMLElement} modal - Modal element
   */
  function closeModal(modal) {
    if (!modal) return;

    modal.classList.remove('ytp-modal-visible');

    setTimeout(() => {
      modal.remove();

      // Remove backdrop
      const backdrop = document.querySelector('.ytp-modal-backdrop');
      if (backdrop) backdrop.remove();
    }, 300);
  }

  /**
   * Check if value is empty
   * @param {*} value - Value to check
   * @returns {boolean}
   */
  function isEmpty(value) {
    return !value || value === '';
  }

  /**
   * Validate by type
   * @param {*} value - Value to validate
   * @param {string} type - Validation type
   * @returns {boolean}
   */
  function validateByType(value, type) {
    const ValidationUtils = window.YouTubePlusValidationUtils;
    if (!ValidationUtils) return true;

    if (type === 'email') return ValidationUtils.isValidEmail(value);
    if (type === 'url') return ValidationUtils.isValidURL(value);

    return true;
  }

  /**
   * Check required field validation
   * @param {*} value - Field value
   * @param {Object} rule - Validation rule
   * @param {string} field - Field name
   * @returns {string|null} Error message or null
   * @private
   */
  function checkRequired(value, rule, field) {
    if (rule.required && isEmpty(value)) {
      return rule.message || `${field} is required`;
    }
    return null;
  }

  /**
   * Check type validation
   * @param {*} value - Field value
   * @param {Object} rule - Validation rule
   * @returns {string|null} Error message or null
   * @private
   */
  function checkType(value, rule) {
    if (rule.type && !validateByType(value, rule.type)) {
      return rule.message || `Invalid ${rule.type}`;
    }
    return null;
  }

  /**
   * Check length constraints
   * @param {*} value - Field value
   * @param {Object} rule - Validation rule
   * @returns {string|null} Error message or null
   * @private
   */
  function checkLength(value, rule) {
    if (rule.min && value.length < rule.min) {
      return rule.message || `Minimum length is ${rule.min}`;
    }
    if (rule.max && value.length > rule.max) {
      return rule.message || `Maximum length is ${rule.max}`;
    }
    return null;
  }

  /**
   * Check pattern validation
   * @param {*} value - Field value
   * @param {Object} rule - Validation rule
   * @returns {string|null} Error message or null
   * @private
   */
  function checkPattern(value, rule) {
    if (rule.pattern && !rule.pattern.test(value)) {
      return rule.message || 'Invalid format';
    }
    return null;
  }

  /**
   * Validate single field
   * @param {string} field - Field name
   * @param {*} value - Field value
   * @param {Object} rule - Validation rule
   * @returns {string|null} Error message or null
   */
  function validateField(field, value, rule) {
    return (
      checkRequired(value, rule, field) ||
      checkType(value, rule) ||
      checkLength(value, rule) ||
      checkPattern(value, rule)
    );
  }

  /**
   * Validate form data
   * @param {Object} data - Form data
   * @param {Object} rules - Validation rules
   * @returns {Object} Validation result
   */
  function validateForm(data, rules) {
    const errors = {};

    Object.keys(rules).forEach(field => {
      const rule = rules[field];
      const value = data[field];
      const error = validateField(field, value, rule);

      if (error) {
        errors[field] = error;
      }
    });

    return {
      valid: Object.keys(errors).length === 0,
      errors,
    };
  }

  // Public API
  return {
    createBackdrop,
    createModalHeader,
    createModalBody,
    createModalFooter,
    createModal,
    showModal,
    closeModal,
    isEmpty,
    validateByType,
    validateField,
    validateForm,
  };
})();
