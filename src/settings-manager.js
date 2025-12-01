/**
 * Settings Manager Module
 * Centralized settings storage and retrieval with event dispatching
 * @module settings-manager
 */

const SettingsManager = (() => {
  'use strict';

  const Storage = window.YouTubePlusStorage || {};

  /**
   * Safe storage get with fallback
   * @param {string} key - Storage key
   * @returns {*} Stored value or null
   */
  const storageGet = key => {
    if (Storage.get) return Storage.get(key);
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  };

  /**
   * Safe storage set with fallback
   * @param {string} key - Storage key
   * @param {*} value - Value to store
   */
  const storageSet = (key, value) => {
    if (Storage.set) {
      Storage.set(key, value);
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Silent fail
    }
  };

  const STORAGE_KEY = 'youtube_plus_all_settings_v2';

  const defaults = {
    speedControl: { enabled: true, currentSpeed: 1 },
    screenshot: { enabled: true },
    download: { enabled: true },
    updateChecker: { enabled: true },
    adBlocker: { enabled: true },
    pip: { enabled: true },
    timecodes: { enabled: true },
  };

  /**
   * Load all settings with defaults
   * @returns {Object} Complete settings object
   */
  const load = () => {
    const saved = storageGet(STORAGE_KEY);
    return saved ? { ...defaults, ...saved } : { ...defaults };
  };

  /**
   * Save all settings and dispatch change event
   * @param {Object} settings - Settings to save
   */
  const save = settings => {
    storageSet(STORAGE_KEY, settings);
    window.dispatchEvent(
      new CustomEvent('youtube-plus-settings-changed', {
        detail: settings,
      })
    );
  };

  /**
   * Get setting by path (e.g., 'speedControl.enabled')
   * @param {string} path - Dot-separated path
   * @returns {*} Setting value
   */
  const get = path => {
    const settings = load();
    return path.split('.').reduce((obj, key) => obj?.[key], settings);
  };

  /**
   * Set setting by path
   * @param {string} path - Dot-separated path
   * @param {*} value - Value to set
   */
  const set = (path, value) => {
    const settings = load();
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((obj, key) => {
      obj[key] = obj[key] || {};
      return obj[key];
    }, settings);
    target[last] = value;
    save(settings);
  };

  /**
   * Reset settings to defaults
   */
  const reset = () => {
    save({ ...defaults });
  };

  /**
   * Update multiple settings at once
   * @param {Object} updates - Settings updates
   */
  const update = updates => {
    const settings = load();
    const merged = { ...settings, ...updates };
    save(merged);
  };

  return {
    load,
    save,
    get,
    set,
    reset,
    update,
    defaults,
  };
})();

// Export globally
if (typeof window !== 'undefined') {
  window.YouTubePlusSettingsManager = SettingsManager;
}
