/**
 * Feature Voting System
 * Supabase-powered voting via REST API
 */

(function () {
  'use strict';
  const _createHTML = window._ytplusCreateHTML || ((/** @type {string} */ s) => s);

  if (typeof window === 'undefined') return;

  const SUPABASE_URL = 'https://ldpccocxlrdsyejfhrvc.supabase.co';
  // This is a Supabase anonymous (public) key — intentionally embedded in client-side code.
  // It has read-only / limited permissions enforced by Row Level Security (RLS) on the server.
  // It is NOT a secret: https://supabase.com/docs/guides/api#api-keys
  const SUPABASE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxkcGNjb2N4bHJkc3llamZocnZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMTAyNDYsImV4cCI6MjA4Nzc4NjI0Nn0.QfwrAG4SMJBPLoP-Mcq3hETQXt0ezinoi0CpN57Zn90';

  const PREVIEW_FEATURE_TITLE = '__ytp_preview_vote__';
  const PREVIEW_FEATURE_DESC = 'Internal row for ytp-plus-voting-preview';

  let votingInitialized = false;
  let voteRequestInFlight = false;
  /** @type {Record<string, any[]>} */
  let votingCommentsCache = {};
  /** @type {Record<string, any>} */
  let votingFeaturesCache = {};
  /** @type {number|null} */
  let settingsPanelBaseMarginLeftPx = null;

  const getSettingsShell = () =>
    /** @type {HTMLElement|null} */ (document.querySelector('.ytp-plus-settings-shell'));

  const getSettingsPanel = () =>
    /** @type {HTMLElement|null} */ (document.querySelector('.ytp-plus-settings-panel'));

  function ensureSettingsPanelBaseMargin() {
    if (settingsPanelBaseMarginLeftPx !== null) return;
    const settingsShell = getSettingsShell();
    if (!(settingsShell instanceof HTMLElement)) return;
    const parsed = parseFloat(window.getComputedStyle(settingsShell).marginLeft || '0');
    settingsPanelBaseMarginLeftPx = Number.isFinite(parsed) ? parsed : 0;
  }

  function setSettingsPanelOffset(/** @type {number} */ offsetPx) {
    const settingsShell = getSettingsShell();
    if (!(settingsShell instanceof HTMLElement)) return;
    ensureSettingsPanelBaseMargin();
    const base = settingsPanelBaseMarginLeftPx || 0;
    settingsShell.style.marginLeft = `${Math.round(base + offsetPx)}px`;
  }

  function layoutCommentsPanel(/** @type {HTMLElement} */ sidePanel) {
    const settingsShell = getSettingsShell();
    const settingsPanel = getSettingsPanel();
    if (!(settingsShell instanceof HTMLElement) || !(settingsPanel instanceof HTMLElement)) return;

    const initialRect = settingsPanel.getBoundingClientRect();
    const width = Math.min(440, Math.floor(window.innerWidth * 0.34));
    const gap = 12;
    const rightSpace = window.innerWidth - initialRect.right;
    const hasEnoughRightSpace = rightSpace >= width + gap;

    const idealOffset = hasEnoughRightSpace
      ? -Math.round((width + gap) / 2)
      : Math.round((width + gap) / 2);
    setSettingsPanelOffset(idealOffset);

    const alignedPanel = getSettingsPanel();
    if (!(alignedPanel instanceof HTMLElement)) return;
    const rect = alignedPanel.getBoundingClientRect();
    const rightSpaceAfterShift = window.innerWidth - rect.right;
    let left = rect.right + gap;
    if (rightSpaceAfterShift < width + gap) {
      left = Math.max(8, rect.left - width - gap);
    }

    sidePanel.style.left = `${Math.max(8, left)}px`;
    sidePanel.style.top = `${Math.max(8, rect.top)}px`;
    sidePanel.style.height = `${Math.max(260, rect.height)}px`;
  }

  function resetSettingsPanelOffset() {
    const settingsShell = getSettingsShell();
    if (!(settingsShell instanceof HTMLElement)) {
      settingsPanelBaseMarginLeftPx = null;
      return;
    }
    if (settingsPanelBaseMarginLeftPx !== null) {
      settingsShell.style.marginLeft = `${Math.round(settingsPanelBaseMarginLeftPx)}px`;
    } else {
      settingsShell.style.removeProperty('margin-left');
    }
    settingsPanelBaseMarginLeftPx = null;
  }

  function setVoteControlsBusy(/** @type {Element|null} */ container, /** @type {boolean} */ busy) {
    if (!container) return;
    container
      .querySelectorAll('.ytp-plus-vote-btn, .ytp-plus-vote-bar-btn')
      .forEach((/** @type {any} */ el) => {
        if (busy) {
          el.setAttribute('aria-disabled', 'true');
          el.style.pointerEvents = 'none';
          el.style.opacity = '0.7';
        } else {
          el.removeAttribute('aria-disabled');
          el.style.pointerEvents = '';
          el.style.opacity = '';
        }
      });
  }

  const t = window.YouTubeUtils?.t || ((/** @type {string} */ key) => key || '');

  const tf = (
    /** @type {string} */ key,
    /** @type {string} */ fallback,
    /** @type {Record<string, any>} */ params = {}
  ) => {
    try {
      const value = t(key, params);
      if (typeof value === 'string' && value && value !== key) return value;
    } catch (e) {
      // Non-critical, suppressed
    }
    return fallback || key || '';
  };

  function getStatusMeta(/** @type {string} */ status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'completed') {
      return {
        className: 'completed',
        label: tf('statusCompleted', 'Completed'),
      };
    }
    if (normalized === 'in_progress') {
      return {
        className: 'in-progress',
        label: tf('statusInProgress', 'In progress'),
      };
    }
    return {
      className: 'proposed',
      label: tf('statusProposed', 'Proposed'),
    };
  }

  // No fallback feature card — when there are no user feature requests,
  // the list simply shows "No feature requests yet". The preview row in the DB
  // (__ytp_preview_vote__) is used only for the aggregate vote bar.

  function getLocalUserId() {
    let userId = localStorage.getItem('ytp_voting_user_id');
    if (!userId) {
      // Use crypto.getRandomValues for stronger randomness instead of Math.random
      const arr = new Uint8Array(16);
      typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues
        ? globalThis.crypto.getRandomValues(arr)
        : arr.forEach((_, i, a) => {
            a[i] = (Math.random() * 256) | 0;
          });
      const hex = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
      userId = 'user_' + hex + '_' + Date.now().toString(36);
      localStorage.setItem('ytp_voting_user_id', userId);
    }
    return userId;
  }

  function normalizeVoteType(/** @type {any} */ value) {
    const numeric = Number(value);
    if (numeric === 1) return 1;
    if (numeric === -1) return -1;
    return 0;
  }

  async function supabaseFetch(/** @type {string} */ endpoint, /** @type {any} */ options = {}) {
    const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...headers, ...options.headers },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      const data = await response.json().catch(() => null);
      return { data, error: null };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { data: null, error: msg };
    }
  }

  async function getFeatures() {
    const { data, error } = await supabaseFetch(
      'ytplus_feature_requests?select=*&order=created_at.desc'
    );
    if (error) {
      console.error('[Voting] Error fetching features:', error);
      return [];
    }
    return data || [];
  }

  async function getAllVotes() {
    const { data, error } = await supabaseFetch(
      'ytplus_feature_votes?select=feature_id,vote_type,ip_address'
    );
    if (error) {
      console.error('[Voting] Error fetching votes:', error);
      return {};
    }
    /** @type {Record<string, {upvotes: number, downvotes: number}>} */
    const votes = {};
    (data || []).forEach((/** @type {any} */ v) => {
      if (!votes[v.feature_id]) {
        votes[v.feature_id] = { upvotes: 0, downvotes: 0 };
      }
      const voteType = normalizeVoteType(v.vote_type);
      if (voteType === 1) votes[v.feature_id].upvotes++;
      else if (voteType === -1) votes[v.feature_id].downvotes++;
    });
    return votes;
  }

  async function getUserVotes() {
    const userId = getLocalUserId();
    const { data, error } = await supabaseFetch(
      `ytplus_feature_votes?select=feature_id,vote_type&ip_address=eq.${userId}`
    );
    if (error) {
      console.error('[Voting] Error fetching user votes:', error);
      return {};
    }
    /** @type {Record<string, number>} */
    const userVotes = {};
    (data || []).forEach((/** @type {any} */ v) => {
      const voteType = normalizeVoteType(v.vote_type);
      if (voteType) userVotes[v.feature_id] = voteType;
    });
    return userVotes;
  }

  async function vote(/** @type {string} */ featureId, /** @type {number} */ voteType) {
    const userId = getLocalUserId();

    const { data: existing } = await supabaseFetch(
      `ytplus_feature_votes?feature_id=eq.${featureId}&ip_address=eq.${userId}&select=id`
    );

    if (existing && existing.length > 0) {
      const existingVote = existing[0];
      if (voteType === 0) {
        await supabaseFetch(`ytplus_feature_votes?id=eq.${existingVote.id}`, { method: 'DELETE' });
        return { success: true, action: 'removed' };
      }
      await supabaseFetch(`ytplus_feature_votes?id=eq.${existingVote.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ vote_type: voteType }),
      });
      return { success: true, action: 'updated' };
    }

    if (voteType === 0) {
      return { success: true, action: 'none' };
    }

    const { error } = await supabaseFetch('ytplus_feature_votes', {
      method: 'POST',
      body: JSON.stringify({
        feature_id: featureId,
        vote_type: voteType,
        ip_address: userId,
      }),
    });

    if (error) {
      console.error('[Voting] Vote error:', error);
      return { success: false, error };
    }
    return { success: true, action: 'added' };
  }

  async function submitFeature(/** @type {string} */ title, /** @type {string} */ description) {
    const MAX_TITLE = 200;
    const MAX_DESC = 2000;
    const stripHTML = (/** @type {string} */ s) =>
      String(s || '')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const normalizeTitle = (/** @type {string} */ value) => stripHTML(value).toLocaleLowerCase();

    title = stripHTML(title).slice(0, MAX_TITLE);
    description = stripHTML(description).slice(0, MAX_DESC);

    if (!title) {
      return { success: false, error: 'Title is required' };
    }

    if (normalizeTitle(title) === PREVIEW_FEATURE_TITLE.toLocaleLowerCase()) {
      return { success: false, error: 'This title is reserved' };
    }

    const existingFeatures = await getFeatures();
    const normalizedTitle = normalizeTitle(title);
    const duplicateFeature = (existingFeatures || []).find(
      (/** @type {any} */ feature) =>
        normalizeTitle(String(feature?.title || '')) === normalizedTitle
    );
    if (duplicateFeature) {
      return { success: false, error: 'Feature already exists' };
    }

    const userId = getLocalUserId();
    const { error } = await supabaseFetch('ytplus_feature_requests', {
      method: 'POST',
      body: JSON.stringify({
        title,
        description,
        author_ip: userId,
      }),
    });

    if (error) {
      console.error('[Voting] Submit error:', error);
      return { success: false, error };
    }
    return { success: true };
  }

  async function getCommentsByFeatureIds(/** @type {string[]} */ featureIds) {
    const ids = (featureIds || []).filter(Boolean);
    if (ids.length === 0) return {};

    const inClause = ids.join(',');
    const { data, error } = await supabaseFetch(
      `ytplus_feature_comments?select=id,feature_id,comment,author_ip,created_at&feature_id=in.(${inClause})&order=created_at.asc`
    );

    if (error) {
      console.error('[Voting] Error fetching comments:', error);
      return {};
    }

    /** @type {Record<string, any[]>} */
    const grouped = {};
    (data || []).forEach((/** @type {any} */ c) => {
      const featureId = String(c?.feature_id || '');
      if (!featureId) return;
      if (!grouped[featureId]) grouped[featureId] = [];
      grouped[featureId].push(c);
    });
    return grouped;
  }

  async function addComment(/** @type {string} */ featureId, /** @type {string} */ commentText) {
    const text = String(commentText || '')
      .replace(/<[^>]*>/g, '')
      .trim()
      .slice(0, 1000);
    if (!text) {
      return { success: false, error: 'Comment is required' };
    }

    const userId = getLocalUserId();
    const { error } = await supabaseFetch('ytplus_feature_comments', {
      method: 'POST',
      body: JSON.stringify({
        feature_id: featureId,
        comment: text,
        author_ip: userId,
      }),
    });

    if (error) {
      console.error('[Voting] Add comment error:', error);
      return { success: false, error };
    }

    return { success: true };
  }

  function formatCommentDate(/** @type {string} */ value) {
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleString();
    } catch (e) {
      return '';
    }
  }

  function isPreviewFeature(/** @type {any} */ feature) {
    return String(feature?.title || '').trim() === PREVIEW_FEATURE_TITLE;
  }

  function getRenderableFeatureTitle(/** @type {any} */ feature) {
    return String(feature?.title || '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getRenderableFeatureDescription(/** @type {any} */ feature) {
    return String(feature?.description || '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getNormalizedRenderableFeatureTitle(/** @type {any} */ feature) {
    return getRenderableFeatureTitle(feature).toLocaleLowerCase();
  }

  function isRenderableFeature(/** @type {any} */ feature) {
    const title = getRenderableFeatureTitle(feature);
    return Boolean(title) && title !== PREVIEW_FEATURE_TITLE;
  }

  async function ensurePreviewFeature(/** @type {any[]} */ features) {
    const fromList = Array.isArray(features) ? features.find(isPreviewFeature) : null;
    if (fromList) return fromList;

    const userId = getLocalUserId();
    const { data, error } = await supabaseFetch('ytplus_feature_requests', {
      method: 'POST',
      body: JSON.stringify({
        title: PREVIEW_FEATURE_TITLE,
        description: PREVIEW_FEATURE_DESC,
        status: 'proposed',
        author_ip: userId,
      }),
    });

    if (error) {
      console.error('[Voting] Error creating preview row:', error);

      // Recover if preview row already exists (e.g. conflict/race condition on insert)
      const encodedTitle = encodeURIComponent(PREVIEW_FEATURE_TITLE);
      const { data: existingPreview } = await supabaseFetch(
        `ytplus_feature_requests?select=id,title,description,status&title=eq.${encodedTitle}&limit=1`
      );
      if (Array.isArray(existingPreview) && existingPreview[0]) {
        return existingPreview[0];
      }
      return null;
    }

    if (Array.isArray(data) && data[0]) return data[0];

    const refreshed = await getFeatures();
    return refreshed.find(isPreviewFeature) || null;
  }

  function createVotingUI(/** @type {HTMLElement} */ container) {
    container.innerHTML = _createHTML(`
      <div class="ytp-plus-voting">
        <div class="ytp-plus-voting-header">
          <h3>${tf('featureRequests', 'Feature Requests')}</h3>
          <button class="ytp-plus-voting-add-btn" id="ytp-plus-show-add-feature">
            + ${tf('addFeature', 'Add Feature')}
          </button>
        </div>
        <div class="ytp-plus-voting-list" id="ytp-plus-voting-list">
          <div class="ytp-plus-voting-loading">${tf('loading', 'Loading...')}</div>
        </div>
        <div class="ytp-plus-voting-add-form" id="ytp-plus-voting-add-form" style="display:none;">
          <input type="text" id="ytp-plus-feature-title" placeholder="${tf('featureTitle', 'Feature title')}" />
          <textarea id="ytp-plus-feature-desc" placeholder="${tf('featureDescription', 'Description')}"></textarea>
          <div class="ytp-plus-voting-form-actions">
            <button class="ytp-plus-voting-cancel" id="ytp-plus-cancel-feature">${tf('cancel', 'Cancel')}</button>
            <button class="ytp-plus-voting-submit" id="ytp-plus-submit-feature">${tf('submit', 'Submit')}</button>
          </div>
        </div>
      </div>
    `);
  }

  function ensureCommentsModal() {
    if (document.getElementById('ytp-plus-comments-panel')) return true;
    if (!document.body || !document.head) return false;

    const panel = document.createElement('div');
    panel.id = 'ytp-plus-comments-panel';
    panel.className = 'ytp-plus-comments-sidepanel';
    panel.innerHTML = _createHTML(`
      <div class="ytp-plus-comments-header">
        <div class="ytp-plus-comments-title" id="ytp-plus-comments-title">${tf('comments', 'Comments')}</div>
        <button class="ytp-plus-comments-close" data-comments-close="1" type="button">×</button>
      </div>
      <div class="ytp-plus-comments-list" id="ytp-plus-comments-list"></div>
      <div class="ytp-plus-comments-form">
        <textarea id="ytp-plus-comments-input" maxlength="1000" placeholder="${tf('addCommentPlaceholder', 'Add a comment...')}"></textarea>
        <button id="ytp-plus-comments-submit" type="button">${tf('submit', 'Submit')}</button>
      </div>
    `);
    document.body.appendChild(panel);

    if (!document.getElementById('ytp-plus-comments-modal-style')) {
      const style = document.createElement('style');
      style.id = 'ytp-plus-comments-modal-style';
      style.textContent = `
        .ytp-plus-comments-sidepanel{position:fixed;top:10vh;left:calc(50% + 390px);width:min(440px,34vw);max-width:92vw;height:60vh;background:var(--yt-glass-bg);border:1.5px solid var(--yt-glass-border);border-radius:24px;display:none;z-index:100001;box-shadow:0 12px 40px rgba(0,0,0,.45);overflow:hidden;backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);contain:layout style paint;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
        .ytp-plus-comments-sidepanel.open{display:flex;flex-direction:column}
        .ytp-plus-comments-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08)}
        .ytp-plus-comments-title{font-size:16px;font-weight:500;color:var(--yt-text-primary);font-family:inherit}
        .ytp-plus-comments-close{border:0;background:transparent;color:#cbd4e4;font-size:24px;cursor:pointer;line-height:1}
        .ytp-plus-comments-list{flex:1;overflow:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px}
        .ytp-plus-comments-item{border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);border-radius:10px;padding:10px}
        .ytp-plus-comments-item-text{color:#e7ecf5;white-space:pre-wrap;word-break:break-word}
        .ytp-plus-comments-item-meta{margin-top:6px;color:#9aabc5;font-size:12px}
        .ytp-plus-comments-form{padding:12px 16px;border-top:1px solid rgba(255,255,255,.08);display:flex;gap:8px;align-items:flex-end}
        #ytp-plus-comments-input{flex:1;min-height:72px;max-height:160px;resize:vertical;background:var(--yt-glass-bg);color:var(--yt-text-primary);border:1px solid var(--yt-glass-border);border-radius:10px;padding:10px}
        #ytp-plus-comments-submit{border:1px solid var(--yt-glass-border);background:var(--yt-accent);color:var(--yt-text-primary);border-radius:10px;padding:10px 14px;cursor:pointer}
        .ytp-plus-voting-item-status-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
        .ytp-plus-voting-comments-icon{border:1px solid var(--yt-glass-border);background:rgba(255,255,255,0.1);color:var(--yt-text-secondary);border-radius:999px;min-width:28px;height:28px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;line-height:1;transition:background-color .2s ease,color .2s ease,border-color .2s ease}
        .ytp-plus-voting-comments-icon:hover{background:var(--yt-hover-bg);color:var(--yt-text-primary)}
        .ytp-plus-voting-comments-icon svg{width:14px;height:14px;display:block;fill:currentColor}
        .ytp-plus-comments-sidepanel textarea,
        .ytp-plus-comments-sidepanel button,
        .ytp-plus-comments-sidepanel .ytp-plus-comments-item,
        .ytp-plus-comments-sidepanel .ytp-plus-comments-item-text,
        .ytp-plus-comments-sidepanel .ytp-plus-comments-item-meta,
        .ytp-plus-comments-sidepanel .ytp-plus-voting-empty{font-family:inherit}
      `;
      document.head.appendChild(style);
    }

    const reposition = () => {
      const sidePanel = document.getElementById('ytp-plus-comments-panel');
      if (!(sidePanel instanceof HTMLElement)) return;
      if (!sidePanel.classList.contains('open')) return;
      layoutCommentsPanel(sidePanel);
    };

    if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
      YouTubeUtils.cleanupManager.registerListener(window, 'resize', reposition);
      YouTubeUtils.cleanupManager.registerListener(window, 'scroll', reposition, true);
    } else {
      window.addEventListener('resize', reposition);
      window.addEventListener('scroll', reposition, true);
    }

    panel.dataset.repositionBound = '1';

    // Ensure comments panel is cleaned up when settings modal closes.
    const onSettingsClosed = () => {
      closeCommentsModal();
      resetSettingsPanelOffset();
    };
    if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
      YouTubeUtils.cleanupManager.registerListener(
        document,
        'youtube-plus-settings-modal-closed',
        onSettingsClosed
      );
    } else {
      document.addEventListener('youtube-plus-settings-modal-closed', onSettingsClosed);
    }

    return true;
  }

  function closeCommentsModal() {
    const panel = document.getElementById('ytp-plus-comments-panel');
    if (panel) panel.classList.remove('open');
    resetSettingsPanelOffset();
  }

  function openCommentsModal(/** @type {string} */ featureId) {
    if (!ensureCommentsModal()) return;

    const panel = document.getElementById('ytp-plus-comments-panel');
    const titleEl = document.getElementById('ytp-plus-comments-title');
    const listEl = document.getElementById('ytp-plus-comments-list');
    const inputEl = /** @type {HTMLTextAreaElement|null} */ (
      document.getElementById('ytp-plus-comments-input')
    );
    const submitEl = /** @type {HTMLButtonElement|null} */ (
      document.getElementById('ytp-plus-comments-submit')
    );
    if (!panel || !titleEl || !listEl || !inputEl || !submitEl) return;

    const feature = votingFeaturesCache[featureId];
    const comments = votingCommentsCache[featureId] || [];
    panel.setAttribute('data-feature-id', featureId);
    titleEl.textContent = String(feature?.title || '').trim() || tf('comments', 'Comments');

    listEl.innerHTML = comments.length
      ? comments
          .map(
            (/** @type {any} */ c) => `
          <div class="ytp-plus-comments-item">
            <div class="ytp-plus-comments-item-text">${escapeHtml(String(c.comment || ''))}</div>
            <div class="ytp-plus-comments-item-meta">${escapeHtml(formatCommentDate(String(c.created_at || '')))}</div>
          </div>
        `
          )
          .join('')
      : `<div class="ytp-plus-voting-empty">No comments yet</div>`;

    inputEl.value = '';
    submitEl.disabled = false;
    panel.classList.add('open');

    if (panel instanceof HTMLElement) {
      layoutCommentsPanel(panel);
    }
  }

  async function loadFeatures() {
    const listEl = document.getElementById('ytp-plus-voting-list');
    if (!listEl) return;

    const allFeaturesRaw = await getFeatures();
    const previewFeature = await ensurePreviewFeature(allFeaturesRaw);
    const seenTitles = new Set();
    const features = (allFeaturesRaw || []).filter((/** @type {any} */ f) => {
      if (!isRenderableFeature(f) || isPreviewFeature(f)) return false;

      const normalizedTitle = getNormalizedRenderableFeatureTitle(f);
      if (!normalizedTitle || seenTitles.has(normalizedTitle)) return false;

      seenTitles.add(normalizedTitle);
      return true;
    });
    const [allVotes, userVotes, commentsByFeature] = await Promise.all([
      getAllVotes(),
      getUserVotes(),
      getCommentsByFeatureIds(features.map((/** @type {any} */ f) => String(f.id || ''))),
    ]);

    const renderFeatures = [...features];
    votingCommentsCache = commentsByFeature;
    votingFeaturesCache = {};
    renderFeatures.forEach((/** @type {any} */ f) => {
      votingFeaturesCache[String(f.id || '')] = f;
    });

    if (renderFeatures.length === 0) {
      listEl.innerHTML = _createHTML(
        `<div class="ytp-plus-voting-empty">${tf('noFeatures', 'No feature requests yet')}</div>`
      );
      // Still update the aggregate vote bar even when there are no user features —
      // the preview feature in the DB tracks the overall like/dislike count.
      updateVoteBar(allVotes, userVotes, previewFeature?.id || null);
      return;
    }

    listEl.innerHTML = _createHTML(
      renderFeatures
        .map((/** @type {any} */ f) => {
          const votes = allVotes[f.id] || { upvotes: 0, downvotes: 0 };
          const userVote = userVotes[f.id] || 0;
          const featureComments = commentsByFeature[f.id] || [];
          const totalVotes = votes.upvotes + votes.downvotes;
          const upPercent = totalVotes > 0 ? Math.round((votes.upvotes / totalVotes) * 100) : 50;
          const statusMeta = getStatusMeta(f.status);
          const featureTitle = getRenderableFeatureTitle(f);
          const featureDescription = getRenderableFeatureDescription(f);
          return `
          <div class="ytp-plus-voting-item" data-feature-id="${f.id}">
            <div class="ytp-plus-voting-item-content">
              <div class="ytp-plus-voting-item-title">${escapeHtml(featureTitle)}</div>
              <div class="ytp-plus-voting-item-desc">${escapeHtml(featureDescription)}</div>
              <div class="ytp-plus-voting-item-status-row">
                <div class="ytp-plus-voting-item-status ${statusMeta.className}">${escapeHtml(statusMeta.label)}</div>
                <button class="ytp-plus-voting-comments-icon" data-comments-open="1" type="button" title="${tf('comments', 'Comments')} (${featureComments.length})" aria-label="${tf('comments', 'Comments')} (${featureComments.length})"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"> <path opacity="0.5" d="M13.0867 21.3877L13.7321 21.7697L13.0867 21.3877ZM13.6288 20.4718L12.9833 20.0898L13.6288 20.4718ZM10.3712 20.4718L9.72579 20.8539H9.72579L10.3712 20.4718ZM10.9133 21.3877L11.5587 21.0057L10.9133 21.3877ZM13.5 2.75C13.9142 2.75 14.25 2.41421 14.25 2C14.25 1.58579 13.9142 1.25 13.5 1.25V2.75ZM22.75 10.5C22.75 10.0858 22.4142 9.75 22 9.75C21.5858 9.75 21.25 10.0858 21.25 10.5H22.75ZM2.3806 15.9134L3.07351 15.6264V15.6264L2.3806 15.9134ZM7.78958 18.9915L7.77666 19.7413L7.78958 18.9915ZM5.08658 18.6194L4.79957 19.3123H4.79957L5.08658 18.6194ZM21.6194 15.9134L22.3123 16.2004V16.2004L21.6194 15.9134ZM16.2104 18.9915L16.1975 18.2416L16.2104 18.9915ZM18.9134 18.6194L19.2004 19.3123H19.2004L18.9134 18.6194ZM4.38751 2.7368L3.99563 2.09732V2.09732L4.38751 2.7368ZM2.7368 4.38751L2.09732 3.99563H2.09732L2.7368 4.38751ZM9.40279 19.2098L9.77986 18.5615L9.77986 18.5615L9.40279 19.2098ZM13.7321 21.7697L14.2742 20.8539L12.9833 20.0898L12.4412 21.0057L13.7321 21.7697ZM9.72579 20.8539L10.2679 21.7697L11.5587 21.0057L11.0166 20.0898L9.72579 20.8539ZM12.4412 21.0057C12.2485 21.3313 11.7515 21.3313 11.5587 21.0057L10.2679 21.7697C11.0415 23.0767 12.9585 23.0767 13.7321 21.7697L12.4412 21.0057ZM10.5 2.75H13.5V1.25H10.5V2.75ZM21.25 10.5V11.5H22.75V10.5H21.25ZM2.75 11.5V10.5H1.25V11.5H2.75ZM1.25 11.5C1.25 12.6546 1.24959 13.5581 1.29931 14.2868C1.3495 15.0223 1.45323 15.6344 1.68769 16.2004L3.07351 15.6264C2.92737 15.2736 2.84081 14.8438 2.79584 14.1847C2.75041 13.5189 2.75 12.6751 2.75 11.5H1.25ZM7.8025 18.2416C6.54706 18.2199 5.88923 18.1401 5.37359 17.9265L4.79957 19.3123C5.60454 19.6457 6.52138 19.7197 7.77666 19.7413L7.8025 18.2416ZM1.68769 16.2004C2.27128 17.6093 3.39066 18.7287 4.79957 19.3123L5.3736 17.9265C4.33223 17.4951 3.50486 16.6678 3.07351 15.6264L1.68769 16.2004ZM21.25 11.5C21.25 12.6751 21.2496 13.5189 21.2042 14.1847C21.1592 14.8438 21.0726 15.2736 20.9265 15.6264L22.3123 16.2004C22.5468 15.6344 22.6505 15.0223 22.7007 14.2868C22.7504 13.5581 22.75 12.6546 22.75 11.5H21.25ZM16.2233 19.7413C17.4786 19.7197 18.3955 19.6457 19.2004 19.3123L18.6264 17.9265C18.1108 18.1401 17.4529 18.2199 16.1975 18.2416L16.2233 19.7413ZM20.9265 15.6264C20.4951 16.6678 19.6678 17.4951 18.6264 17.9265L19.2004 19.3123C20.6093 18.7287 21.7287 17.6093 22.3123 16.2004L20.9265 15.6264ZM10.5 1.25C8.87781 1.25 7.6085 1.24921 6.59611 1.34547C5.57256 1.44279 4.73445 1.64457 3.99563 2.09732L4.77938 3.37628C5.24291 3.09223 5.82434 2.92561 6.73809 2.83873C7.663 2.75079 8.84876 2.75 10.5 2.75V1.25ZM2.75 10.5C2.75 8.84876 2.75079 7.663 2.83873 6.73809C2.92561 5.82434 3.09223 5.24291 3.37628 4.77938L2.09732 3.99563C1.64457 4.73445 1.44279 5.57256 1.34547 6.59611C1.24921 7.6085 1.25 8.87781 1.25 10.5H2.75ZM3.99563 2.09732C3.22194 2.57144 2.57144 3.22194 2.09732 3.99563L3.37628 4.77938C3.72672 4.20752 4.20752 3.72672 4.77938 3.37628L3.99563 2.09732ZM11.0166 20.0898C10.8136 19.7468 10.6354 19.4441 10.4621 19.2063C10.2795 18.9559 10.0702 18.7304 9.77986 18.5615L9.02572 19.8582C9.07313 19.8857 9.13772 19.936 9.24985 20.0898C9.37122 20.2564 9.50835 20.4865 9.72579 20.8539L11.0166 20.0898ZM7.77666 19.7413C8.21575 19.7489 8.49387 19.7545 8.70588 19.7779C8.90399 19.7999 8.98078 19.832 9.02572 19.8582L9.77986 18.5615C9.4871 18.3912 9.18246 18.3215 8.87097 18.287C8.57339 18.2541 8.21375 18.2487 7.8025 18.2416L7.77666 19.7413ZM14.2742 20.8539C14.4916 20.4865 14.6287 20.2564 14.7501 20.0898C14.8622 19.936 14.9268 19.8857 14.9742 19.8582L14.2201 18.5615C13.9298 18.7304 13.7204 18.9559 13.5379 19.2063C13.3646 19.4441 13.1864 19.7468 12.9833 20.0898L14.2742 20.8539ZM16.1975 18.2416C15.7862 18.2487 15.4266 18.2541 15.129 18.287C14.8175 18.3215 14.5129 18.3912 14.2201 18.5615L14.9742 19.8582C15.0192 19.832 15.096 19.7999 15.2941 19.7779C15.5061 19.7545 15.7842 19.7489 16.2233 19.7413L16.1975 18.2416Z" fill="currentColor"></path> <circle cx="19" cy="5" r="3" stroke="currentColor" stroke-width="1.5"></circle> </svg></button>
              </div>
            </div>
            <div class="ytp-plus-voting-item-votes">
              <div class="ytp-plus-voting-score">
                <span class="ytp-plus-vote-total">${totalVotes} ${tf('votes', 'votes')}</span>
              </div>
              <div class="ytp-plus-voting-buttons">
                <div class="ytp-plus-voting-buttons-track" style="background:linear-gradient(to right, #4caf50 ${upPercent}%, #f44336 ${upPercent}%);"></div>
                <button class="ytp-plus-vote-btn ${userVote === 1 ? 'active' : ''}" data-vote="1" title="${tf('like', 'Like')}" type="button" aria-label="${tf('like', 'Like')}">
                  <svg class="ytp-plus-vote-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M20.9751 12.1852L20.2361 12.0574L20.9751 12.1852ZM20.2696 16.265L19.5306 16.1371L20.2696 16.265ZM6.93776 20.4771L6.19055 20.5417H6.19055L6.93776 20.4771ZM6.1256 11.0844L6.87281 11.0198L6.1256 11.0844ZM13.9949 5.22142L14.7351 5.34269V5.34269L13.9949 5.22142ZM13.3323 9.26598L14.0724 9.38725V9.38725L13.3323 9.26598ZM6.69813 9.67749L6.20854 9.10933H6.20854L6.69813 9.67749ZM8.13687 8.43769L8.62646 9.00585H8.62646L8.13687 8.43769ZM10.518 4.78374L9.79207 4.59542L10.518 4.78374ZM10.9938 2.94989L11.7197 3.13821L11.7197 3.13821L10.9938 2.94989ZM12.6676 2.06435L12.4382 2.77841L12.4382 2.77841L12.6676 2.06435ZM12.8126 2.11093L13.0419 1.39687L13.0419 1.39687L12.8126 2.11093ZM9.86194 6.46262L10.5235 6.81599V6.81599L9.86194 6.46262ZM13.9047 3.24752L13.1787 3.43584V3.43584L13.9047 3.24752ZM11.6742 2.13239L11.3486 1.45675L11.3486 1.45675L11.6742 2.13239ZM20.2361 12.0574L19.5306 16.1371L21.0086 16.3928L21.7142 12.313L20.2361 12.0574ZM13.245 21.25H8.59634V22.75H13.245V21.25ZM7.68497 20.4125L6.87281 11.0198L5.37839 11.149L6.19055 20.5417L7.68497 20.4125ZM19.5306 16.1371C19.0238 19.0677 16.3813 21.25 13.245 21.25V22.75C17.0712 22.75 20.3708 20.081 21.0086 16.3928L19.5306 16.1371ZM13.2548 5.10015L12.5921 9.14472L14.0724 9.38725L14.7351 5.34269L13.2548 5.10015ZM7.18772 10.2456L8.62646 9.00585L7.64728 7.86954L6.20854 9.10933L7.18772 10.2456ZM11.244 4.97206L11.7197 3.13821L10.2678 2.76157L9.79207 4.59542L11.244 4.97206ZM12.4382 2.77841L12.5832 2.82498L13.0419 1.39687L12.897 1.3503L12.4382 2.77841ZM10.5235 6.81599C10.8354 6.23198 11.0777 5.61339 11.244 4.97206L9.79207 4.59542C9.65572 5.12107 9.45698 5.62893 9.20041 6.10924L10.5235 6.81599ZM12.5832 2.82498C12.8896 2.92342 13.1072 3.16009 13.1787 3.43584L14.6306 3.05921C14.4252 2.26719 13.819 1.64648 13.0419 1.39687L12.5832 2.82498ZM11.7197 3.13821C11.7547 3.0032 11.8522 2.87913 11.9998 2.80804L11.3486 1.45675C10.8166 1.71309 10.417 2.18627 10.2678 2.76157L11.7197 3.13821ZM11.9998 2.80804C12.1345 2.74311 12.2931 2.73181 12.4382 2.77841L12.897 1.3503C12.3872 1.18655 11.8312 1.2242 11.3486 1.45675L11.9998 2.80804ZM14.1537 10.9842H19.3348V9.4842H14.1537V10.9842ZM14.7351 5.34269C14.8596 4.58256 14.824 3.80477 14.6306 3.0592L13.1787 3.43584C13.3197 3.97923 13.3456 4.54613 13.2548 5.10016L14.7351 5.34269ZM8.59634 21.25C8.12243 21.25 7.726 20.887 7.68497 20.4125L6.19055 20.5417C6.29851 21.7902 7.34269 22.75 8.59634 22.75V21.25ZM8.62646 9.00585C9.30632 8.42 10.0391 7.72267 10.5235 6.81599L9.20041 6.10924C8.85403 6.75767 8.30249 7.30493 7.64728 7.86954L8.62646 9.00585ZM21.7142 12.313C21.9695 10.8365 20.8341 9.4842 19.3348 9.4842V10.9842C19.9014 10.9842 20.3332 11.4959 20.2361 12.0574L21.7142 12.313ZM12.5921 9.14471C12.4344 10.1076 13.1766 10.9842 14.1537 10.9842V9.4842C14.1038 9.4842 14.0639 9.43901 14.0724 9.38725L12.5921 9.14471ZM6.87281 11.0198C6.84739 10.7258 6.96474 10.4378 7.18772 10.2456L6.20854 9.10933C5.62021 9.61631 5.31148 10.3753 5.37839 11.149L6.87281 11.0198Z" fill="currentColor"></path> <path opacity="0.5" d="M3.9716 21.4709L3.22439 21.5355L3.9716 21.4709ZM3 10.2344L3.74721 10.1698C3.71261 9.76962 3.36893 9.46776 2.96767 9.48507C2.5664 9.50239 2.25 9.83274 2.25 10.2344L3 10.2344ZM4.71881 21.4063L3.74721 10.1698L2.25279 10.299L3.22439 21.5355L4.71881 21.4063ZM3.75 21.5129V10.2344H2.25V21.5129H3.75ZM3.22439 21.5355C3.2112 21.383 3.33146 21.2502 3.48671 21.2502V22.7502C4.21268 22.7502 4.78122 22.1281 4.71881 21.4063L3.22439 21.5355ZM3.48671 21.2502C3.63292 21.2502 3.75 21.3686 3.75 21.5129H2.25C2.25 22.1954 2.80289 22.7502 3.48671 22.7502V21.2502Z" fill="currentColor"></path> </svg>
                </button>
                <button class="ytp-plus-vote-btn ${userVote === -1 ? 'active' : ''}" data-vote="-1" title="${tf('dislike', 'Dislike')}" type="button" aria-label="${tf('dislike', 'Dislike')}">
                  <svg class="ytp-plus-vote-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M20.9751 11.8148L20.2361 11.9426L20.9751 11.8148ZM20.2696 7.73505L19.5306 7.86285L20.2696 7.73505ZM6.93776 3.52293L6.19055 3.45832H6.19055L6.93776 3.52293ZM6.1256 12.9156L6.87281 12.9802L6.1256 12.9156ZM13.9949 18.7786L14.7351 18.6573V18.6573L13.9949 18.7786ZM13.3323 14.734L14.0724 14.6128V14.6128L13.3323 14.734ZM6.69813 14.3225L6.20854 14.8907H6.20854L6.69813 14.3225ZM8.13687 15.5623L8.62646 14.9942H8.62646L8.13687 15.5623ZM10.518 19.2163L9.79207 19.4046L10.518 19.2163ZM10.9938 21.0501L11.7197 20.8618L11.7197 20.8618L10.9938 21.0501ZM12.6676 21.9356L12.4382 21.2216L12.4382 21.2216L12.6676 21.9356ZM12.8126 21.8891L13.0419 22.6031L13.0419 22.6031L12.8126 21.8891ZM9.86194 17.5374L10.5235 17.184V17.184L9.86194 17.5374ZM13.9047 20.7525L13.1787 20.5642V20.5642L13.9047 20.7525ZM11.6742 21.8676L11.3486 22.5433L11.3486 22.5433L11.6742 21.8676ZM20.2361 11.9426L19.5306 7.86285L21.0086 7.60724L21.7142 11.687L20.2361 11.9426ZM13.245 2.75H8.59634V1.25H13.245V2.75ZM7.68497 3.58754L6.87281 12.9802L5.37839 12.851L6.19055 3.45832L7.68497 3.58754ZM19.5306 7.86285C19.0238 4.93226 16.3813 2.75 13.245 2.75V1.25C17.0712 1.25 20.3708 3.91895 21.0086 7.60724L19.5306 7.86285ZM13.2548 18.8998L12.5921 14.8553L14.0724 14.6128L14.7351 18.6573L13.2548 18.8998ZM7.18772 13.7544L8.62646 14.9942L7.64728 16.1305L6.20854 14.8907L7.18772 13.7544ZM11.244 19.0279L11.7197 20.8618L10.2678 21.2384L9.79207 19.4046L11.244 19.0279ZM12.4382 21.2216L12.5832 21.175L13.0419 22.6031L12.897 22.6497L12.4382 21.2216ZM10.5235 17.184C10.8354 17.768 11.0777 18.3866 11.244 19.0279L9.79207 19.4046C9.65572 18.8789 9.45698 18.3711 9.20041 17.8908L10.5235 17.184ZM12.5832 21.175C12.8896 21.0766 13.1072 20.8399 13.1787 20.5642L14.6306 20.9408C14.4252 21.7328 13.819 22.3535 13.0419 22.6031L12.5832 21.175ZM11.7197 20.8618C11.7547 20.9968 11.8522 21.1209 11.9998 21.192L11.3486 22.5433C10.8166 22.2869 10.417 21.8137 10.2678 21.2384L11.7197 20.8618ZM11.9998 21.192C12.1345 21.2569 12.2931 21.2682 12.4382 21.2216L12.897 22.6497C12.3872 22.8135 11.8312 22.7758 11.3486 22.5433L11.9998 21.192ZM14.1537 13.0158H19.3348V14.5158H14.1537V13.0158ZM14.7351 18.6573C14.8596 19.4174 14.824 20.1952 14.6306 20.9408L13.1787 20.5642C13.3197 20.0208 13.3456 19.4539 13.2548 18.8998L14.7351 18.6573ZM8.59634 2.75C8.12243 2.75 7.726 3.11302 7.68497 3.58754L6.19055 3.45832C6.29851 2.20975 7.34269 1.25 8.59634 1.25V2.75ZM8.62646 14.9942C9.30632 15.58 10.0391 16.2773 10.5235 17.184L9.20041 17.8908C8.85403 17.2423 8.30249 16.6951 7.64728 16.1305L8.62646 14.9942ZM21.7142 11.687C21.9695 13.1635 20.8341 14.5158 19.3348 14.5158V13.0158C19.9014 13.0158 20.3332 12.5041 20.2361 11.9426L21.7142 11.687ZM12.5921 14.8553C12.4344 13.8924 13.1766 13.0158 14.1537 13.0158V14.5158C14.1038 14.5158 14.0639 14.561 14.0724 14.6128L12.5921 14.8553ZM6.87281 12.9802C6.84739 13.2742 6.96474 13.5622 7.18772 13.7544L6.20854 14.8907C5.62021 14.3837 5.31148 13.6247 5.37839 12.851L6.87281 12.9802Z" fill="currentColor"></path> <path opacity="0.5" d="M3.9716 2.52911L3.22439 2.4645L3.9716 2.52911ZM3 13.7656L3.74721 13.8302C3.71261 14.2304 3.36893 14.5322 2.96767 14.5149C2.5664 14.4976 2.25 14.1673 2.25 13.7656L3 13.7656ZM4.71881 2.59372L3.74721 13.8302L2.25279 13.701L3.22439 2.4645L4.71881 2.59372ZM3.75 2.48709V13.7656H2.25V2.48709H3.75ZM3.22439 2.4645C3.2112 2.61704 3.33146 2.74983 3.48671 2.74983V1.24983C4.21268 1.24983 4.78122 1.87192 4.71881 2.59372L3.22439 2.4645ZM3.48671 2.74983C3.63292 2.74983 3.75 2.63139 3.75 2.48709H2.25C2.25 1.80457 2.80289 1.24983 3.48671 1.24983V2.74983Z" fill="currentColor"></path> </svg>
                </button>
              </div>
            </div>
          </div>
        `;
        })
        .join('')
    );

    listEl.querySelectorAll('.ytp-plus-vote-btn').forEach((/** @type {any} */ btn) => {
      btn.addEventListener('click', async () => {
        if (voteRequestInFlight) return;
        const card = /** @type {any} */ (btn.closest('.ytp-plus-voting-item'));
        const featureId = card?.dataset?.featureId;
        const voteType = parseInt(btn.dataset?.vote || '0', 10);
        if (!featureId) return;
        const currentUserVote = userVotes[featureId] || 0;

        let newVoteType = voteType;
        if (currentUserVote === voteType) {
          newVoteType = 0;
        }

        try {
          voteRequestInFlight = true;
          setVoteControlsBusy(
            /** @type {Element|null} */ (
              listEl.closest('.ytp-plus-settings-section, .ytp-plus-voting') || listEl
            ),
            true
          );

          const result = await vote(featureId, newVoteType);
          if (result.success) {
            await loadFeatures();
          }
        } finally {
          voteRequestInFlight = false;
          setVoteControlsBusy(
            /** @type {Element|null} */ (
              listEl.closest('.ytp-plus-settings-section, .ytp-plus-voting') || listEl
            ),
            false
          );
        }
      });
    });

    // Update aggregate vote bar
    updateVoteBar(allVotes, userVotes, previewFeature?.id || null);
  }

  function escapeHtml(/** @type {string} */ str) {
    if (!str) return '';
    if (window.YouTubeSecurityUtils?.escapeHtml) return window.YouTubeSecurityUtils.escapeHtml(str);
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /** Aggregate all feature votes into a single bar above the feature list */
  function updateVoteBar(
    /** @type {Record<string, any>} */ allVotes,
    /** @type {Record<string, number>} */ userVotes,
    /** @type {string|null} */ previewFeatureId
  ) {
    const fillEl = document.getElementById('ytp-plus-vote-bar-fill');
    const countEl = document.getElementById('ytp-plus-vote-bar-count');
    const upBtn = document.getElementById('ytp-plus-vote-bar-up');
    const downBtn = document.getElementById('ytp-plus-vote-bar-down');
    if (!fillEl || !countEl) return;

    const previewVotes = previewFeatureId
      ? allVotes[previewFeatureId] || { upvotes: 0, downvotes: 0 }
      : { upvotes: 0, downvotes: 0 };

    const totalUp = previewVotes.upvotes || 0;
    const totalDown = previewVotes.downvotes || 0;

    const total = totalUp + totalDown;
    const pct = total > 0 ? Math.round((totalUp / total) * 100) : 50;
    /** @type {any} */ (fillEl).style.background =
      `linear-gradient(to right, #4caf50 ${pct}%, #f44336 ${pct}%)`;
    countEl.textContent = total > 0 ? `${total}` : '0';

    const previewUserVote = previewFeatureId ? userVotes[previewFeatureId] || 0 : 0;
    if (upBtn) upBtn.classList.toggle('active', previewUserVote === 1);
    if (downBtn) downBtn.classList.toggle('active', previewUserVote === -1);
  }

  /** Before/After comparison slider */
  function initSlider() {
    const container = /** @type {any} */ (document.querySelector('.ytp-plus-ba-container'));
    if (!container || container.dataset.sliderInit) return;
    container.dataset.sliderInit = '1';

    const afterEl = /** @type {any} */ (container.querySelector('.ytp-plus-ba-after'));
    const divider = /** @type {any} */ (container.querySelector('.ytp-plus-ba-divider'));
    if (!afterEl || !divider) return;

    let dragging = false;
    /** @type {ReturnType<typeof setTimeout>|null} */
    let resumeTimer = null;
    /** @type {number|null} */
    let rafId = null;

    function setPosition(/** @type {number} */ pct, manual = false) {
      const clamped = Math.max(2, Math.min(98, pct));
      afterEl.style.clipPath = `inset(0 0 0 ${clamped}%)`;
      if (manual) {
        divider.style.left = `${clamped}%`;
      }
      divider.setAttribute('aria-valuenow', String(Math.round(clamped)));
    }

    function getPct(/** @type {number} */ clientX) {
      const rect = container.getBoundingClientRect();
      return ((clientX - rect.left) / rect.width) * 100;
    }

    function pauseAutoplay() {
      divider.classList.remove('autoplay');
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        divider.classList.add('autoplay');
        startAutoplayRaf();
      }, 3000);
    }

    function startAutoplayRaf() {
      if (rafId) return;
      function loop() {
        if (!divider.classList.contains('autoplay')) {
          rafId = null;
          return;
        }
        const rect = container.getBoundingClientRect();
        const dRect = divider.getBoundingClientRect();
        const pct = ((dRect.left + dRect.width / 2 - rect.left) / rect.width) * 100;
        setPosition(pct, false);
        rafId = requestAnimationFrame(loop);
      }
      rafId = requestAnimationFrame(loop);
    }

    container.addEventListener('mousedown', (/** @type {MouseEvent} */ e) => {
      dragging = true;
      pauseAutoplay();
      setPosition(getPct(e.clientX), true);
      e.preventDefault();
    });
    const onMousemove = (/** @type {MouseEvent} */ e) => {
      if (dragging) setPosition(getPct(e.clientX), true);
    };
    const onMouseup = () => {
      dragging = false;
    };
    if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
      YouTubeUtils.cleanupManager.registerListener(
        window,
        'mousemove',
        /** @type {EventListener} */ (onMousemove)
      );
      YouTubeUtils.cleanupManager.registerListener(window, 'mouseup', onMouseup);
    } else {
      window.addEventListener('mousemove', onMousemove);
      window.addEventListener('mouseup', onMouseup);
    }

    container.addEventListener(
      'touchstart',
      (/** @type {TouchEvent} */ e) => {
        dragging = true;
        pauseAutoplay();
        setPosition(getPct(e.touches[0].clientX), true);
      },
      { passive: true }
    );
    const onTouchmove = (/** @type {TouchEvent} */ e) => {
      if (dragging) setPosition(getPct(e.touches[0].clientX), true);
    };
    const onTouchend = () => {
      dragging = false;
    };
    if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
      YouTubeUtils.cleanupManager.registerListener(
        window,
        'touchmove',
        /** @type {EventListener} */ (onTouchmove),
        {
          passive: true,
        }
      );
      YouTubeUtils.cleanupManager.registerListener(window, 'touchend', onTouchend);
    } else {
      window.addEventListener('touchmove', onTouchmove, { passive: true });
      window.addEventListener('touchend', onTouchend);
    }

    divider.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
      pauseAutoplay();
      const cur = parseFloat(divider.getAttribute('aria-valuenow') || '50');
      if (e.key === 'ArrowLeft') {
        setPosition(cur - 2, true);
        e.preventDefault();
      }
      if (e.key === 'ArrowRight') {
        setPosition(cur + 2, true);
        e.preventDefault();
      }
    });

    // initial position 50%
    setPosition(50, true);

    // start autoplay after short delay
    setTimeout(() => {
      divider.classList.add('autoplay');
      startAutoplayRaf();
    }, 400);
  }

  function initVoting() {
    if (votingInitialized) return;
    votingInitialized = true;
    if (!ensureCommentsModal()) {
      const onReady = () => {
        ensureCommentsModal();
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady, { once: true });
      } else {
        setTimeout(onReady, 0);
      }
    }

    // Vote bar aggregate buttons
    const voteBarHandler = async (/** @type {any} */ e) => {
      const barBtn = e.target?.closest?.('.ytp-plus-vote-bar-btn');
      if (barBtn) {
        if (voteRequestInFlight) return;
        const features = await getFeatures();
        const previewFeature = await ensurePreviewFeature(features);
        if (!previewFeature?.id) return;

        const userVotes = await getUserVotes();
        const voteType = parseInt(barBtn.dataset.vote, 10);

        const currentUserVote = userVotes[previewFeature.id] || 0;
        const newVoteType = currentUserVote === voteType ? 0 : voteType;
        const controlsRoot =
          barBtn.closest('.ytp-plus-settings-section, .ytp-plus-voting') || document.body;
        try {
          voteRequestInFlight = true;
          setVoteControlsBusy(controlsRoot, true);
          await vote(previewFeature.id, newVoteType);
          await loadFeatures();
        } finally {
          voteRequestInFlight = false;
          setVoteControlsBusy(controlsRoot, false);
        }
      }
    };

    const addFeatureHandler = (/** @type {any} */ e) => {
      const showAddBtn = e.target?.closest?.('#ytp-plus-show-add-feature');
      const cancelBtn = e.target?.closest?.('#ytp-plus-cancel-feature');
      const submitBtn = e.target?.closest?.('#ytp-plus-submit-feature');

      if (showAddBtn) {
        const addFormEl = document.getElementById('ytp-plus-voting-add-form');
        const showAddEl = document.getElementById('ytp-plus-show-add-feature');
        if (addFormEl) /** @type {any} */ (addFormEl).style.display = 'block';
        if (showAddEl) /** @type {any} */ (showAddEl).style.display = 'none';
      }

      if (cancelBtn) {
        const addFormEl = document.getElementById('ytp-plus-voting-add-form');
        const showAddEl = document.getElementById('ytp-plus-show-add-feature');
        const titleEl = document.getElementById('ytp-plus-feature-title');
        const descEl = document.getElementById('ytp-plus-feature-desc');

        if (addFormEl) /** @type {any} */ (addFormEl).style.display = 'none';
        if (showAddEl) /** @type {any} */ (showAddEl).style.display = 'block';
        if (titleEl) /** @type {any} */ (titleEl).value = '';
        if (descEl) /** @type {any} */ (descEl).value = '';
      }

      if (submitBtn) {
        const titleInput = document.getElementById('ytp-plus-feature-title');
        const descInput = document.getElementById('ytp-plus-feature-desc');
        const title = /** @type {any} */ (titleInput)?.value?.trim?.() || '';
        const desc = /** @type {any} */ (descInput)?.value?.trim?.() || '';
        if (titleInput instanceof HTMLInputElement) {
          titleInput.setCustomValidity('');
        }
        if (!title && titleInput instanceof HTMLInputElement) {
          titleInput.setCustomValidity(tf('featureTitleRequired', 'Feature title is required'));
          titleInput.reportValidity();
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = tf('loading', 'Loading...');

        submitFeature(title, desc).then(result => {
          submitBtn.disabled = false;
          submitBtn.textContent = tf('submit', 'Submit');

          if (!result.success) {
            if (titleInput instanceof HTMLInputElement) {
              titleInput.setCustomValidity(String(result.error || ''));
              titleInput.reportValidity();
            }
            return;
          }

          if (result.success) {
            const addFormEl = document.getElementById('ytp-plus-voting-add-form');
            const showAddEl = document.getElementById('ytp-plus-show-add-feature');
            if (addFormEl) /** @type {any} */ (addFormEl).style.display = 'none';
            if (showAddEl) /** @type {any} */ (showAddEl).style.display = 'block';
            if (titleInput) /** @type {any} */ (titleInput).value = '';
            if (descInput) /** @type {any} */ (descInput).value = '';
            loadFeatures();
          }
        });
      }
    };

    const commentHandler = (/** @type {any} */ e) => {
      const navItem = e.target?.closest?.('.ytp-plus-settings-nav-item');
      if (navItem) {
        const nextSection = String(navItem.dataset?.section || '');
        if (nextSection && nextSection !== 'voting') {
          closeCommentsModal();
        }
      }

      const closeBtn = e.target?.closest?.('[data-comments-close="1"]');
      if (closeBtn) {
        closeCommentsModal();
        return;
      }

      const openBtn = e.target?.closest?.('[data-comments-open="1"]');
      if (openBtn) {
        const card = /** @type {HTMLElement|null} */ (openBtn.closest('.ytp-plus-voting-item'));
        const featureId = card?.dataset?.featureId || '';
        if (featureId) {
          openCommentsModal(featureId);
        }
        return;
      }

      const submitCommentBtn = e.target?.closest?.('#ytp-plus-comments-submit');
      if (!submitCommentBtn) return;

      const panel = document.getElementById('ytp-plus-comments-panel');
      const featureId = panel?.getAttribute('data-feature-id') || '';
      const input = /** @type {HTMLTextAreaElement|null} */ (
        document.getElementById('ytp-plus-comments-input')
      );
      const value = String(input?.value || '').trim();
      if (!featureId || !value) return;

      submitCommentBtn.disabled = true;
      addComment(featureId, value)
        .then(result => {
          if (result.success) {
            if (input) input.value = '';
            return loadFeatures().then(() => openCommentsModal(featureId));
          }
          return null;
        })
        .finally(() => {
          submitCommentBtn.disabled = false;
        });
    };

    // Register both click handlers with cleanupManager
    if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
      YouTubeUtils.cleanupManager.registerListener(document, 'click', voteBarHandler);
      YouTubeUtils.cleanupManager.registerListener(document, 'click', addFeatureHandler);
      YouTubeUtils.cleanupManager.registerListener(document, 'click', commentHandler);
    } else {
      document.addEventListener('click', voteBarHandler);
      document.addEventListener('click', addFeatureHandler);
      document.addEventListener('click', commentHandler);
    }
  }

  const VotingSystem = {
    init: initVoting,
    createUI: createVotingUI,
    loadFeatures,
    getFeatures,
    vote,
    submitFeature,
    initSlider,
    updateVoteBar,
  };

  if (typeof window.YouTubePlus === 'undefined') {
    window.YouTubePlus = {};
  }
  window.YouTubePlus.Voting = VotingSystem;

  // Register with LazyLoader for deferred initialization
  if (window.YouTubePlusLazyLoader) {
    window.YouTubePlusLazyLoader.register('voting', initVoting, { priority: 0 });
  }
})();
