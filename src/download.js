/**
 * YouTube+ Download Module
 * Unified download system with button UI and download functionality
 * @version 3.0
 */

(function () {
  'use strict';

  const isRelevantRoute = () => {
    try {
      const path = location.pathname || '';
      return path === '/watch' || path.startsWith('/shorts');
    } catch {
      return false;
    }
  };

  const onDomReady = cb => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', cb, { once: true });
    } else {
      cb();
    }
  };

  // DOM cache helpers with fallback
  const $ = selector => {
    if (window.YouTubeDOMCache && typeof window.YouTubeDOMCache.get === 'function') {
      return window.YouTubeDOMCache.get(selector);
    }
    return document.querySelector(selector);
  };
  const $$ = selector => {
    if (window.YouTubeDOMCache && typeof window.YouTubeDOMCache.getAll === 'function') {
      return window.YouTubeDOMCache.getAll(selector);
    }
    return document.querySelectorAll(selector);
  };

  // Check dependencies
  if (typeof YouTubeUtils === 'undefined') {
    console.error('[YouTube+ Download] YouTubeUtils not found!');
    return;
  }

  // Create a custom glassmorphic subtitle dropdown control
  function createSubtitleSelect() {
    const subtitleSelect = document.createElement('div');
    subtitleSelect.setAttribute('role', 'listbox');
    Object.assign(subtitleSelect.style, {
      position: 'relative',
      width: '100%',
      marginBottom: '8px',
      fontSize: '14px',
      color: '#fff',
      cursor: 'pointer',
    });

    const _ssDisplay = document.createElement('div');
    Object.assign(_ssDisplay.style, {
      padding: '10px 12px',
      borderRadius: '10px',
      background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
      border: '1px solid rgba(255,255,255,0.06)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      backdropFilter: 'blur(6px)',
      boxShadow: '0 4px 18px rgba(0,0,0,0.35) inset',
    });
    const _ssLabel = document.createElement('div');
    _ssLabel.style.flex = '1';
    _ssLabel.style.overflow = 'hidden';
    _ssLabel.style.textOverflow = 'ellipsis';
    _ssLabel.style.whiteSpace = 'nowrap';
    _ssLabel.textContent = t('loading');
    const _ssChevron = document.createElement('div');
    _ssChevron.textContent = '▾';
    _ssChevron.style.opacity = '0.8';
    _ssDisplay.appendChild(_ssLabel);
    _ssDisplay.appendChild(_ssChevron);

    const _ssList = document.createElement('div');
    Object.assign(_ssList.style, {
      position: 'absolute',
      top: 'calc(100% + 8px)',
      left: '0',
      right: '0',
      maxHeight: '220px',
      overflowY: 'auto',
      borderRadius: '10px',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02))',
      border: '1px solid rgba(255,255,255,0.06)',
      boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
      backdropFilter: 'blur(8px)',
      zIndex: '9999',
      display: 'none',
    });

    subtitleSelect.appendChild(_ssDisplay);
    subtitleSelect.appendChild(_ssList);

    _ssList.addEventListener('click', e => {
      const item = e.target?.closest?.('[data-value]');
      if (!item || !_ssList.contains(item)) return;
      subtitleSelect.value = item.dataset.value;
      _ssList.style.display = 'none';
    });

    _ssList.addEventListener('mouseover', e => {
      const item = e.target?.closest?.('[data-value]');
      if (!item || !_ssList.contains(item)) return;
      item.style.background = 'rgba(255,255,255,0.02)';
    });

    _ssList.addEventListener('mouseout', e => {
      const item = e.target?.closest?.('[data-value]');
      if (!item || !_ssList.contains(item)) return;
      const related = e.relatedTarget;
      if (related && item.contains(related)) return;
      item.style.background = 'transparent';
    });

    subtitleSelect._options = [];
    subtitleSelect._value = '';
    subtitleSelect._disabled = false;

    subtitleSelect.setPlaceholder = text => {
      _ssLabel.textContent = text || '';
      subtitleSelect._options = [];
      _ssList.innerHTML = '';
      subtitleSelect._value = '';
    };

    subtitleSelect.setOptions = options => {
      subtitleSelect._options = options || [];
      _ssList.innerHTML = '';
      subtitleSelect._options.forEach(opt => {
        const item = document.createElement('div');
        item.textContent = opt.text;
        item.dataset.value = String(opt.value);
        Object.assign(item.style, {
          padding: '10px 12px',
          cursor: 'pointer',
          borderBottom: '1px solid rgba(255,255,255,0.02)',
          color: '#fff',
        });
        _ssList.appendChild(item);
      });
      if (subtitleSelect._options.length > 0) {
        subtitleSelect.value = String(subtitleSelect._options[0].value);
      } else {
        subtitleSelect._value = '';
        _ssLabel.textContent = t('noSubtitles');
      }
    };

    Object.defineProperty(subtitleSelect, 'value', {
      get() {
        return subtitleSelect._value;
      },
      set(v) {
        subtitleSelect._value = String(v);
        const found = subtitleSelect._options.find(o => String(o.value) === subtitleSelect._value);
        _ssLabel.textContent = found ? found.text : '';
      },
    });

    Object.defineProperty(subtitleSelect, 'disabled', {
      get() {
        return subtitleSelect._disabled;
      },
      set(v) {
        subtitleSelect._disabled = !!v;
        _ssDisplay.style.opacity = subtitleSelect._disabled ? '0.5' : '1';
        subtitleSelect.style.pointerEvents = subtitleSelect._disabled ? 'none' : 'auto';
      },
    });

    _ssDisplay.addEventListener('click', () => {
      if (subtitleSelect._disabled) return;
      _ssList.style.display = _ssList.style.display === 'none' ? '' : 'none';
    });

    const _ac = new AbortController();
    document.addEventListener(
      'click',
      e => {
        if (!subtitleSelect.contains(e.target)) _ssList.style.display = 'none';
      },
      { signal: _ac.signal }
    );

    subtitleSelect.destroy = () => _ac.abort();

    return subtitleSelect;
  }

  const { NotificationManager } = YouTubeUtils;

  // Translation helper: dynamically resolve central i18n (embedded) at call time
  // to avoid missing translations due to initialization order. Falls back to
  // YouTubeUtils.t if present, otherwise returns the key (with simple params).
  function t(key, params = {}) {
    try {
      if (typeof window !== 'undefined') {
        if (window.YouTubePlusI18n && typeof window.YouTubePlusI18n.t === 'function') {
          return window.YouTubePlusI18n.t(key, params);
        }
        if (window.YouTubeUtils && typeof window.YouTubeUtils.t === 'function') {
          return window.YouTubeUtils.t(key, params);
        }
      }
    } catch {
      // ignore and fall back
    }

    // Minimal fallback: return key with simple interpolation
    const str = String(key || '');
    if (!params || Object.keys(params).length === 0) return str;
    let result = str;
    for (const [k, v] of Object.entries(params)) result = result.split(`{${k}}`).join(String(v));
    return result;
  }

  // Initialize logger (logger is defined in build order before this module)
  /* global YouTubePlusLogger */
  const logger =
    typeof YouTubePlusLogger !== 'undefined' && YouTubePlusLogger
      ? YouTubePlusLogger.createLogger('Download')
      : {
          debug: () => {},
          info: () => {},
          warn: console.warn.bind(console),
          error: console.error.bind(console),
        };

  /**
   * Download Configuration
   */
  const DownloadConfig = {
    // TubeInsights API endpoints (mp3yt.is backend)
    API: {
      KEY_URL: 'https://cnv.cx/v2/sanity/key',
      CONVERT_URL: 'https://cnv.cx/v2/converter',
    },

    // HTTP headers for API requests
    HEADERS: {
      'Content-Type': 'application/json',
      Origin: 'https://mp3yt.is',
      Accept: '*/*',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    },

    // Available video qualities (144p to 4K)
    VIDEO_QUALITIES: ['144', '240', '360', '480', '720', '1080', '1440', '2160'],

    // Available audio bitrates (kbps)
    AUDIO_BITRATES: ['64', '128', '192', '256', '320'],

    // Default download options
    DEFAULTS: {
      format: 'video', // 'video' or 'audio'
      videoQuality: '1080',
      audioBitrate: '320',
      embedThumbnail: true,
    },
  };

  /**
   * Get current YouTube video ID
   * @returns {string|null} Video ID or null
   */
  function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('v') || null;
  }

  /**
   * Get current video URL
   * @returns {string} Full video URL
   */
  function getVideoUrl() {
    const videoId = getVideoId();
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : window.location.href;
  }

  /**
   * Get video title from page
   * @returns {string} Video title or 'video'
   */
  function getVideoTitle() {
    try {
      const titleElement =
        $('h1.ytd-video-primary-info-renderer yt-formatted-string') ||
        $('h1.title yt-formatted-string') ||
        $('ytd-watch-metadata h1');
      return titleElement ? titleElement.textContent.trim() : 'video';
    } catch {
      return 'video';
    }
  }

  /**
   * Sanitize filename for safe file system operations
   * @param {string} filename - Original filename
   * @returns {string} Sanitized filename
   */
  function sanitizeFilename(filename) {
    return filename
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200); // Limit length
  }

  /**
   * Format bytes to human-readable string
   * @param {number} bytes - Byte count
   * @returns {string} Formatted string (e.g., "8.5 MB")
   */
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Create GM_xmlhttpRequest wrapper with callbacks
   * @param {Object} options - Request options
   * @param {Function} resolve - Promise resolve function
   * @param {Function} reject - Promise reject function
   * @returns {Object} GM_xmlhttpRequest options
   */
  function createGmRequestOptions(options, resolve, reject) {
    return {
      ...options,
      onload: response => {
        if (options.onload) options.onload(response);
        resolve(response);
      },
      onerror: error => {
        if (options.onerror) options.onerror(error);
        reject(error);
      },
      ontimeout: () => {
        if (options.ontimeout) options.ontimeout();
        reject(new Error('Request timeout'));
      },
    };
  }

  /**
   * Build response-like object from fetch response
   * @param {Response} resp - Fetch response
   * @returns {Object} Response-like object
   */
  function buildResponseObject(resp) {
    return {
      status: resp.status,
      statusText: resp.statusText,
      finalUrl: resp.url,
      headers: {},
      responseText: null,
      response: null,
    };
  }

  /**
   * Try to extract text from response
   * @param {Response} resp - Fetch response
   * @param {Object} responseLike - Response-like object to populate
   */
  async function extractResponseText(resp, responseLike) {
    try {
      responseLike.responseText = await resp.text();
    } catch {
      responseLike.responseText = null;
    }
  }

  /**
   * Try to extract blob from response if needed
   * @param {Response} resp - Fetch response
   * @param {Object} responseLike - Response-like object to populate
   * @param {string} responseType - Expected response type
   */
  async function extractResponseBlob(resp, responseLike, responseType) {
    if (responseType === 'blob') {
      try {
        responseLike.response = await resp.blob();
      } catch {
        responseLike.response = null;
      }
    }
  }

  /**
   * Execute fetch-based request as fallback
   * @param {Object} options - Request options
   * @returns {Promise<Object>} Response object
   */
  async function executeFetchFallback(options) {
    const fetchOpts = {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.data || options.body || undefined,
    };

    const resp = await fetch(options.url, fetchOpts);
    const responseLike = buildResponseObject(resp);

    await extractResponseText(resp, responseLike);
    await extractResponseBlob(resp, responseLike, options.responseType);

    if (options.onload) options.onload(responseLike);
    return responseLike;
  }

  /**
   * Promise wrapper for GM_xmlhttpRequest
   * @param {Object} options - Request options
   * @returns {Promise<Object>} Response object
   */
  function gmXmlHttpRequest(options) {
    return new Promise((resolve, reject) => {
      // Prefer GM_xmlhttpRequest (userscript/extension context) because it can bypass CORS.
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        GM_xmlhttpRequest(createGmRequestOptions(options, resolve, reject));
        return;
      }

      // Fallback for page context: try using fetch(). Note: fetch() is subject to CORS and
      // may fail where GM_xmlhttpRequest would succeed. This fallback attempts to mimic
      // a similar response shape used by the rest of the code.
      (async () => {
        try {
          const responseLike = await executeFetchFallback(options);
          resolve(responseLike);
        } catch (err) {
          if (options.onerror) options.onerror(err);
          reject(err);
        }
      })();
    });
  }

  /**
   * Create square album art from YouTube thumbnail
   * @param {string} thumbnailUrl - Thumbnail URL
   * @returns {Promise<Blob>} Album art blob
   */
  function createSquareAlbumArt(thumbnailUrl) {
    return new Promise((resolve, reject) => {
      const img = document.createElement('img');
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = Math.min(img.width, img.height);
        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);

        canvas.toBlob(
          blob => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to create blob'));
          },
          'image/jpeg',
          0.95
        );
      };

      img.onerror = () => reject(new Error('Failed to load thumbnail'));
      img.src = thumbnailUrl;
    });
  }

  /**
   * Embed album art and metadata into MP3 file
   * Requires ID3Writer library (browser-id3-writer)
   *
   * @param {Blob} mp3Blob - Original MP3 blob
   * @param {Blob} albumArtBlob - Album art image blob
   * @param {Object} metadata - Metadata (title, artist, album)
   * @returns {Promise<Blob>} MP3 blob with embedded metadata
   */
  async function embedAlbumArtToMP3(mp3Blob, albumArtBlob, metadata) {
    try {
      if (typeof window.ID3Writer === 'undefined') {
        logger.warn('ID3Writer not available, skipping album art embedding');
        return mp3Blob;
      }

      const arrayBuffer = await mp3Blob.arrayBuffer();
      const writer = new window.ID3Writer(arrayBuffer);

      // Set metadata
      if (metadata.title) {
        writer.setFrame('TIT2', metadata.title);
      }
      if (metadata.artist) {
        writer.setFrame('TPE1', [metadata.artist]);
      }
      if (metadata.album) {
        writer.setFrame('TALB', metadata.album);
      }

      // Embed album art
      if (albumArtBlob) {
        const coverArrayBuffer = await albumArtBlob.arrayBuffer();
        writer.setFrame('APIC', {
          type: 3, // Cover (front)
          data: coverArrayBuffer,
          description: 'Cover',
        });
      }

      writer.addTag();
      /* global Blob */
      return new Blob([writer.arrayBuffer], { type: 'audio/mpeg' });
    } catch (error) {
      logger.error('Error embedding album art:', error);
      return mp3Blob;
    }
  }

  /**
   * Get available subtitles for a video
   * @param {string} videoId - YouTube video ID
   * @returns {Promise<Object>} Subtitle data
   */
  /**
   * Fetch player data from YouTube API
   * @param {string} videoId - Video ID
   * @returns {Promise<Object>} Player data response
   * @private
   */
  async function fetchPlayerData(videoId) {
    const response = await gmXmlHttpRequest({
      method: 'POST',
      url: 'https://www.youtube.com/youtubei/v1/player',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': DownloadConfig.HEADERS['User-Agent'],
      },
      data: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240304.00.00',
          },
        },
        videoId,
      }),
    });

    if (response.status !== 200) {
      throw new Error(`Failed to get player data: ${response.status}`);
    }

    return JSON.parse(response.responseText);
  }

  /**
   * Build subtitle URL with format parameter
   * @param {string} baseUrl - Base subtitle URL
   * @returns {string} Complete subtitle URL
   * @private
   */
  function buildSubtitleUrl(baseUrl) {
    if (!baseUrl.includes('fmt=')) {
      return `${baseUrl}&fmt=srv1`;
    }
    return baseUrl;
  }

  /**
   * Parse caption tracks into subtitle objects
   * @param {Array} captionTracks - Caption track data
   * @returns {Array} Subtitle objects
   * @private
   */
  function parseCaptionTracks(captionTracks) {
    return captionTracks.map(track => ({
      name: track.name?.simpleText || track.languageCode,
      languageCode: track.languageCode,
      url: buildSubtitleUrl(track.baseUrl),
      isAutoGenerated: track.kind === 'asr',
    }));
  }

  /**
   * Parse translation languages into subtitle objects
   * @param {Array} translationLanguages - Translation language data
   * @param {string} baseUrl - Base URL for translations
   * @returns {Array} Auto-translation subtitle objects
   * @private
   */
  function parseTranslationLanguages(translationLanguages, baseUrl) {
    return translationLanguages.map(lang => ({
      name: lang.languageName?.simpleText || lang.languageCode,
      languageCode: lang.languageCode,
      baseUrl: baseUrl || '',
      isAutoGenerated: true,
    }));
  }

  /**
   * Create empty subtitle result
   * @param {string} videoId - Video ID
   * @param {string} videoTitle - Video title
   * @returns {Object} Empty subtitle result
   * @private
   */
  function createEmptySubtitleResult(videoId, videoTitle) {
    return {
      videoId,
      videoTitle,
      subtitles: [],
      autoTransSubtitles: [],
    };
  }

  /**
   * Get subtitles for a video
   * @param {string} videoId - Video ID
   * @returns {Promise<Object|null>} Subtitle data or null on error
   */
  async function getSubtitles(videoId) {
    try {
      const data = await fetchPlayerData(videoId);
      const videoTitle = data.videoDetails?.title || 'video';
      const captions = data.captions?.playerCaptionsTracklistRenderer;

      if (!captions) {
        return createEmptySubtitleResult(videoId, videoTitle);
      }

      const captionTracks = captions.captionTracks || [];
      const translationLanguages = captions.translationLanguages || [];
      const baseUrl = captionTracks[0]?.baseUrl || '';

      return {
        videoId,
        videoTitle,
        subtitles: parseCaptionTracks(captionTracks),
        autoTransSubtitles: parseTranslationLanguages(translationLanguages, baseUrl),
      };
    } catch (error) {
      logger.error('Error getting subtitles:', error);
      return null;
    }
  }

  /**
   * Parse subtitle XML to cues
   * @param {string} xml - XML subtitle content
   * @returns {Array} Array of cues
   */
  function parseSubtitleXML(xml) {
    const cues = [];
    const textTagRegex = /<text\s+start="([^"]+)"\s+dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/gi;
    let match;

    while ((match = textTagRegex.exec(xml)) !== null) {
      const start = parseFloat(match[1] || '0');
      const duration = parseFloat(match[2] || '0');
      let text = match[3] || '';

      // Remove CDATA
      text = text.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');

      // Decode HTML entities
      text = decodeHTMLEntities(text.trim());

      cues.push({ start, duration, text });
    }

    return cues;
  }

  /**
   * Decode HTML entities
   * @param {string} text - Text with HTML entities
   * @returns {string} Decoded text
   */
  function decodeHTMLEntities(text) {
    const entities = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&apos;': "'",
      '&nbsp;': ' ',
    };

    let decoded = text;
    for (const [entity, char] of Object.entries(entities)) {
      decoded = decoded.replace(new RegExp(entity, 'g'), char);
    }

    // Decode numeric entities
    decoded = decoded.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
    decoded = decoded.replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );

    return decoded;
  }

  /**
   * Convert cues to SRT format
   * @param {Array} cues - Array of cues
   * @returns {string} SRT formatted text
   */
  function convertToSRT(cues) {
    let srt = '';
    cues.forEach((cue, index) => {
      const startTime = formatSRTTime(cue.start);
      const endTime = formatSRTTime(cue.start + cue.duration);
      const text = cue.text.replace(/\n/g, ' ').trim();

      srt += `${index + 1}\n`;
      srt += `${startTime} --> ${endTime}\n`;
      srt += `${text}\n\n`;
    });

    return srt;
  }

  /**
   * Format time for SRT (HH:MM:SS,mmm)
   * @param {number} seconds - Time in seconds
   * @returns {string} Formatted time
   */
  function formatSRTTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
  }

  /**
   * Convert cues to plain text
   * @param {Array} cues - Array of cues
   * @returns {string} Plain text
   */
  function convertToTXT(cues) {
    return cues.map(cue => cue.text.trim()).join('\n');
  }

  /**
   * Download subtitle file
   * @param {Object} options - Download options
   * @param {string} options.videoId - Video ID
   * @param {string} options.url - Subtitle URL
   * @param {string} options.languageCode - Language code
   * @param {string} options.languageName - Language name
   * @param {string} [options.format='srt'] - Format: 'srt', 'txt', 'xml'
   * @param {string} [options.translateTo] - Target language code for translation
   * @returns {Promise<void>}
   */
  async function downloadSubtitle(options = {}) {
    const {
      videoId,
      url: baseUrl,
      languageCode,
      languageName,
      format = 'srt',
      translateTo = null,
    } = options;

    if (!videoId || !baseUrl) {
      throw new Error('Video ID and URL are required');
    }

    const title = getVideoTitle();

    // Build subtitle URL
    let subtitleUrl = baseUrl;
    if (!subtitleUrl.includes('fmt=')) {
      subtitleUrl += '&fmt=srv1';
    }
    if (translateTo) {
      subtitleUrl += `&tlang=${translateTo}`;
    }

    NotificationManager.show(t('subtitleDownloading'), {
      duration: 2000,
      type: 'info',
    });

    try {
      // Download XML
      const response = await gmXmlHttpRequest({
        method: 'GET',
        url: subtitleUrl,
        headers: {
          'User-Agent': DownloadConfig.HEADERS['User-Agent'],
          Referer: 'https://www.youtube.com/',
        },
      });

      if (response.status !== 200) {
        throw new Error(`Failed to download subtitle: ${response.status}`);
      }

      const xmlText = response.responseText;

      if (!xmlText || xmlText.length === 0) {
        throw new Error('Empty subtitle response');
      }

      let content;
      let extension;

      if (format === 'xml') {
        content = xmlText;
        extension = 'xml';
      } else {
        const cues = parseSubtitleXML(xmlText);

        if (cues.length === 0) {
          throw new Error('No subtitle cues found');
        }

        if (format === 'srt') {
          content = convertToSRT(cues);
          extension = 'srt';
        } else if (format === 'txt') {
          content = convertToTXT(cues);
          extension = 'txt';
        } else {
          content = xmlText;
          extension = 'xml';
        }
      }

      // Create filename
      const langSuffix = translateTo ? `${languageCode}-${translateTo}` : languageCode;
      const filename = sanitizeFilename(`${title} - ${languageName} (${langSuffix}).${extension}`);

      // Download file
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      NotificationManager.show(t('subtitleDownloaded'), {
        duration: 3000,
        type: 'success',
      });

      logger.debug('Subtitle downloaded:', filename);
    } catch (error) {
      logger.error('Error downloading subtitle:', error);
      NotificationManager.show(`${t('subtitleDownloadFailed')} ${error.message}`, {
        duration: 5000,
        type: 'error',
      });
      throw error;
    }
  }

  /**
   * Download video or audio from YouTube
   *
   * This is the main download function that uses TubeInsights API (mp3yt.is)
   * to convert and download YouTube videos/audio.
   *
   * @param {Object} options - Download options
   * @param {string} [options.format='video'] - Format: 'video' or 'audio'
   * @param {string} [options.quality='1080'] - Video quality: '144', '240', '360', '480', '720', '1080', '1440', '2160'
   * @param {string} [options.audioBitrate='320'] - Audio bitrate: '64', '128', '192', '256', '320'
   * @param {boolean} [options.embedThumbnail=true] - Embed thumbnail in audio file (requires ID3Writer)
   * @param {Function} [options.onProgress=null] - Progress callback (progress) => void
   * @returns {Promise<void>} Resolves when download completes
   *
   * @example
   * // Download 1080p video
   * await downloadVideo({ format: 'video', quality: '1080' });
   *
   * // Download 320kbps audio with album art
   * await downloadVideo({
   *   format: 'audio',
   *   audioBitrate: '320',
   *   embedThumbnail: true
   * });
   */
  async function downloadVideo(options = {}) {
    const {
      format = DownloadConfig.DEFAULTS.format,
      quality = DownloadConfig.DEFAULTS.videoQuality,
      audioBitrate = DownloadConfig.DEFAULTS.audioBitrate,
      embedThumbnail = DownloadConfig.DEFAULTS.embedThumbnail,
      onProgress = null,
    } = options;

    const videoId = getVideoId();
    if (!videoId) {
      throw new Error('Video ID not found');
    }

    const videoUrl = getVideoUrl();
    const title = getVideoTitle();

    // Show loading notification
    NotificationManager.show(t('startingDownload'), {
      duration: 2000,
      type: 'info',
    });

    try {
      // Step 1: Get API key from TubeInsights endpoint
      logger.debug('Fetching API key...');
      const keyResponse = await gmXmlHttpRequest({
        method: 'GET',
        url: DownloadConfig.API.KEY_URL,
        headers: DownloadConfig.HEADERS,
      });

      if (keyResponse.status !== 200) {
        throw new Error(`Failed to get API key: ${keyResponse.status}`);
      }

      const keyData = JSON.parse(keyResponse.responseText);
      if (!keyData || !keyData.key) {
        throw new Error('API key not found in response');
      }

      const { key } = keyData;
      logger.debug('API key obtained');

      // Step 2: Prepare conversion payload
      let payload;
      if (format === 'video') {
        // Use VP9 codec for 1440p and above, H264 for lower qualities
        const codec = parseInt(quality, 10) > 1080 ? 'vp9' : 'h264';
        payload = {
          link: videoUrl,
          format: 'mp4',
          audioBitrate: '128',
          videoQuality: quality,
          filenameStyle: 'pretty',
          vCodec: codec,
        };
      } else {
        payload = {
          link: videoUrl,
          format: 'mp3',
          audioBitrate,
          filenameStyle: 'pretty',
        };
      }

      // Step 3: Request conversion
      logger.debug('Requesting conversion...', payload);
      const customHeaders = {
        ...DownloadConfig.HEADERS,
        key,
      };

      const downloadResponse = await gmXmlHttpRequest({
        method: 'POST',
        url: DownloadConfig.API.CONVERT_URL,
        headers: customHeaders,
        data: JSON.stringify(payload),
      });

      if (downloadResponse.status !== 200) {
        throw new Error(`Conversion failed: ${downloadResponse.status}`);
      }

      const apiDownloadInfo = JSON.parse(downloadResponse.responseText);
      logger.debug('Conversion response:', apiDownloadInfo);

      if (!apiDownloadInfo.url) {
        throw new Error('No download URL received from API');
      }

      // Step 4: Download the file
      logger.debug('Downloading file from:', apiDownloadInfo.url);
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest === 'undefined') {
          // Fallback: open in new tab
          logger.warn('GM_xmlhttpRequest not available, opening in new tab');
          window.open(apiDownloadInfo.url, '_blank');
          resolve();
          return;
        }

        GM_xmlhttpRequest({
          method: 'GET',
          url: apiDownloadInfo.url,
          responseType: 'blob',
          headers: {
            'User-Agent': DownloadConfig.HEADERS['User-Agent'],
            Referer: 'https://mp3yt.is/',
            Accept: '*/*',
          },
          onprogress: progress => {
            if (onProgress) {
              onProgress({
                loaded: progress.loaded,
                total: progress.total,
                percent: progress.total ? Math.round((progress.loaded / progress.total) * 100) : 0,
              });
            }
          },
          onload: async response => {
            if (response.status === 200 && response.response) {
              let blob = response.response;

              if (blob.size === 0) {
                reject(new Error(t('zeroBytesError')));
                return;
              }

              window.YouTubeUtils &&
                YouTubeUtils.logger &&
                YouTubeUtils.logger.debug &&
                YouTubeUtils.logger.debug(`[Download] File downloaded: ${formatBytes(blob.size)}`);

              // Embed thumbnail for audio files
              if (format === 'audio' && embedThumbnail) {
                try {
                  logger.debug('Embedding album art...');
                  const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
                  const albumArt = await createSquareAlbumArt(thumbnailUrl);
                  blob = await embedAlbumArtToMP3(blob, albumArt, { title });
                  logger.debug('Album art embedded successfully');
                } catch (error) {
                  logger.error('Failed to embed album art:', error);
                  // Continue with download even if album art embedding fails
                }
              }

              // Create download link and trigger download
              const blobUrl = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = blobUrl;

              const filename =
                apiDownloadInfo.filename || `${title}.${format === 'video' ? 'mp4' : 'mp3'}`;
              a.download = sanitizeFilename(filename);

              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);

              // Clean up blob URL after download
              setTimeout(() => URL.revokeObjectURL(blobUrl), 100);

              NotificationManager.show(t('downloadCompleted'), {
                duration: 3000,
                type: 'success',
              });

              logger.debug('Download completed:', filename);
              resolve();
            } else {
              reject(new Error(`Download failed: ${response.status}`));
            }
          },
          onerror: () => reject(new Error('Download failed - network error')),
          ontimeout: () => reject(new Error('Download timeout')),
        });
      });
    } catch (error) {
      logger.error('Error:', error);
      NotificationManager.show(`${t('downloadFailed')} ${error.message}`, {
        duration: 5000,
        type: 'error',
      });
      throw error;
    }
  }

  /**
   * Initialize module
   * This module doesn't create any UI, just exposes the API
   */
  // --- Modal UI for Direct Download (lightweight, self-contained) ---
  let _modalElements = null;

  function createTabButtons(onTabChange) {
    const tabContainer = document.createElement('div');
    Object.assign(tabContainer.style, {
      display: 'flex',
      gap: '8px',
      padding: '12px',
      justifyContent: 'center',
      alignItems: 'center',
      background: 'transparent',
    });

    const videoTab = document.createElement('button');
    videoTab.textContent = t('videoTab');
    videoTab.dataset.format = 'video';

    const audioTab = document.createElement('button');
    audioTab.textContent = t('audioTab');
    audioTab.dataset.format = 'audio';

    const subTab = document.createElement('button');
    subTab.textContent = t('subtitleTab');
    subTab.dataset.format = 'subtitle';

    [videoTab, audioTab, subTab].forEach(btn => {
      Object.assign(btn.style, {
        flex: 'initial',
        padding: '8px 18px',
        border: '1px solid rgba(255,255,255,0.06)',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '600',
        transition: 'all 0.18s ease',
        color: '#666',
        borderRadius: '999px',
      });
      // Accessibility & artifact prevention
      btn.type = 'button';
      btn.style.outline = 'none';
      btn.style.userSelect = 'none';
      btn.setAttribute('aria-pressed', 'false');
    });

    function setActive(btn) {
      // Reset all to inactive style
      [videoTab, audioTab, subTab].forEach(b => {
        b.style.background = 'transparent';
        b.style.color = '#666';
        b.style.border = '1px solid rgba(255,255,255,0.06)';
        b.style.boxShadow = 'none';
        b.setAttribute('aria-pressed', 'false');
      });

      // Active look: green for main, white text.
      Object.assign(btn.style, {
        background: '#10c56a',
        color: '#fff',
        border: '1px solid rgba(0,0,0,0.06)',
        boxShadow: '0 1px 0 rgba(0,0,0,0.04) inset',
      });
      btn.setAttribute('aria-pressed', 'true');

      // Notify consumer about tab change (guarded to avoid throwing during early render)
      try {
        onTabChange(btn.dataset.format);
      } catch {
        // ignore - avoids visual glitches if consumer manipulates DOM before it's fully appended
      }
    }

    // Add click handlers that also remove focus to prevent outline artifacts
    [videoTab, audioTab, subTab].forEach(btn => {
      btn.addEventListener('click', () => {
        setActive(btn);
        try {
          btn.blur();
        } catch {
          /* ignore */
        }
      });
    });

    tabContainer.appendChild(videoTab);
    tabContainer.appendChild(audioTab);
    tabContainer.appendChild(subTab);

    // Set initial active tab after buttons are appended to DOM to avoid first-render artifacts
    // setTimeout 0 yields the same-tick deferred execution without blocking
    setTimeout(() => setActive(videoTab), 0);

    return tabContainer;
  }

  function buildModalForm() {
    // Quality selection container (we will render custom pill buttons into this div)
    const qualitySelect = document.createElement('div');
    qualitySelect.role = 'radiogroup';
    // allow using .value property like the select element
    qualitySelect.value = DownloadConfig.DEFAULTS.videoQuality;
    Object.assign(qualitySelect.style, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '10px',
      padding: '12px 6px',
      borderRadius: '10px',
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
    });

    const embedCheckbox = document.createElement('input');
    embedCheckbox.type = 'checkbox';
    embedCheckbox.checked = DownloadConfig.DEFAULTS.embedThumbnail;

    const embedLabel = document.createElement('label');
    embedLabel.style.fontSize = '13px';
    embedLabel.style.display = 'flex';
    embedLabel.style.alignItems = 'center';
    embedLabel.style.gap = '6px';
    embedLabel.style.color = '#fff';
    // Keep the embed thumbnail option always enabled but hidden from the UI
    embedLabel.style.display = 'none';
    embedLabel.appendChild(embedCheckbox);
    embedLabel.appendChild(document.createTextNode(t('embedThumbnail')));

    const subtitleWrapper = document.createElement('div');
    subtitleWrapper.style.display = 'none';

    const subtitleSelect = createSubtitleSelect();

    // Subtitle format buttons (SRT/TXT/XML) rendered as pill buttons
    const formatSelect = document.createElement('div');
    formatSelect.role = 'radiogroup';
    formatSelect.value = 'srt';
    Object.assign(formatSelect.style, {
      display: 'flex',
      gap: '8px',
      padding: '6px 0',
      borderRadius: '6px',
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
    });
    ['srt', 'txt', 'xml'].forEach(fmt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.value = fmt;
      btn.textContent = fmt.toUpperCase();
      Object.assign(btn.style, {
        padding: '6px 12px',
        borderRadius: '999px',
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.02)',
        color: '#fff',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '600',
      });
      btn.addEventListener('click', () => {
        Array.from(formatSelect.children).forEach(c => {
          c.style.background = 'transparent';
          c.style.color = '#fff';
          c.style.border = '1px solid rgba(255,255,255,0.08)';
        });
        btn.style.background = '#111';
        btn.style.color = '#10c56a';
        btn.style.border = '1px solid rgba(16,197,106,0.15)';
        formatSelect.value = fmt;
      });
      formatSelect.appendChild(btn);
    });
    // select default
    const _defaultFmtBtn = Array.from(formatSelect.children).find(
      c => c.dataset.value === formatSelect.value
    );
    if (_defaultFmtBtn) _defaultFmtBtn.click();

    subtitleWrapper.appendChild(subtitleSelect);
    subtitleWrapper.appendChild(formatSelect);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = t('cancel');
    Object.assign(cancelBtn.style, {
      padding: '8px 16px',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.12)',
      background: 'transparent',
      cursor: 'pointer',
      fontSize: '14px',
      color: '#fff',
    });

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = t('download');
    Object.assign(downloadBtn.style, {
      padding: '8px 20px',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.12)',
      background: 'transparent',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '600',
    });

    const progressWrapper = document.createElement('div');
    progressWrapper.style.display = 'none';
    progressWrapper.style.marginTop = '12px';

    const progressBar = document.createElement('div');
    Object.assign(progressBar.style, {
      width: '100%',
      height: '3px',
      background: '#e0e0e0',
      borderRadius: '5px',
      overflow: 'hidden',
      marginBottom: '6px',
    });

    const progressFill = document.createElement('div');
    Object.assign(progressFill.style, {
      width: '0%',
      height: '100%',
      background: '#1a73e8',
      transition: 'width 200ms linear',
    });

    progressBar.appendChild(progressFill);

    const progressText = document.createElement('div');
    progressText.style.fontSize = '12px';
    progressText.style.color = '#666';

    progressWrapper.appendChild(progressBar);
    progressWrapper.appendChild(progressText);

    return {
      qualitySelect,
      embedLabel,
      subtitleWrapper,
      subtitleSelect,
      formatSelect,
      cancelBtn,
      downloadBtn,
      progressWrapper,
      progressFill,
      progressText,
    };
  }

  /**
   * Disable form controls during download
   * @param {Object} formParts - Form elements
   */
  function disableFormControls(formParts) {
    try {
      if (formParts.qualitySelect) formParts.qualitySelect.disabled = true;
      if (formParts.downloadBtn) {
        formParts.downloadBtn.disabled = true;
        formParts.downloadBtn.style.opacity = '0.5';
        formParts.downloadBtn.style.cursor = 'not-allowed';
      }
      if (formParts.cancelBtn) formParts.cancelBtn.disabled = true;
    } catch (e) {
      console.error('Error disabling form controls:', e);
    }
  }

  /**
   * Enable form controls after download
   * @param {Object} formParts - Form elements
   */
  function enableFormControls(formParts) {
    try {
      if (formParts.qualitySelect) formParts.qualitySelect.disabled = false;
      if (formParts.downloadBtn) formParts.downloadBtn.disabled = false;
      if (formParts.cancelBtn) formParts.cancelBtn.disabled = false;

      // Reset button styles to ensure they're clickable
      if (formParts.downloadBtn) {
        formParts.downloadBtn.style.opacity = '1';
        formParts.downloadBtn.style.cursor = 'pointer';
        formParts.downloadBtn.style.pointerEvents = 'auto';
      }
    } catch (e) {
      console.error('Error enabling form controls:', e);
    }
  }

  /**
   * Initialize progress display
   * @param {Object} formParts - Form elements
   */
  function initializeProgress(formParts) {
    formParts.progressWrapper.style.display = '';
    formParts.progressFill.style.width = '0%';
    formParts.progressText.textContent = t('starting');
  }

  /**
   * Handle subtitle download
   * @param {Object} formParts - Form elements
   * @param {Function} getSubtitlesData - Function to get subtitles data
   */
  async function handleSubtitleDownload(formParts, getSubtitlesData) {
    const subtitlesData = getSubtitlesData();
    const selectedIndex = parseInt(formParts.subtitleSelect.value, 10);
    const subtitle = subtitlesData.all[selectedIndex];
    const subtitleFormat = formParts.formatSelect.value;

    if (!subtitle) {
      throw new Error(t('noSubtitleSelected'));
    }

    const videoId = getVideoId();
    await downloadSubtitle({
      videoId,
      url: subtitle.url,
      languageCode: subtitle.languageCode,
      languageName: subtitle.name,
      format: subtitleFormat,
      translateTo: subtitle.translateTo || null,
    });
  }

  /**
   * Handle video/audio download
   * @param {Object} formParts - Form elements
   * @param {string} format - Download format
   */
  async function handleMediaDownload(formParts, format) {
    const opts = {
      format,
      quality: formParts.qualitySelect.value,
      audioBitrate: formParts.qualitySelect.value,
      embedThumbnail: format === 'audio',
      onProgress: p => {
        formParts.progressFill.style.width = `${p.percent || 0}%`;
        formParts.progressText.textContent = `${p.percent || 0}% • ${formatBytes(p.loaded || 0)} / ${p.total ? formatBytes(p.total) : '—'}`;
      },
    };

    await downloadVideo(opts);
  }

  /**
   * Complete download and close modal
   * @param {Object} formParts - Form elements
   */
  function completeDownload(formParts) {
    formParts.progressText.textContent = t('completed');
    setTimeout(() => closeModal(), 800);
  }

  /**
   * Handle download error
   * @param {Object} formParts - Form elements
   * @param {Error} err - Error object
   */
  function handleDownloadError(formParts, err) {
    const errorMsg = err?.message || 'Unknown error';
    formParts.progressText.textContent = `${t('downloadFailed')} ${errorMsg}`;
    formParts.progressText.style.color = '#ff5555';

    // Ensure controls are re-enabled even if something goes wrong
    enableFormControls(formParts);

    // Add a safety timeout to force re-enable after 500ms
    setTimeout(() => {
      try {
        enableFormControls(formParts);
      } catch (e) {
        console.error('Failed to re-enable controls:', e);
      }
    }, 500);

    // Reset progress text color after 3 seconds
    setTimeout(() => {
      formParts.progressText.style.color = '#fff';
    }, 3000);
  }

  function wireModalEvents(formParts, activeFormatGetter, getSubtitlesData) {
    formParts.cancelBtn.addEventListener('click', () => closeModal());

    formParts.downloadBtn.addEventListener('click', async () => {
      // Prevent multiple simultaneous downloads
      if (formParts.downloadBtn.disabled) return;

      disableFormControls(formParts);
      initializeProgress(formParts);

      const format = activeFormatGetter();

      try {
        if (format === 'subtitle') {
          await handleSubtitleDownload(formParts, getSubtitlesData);
        } else {
          await handleMediaDownload(formParts, format);
        }
        completeDownload(formParts);
      } catch (err) {
        console.error('[Download Error]:', err);
        handleDownloadError(formParts, err);
      } finally {
        // Extra safety: ensure controls are re-enabled
        setTimeout(() => {
          if (formParts.downloadBtn && !formParts.downloadBtn.disabled) {
            return; // Already enabled
          }
          enableFormControls(formParts);
        }, 1000);
      }
    });
  }

  /**
   * Load subtitles into the provided form parts and fill subtitlesData
   * Separated from createModalUI to reduce function length for linting.
   */
  async function loadSubtitlesForForm(formParts, subtitlesData) {
    const videoId = getVideoId();
    if (!videoId) return;

    formParts.subtitleSelect.setPlaceholder(t('loading'));
    formParts.subtitleSelect.disabled = true;

    try {
      const data = await getSubtitles(videoId);
      if (!data) {
        formParts.subtitleSelect.setPlaceholder(t('noSubtitles'));
        return;
      }

      subtitlesData.original = data.subtitles;
      subtitlesData.translated = data.autoTransSubtitles.map(autot => ({
        ...autot,
        url: data.subtitles[0]?.url || '',
        translateTo: autot.languageCode,
      }));
      subtitlesData.all = [...subtitlesData.original, ...subtitlesData.translated];

      if (subtitlesData.all.length === 0) {
        formParts.subtitleSelect.setPlaceholder(t('noSubtitles'));
        return;
      }

      const opts = subtitlesData.all.map((sub, idx) => ({
        value: idx,
        text: sub.name + (sub.translateTo ? t('autoTranslateSuffix') : ''),
      }));
      formParts.subtitleSelect.setOptions(opts);
      formParts.subtitleSelect.disabled = false;
    } catch (err) {
      logger.error('Failed to load subtitles:', err);
      formParts.subtitleSelect.setPlaceholder(t('subtitleLoadError'));
    }
  }

  /**
   * Update quality/options UI depending on active format.
   * Extracted from createModalUI to satisfy max-lines-per-function.
   */
  function updateQualityOptionsForForm(formParts, activeFormat, subtitlesData) {
    if (activeFormat === 'subtitle') {
      formParts.qualitySelect.style.display = 'none';
      formParts.embedLabel.style.display = 'none';
      formParts.subtitleWrapper.style.display = 'block';
      loadSubtitlesForForm(formParts, subtitlesData);
      return;
    }

    if (activeFormat === 'video') {
      formParts.qualitySelect.style.display = 'flex';
      formParts.embedLabel.style.display = 'none';
      formParts.subtitleWrapper.style.display = 'none';

      // Render custom pill buttons for video qualities, split low/high and show VP9 label
      formParts.qualitySelect.innerHTML = '';
      const lowQuals = DownloadConfig.VIDEO_QUALITIES.filter(q => parseInt(q, 10) <= 1080);
      const highQuals = DownloadConfig.VIDEO_QUALITIES.filter(q => parseInt(q, 10) > 1080);

      function makeQualityButton(q) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.value = q;
        btn.textContent = `${q}p`;
        Object.assign(btn.style, {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          borderRadius: '999px',
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.02)',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: '600',
        });

        btn.addEventListener('click', () => {
          Array.from(formParts.qualitySelect.children).forEach(c => {
            if (c.dataset && c.dataset.value) {
              c.style.background = 'transparent';
              c.style.color = '#fff';
              c.style.border = '1px solid rgba(255,255,255,0.08)';
            }
          });
          btn.style.background = '#111';
          btn.style.color = '#10c56a';
          btn.style.border = '1px solid rgba(16,197,106,0.15)';
          formParts.qualitySelect.value = q;
        });

        return btn;
      }

      lowQuals.forEach(q => formParts.qualitySelect.appendChild(makeQualityButton(q)));

      if (highQuals.length > 0) {
        const labelWrap = document.createElement('div');
        Object.assign(labelWrap.style, {
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          width: '100%',
          margin: '8px 0',
        });
        const lineLeft = document.createElement('div');
        lineLeft.style.flex = '1';
        lineLeft.style.borderTop = '1px solid rgba(255,255,255,0.06)';
        const label = document.createElement('div');
        label.textContent = t('vp9Label');
        Object.assign(label.style, {
          fontSize: '12px',
          color: 'rgba(255,255,255,0.7)',
          padding: '0 8px',
        });
        const lineRight = document.createElement('div');
        lineRight.style.flex = '1';
        lineRight.style.borderTop = '1px solid rgba(255,255,255,0.06)';
        labelWrap.appendChild(lineLeft);
        labelWrap.appendChild(label);
        labelWrap.appendChild(lineRight);
        formParts.qualitySelect.appendChild(labelWrap);

        highQuals.forEach(q => formParts.qualitySelect.appendChild(makeQualityButton(q)));
      }

      // select default
      formParts.qualitySelect.value = DownloadConfig.DEFAULTS.videoQuality;
      const defaultBtn = Array.from(formParts.qualitySelect.children).find(
        c => c.dataset && c.dataset.value === formParts.qualitySelect.value
      );
      if (defaultBtn) defaultBtn.click();

      return;
    }

    // audio
    formParts.qualitySelect.style.display = 'flex';
    formParts.embedLabel.style.display = 'flex';
    formParts.subtitleWrapper.style.display = 'none';

    // Render pill buttons for audio bitrates
    formParts.qualitySelect.innerHTML = '';
    DownloadConfig.AUDIO_BITRATES.forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.value = b;
      btn.textContent = `${b} kbps`;
      Object.assign(btn.style, {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        borderRadius: '999px',
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.02)',
        color: '#fff',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '600',
      });

      btn.addEventListener('click', () => {
        Array.from(formParts.qualitySelect.children).forEach(c => {
          c.style.background = 'transparent';
          c.style.color = '#fff';
          c.style.border = '1px solid rgba(255,255,255,0.08)';
        });
        btn.style.background = '#111';
        btn.style.color = '#10c56a';
        btn.style.border = '1px solid rgba(16,197,106,0.15)';
        formParts.qualitySelect.value = b;
      });

      formParts.qualitySelect.appendChild(btn);
    });
    formParts.qualitySelect.value = DownloadConfig.DEFAULTS.audioBitrate;
    const defaultAudioBtn = Array.from(formParts.qualitySelect.children).find(
      c => c.dataset.value === formParts.qualitySelect.value
    );
    if (defaultAudioBtn) defaultAudioBtn.click();
    // Do not show the embed thumbnail control in the UI; embedding is always enabled
    formParts.embedLabel.style.display = 'none';
  }

  function createModalUI() {
    if (_modalElements) return _modalElements;

    let activeFormat = 'video';
    const subtitlesData = { all: [], original: [], translated: [] };

    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '999999',
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
      width: '420px',
      maxWidth: '94%',
      background: 'rgba(20,20,20,0.64)',
      color: '#fff',
      borderRadius: '12px',
      boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      fontFamily: 'Arial, sans-serif',
      border: '1px solid rgba(255,255,255,0.06)',
      backdropFilter: 'blur(8px)',
    });

    const formParts = buildModalForm();

    const tabContainer = createTabButtons(format => {
      activeFormat = format;
      updateQualityOptionsForForm(formParts, activeFormat, subtitlesData);
    });

    const content = document.createElement('div');
    content.style.padding = '16px';
    content.appendChild(formParts.qualitySelect);
    content.appendChild(formParts.embedLabel);
    content.appendChild(formParts.subtitleWrapper);
    content.appendChild(formParts.progressWrapper);

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, {
      display: 'flex',
      gap: '8px',
      padding: '16px',
      justifyContent: 'center',
    });
    btnRow.appendChild(formParts.cancelBtn);
    btnRow.appendChild(formParts.downloadBtn);

    box.appendChild(tabContainer);
    box.appendChild(content);
    box.appendChild(btnRow);
    overlay.appendChild(box);

    updateQualityOptionsForForm(formParts, activeFormat, subtitlesData);
    wireModalEvents(
      formParts,
      () => activeFormat,
      () => subtitlesData
    );
    _modalElements = { overlay, box, ...formParts };
    return _modalElements;
  }

  function openModal() {
    const els = createModalUI();
    if (!els) return;
    try {
      if (!document.body.contains(els.overlay)) document.body.appendChild(els.overlay);
    } catch {
      /* ignore */
    }
  }

  function closeModal() {
    if (!_modalElements) return;
    try {
      // Clean up subtitle select listener to prevent document click leak
      const ss = _modalElements.overlay?.querySelector('[role="listbox"]');
      if (ss && typeof ss.destroy === 'function') ss.destroy();
      if (_modalElements.overlay && _modalElements.overlay.parentNode) {
        _modalElements.overlay.parentNode.removeChild(_modalElements.overlay);
      }
    } catch {
      /* ignore */
    }
    _modalElements = null;
  }

  // ============================================================================
  // DOWNLOAD BUTTON UI (merged from download-button.js)
  // ============================================================================

  /**
   * Helper to wait for download API to be available
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<Object|undefined>} Download API or undefined
   */
  const waitForDownloadAPI = timeout =>
    new Promise(resolve => {
      const interval = 200;
      let waited = 0;

      if (typeof window.YouTubePlusDownload !== 'undefined') {
        return resolve(window.YouTubePlusDownload);
      }

      const id = setInterval(() => {
        waited += interval;
        if (typeof window.YouTubePlusDownload !== 'undefined') {
          clearInterval(id);
          return resolve(window.YouTubePlusDownload);
        }
        if (waited >= timeout) {
          clearInterval(id);
          return resolve(undefined);
        }
      }, interval);
    });

  /**
   * Fallback clipboard copy for older browsers
   * @param {string} text - Text to copy
   * @param {Function} tFn - Translation function
   * @param {Object} notificationMgr - Notification manager
   */
  const fallbackCopyToClipboard = (text, tFn, notificationMgr) => {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    notificationMgr.show(tFn('copiedToClipboard'), {
      duration: 2000,
      type: 'success',
    });
  };

  /**
   * Build URL from template
   * @param {string} template - URL template
   * @param {string} videoId - Video ID
   * @param {string} videoUrl - Full video URL
   * @returns {string} Built URL
   */
  const buildUrl = (template, videoId, videoUrl) =>
    (template || '')
      .replace('{videoId}', videoId || '')
      .replace('{videoUrl}', encodeURIComponent(videoUrl || ''));

  /**
   * Create download button element
   * @param {Function} tFn - Translation function
   * @returns {HTMLElement} Button element
   */
  const createButtonElement = tFn => {
    const button = document.createElement('div');
    button.className = 'ytp-button ytp-download-button';
    button.setAttribute('title', tFn('downloadOptions'));
    button.setAttribute('tabindex', '0');
    button.setAttribute('role', 'button');
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = `
      <svg fill="currentColor" width="24" height="24" viewBox="0 0 256 256" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto;vertical-align:middle;">
        <path d="M83.17188,112.83984a4.00026,4.00026,0,0,1,5.65624-5.6582L124,142.34473V40a4,4,0,0,1,8,0V142.34473l35.17188-35.16309a4.00026,4.00026,0,0,1,5.65624,5.6582l-42,41.98926a4.00088,4.00088,0,0,1-5.65624,0ZM216,148a4.0002,4.0002,0,0,0-4,4v56a4.00427,4.00427,0,0,1-4,4H48a4.00427,4.00427,0,0,1-4-4V152a4,4,0,0,0-8,0v56a12.01343,12.01343,0,0,0,12,12H208a12.01343,12.01343,0,0,0,12-12V152A4.0002,4.0002,0,0,0,216,148Z"/>
      </svg>
    `;
    return button;
  };

  /**
   * Position dropdown below button (batched with RAF)
   * @param {HTMLElement} button - Button element
   * @param {HTMLElement} dropdown - Dropdown element
   */
  const positionDropdown = (() => {
    let rafId = null;
    let pendingButton = null;
    let pendingDropdown = null;

    const applyPosition = () => {
      if (!pendingButton || !pendingDropdown) return;

      const rect = pendingButton.getBoundingClientRect();
      const left = Math.max(8, rect.left + rect.width / 2 - 75);
      const bottom = Math.max(8, window.innerHeight - rect.top + 12);
      pendingDropdown.style.left = `${left}px`;
      pendingDropdown.style.bottom = `${bottom}px`;

      rafId = null;
      pendingButton = null;
      pendingDropdown = null;
    };

    return (button, dropdown) => {
      pendingButton = button;
      pendingDropdown = dropdown;

      if (rafId !== null) return; // Already scheduled
      rafId = requestAnimationFrame(applyPosition);
    };
  })();

  /**
   * Download Site Actions - Handle different types of downloads
   */
  const createDownloadActions = (tFn, ytUtils) => {
    /**
     * Handle direct download
     */
    const handleDirectDownload = async () => {
      const api = await waitForDownloadAPI(2000);
      if (!api) {
        console.error('[YouTube+] Direct download module not loaded');
        ytUtils.NotificationManager.show(tFn('directDownloadModuleNotAvailable'), {
          duration: 3000,
          type: 'error',
        });
        return;
      }

      try {
        if (typeof api.openModal === 'function') {
          api.openModal();
          return;
        }
        if (typeof api.downloadVideo === 'function') {
          await api.downloadVideo({ format: 'video', quality: '1080' });
          return;
        }
      } catch (err) {
        console.error('[YouTube+] Direct download invocation failed:', err);
      }

      ytUtils.NotificationManager.show(tFn('directDownloadModuleNotAvailable'), {
        duration: 3000,
        type: 'error',
      });
    };

    /**
     * Handle YTDL download - copies URL to clipboard and opens YTDL
     * @param {string} url - YTDL URL
     */
    const handleYTDLDownload = url => {
      const videoId = new URLSearchParams(location.search).get('v');
      const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : location.href;

      // Copy to clipboard
      navigator.clipboard
        .writeText(videoUrl)
        .then(() => {
          ytUtils.NotificationManager.show(tFn('copiedToClipboard'), {
            duration: 2000,
            type: 'success',
          });
        })
        .catch(() => {
          fallbackCopyToClipboard(videoUrl, tFn, ytUtils.NotificationManager);
        });

      // Open YTDL in new tab
      window.open(url, '_blank');
    };

    /**
     * Helper to open download site or trigger direct download
     * @param {string} url - Download URL
     * @param {boolean} isYTDL - Whether this is YTDL download
     * @param {boolean} isDirect - Whether this is direct download
     * @param {HTMLElement} dropdown - Dropdown element to hide
     * @param {HTMLElement} button - Button element
     */
    const openDownloadSite = (url, isYTDL, isDirect, dropdown, button) => {
      dropdown.classList.remove('visible');
      button.setAttribute('aria-expanded', 'false');

      if (isDirect) {
        handleDirectDownload();
        return;
      }

      if (isYTDL) {
        handleYTDLDownload(url);
        return;
      }

      window.open(url, '_blank');
    };

    return { handleDirectDownload, handleYTDLDownload, openDownloadSite };
  };

  /**
   * Download Sites Configuration Builder
   * @param {Function} tFn - Translation function
   * @returns {Function} Builder function
   */
  const createDownloadSitesBuilder = tFn => {
    return (customization, enabledSites, videoId, videoUrl) => {
      const baseSites = [
        {
          key: 'externalDownloader',
          name: customization?.externalDownloader?.name || 'SSYouTube',
          url: buildUrl(
            customization?.externalDownloader?.url || `https://ssyoutube.com/watch?v={videoId}`,
            videoId,
            videoUrl
          ),
          isYTDL: false,
          isDirect: false,
        },
        {
          key: 'ytdl',
          name: 'by YTDL',
          url: `http://localhost:5005`,
          isYTDL: true,
          isDirect: false,
        },
        {
          key: 'direct',
          name: tFn('directDownload'),
          url: '#',
          isYTDL: false,
          isDirect: true,
        },
      ];

      const downloadSites = baseSites.filter(s => enabledSites[s.key] !== false);
      return { baseSites, downloadSites };
    };
  };

  /**
   * Create dropdown options element
   * @param {Array} downloadSites - Download sites configuration
   * @param {HTMLElement} button - Button element
   * @param {Function} openDownloadSiteFn - Click handler
   * @returns {HTMLElement} Dropdown element
   */
  const createDropdownOptions = (downloadSites, button, openDownloadSiteFn) => {
    const options = document.createElement('div');
    options.className = 'download-options';
    options.setAttribute('role', 'menu');

    const list = document.createElement('div');
    list.className = 'download-options-list';

    downloadSites.forEach(site => {
      const opt = document.createElement('div');
      opt.className = 'download-option-item';
      opt.textContent = site.name;
      opt.setAttribute('role', 'menuitem');
      opt.setAttribute('tabindex', '0');

      opt.dataset.url = site.url;
      opt.dataset.isYtdl = site.isYTDL ? 'true' : 'false';
      opt.dataset.isDirect = site.isDirect ? 'true' : 'false';

      list.appendChild(opt);
    });

    const handleOptionActivate = item => {
      if (!item) return;
      openDownloadSiteFn(
        item.dataset.url,
        item.dataset.isYtdl === 'true',
        item.dataset.isDirect === 'true',
        options,
        button
      );
    };

    list.addEventListener('click', e => {
      const item = e.target?.closest?.('.download-option-item');
      if (!item || !list.contains(item)) return;
      handleOptionActivate(item);
    });

    list.addEventListener('keydown', e => {
      const item = e.target?.closest?.('.download-option-item');
      if (!item || !list.contains(item)) return;
      if (e.key === 'Enter' || e.key === ' ') {
        handleOptionActivate(item);
      }
    });

    options.appendChild(list);
    return options;
  };

  /**
   * Setup dropdown hover behavior with event delegation
   * Uses WeakMap to store timers per button/dropdown pair
   */
  const setupDropdownHoverBehavior = (() => {
    let initialized = false;
    const dropdownTimers = new WeakMap();

    const getTimer = element => dropdownTimers.get(element);
    const setTimer = (element, timerId) => dropdownTimers.set(element, timerId);
    const clearTimer = element => {
      const timerId = getTimer(element);
      if (timerId !== undefined) {
        clearTimeout(timerId);
        dropdownTimers.delete(element);
      }
    };

    const showDropdown = (button, dropdown) => {
      clearTimer(button);
      clearTimer(dropdown);
      positionDropdown(button, dropdown);
      dropdown.classList.add('visible');
      button.setAttribute('aria-expanded', 'true');
    };

    const hideDropdown = (button, dropdown) => {
      clearTimer(button);
      clearTimer(dropdown);
      const timerId = setTimeout(() => {
        dropdown.classList.remove('visible');
        button.setAttribute('aria-expanded', 'false');
      }, 180);
      setTimer(button, timerId);
    };

    const initDelegation = () => {
      if (initialized) return;
      initialized = true;

      // Mouseenter/mouseleave delegation on document with capture phase
      document.addEventListener(
        'mouseenter',
        e => {
          const button = e.target?.closest?.('.ytp-download-button');
          if (button) {
            const dropdown = $('.download-options');
            if (dropdown) {
              clearTimer(button);
              clearTimer(dropdown);
              showDropdown(button, dropdown);
            }
            return;
          }

          const dropdown = e.target?.closest?.('.download-options');
          if (dropdown) {
            const button = $('.ytp-download-button');
            if (button) {
              clearTimer(button);
              clearTimer(dropdown);
              showDropdown(button, dropdown);
            }
          }
        },
        true
      );

      document.addEventListener(
        'mouseleave',
        e => {
          const button = e.target?.closest?.('.ytp-download-button');
          if (button) {
            const dropdown = $('.download-options');
            if (dropdown) {
              clearTimer(button);
              clearTimer(dropdown);
              const timerId = setTimeout(() => hideDropdown(button, dropdown), 180);
              setTimer(button, timerId);
            }
            return;
          }

          const dropdown = e.target?.closest?.('.download-options');
          if (dropdown) {
            const button = $('.ytp-download-button');
            if (button) {
              clearTimer(button);
              clearTimer(dropdown);
              const timerId = setTimeout(() => hideDropdown(button, dropdown), 180);
              setTimer(dropdown, timerId);
            }
          }
        },
        true
      );

      // Keydown delegation for Enter/Space on button
      document.addEventListener('keydown', e => {
        const button = e.target?.closest?.('.ytp-download-button');
        if (!button) return;

        if (e.key === 'Enter' || e.key === ' ') {
          const dropdown = $('.download-options');
          if (!dropdown) return;

          if (dropdown.classList.contains('visible')) {
            hideDropdown(button, dropdown);
          } else {
            showDropdown(button, dropdown);
          }
        }
      });
    };

    // Return function that just initializes delegation once
    return () => {
      initDelegation();
    };
  })();

  /**
   * Download Button Manager - Handles download button creation and dropdown management
   * @param {Object} config - Configuration object
   * @param {Object} config.settings - Settings object
   * @param {Function} config.t - Translation function
   * @param {Function} config.getElement - Get element function
   * @param {Object} config.YouTubeUtils - YouTube utilities
   * @returns {Object} Download button manager API
   */
  const createDownloadButtonManager = config => {
    const { settings, t: tFn, getElement, YouTubeUtils: ytUtils } = config;

    const actions = createDownloadActions(tFn, ytUtils);
    const buildDownloadSites = createDownloadSitesBuilder(tFn);

    /**
     * Add download button to controls
     * @param {HTMLElement} controls - Controls container
     */
    const addDownloadButton = controls => {
      if (!settings.enableDownload) return;

      try {
        const existingBtn = controls.querySelector('.ytp-download-button');
        if (existingBtn) existingBtn.remove();
      } catch {
        // ignore
      }

      const videoId = new URLSearchParams(location.search).get('v');
      const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : location.href;

      const customization = settings.downloadSiteCustomization || {
        externalDownloader: { name: 'SSYouTube', url: 'https://ssyoutube.com/watch?v={videoId}' },
      };

      const enabledSites = settings.downloadSites || {
        externalDownloader: true,
        ytdl: true,
        direct: true,
      };
      const { downloadSites } = buildDownloadSites(customization, enabledSites, videoId, videoUrl);

      const button = createButtonElement(tFn);

      if (downloadSites.length === 1) {
        const singleSite = downloadSites[0];
        button.style.cursor = 'pointer';
        const tempDropdown = document.createElement('div');
        button.addEventListener('click', () =>
          actions.openDownloadSite(
            singleSite.url,
            singleSite.isYTDL,
            singleSite.isDirect,
            tempDropdown,
            button
          )
        );
        controls.insertBefore(button, controls.firstChild);
        return;
      }

      const dropdown = createDropdownOptions(downloadSites, button, actions.openDownloadSite);

      const existingDownload = $('.download-options');
      if (existingDownload) existingDownload.remove();

      try {
        document.body.appendChild(dropdown);
      } catch {
        button.appendChild(dropdown);
      }

      setupDropdownHoverBehavior(button, dropdown);

      try {
        if (typeof window !== 'undefined') {
          window.youtubePlus = window.youtubePlus || {};
          window.youtubePlus.downloadButtonManager = window.youtubePlus.downloadButtonManager || {};

          window.youtubePlus.downloadButtonManager.addDownloadButton = controlsArg =>
            addDownloadButton(controlsArg);
          window.youtubePlus.downloadButtonManager.refreshDownloadButton = () => {
            try {
              const btn = $('.ytp-download-button');
              const dd = $('.download-options');

              // If we should show downloads but the elements are missing, attempt to recreate
              if (settings.enableDownload && (!btn || !dd)) {
                try {
                  const controlsEl = $('.ytp-right-controls');
                  if (controlsEl) {
                    // recreate button + dropdown
                    addDownloadButton(controlsEl);
                  }
                } catch {
                  /* ignore recreation errors */
                }
              }

              if (settings.enableDownload) {
                if (btn) btn.style.display = '';
                if (dd) dd.style.display = '';
              } else {
                if (btn) btn.style.display = 'none';
                if (dd) dd.style.display = 'none';
              }
            } catch {
              /* ignore */
            }
          };

          window.youtubePlus.rebuildDownloadDropdown = () => {
            try {
              const controlsEl = $('.ytp-right-controls');
              if (!controlsEl) return;
              window.youtubePlus.downloadButtonManager.addDownloadButton(controlsEl);
              window.youtubePlus.settings = window.youtubePlus.settings || settings;
            } catch (e) {
              console.warn('[YouTube+] rebuildDownloadDropdown failed:', e);
            }
          };
        }
      } catch (e) {
        console.warn('[YouTube+] expose rebuildDownloadDropdown failed:', e);
      }

      controls.insertBefore(button, controls.firstChild);
    };

    /**
     * Refresh download button visibility based on settings
     */
    const refreshDownloadButton = () => {
      const button = getElement('.ytp-download-button');
      let dropdown = $('.download-options');

      // If downloads are enabled but the dropdown/button are missing, recreate them
      if (settings.enableDownload && (!button || !dropdown)) {
        try {
          const controlsEl = $('.ytp-right-controls');
          if (controlsEl) {
            addDownloadButton(controlsEl);
            // re-query after creation
            dropdown = $('.download-options');
          }
        } catch (e) {
          logger && logger.warn && logger.warn('[YouTube+] recreate download button failed:', e);
        }
      }

      if (settings.enableDownload) {
        if (button) button.style.display = '';
        if (dropdown) dropdown.style.display = '';
      } else {
        if (button) button.style.display = 'none';
        if (dropdown) dropdown.style.display = 'none';
      }
    };

    return {
      addDownloadButton,
      refreshDownloadButton,
    };
  };

  // ============================================================================
  // MODULE INITIALIZATION
  // ============================================================================

  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;
    try {
      window.YouTubeUtils &&
        YouTubeUtils.logger &&
        YouTubeUtils.logger.debug &&
        YouTubeUtils.logger.debug('[YouTube+ Download] Unified module loaded');
      window.YouTubeUtils &&
        YouTubeUtils.logger &&
        YouTubeUtils.logger.debug &&
        YouTubeUtils.logger.debug(
          '[YouTube+ Download] Use window.YouTubePlusDownload.downloadVideo() to download'
        );
      window.YouTubeUtils &&
        YouTubeUtils.logger &&
        YouTubeUtils.logger.debug &&
        YouTubeUtils.logger.debug('[YouTube+ Download] Button manager available');
    } catch {}
  }

  // Export public API
  if (typeof window !== 'undefined') {
    window.YouTubePlusDownload = {
      downloadVideo,

      // Subtitle functions
      getSubtitles,
      downloadSubtitle,

      // Utility functions
      getVideoId,
      getVideoUrl,
      getVideoTitle,
      sanitizeFilename,
      formatBytes,

      // Configuration
      DownloadConfig,

      // UI: open modal for user selection
      openModal,

      // Initialize (called automatically)
      init,
    };

    // Export button manager for basic.js
    window.YouTubePlusDownloadButton = { createDownloadButtonManager };
  }

  // Export module to global scope for module loader
  if (typeof window !== 'undefined') {
    window.YouTubeDownload = {
      init,
      openModal,
      getVideoId,
      getVideoTitle,
      version: '3.0',
    };
  }

  const ensureInit = () => {
    if (!isRelevantRoute()) return;
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(init, { timeout: 1500 });
    } else {
      setTimeout(init, 0);
    }
  };

  onDomReady(ensureInit);

  if (window.YouTubeUtils?.cleanupManager?.registerListener) {
    YouTubeUtils.cleanupManager.registerListener(document, 'yt-navigate-finish', ensureInit, {
      passive: true,
    });
  } else {
    document.addEventListener('yt-navigate-finish', ensureInit, { passive: true });
  }
})();
