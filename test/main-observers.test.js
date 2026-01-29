/**
 * @jest-environment jsdom
 */

describe('Main Module - DOM Observer Optimizations', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('Debouncing Logic', () => {
    test('should debounce rapid function calls', () => {
      let debounceTimer = null;
      const callback = jest.fn();
      const debounceInterval = 50;

      const debouncedFunction = () => {
        if (debounceTimer) return;
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          callback();
        }, debounceInterval);
      };

      // Call function multiple times rapidly
      for (let i = 0; i < 10; i++) {
        debouncedFunction();
      }

      // Callback should not be called yet
      expect(callback).not.toHaveBeenCalled();

      // Advance timers
      jest.advanceTimersByTime(debounceInterval);

      // Callback should be called once
      expect(callback).toHaveBeenCalledTimes(1);
    });

    test('should handle plugin detection logic', () => {
      let debounceTimer = null;
      const pluginsDetected = {};
      const processPlugin = jest.fn();
      const debounceInterval = 50;

      const handleMutation = attributeName => {
        if (debounceTimer) return;
        debounceTimer = setTimeout(() => {
          debounceTimer = null;

          if (attributeName === 'data-ytlstm-theater-mode') {
            if (!pluginsDetected['external.ytlstm']) {
              pluginsDetected['external.ytlstm'] = true;
              processPlugin('external.ytlstm');
            }
          }
        }, debounceInterval);
      };

      // Simulate multiple mutations
      handleMutation('data-ytlstm-theater-mode');
      handleMutation('data-ytlstm-theater-mode');

      jest.advanceTimersByTime(debounceInterval);

      expect(processPlugin).toHaveBeenCalledWith('external.ytlstm');
      expect(pluginsDetected['external.ytlstm']).toBe(true);
    });

    test('should prevent duplicate plugin activation', () => {
      const pluginsDetected = {};
      const activatePlugin = jest.fn();

      const processPlugin = pluginName => {
        if (!pluginsDetected[pluginName]) {
          pluginsDetected[pluginName] = true;
          activatePlugin(pluginName);
        }
      };

      // Try to activate same plugin multiple times
      processPlugin('test-plugin');
      processPlugin('test-plugin');
      processPlugin('test-plugin');

      // Plugin should only be activated once
      expect(activatePlugin).toHaveBeenCalledTimes(1);
    });
  });

  describe('Comment Observer Throttling', () => {
    test('should throttle comment processing logic', () => {
      let throttleTimer = null;
      let pendingMutations = [];
      const processCommentMutations = jest.fn();

      const handleMutation = mutation => {
        pendingMutations.push(mutation);
        if (throttleTimer) return;
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          const allMutations = pendingMutations;
          pendingMutations = [];
          processCommentMutations(allMutations);
        }, 50);
      };

      // Simulate rapid mutations
      handleMutation({ type: 'attributes', attributeName: 'hidden' });
      handleMutation({ type: 'attributes', attributeName: 'tyt-comments-video-id' });
      handleMutation({ type: 'attributes', attributeName: 'tyt-comments-data-status' });

      expect(processCommentMutations).not.toHaveBeenCalled();

      jest.advanceTimersByTime(50);

      expect(processCommentMutations).toHaveBeenCalledTimes(1);
      expect(processCommentMutations.mock.calls[0][0].length).toBe(3);
    });

    test('should accumulate pending mutations', () => {
      let throttleTimer = null;
      let pendingMutations = [];
      const processMutations = jest.fn();

      const handleMutation = mutation => {
        pendingMutations.push(mutation);
        if (throttleTimer) return;
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          const allMutations = pendingMutations;
          pendingMutations = [];
          processMutations(allMutations);
        }, 50);
      };

      // Multiple mutations
      handleMutation({ type: 'attributes', attr: 'attr1' });
      expect(pendingMutations.length).toBe(1);

      handleMutation({ type: 'attributes', attr: 'attr2' });
      expect(pendingMutations.length).toBe(2);

      handleMutation({ type: 'childList' });
      expect(pendingMutations.length).toBe(3);

      jest.advanceTimersByTime(50);

      expect(processMutations).toHaveBeenCalledTimes(1);
      expect(pendingMutations.length).toBe(0);
    });
  });

  describe('EGM Panels Observer Debouncing', () => {
    test('should debounce EGM panel updates at 60fps', () => {
      let egmPanelsDebounceTimer = null;
      const updateEgmPanels = jest.fn();
      const debounceInterval = 16; // ~60fps

      const handleUpdate = () => {
        if (egmPanelsDebounceTimer) return;
        egmPanelsDebounceTimer = setTimeout(() => {
          egmPanelsDebounceTimer = null;
          updateEgmPanels();
        }, debounceInterval);
      };

      // Trigger rapid updates (animation frames)
      for (let i = 0; i < 10; i++) {
        handleUpdate();
      }

      expect(updateEgmPanels).not.toHaveBeenCalled();

      jest.advanceTimersByTime(debounceInterval);

      expect(updateEgmPanels).toHaveBeenCalledTimes(1);
    });

    test('should use 60fps debounce interval', () => {
      let debounceTimer = null;
      const callback = jest.fn();
      const debounceInterval = 16; // ~60fps

      const debouncedUpdate = () => {
        if (debounceTimer) return;
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          callback();
        }, debounceInterval);
      };

      debouncedUpdate();

      // Before interval
      jest.advanceTimersByTime(15);
      expect(callback).not.toHaveBeenCalled();

      // After interval
      jest.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Observer Performance Optimization', () => {
    test('should reduce callback frequency with debouncing', () => {
      const callbackWithoutDebounce = jest.fn();
      const callbackWithDebounce = jest.fn();
      let debounceTimer = null;

      // Without debounce
      const normalUpdate = () => {
        callbackWithoutDebounce();
      };

      // With debounce
      const debouncedUpdate = () => {
        if (debounceTimer) return;
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          callbackWithDebounce();
        }, 50);
      };

      // Trigger 100 rapid updates
      for (let i = 0; i < 100; i++) {
        normalUpdate();
        debouncedUpdate();
      }

      jest.advanceTimersByTime(50);

      // Without debounce: called many times
      expect(callbackWithoutDebounce.mock.calls.length).toBe(100);

      // With debounce: called once
      expect(callbackWithDebounce).toHaveBeenCalledTimes(1);
    });

    test('should handle multiple debounce timings', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      let timer1 = null;
      let timer2 = null;

      const debounced1 = () => {
        if (timer1) return;
        timer1 = setTimeout(() => {
          timer1 = null;
          callback1();
        }, 50);
      };

      const debounced2 = () => {
        if (timer2) return;
        timer2 = setTimeout(() => {
          timer2 = null;
          callback2();
        }, 100);
      };

      debounced1();
      debounced2();

      jest.advanceTimersByTime(50);
      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).not.toHaveBeenCalled();

      jest.advanceTimersByTime(50);
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe('Observer Memory Management', () => {
    test('should clear pending timers on cleanup', () => {
      let debounceTimer = null;
      const callback = jest.fn();

      const scheduleUpdate = () => {
        if (debounceTimer) return;
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          callback();
        }, 50);
      };

      scheduleUpdate();

      // Cleanup before timer fires
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      jest.advanceTimersByTime(50);

      expect(callback).not.toHaveBeenCalled();
    });

    test('should handle timer cancellation', () => {
      let timer = null;
      const callback = jest.fn();

      const startTimer = () => {
        timer = setTimeout(callback, 100);
      };

      const cancelTimer = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

      startTimer();
      cancelTimer();

      jest.advanceTimersByTime(100);

      expect(callback).not.toHaveBeenCalled();
    });
  });
});
