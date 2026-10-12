const {
  TOGGLE_CYCLES,
  LEAK_METRICS,
  FEATURES,
  FEATURE_LEAK_THRESHOLDS,
} = require('../e2e/feature-toggle-leaks.spec.js');

/**
 * Pinned upper-bound ceilings for per-feature leak thresholds.
 * Thresholds in `e2e/feature-toggle-leaks.spec.js` (`FEATURE_LEAK_THRESHOLDS`)
 * form a one-way ratchet: they may be lowered as leaks are fixed (`0 <= threshold <= ceiling`),
 * but must NEVER be increased above these ceilings.
 */
const PINNED_FEATURE_LEAK_CEILINGS = {
  enableStyles: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableSpeedControl: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableScreenshot: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableDownload: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableAdBlocker: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  endscreen: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  'styles.thumbnailHover': {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  'styles.immersiveSearch': {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  'styles.hideVoiceSearch': {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  'styles.transparentHeader': {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  'styles.hideSideGuide': {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  'styles.cleanSideGuide': {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  'styles.fixFeedLayout': {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  'styles.compactFeed': {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  'styles.betterCaptions': {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  'styles.playerBlur': {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  'styles.theaterEnhancements': {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  'styles.sideVideosColumnsEnabled': {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableEnhanced: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableTabview: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableCommentTranslate: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableResumeTime: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableZoom: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableThumbnail: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enablePlaylistSearch: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableScrollToTopButton: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableRememberManualQuality: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableLoop: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enablePip: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  timecodeEnabled: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableMusic: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enablePlayAll: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableStatsButton: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableChannelStats: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  shortsKeyboard: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  settingsModal: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  performanceMode: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
  enableAnimations: {
    listenersDelta: 0,
    detachedListenersDelta: 0,
    timersDelta: 0,
    observersDelta: 0,
    stylesDelta: 0,
    domDelta: 0,
    featureDomLeftovers: 0,
    featureStyleLeftovers: 0,
    featureAttrLeftovers: 0,
  },
};

const EXPECTED_GROUP_FEATURES = ['enableEnhanced'];
const EXPECTED_NOT_EXERCISED_FEATURES = ['enableMusic'];

describe('Feature toggle leak threshold ratchet', () => {
  test('group and not-exercised features are explicitly tracked and pinned', () => {
    const groupFeatures = FEATURES.filter(f => f.kind === 'group').map(f => f.id);
    const notExercisedFeatures = FEATURES.filter(f => f.requiresHost).map(f => f.id);

    expect(groupFeatures.sort()).toEqual([...EXPECTED_GROUP_FEATURES].sort());
    expect(notExercisedFeatures.sort()).toEqual([...EXPECTED_NOT_EXERCISED_FEATURES].sort());
  });

  test('every feature in FEATURES has a complete threshold entry', () => {
    expect(TOGGLE_CYCLES).toBe(10);
    expect(FEATURES.length).toBe(38);

    const featureIds = FEATURES.map(f => f.id);
    expect(Object.keys(FEATURE_LEAK_THRESHOLDS).sort()).toEqual([...featureIds].sort());
    expect(Object.keys(PINNED_FEATURE_LEAK_CEILINGS).sort()).toEqual([...featureIds].sort());

    for (const id of featureIds) {
      const entry = FEATURE_LEAK_THRESHOLDS[id];
      expect(Object.keys(entry).sort()).toEqual([...LEAK_METRICS].sort());
    }
  });

  test('per-feature leak thresholds can only decrease and never exceed pinned ceilings', () => {
    const violations = [];

    for (const [featureId, ceilingEntry] of Object.entries(PINNED_FEATURE_LEAK_CEILINGS)) {
      const currentEntry = FEATURE_LEAK_THRESHOLDS[featureId];
      if (!currentEntry) {
        violations.push(`Missing threshold entry for ${featureId}`);
        continue;
      }

      for (const metric of LEAK_METRICS) {
        const currentVal = currentEntry[metric];
        const ceilingVal = ceilingEntry[metric];

        if (typeof currentVal !== 'number' || !Number.isInteger(currentVal) || currentVal < 0) {
          violations.push(`${featureId}.${metric}: invalid threshold value ${String(currentVal)}`);
          continue;
        }

        if (currentVal > ceilingVal) {
          violations.push(
            `${featureId}.${metric}: threshold increased from ceiling ${ceilingVal} to ${currentVal} (thresholds may only decrease)`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
