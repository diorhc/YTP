/**
 * Error Recovery Utility Module
 * Extracted recovery strategies to reduce complexity
 */

window.YouTubePlusErrorRecovery = (() => {
  'use strict';

  /**
   * Recovery strategies enumeration
   */
  const RECOVERY_STRATEGIES = {
    RELOAD: 'reload',
    CLEAR_STORAGE: 'clear_storage',
    RESET_STATE: 'reset_state',
    NOTIFY_USER: 'notify_user',
  };

  /**
   * Determine recovery strategy based on error type
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   * @returns {string} Recovery strategy
   */
  function determineStrategy(error, context = {}) {
    if (!error) return RECOVERY_STRATEGIES.NOTIFY_USER;

    const errorMsg = error.message || '';
    const errorType = context.type || '';

    // Storage errors
    if (errorMsg.includes('localStorage') || errorMsg.includes('storage')) {
      return RECOVERY_STRATEGIES.CLEAR_STORAGE;
    }

    // DOM errors
    if (errorMsg.includes('querySelector') || errorMsg.includes('DOM')) {
      return RECOVERY_STRATEGIES.RESET_STATE;
    }

    // Critical errors
    if (errorType === 'unhandledRejection' || errorMsg.includes('fatal')) {
      return RECOVERY_STRATEGIES.RELOAD;
    }

    // Default strategy
    return RECOVERY_STRATEGIES.NOTIFY_USER;
  }

  /**
   * Clear corrupted storage
   * @returns {boolean} Success status
   */
  function clearStorage() {
    try {
      const keysToKeep = ['youtube-plus-settings', 'youtube-plus-user-prefs'];
      const allKeys = Object.keys(localStorage);

      allKeys.forEach(key => {
        if (!keysToKeep.includes(key) && key.startsWith('youtube-plus-')) {
          localStorage.removeItem(key);
        }
      });

      return true;
    } catch (err) {
      console.error('[YouTube+][Recovery] Failed to clear storage:', err);
      return false;
    }
  }

  /**
   * Reset application state
   * @returns {boolean} Success status
   */
  function resetState() {
    try {
      // Clear caches
      if (window.YouTubePlusDOMUtils?.clearSelectorCache) {
        window.YouTubePlusDOMUtils.clearSelectorCache();
      }

      // Reset flags
      if (window.YouTubeUtils) {
        window.YouTubeUtils.resetFlags?.();
      }

      return true;
    } catch (err) {
      console.error('[YouTube+][Recovery] Failed to reset state:', err);
      return false;
    }
  }

  /**
   * Notify user of error
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   */
  function notifyUser(error, context = {}) {
    const message = `An error occurred: ${error.message || 'Unknown error'}`;
    console.error('[YouTube+][Error]', message, context);

    // Show user notification if available
    if (window.YouTubeUtils?.showNotification) {
      window.YouTubeUtils.showNotification(message, 'error');
    }
  }

  /**
   * Reload page with delay
   * @param {number} delay - Delay in milliseconds
   */
  function reloadPage(delay = 1000) {
    console.log('[YouTube+][Recovery] Reloading page in', delay, 'ms');
    setTimeout(() => {
      window.location.reload();
    }, delay);
  }

  /**
   * Execute recovery strategy
   * @param {string} strategy - Recovery strategy
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   * @returns {boolean} Success status
   */
  function executeStrategy(strategy, error, context = {}) {
    console.log('[YouTube+][Recovery] Executing strategy:', strategy);

    switch (strategy) {
      case RECOVERY_STRATEGIES.CLEAR_STORAGE:
        if (clearStorage()) {
          notifyUser(new Error('Storage cleared due to error'), context);
          return true;
        }
        return false;

      case RECOVERY_STRATEGIES.RESET_STATE:
        if (resetState()) {
          notifyUser(new Error('Application state reset'), context);
          return true;
        }
        return false;

      case RECOVERY_STRATEGIES.RELOAD:
        notifyUser(new Error('Reloading page to recover from error'), context);
        reloadPage();
        return true;

      case RECOVERY_STRATEGIES.NOTIFY_USER:
      default:
        notifyUser(error, context);
        return false;
    }
  }

  /**
   * Attempt to recover from error
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   * @returns {boolean} Success status
   */
  function attemptRecovery(error, context = {}) {
    const strategy = determineStrategy(error, context);
    return executeStrategy(strategy, error, context);
  }

  /**
   * Check if error is recoverable
   * @param {Error} error - Error object
   * @returns {boolean}
   */
  function isRecoverable(error) {
    if (!error) return false;

    const fatalErrors = ['SecurityError', 'CSP', 'TrustedTypes'];
    const errorMsg = error.message || '';

    return !fatalErrors.some(fatal => errorMsg.includes(fatal));
  }

  // Public API
  return {
    RECOVERY_STRATEGIES,
    determineStrategy,
    clearStorage,
    resetState,
    notifyUser,
    reloadPage,
    executeStrategy,
    attemptRecovery,
    isRecoverable,
  };
})();
