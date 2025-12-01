/**
 * Stats Utility Module
 * Extracted utilities for stats panel rendering and overlay management
 */

window.YouTubePlusStatsUtils = (() => {
  'use strict';

  /**
   * Format bytes to human-readable string
   * @param {number} bytes - Bytes to format
   * @returns {string}
   */
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Format duration to human-readable string
   * @param {number} seconds - Duration in seconds
   * @returns {string}
   */
  function formatDuration(seconds) {
    if (!seconds || seconds === 0) return '0:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const pad = num => String(num).padStart(2, '0');

    if (hours > 0) {
      return `${hours}:${pad(minutes)}:${pad(secs)}`;
    }

    return `${minutes}:${pad(secs)}`;
  }

  /**
   * Create stats row element
   * @param {string} label - Row label
   * @param {string} value - Row value
   * @param {string} className - Optional CSS class
   * @returns {HTMLElement}
   */
  function createStatsRow(label, value, className = '') {
    const DOMUtils = window.YouTubePlusDOMUtils;

    if (DOMUtils && DOMUtils.createElement) {
      return DOMUtils.createElement(
        'div',
        {
          className: `ytp-stats-row ${className}`,
        },
        [
          DOMUtils.createElement('span', { className: 'ytp-stats-label' }, [label]),
          DOMUtils.createElement('span', { className: 'ytp-stats-value' }, [value]),
        ]
      );
    }

    // Fallback
    const row = document.createElement('div');
    row.className = `ytp-stats-row ${className}`;

    const labelEl = document.createElement('span');
    labelEl.className = 'ytp-stats-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'ytp-stats-value';
    valueEl.textContent = value;

    row.appendChild(labelEl);
    row.appendChild(valueEl);

    return row;
  }

  /**
   * Create section header element
   * @param {string} title - Section title
   * @returns {HTMLElement}
   */
  function createSectionHeader(title) {
    const DOMUtils = window.YouTubePlusDOMUtils;

    if (DOMUtils && DOMUtils.createElement) {
      return DOMUtils.createElement(
        'div',
        {
          className: 'ytp-stats-section-header',
        },
        [title]
      );
    }

    const header = document.createElement('div');
    header.className = 'ytp-stats-section-header';
    header.textContent = title;
    return header;
  }

  /**
   * Get video quality info
   * @param {HTMLVideoElement} video - Video element
   * @returns {Object} Quality information
   */
  /**
   * Determine quality label from height
   * @param {number} height - Video height in pixels
   * @returns {string} Quality label
   */
  function determineQualityLabel(height) {
    const qualityMap = [
      { threshold: 2160, label: '4K' },
      { threshold: 1440, label: '1440p' },
      { threshold: 1080, label: '1080p' },
      { threshold: 720, label: '720p' },
      { threshold: 480, label: '480p' },
      { threshold: 360, label: '360p' },
    ];

    for (const { threshold, label } of qualityMap) {
      if (height >= threshold) return label;
    }

    return height > 0 ? `${height}p` : 'Unknown';
  }

  function getVideoQuality(video) {
    if (!video) return { width: 0, height: 0, quality: 'Unknown' };

    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    const quality = determineQualityLabel(height);

    return { width, height, quality };
  }

  /**
   * Get video performance metrics
   * @param {HTMLVideoElement} video - Video element
   * @returns {Object} Performance metrics
   */
  function getVideoMetrics(video) {
    if (!video) {
      return {
        buffered: 0,
        played: 0,
        currentTime: 0,
        duration: 0,
        bufferedRanges: [],
      };
    }

    const bufferedRanges = [];
    for (let i = 0; i < video.buffered.length; i++) {
      bufferedRanges.push({
        start: video.buffered.start(i),
        end: video.buffered.end(i),
      });
    }

    return {
      buffered: video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0,
      played: video.currentTime || 0,
      currentTime: video.currentTime || 0,
      duration: video.duration || 0,
      bufferedRanges,
    };
  }

  /**
   * Calculate buffer percentage
   * @param {HTMLVideoElement} video - Video element
   * @returns {number} Buffer percentage (0-100)
   */
  function getBufferPercentage(video) {
    if (!video || !video.duration) return 0;

    const metrics = getVideoMetrics(video);
    return Math.round((metrics.buffered / video.duration) * 100);
  }

  /**
   * Create overlay element
   * @param {Object} options - Overlay options
   * @returns {HTMLElement}
   */
  function createOverlay({ className = '', content = '', closeable = true } = {}) {
    const DOMUtils = window.YouTubePlusDOMUtils;

    const overlay =
      DOMUtils && DOMUtils.createElement
        ? DOMUtils.createElement('div', { className: `ytp-overlay ${className}` })
        : document.createElement('div');

    if (!DOMUtils) {
      overlay.className = `ytp-overlay ${className}`;
    }

    if (content) {
      overlay.textContent = content;
    }

    if (closeable) {
      const closeBtn =
        DOMUtils && DOMUtils.createButton
          ? DOMUtils.createButton({
              text: '×',
              className: 'ytp-overlay-close',
              ariaLabel: 'Close',
            })
          : document.createElement('button');

      if (!DOMUtils) {
        closeBtn.className = 'ytp-overlay-close';
        closeBtn.textContent = '×';
        closeBtn.setAttribute('aria-label', 'Close');
      }

      closeBtn.addEventListener('click', () => {
        overlay.remove();
      });

      overlay.appendChild(closeBtn);
    }

    return overlay;
  }

  /**
   * Position overlay relative to target
   * @param {HTMLElement} overlay - Overlay element
   * @param {HTMLElement} target - Target element
   * @param {string} position - Position ('top', 'bottom', 'left', 'right')
   */
  function positionOverlay(overlay, target, position = 'bottom') {
    if (!overlay || !target) return;

    const rect = target.getBoundingClientRect();

    overlay.style.position = 'absolute';

    switch (position) {
      case 'top':
        overlay.style.bottom = `${window.innerHeight - rect.top + 10}px`;
        overlay.style.left = `${rect.left}px`;
        break;
      case 'bottom':
        overlay.style.top = `${rect.bottom + 10}px`;
        overlay.style.left = `${rect.left}px`;
        break;
      case 'left':
        overlay.style.top = `${rect.top}px`;
        overlay.style.right = `${window.innerWidth - rect.left + 10}px`;
        break;
      case 'right':
        overlay.style.top = `${rect.top}px`;
        overlay.style.left = `${rect.right + 10}px`;
        break;
      default:
        break;
    }
  }

  // Public API
  return {
    formatBytes,
    formatDuration,
    createStatsRow,
    createSectionHeader,
    getVideoQuality,
    getVideoMetrics,
    getBufferPercentage,
    createOverlay,
    positionOverlay,
  };
})();
