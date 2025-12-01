/**
 * Notification Manager Module
 * Centralized notification system with queue and deduplication
 * @module notification-manager
 */

/**
 * Notification options typedef
 * @typedef {Object} NotificationOptions
 * @property {number} [duration]
 * @property {('top-right'|'top-left'|'bottom-right'|'bottom-left'|string|null)} [position]
 * @property {{text:string, callback:Function}} [action]
 * @property {string} [type]
 */

const NotificationManager = (() => {
  'use strict';

  const DOMManager = window.YouTubePlusDOMManager || {};
  const createElement =
    DOMManager.createElement ||
    ((tag, attrs, children) => {
      const el = document.createElement(tag);
      if (attrs?.className) {
        el.className = attrs.className;
      }
      if (children) {
        children.forEach(c =>
          el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
        );
      }
      return el;
    });

  const _queue = [];
  const activeNotifications = new Set();
  const _MAX_VISIBLE = 3;
  const DEFAULT_DURATION = 3000;
  const CONTAINER_ID = 'youtube-enhancer-notification-container';

  // Position presets for notifications
  const POSITION_PRESETS = {
    'top-right': { top: '20px', right: '20px' },
    'top-left': { top: '20px', left: '20px' },
    'bottom-right': { bottom: '20px', right: '20px' },
    'bottom-left': { bottom: '20px', left: '20px' },
  };

  /**
   * Error logging helper
   * @param {string} message - Error message
   * @param {Error} error - Error object
   */
  const logError = (message, error) => {
    console.error(`[YouTube+][NotificationManager] ${message}:`, error);
  };

  /**
   * Get or create notification container
   * @returns {HTMLElement|null} Container element
   */
  const getContainer = () => {
    let container = document.getElementById(CONTAINER_ID);
    if (!container) {
      container = createElement('div', {
        id: CONTAINER_ID,
        className: 'youtube-enhancer-notification-container',
      });
      try {
        document.body.appendChild(container);
      } catch (e) {
        logError('Failed to create container', e);
        return null;
      }
    }
    return container;
  };

  /**
   * Animate notification removal
   * @param {HTMLElement} notification - Notification element
   */
  const animateRemoval = notification => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(20px)';
  };

  /**
   * Clean up notification element
   * @param {HTMLElement} notification - Notification element
   */
  const cleanupNotification = notification => {
    try {
      notification.remove();
      activeNotifications.delete(notification);
    } catch (e) {
      logError('Failed to remove notification', e);
    }
  };

  /**
   * Remove notification from DOM and tracking
   * @param {HTMLElement} notification - Notification element
   */
  const remove = notification => {
    if (!notification) return;

    try {
      animateRemoval(notification);
      setTimeout(() => cleanupNotification(notification), 300);
    } catch (e) {
      logError('Failed to animate notification removal', e);
    }
  };

  /**
   * Get position styles for notification
   * @param {string|null} position - Position preset name
   * @returns {Object} Position styles
   */
  const getPositionStyles = position => {
    return position && POSITION_PRESETS[position] ? POSITION_PRESETS[position] : {};
  };

  /**
   * Create message span element
   * @param {string} message - Message text
   * @returns {HTMLElement} Message span element
   */
  const createMessageElement = message => {
    return createElement('span', { style: { flex: '1' } }, [message]);
  };

  /**
   * Create action button element
   * @param {Object} action - Action configuration
   * @param {HTMLElement} notification - Parent notification element
   * @returns {HTMLElement} Action button element
   */
  const createActionButton = (action, notification) => {
    const actionBtn = createElement(
      'button',
      {
        style: {
          background: 'rgba(255,255,255,0.2)',
          border: '1px solid rgba(255,255,255,0.3)',
          color: 'white',
          padding: '4px 12px',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: '600',
          transition: 'background 0.2s',
        },
      },
      [action.text]
    );

    actionBtn.addEventListener('click', () => {
      action.callback();
      remove(notification);
    });

    return actionBtn;
  };

  /**
   * Set accessibility attributes on notification
   * @param {HTMLElement} notification - Notification element
   */
  const setAccessibilityAttributes = notification => {
    notification.setAttribute('role', 'status');
    notification.setAttribute('aria-live', 'polite');
    notification.setAttribute('aria-atomic', 'true');
  };

  /**
   * Create notification element
   * @param {string} message - Notification message
   * @param {NotificationOptions} options - Notification options
   * @returns {HTMLElement} Notification element
   */
  const createNotification = (message, options = {}) => {
    const { position = null, action = null } = options;

    const notification = createElement('div', {
      className: 'youtube-enhancer-notification',
      dataset: { message },
      style: {
        zIndex: '10001',
        width: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        ...getPositionStyles(position),
      },
    });

    setAccessibilityAttributes(notification);

    const messageSpan = createMessageElement(message);
    notification.appendChild(messageSpan);

    if (action && action.text && typeof action.callback === 'function') {
      const actionBtn = createActionButton(action, notification);
      notification.appendChild(actionBtn);
    }

    return notification;
  };

  /**
   * Validate notification message
   * @param {string} message - Message to validate
   * @returns {boolean} True if valid
   */
  const isValidMessage = message => {
    if (!message || typeof message !== 'string') {
      logError('Invalid message', new Error('Message must be a non-empty string'));
      return false;
    }
    return true;
  };

  /**
   * Remove duplicate notifications with same message
   * @param {string} message - Message to check for duplicates
   */
  const removeDuplicates = message => {
    activeNotifications.forEach(notif => {
      if (notif.dataset.message === message) {
        remove(notif);
      }
    });
  };

  /**
   * Add notification to container
   * @param {HTMLElement} notification - Notification element
   * @param {HTMLElement} container - Container element
   */
  const addToContainer = (notification, container) => {
    container.appendChild(notification);
    activeNotifications.add(notification);
  };

  /**
   * Schedule auto-removal of notification
   * @param {HTMLElement} notification - Notification element
   * @param {number} duration - Duration in milliseconds
   */
  const scheduleRemoval = (notification, duration) => {
    if (duration > 0) {
      setTimeout(() => remove(notification), duration);
    }
  };

  /**
   * Show notification
   * @param {string} message - Notification message
   * @param {NotificationOptions} options - Notification options
   * @returns {HTMLElement|null} Notification element
   */
  const show = (message, options = {}) => {
    if (!isValidMessage(message)) {
      return null;
    }

    const { duration = DEFAULT_DURATION } = options;

    removeDuplicates(message);

    const container = getContainer();
    if (!container) return null;

    try {
      const notification = createNotification(message, options);
      addToContainer(notification, container);
      scheduleRemoval(notification, duration);
      return notification;
    } catch (error) {
      logError('Failed to show notification', error);
      return null;
    }
  };

  /**
   * Clear all notifications
   */
  const clearAll = () => {
    activeNotifications.forEach(notif => remove(notif));
    activeNotifications.clear();
  };

  /**
   * Show success notification
   * @param {string} message - Message
   * @param {Object} options - Options
   * @returns {HTMLElement|null} Notification element
   */
  const success = (message, options = {}) => {
    return show(`✓ ${message}`, { ...options, type: 'success' });
  };

  /**
   * Show error notification
   * @param {string} message - Message
   * @param {Object} options - Options
   * @returns {HTMLElement|null} Notification element
   */
  const error = (message, options = {}) => {
    return show(`✗ ${message}`, { ...options, type: 'error', duration: 5000 });
  };

  /**
   * Show info notification
   * @param {string} message - Message
   * @param {Object} options - Options
   * @returns {HTMLElement|null} Notification element
   */
  const info = (message, options = {}) => {
    return show(`ℹ ${message}`, { ...options, type: 'info' });
  };

  return {
    show,
    remove,
    clearAll,
    success,
    error,
    info,
    activeNotifications,
  };
})();

// Export globally
if (typeof window !== 'undefined') {
  window.YouTubePlusNotificationManager = NotificationManager;
}
