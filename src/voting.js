/**
 * Feature Voting System
 * Supabase-powered voting via REST API
 */

(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  const SUPABASE_URL = 'https://ldpccocxlrdsyejfhrvc.supabase.co';
  const SUPABASE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxkcGNjb2N4bHJkc3llamZocnZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMTAyNDYsImV4cCI6MjA4Nzc4NjI0Nn0.QfwrAG4SMJBPLoP-Mcq3hETQXt0ezinoi0CpN57Zn90';

  const PREVIEW_FEATURE_TITLE = '__ytp_preview_vote__';
  const PREVIEW_FEATURE_DESC = 'Internal row for ytp-plus-voting-preview';

  let votingInitialized = false;
  let voteRequestInFlight = false;

  function setVoteControlsBusy(container, busy) {
    if (!container) return;
    container.querySelectorAll('.ytp-plus-vote-btn, .ytp-plus-vote-bar-btn').forEach(el => {
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

  const t = (key, params = {}) => {
    if (window.YouTubePlusI18n?.t) return window.YouTubePlusI18n.t(key, params);
    if (window.YouTubeUtils?.t) return window.YouTubeUtils.t(key, params);
    return key || '';
  };

  const tf = (key, fallback, params = {}) => {
    try {
      const value = t(key, params);
      if (typeof value === 'string' && value && value !== key) return value;
    } catch {}
    return fallback || key || '';
  };

  function getStatusMeta(status) {
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
      userId = 'user_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
      localStorage.setItem('ytp_voting_user_id', userId);
    }
    return userId;
  }

  function normalizeVoteType(value) {
    const numeric = Number(value);
    if (numeric === 1) return 1;
    if (numeric === -1) return -1;
    return 0;
  }

  async function supabaseFetch(endpoint, options = {}) {
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
      return { data: null, error: error.message };
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
    const votes = {};
    (data || []).forEach(v => {
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
    const userVotes = {};
    (data || []).forEach(v => {
      const voteType = normalizeVoteType(v.vote_type);
      if (voteType) userVotes[v.feature_id] = voteType;
    });
    return userVotes;
  }

  async function vote(featureId, voteType) {
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

  async function submitFeature(title, description) {
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

  function isPreviewFeature(feature) {
    return String(feature?.title || '').trim() === PREVIEW_FEATURE_TITLE;
  }

  async function ensurePreviewFeature(features) {
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

  function createVotingUI(container) {
    container.innerHTML = `
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
    `;
  }

  async function loadFeatures() {
    const listEl = document.getElementById('ytp-plus-voting-list');
    if (!listEl) return;

    const allFeaturesRaw = await getFeatures();
    const previewFeature = await ensurePreviewFeature(allFeaturesRaw);
    const features = (allFeaturesRaw || []).filter(f => !isPreviewFeature(f));
    const allVotes = await getAllVotes();
    const userVotes = await getUserVotes();

    const renderFeatures = [...features];

    if (renderFeatures.length === 0) {
      listEl.innerHTML = `<div class="ytp-plus-voting-empty">${tf('noFeatures', 'No feature requests yet')}</div>`;
      // Still update the aggregate vote bar even when there are no user features —
      // the preview feature in the DB tracks the overall like/dislike count.
      updateVoteBar(allVotes, userVotes, previewFeature?.id || null);
      return;
    }

    listEl.innerHTML = renderFeatures
      .map(f => {
        const votes = allVotes[f.id] || { upvotes: 0, downvotes: 0 };
        const userVote = userVotes[f.id] || 0;
        const totalVotes = votes.upvotes + votes.downvotes;
        const upPercent = totalVotes > 0 ? Math.round((votes.upvotes / totalVotes) * 100) : 50;
        const statusMeta = getStatusMeta(f.status);
        return `
          <div class="ytp-plus-voting-item" data-feature-id="${f.id}">
            <div class="ytp-plus-voting-item-content">
              <div class="ytp-plus-voting-item-title">${escapeHtml(f.title)}</div>
              <div class="ytp-plus-voting-item-desc">${escapeHtml(f.description || '')}</div>
              <div class="ytp-plus-voting-item-status ${statusMeta.className}">${escapeHtml(statusMeta.label)}</div>
            </div>
            <div class="ytp-plus-voting-item-votes">
              <div class="ytp-plus-voting-score">
                <span class="ytp-plus-vote-total">${totalVotes} ${tf('votes', 'votes')}</span>
              </div>
              <div class="ytp-plus-voting-buttons">
                <div class="ytp-plus-voting-buttons-track" style="background:linear-gradient(to right, #4caf50 ${upPercent}%, #f44336 ${upPercent}%);"></div>
                <button class="ytp-plus-vote-btn ${userVote === 1 ? 'active' : ''}" data-vote="1" title="${tf('like', 'Like')}" type="button" aria-label="${tf('like', 'Like')}">
                  <svg class="ytp-plus-vote-icon" viewBox="0 0 24 24"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>
                </button>
                <button class="ytp-plus-vote-btn ${userVote === -1 ? 'active' : ''}" data-vote="-1" title="${tf('dislike', 'Dislike')}" type="button" aria-label="${tf('dislike', 'Dislike')}">
                  <svg class="ytp-plus-vote-icon" viewBox="0 0 24 24"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>
                </button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    listEl.querySelectorAll('.ytp-plus-vote-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (voteRequestInFlight) return;
        const featureId = btn.closest('.ytp-plus-voting-item').dataset.featureId;
        const voteType = parseInt(btn.dataset.vote, 10);
        const currentUserVote = userVotes[featureId] || 0;

        let newVoteType = voteType;
        if (currentUserVote === voteType) {
          newVoteType = 0;
        }

        try {
          voteRequestInFlight = true;
          setVoteControlsBusy(
            listEl.closest('.ytp-plus-settings-section, .ytp-plus-voting') || listEl,
            true
          );

          const result = await vote(featureId, newVoteType);
          if (result.success) {
            await loadFeatures();
          }
        } finally {
          voteRequestInFlight = false;
          setVoteControlsBusy(
            listEl.closest('.ytp-plus-settings-section, .ytp-plus-voting') || listEl,
            false
          );
        }
      });
    });

    // Update aggregate vote bar
    updateVoteBar(allVotes, userVotes, previewFeature?.id || null);
  }

  function escapeHtml(str) {
    if (!str) return '';
    if (window.YouTubeSecurityUtils?.escapeHtml) return window.YouTubeSecurityUtils.escapeHtml(str);
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /** Aggregate all feature votes into a single bar above the feature list */
  function updateVoteBar(allVotes, userVotes, previewFeatureId) {
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
    fillEl.style.background = `linear-gradient(to right, #4caf50 ${pct}%, #f44336 ${pct}%)`;
    countEl.textContent = total > 0 ? `${total}` : '0';

    const previewUserVote = previewFeatureId ? userVotes[previewFeatureId] || 0 : 0;
    if (upBtn) upBtn.classList.toggle('active', previewUserVote === 1);
    if (downBtn) downBtn.classList.toggle('active', previewUserVote === -1);
  }

  /** Before/After comparison slider */
  function initSlider() {
    const container = document.querySelector('.ytp-plus-ba-container');
    if (!container || container.dataset.sliderInit) return;
    container.dataset.sliderInit = '1';

    const afterEl = container.querySelector('.ytp-plus-ba-after');
    const divider = container.querySelector('.ytp-plus-ba-divider');
    if (!afterEl || !divider) return;

    let dragging = false;
    let resumeTimer = null;
    let rafId = null;

    function setPosition(pct, manual = false) {
      const clamped = Math.max(2, Math.min(98, pct));
      afterEl.style.clipPath = `inset(0 0 0 ${clamped}%)`;
      if (manual) {
        divider.style.left = `${clamped}%`;
      }
      divider.setAttribute('aria-valuenow', String(Math.round(clamped)));
    }

    function getPct(clientX) {
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

    container.addEventListener('mousedown', e => {
      dragging = true;
      pauseAutoplay();
      setPosition(getPct(e.clientX), true);
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (dragging) setPosition(getPct(e.clientX), true);
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
    });

    container.addEventListener(
      'touchstart',
      e => {
        dragging = true;
        pauseAutoplay();
        setPosition(getPct(e.touches[0].clientX), true);
      },
      { passive: true }
    );
    window.addEventListener(
      'touchmove',
      e => {
        if (dragging) setPosition(getPct(e.touches[0].clientX), true);
      },
      { passive: true }
    );
    window.addEventListener('touchend', () => {
      dragging = false;
    });

    divider.addEventListener('keydown', e => {
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

    // Vote bar aggregate buttons
    document.addEventListener('click', async e => {
      const barBtn = e.target.closest('.ytp-plus-vote-bar-btn');
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
    });

    document.addEventListener('click', e => {
      const showAddBtn = e.target.closest('#ytp-plus-show-add-feature');
      const cancelBtn = e.target.closest('#ytp-plus-cancel-feature');
      const submitBtn = e.target.closest('#ytp-plus-submit-feature');

      if (showAddBtn) {
        const addFormEl = document.getElementById('ytp-plus-voting-add-form');
        const showAddEl = document.getElementById('ytp-plus-show-add-feature');
        if (addFormEl) addFormEl.style.display = 'block';
        if (showAddEl) showAddEl.style.display = 'none';
      }

      if (cancelBtn) {
        const addFormEl = document.getElementById('ytp-plus-voting-add-form');
        const showAddEl = document.getElementById('ytp-plus-show-add-feature');
        const titleEl = document.getElementById('ytp-plus-feature-title');
        const descEl = document.getElementById('ytp-plus-feature-desc');

        if (addFormEl) addFormEl.style.display = 'none';
        if (showAddEl) showAddEl.style.display = 'block';
        if (titleEl) titleEl.value = '';
        if (descEl) descEl.value = '';
      }

      if (submitBtn) {
        const titleInput = document.getElementById('ytp-plus-feature-title');
        const descInput = document.getElementById('ytp-plus-feature-desc');
        const title = titleInput?.value?.trim() || '';
        const desc = descInput?.value?.trim() || '';
        if (!title) return;

        submitBtn.disabled = true;
        submitBtn.textContent = tf('loading', 'Loading...');

        submitFeature(title, desc).then(result => {
          submitBtn.disabled = false;
          submitBtn.textContent = tf('submit', 'Submit');

          if (result.success) {
            const addFormEl = document.getElementById('ytp-plus-voting-add-form');
            const showAddEl = document.getElementById('ytp-plus-show-add-feature');
            if (addFormEl) addFormEl.style.display = 'none';
            if (showAddEl) showAddEl.style.display = 'block';
            if (titleInput) titleInput.value = '';
            if (descInput) descInput.value = '';
            loadFeatures();
          }
        });
      }
    });
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
})();
