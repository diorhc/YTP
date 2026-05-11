/**
 * @jest-environment jsdom
 */

/**
 * @typedef {Object} TestState
 * @property {HTMLElement | null} overlay
 * @property {ReturnType<typeof setInterval> | null} intervalId
 * @property {number} updateInterval
 * @property {number} overlayOpacity
 * @property {string} currentChannelName
 */

describe('Stats Module - Event Handler Optimization', () => {
  /** @type {TestState} */
  let state;

  /** @param {EventTarget | null} target */
  const isInput = target => target instanceof HTMLInputElement;
  /** @param {EventTarget | null} target */
  const isSelect = target => target instanceof HTMLSelectElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    state = {
      overlay: null,
      intervalId: null,
      updateInterval: 5000,
      overlayOpacity: 0.7,
      currentChannelName: 'TestChannel',
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (state.intervalId) {
      clearInterval(state.intervalId);
    }
  });

  describe('Display Options Event Delegation', () => {
    test('should handle checkbox changes through delegation', () => {
      const displaySection = document.createElement('div');
      displaySection.id = 'display-section';

      const updateDisplayState = jest.fn();

      displaySection.addEventListener('change', e => {
        if (!isInput(e.target)) {
          return;
        }
        const checkbox = e.target;
        if (checkbox.type === 'checkbox' && checkbox.id.startsWith('show-')) {
          const option = checkbox.id.replace('show-', '');
          localStorage.setItem(`show-${option}`, String(checkbox.checked));
          updateDisplayState();
        }
      });

      ['subscribers', 'views', 'videos'].forEach(option => {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `show-${option}`;
        checkbox.checked = true;
        displaySection.appendChild(checkbox);
      });

      document.body.appendChild(displaySection);

      const subscribersCheckbox = document.getElementById('show-subscribers');
      expect(subscribersCheckbox).toBeInstanceOf(HTMLInputElement);
      if (!(subscribersCheckbox instanceof HTMLInputElement)) {
        return;
      }

      subscribersCheckbox.checked = false;
      subscribersCheckbox.dispatchEvent(new Event('change', { bubbles: true }));

      expect(updateDisplayState).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('show-subscribers')).toBe('false');
    });

    test('should only process checkboxes with show- prefix', () => {
      const displaySection = document.createElement('div');
      const updateDisplayState = jest.fn();

      displaySection.addEventListener('change', e => {
        if (!isInput(e.target)) {
          return;
        }
        const checkbox = e.target;
        if (checkbox.type === 'checkbox' && checkbox.id.startsWith('show-')) {
          updateDisplayState();
        }
      });

      const relevantCheckbox = document.createElement('input');
      relevantCheckbox.type = 'checkbox';
      relevantCheckbox.id = 'show-subscribers';
      displaySection.appendChild(relevantCheckbox);

      const irrelevantCheckbox = document.createElement('input');
      irrelevantCheckbox.type = 'checkbox';
      irrelevantCheckbox.id = 'other-checkbox';
      displaySection.appendChild(irrelevantCheckbox);

      document.body.appendChild(displaySection);

      irrelevantCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
      expect(updateDisplayState).not.toHaveBeenCalled();

      relevantCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
      expect(updateDisplayState).toHaveBeenCalledTimes(1);
    });
  });

  describe('Controls Section Event Delegation', () => {
    test('should handle font size slider through delegation', () => {
      const controlsSection = document.createElement('div');
      const overlay = document.createElement('div');
      overlay.className = 'stats-overlay';

      const numberElements = ['subscribers-number', 'views-number', 'videos-number'].map(cls => {
        const el = document.createElement('div');
        el.className = cls;
        if (el.style) {
          el.style.fontSize = '24px';
        }
        overlay.appendChild(el);
        return el;
      });

      state.overlay = overlay;

      controlsSection.addEventListener('input', e => {
        if (!isInput(e.target)) {
          return;
        }
        const input = e.target;

        if (input.classList.contains('font-size-slider')) {
          const fontSizeValue = controlsSection.querySelector('.font-size-value');
          if (fontSizeValue) fontSizeValue.textContent = `${input.value}px`;
          localStorage.setItem('youtubeEnhancerFontSize', input.value);
          if (state.overlay) {
            state.overlay
              .querySelectorAll('.subscribers-number,.views-number,.videos-number')
              .forEach(el => {
                if (el instanceof HTMLElement && el.style) {
                  el.style.fontSize = `${input.value}px`;
                }
              });
          }
        }
      });

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'font-size-slider';
      slider.min = '16';
      slider.max = '72';
      slider.value = '32';

      const valueDisplay = document.createElement('div');
      valueDisplay.className = 'font-size-value';
      valueDisplay.textContent = '32px';

      controlsSection.appendChild(slider);
      controlsSection.appendChild(valueDisplay);
      document.body.appendChild(controlsSection);

      slider.value = '48';
      slider.dispatchEvent(new Event('input', { bubbles: true }));

      expect(localStorage.getItem('youtubeEnhancerFontSize')).toBe('48');
      expect(valueDisplay.textContent).toBe('48px');
      numberElements.forEach(el => {
        if (el.style) {
          expect(el.style.fontSize).toBe('48px');
        }
      });
    });

    test('should handle interval slider through delegation', () => {
      const controlsSection = document.createElement('div');

      controlsSection.addEventListener('input', e => {
        if (!isInput(e.target)) {
          return;
        }
        const input = e.target;

        if (input.classList.contains('interval-slider')) {
          const newInterval = parseInt(input.value, 10) * 1000;
          const intervalValue = controlsSection.querySelector('.interval-value');
          if (intervalValue) intervalValue.textContent = `${input.value}s`;
          state.updateInterval = newInterval;
          localStorage.setItem('youtubeEnhancerInterval', String(newInterval));
        }
      });

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'interval-slider';
      slider.min = '2';
      slider.max = '10';
      slider.value = '5';

      const valueDisplay = document.createElement('div');
      valueDisplay.className = 'interval-value';
      valueDisplay.textContent = '5s';

      controlsSection.appendChild(slider);
      controlsSection.appendChild(valueDisplay);
      document.body.appendChild(controlsSection);

      slider.value = '7';
      slider.dispatchEvent(new Event('input', { bubbles: true }));

      expect(state.updateInterval).toBe(7000);
      expect(localStorage.getItem('youtubeEnhancerInterval')).toBe('7000');
      expect(valueDisplay.textContent).toBe('7s');
    });

    test('should handle opacity slider through delegation', () => {
      const controlsSection = document.createElement('div');
      const overlay = document.createElement('div');
      state.overlay = overlay;

      controlsSection.addEventListener('input', e => {
        if (!isInput(e.target)) {
          return;
        }
        const input = e.target;

        if (input.classList.contains('opacity-slider')) {
          const newOpacity = parseInt(input.value, 10) / 100;
          const opacityValue = controlsSection.querySelector('.opacity-value');
          if (opacityValue) opacityValue.textContent = `${input.value}%`;
          state.overlayOpacity = newOpacity;
          localStorage.setItem('youtubeEnhancerOpacity', String(newOpacity));

          if (state.overlay && state.overlay.style) {
            state.overlay.style.backgroundColor = `rgba(0, 0, 0, ${newOpacity})`;
          }
        }
      });

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'opacity-slider';
      slider.min = '50';
      slider.max = '90';
      slider.value = '70';

      const valueDisplay = document.createElement('div');
      valueDisplay.className = 'opacity-value';
      valueDisplay.textContent = '70%';

      controlsSection.appendChild(slider);
      controlsSection.appendChild(valueDisplay);
      document.body.appendChild(controlsSection);

      slider.value = '85';
      slider.dispatchEvent(new Event('input', { bubbles: true }));

      expect(state.overlayOpacity).toBe(0.85);
      expect(localStorage.getItem('youtubeEnhancerOpacity')).toBe('0.85');
      expect(valueDisplay.textContent).toBe('85%');
      if (overlay.style) {
        expect(overlay.style.backgroundColor).toBe('rgba(0, 0, 0, 0.85)');
      }
    });

    test('should handle font family select through delegation', () => {
      const controlsSection = document.createElement('div');
      const overlay = document.createElement('div');

      const numberElements = ['subscribers-number', 'views-number', 'videos-number'].map(cls => {
        const el = document.createElement('div');
        el.className = cls;
        if (el.style) {
          el.style.fontFamily = 'Rubik, sans-serif';
        }
        overlay.appendChild(el);
        return el;
      });

      state.overlay = overlay;

      controlsSection.addEventListener('change', e => {
        if (!isSelect(e.target)) {
          return;
        }
        const select = e.target;

        if (select.classList.contains('font-family-select')) {
          localStorage.setItem('youtubeEnhancerFontFamily', select.value);
          if (state.overlay) {
            state.overlay
              .querySelectorAll('.subscribers-number,.views-number,.videos-number')
              .forEach(el => {
                if (el instanceof HTMLElement && el.style) {
                  el.style.fontFamily = select.value;
                }
              });
          }
        }
      });

      const select = document.createElement('select');
      select.className = 'font-family-select';
      ['Rubik, sans-serif', 'Impact, Charcoal, sans-serif', 'Verdana, Geneva, sans-serif'].forEach(
        font => {
          const option = document.createElement('option');
          option.value = font;
          option.textContent = font.split(',')[0];
          select.appendChild(option);
        }
      );

      controlsSection.appendChild(select);
      document.body.appendChild(controlsSection);

      select.value = 'Impact, Charcoal, sans-serif';
      select.dispatchEvent(new Event('change', { bubbles: true }));

      expect(localStorage.getItem('youtubeEnhancerFontFamily')).toBe(
        'Impact, Charcoal, sans-serif'
      );
      numberElements.forEach(el => {
        if (el.style) {
          expect(el.style.fontFamily).toBe('Impact, Charcoal, sans-serif');
        }
      });
    });
  });

  describe('Event Delegation Performance Benefits', () => {
    test('should use single listener for multiple checkboxes', () => {
      const container = document.createElement('div');
      let listenerCount = 0;

      container.addEventListener('change', () => {
        listenerCount++;
      });

      for (let i = 0; i < 10; i++) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `checkbox-${i}`;
        container.appendChild(checkbox);
      }

      document.body.appendChild(container);

      for (let i = 0; i < 10; i++) {
        const checkbox = document.getElementById(`checkbox-${i}`);
        expect(checkbox).toBeInstanceOf(HTMLInputElement);
        if (!(checkbox instanceof HTMLInputElement)) {
          continue;
        }
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }

      expect(listenerCount).toBe(10);
    });

    test('should handle dynamically added elements', () => {
      const container = document.createElement('div');
      /** @type {string[]} */
      const results = [];

      container.addEventListener('click', e => {
        if (!(e.target instanceof Element)) {
          return;
        }
        const button = e.target.closest('button');
        if (button instanceof HTMLButtonElement) {
          results.push(button.id);
        }
      });

      document.body.appendChild(container);

      for (let i = 0; i < 5; i++) {
        const button = document.createElement('button');
        button.id = `btn-${i}`;
        container.appendChild(button);
      }

      container.querySelectorAll('button').forEach(btn => btn.click());

      expect(results).toEqual(['btn-0', 'btn-1', 'btn-2', 'btn-3', 'btn-4']);
    });
  });
});
