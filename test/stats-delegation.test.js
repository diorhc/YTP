/**
 * @jest-environment jsdom
 */

describe('Stats Module - Event Handler Optimization', () => {
  let state;

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Mock state object
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

      // Add delegated event listener
      displaySection.addEventListener('change', e => {
        const checkbox = e.target;
        if (checkbox.type === 'checkbox' && checkbox.id.startsWith('show-')) {
          const option = checkbox.id.replace('show-', '');
          localStorage.setItem(`show-${option}`, String(checkbox.checked));
          updateDisplayState();
        }
      });

      // Create checkboxes
      ['subscribers', 'views', 'videos'].forEach(option => {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `show-${option}`;
        checkbox.checked = true;
        displaySection.appendChild(checkbox);
      });

      document.body.appendChild(displaySection);

      // Simulate checkbox change
      const subscribersCheckbox = document.getElementById('show-subscribers');
      subscribersCheckbox.checked = false;
      subscribersCheckbox.dispatchEvent(new Event('change', { bubbles: true }));

      expect(updateDisplayState).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('show-subscribers')).toBe('false');
    });

    test('should only process checkboxes with show- prefix', () => {
      const displaySection = document.createElement('div');

      const updateDisplayState = jest.fn();

      displaySection.addEventListener('change', e => {
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

      // Only relevant checkbox should trigger update
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
        el.style.fontSize = '24px';
        overlay.appendChild(el);
        return el;
      });

      state.overlay = overlay;

      // Add delegated input handler
      controlsSection.addEventListener('input', e => {
        const target = e.target;

        if (target.classList.contains('font-size-slider')) {
          const input = target;
          const fontSizeValue = controlsSection.querySelector('.font-size-value');
          if (fontSizeValue) fontSizeValue.textContent = `${input.value}px`;
          localStorage.setItem('youtubeEnhancerFontSize', input.value);
          if (state.overlay) {
            state.overlay
              .querySelectorAll('.subscribers-number,.views-number,.videos-number')
              .forEach(el => {
                el.style.fontSize = `${input.value}px`;
              });
          }
        }
      });

      // Create slider
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

      // Simulate slider input
      slider.value = '48';
      slider.dispatchEvent(new Event('input', { bubbles: true }));

      expect(localStorage.getItem('youtubeEnhancerFontSize')).toBe('48');
      expect(valueDisplay.textContent).toBe('48px');
      numberElements.forEach(el => {
        expect(el.style.fontSize).toBe('48px');
      });
    });

    test('should handle interval slider through delegation', () => {
      const controlsSection = document.createElement('div');

      controlsSection.addEventListener('input', e => {
        const target = e.target;

        if (target.classList.contains('interval-slider')) {
          const input = target;
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
        const target = e.target;

        if (target.classList.contains('opacity-slider')) {
          const input = target;
          const newOpacity = parseInt(input.value, 10) / 100;
          const opacityValue = controlsSection.querySelector('.opacity-value');
          if (opacityValue) opacityValue.textContent = `${input.value}%`;
          state.overlayOpacity = newOpacity;
          localStorage.setItem('youtubeEnhancerOpacity', String(newOpacity));

          if (state.overlay) {
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
      expect(overlay.style.backgroundColor).toBe('rgba(0, 0, 0, 0.85)');
    });

    test('should handle font family select through delegation', () => {
      const controlsSection = document.createElement('div');
      const overlay = document.createElement('div');

      const numberElements = ['subscribers-number', 'views-number', 'videos-number'].map(cls => {
        const el = document.createElement('div');
        el.className = cls;
        el.style.fontFamily = 'Rubik, sans-serif';
        overlay.appendChild(el);
        return el;
      });

      state.overlay = overlay;

      controlsSection.addEventListener('change', e => {
        const target = e.target;

        if (target.classList.contains('font-family-select')) {
          const select = target;
          localStorage.setItem('youtubeEnhancerFontFamily', select.value);
          if (state.overlay) {
            state.overlay
              .querySelectorAll('.subscribers-number,.views-number,.videos-number')
              .forEach(el => {
                el.style.fontFamily = select.value;
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
        expect(el.style.fontFamily).toBe('Impact, Charcoal, sans-serif');
      });
    });
  });

  describe('Event Delegation Performance Benefits', () => {
    test('should use single listener for multiple checkboxes', () => {
      const container = document.createElement('div');
      let listenerCount = 0;

      // Add delegated listener
      container.addEventListener('change', () => {
        listenerCount++;
      });

      // Add multiple checkboxes
      for (let i = 0; i < 10; i++) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `checkbox-${i}`;
        container.appendChild(checkbox);
      }

      document.body.appendChild(container);

      // Trigger multiple checkboxes
      for (let i = 0; i < 10; i++) {
        const checkbox = document.getElementById(`checkbox-${i}`);
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Single listener handles all events
      expect(listenerCount).toBe(10);
    });

    test('should handle dynamically added elements', () => {
      const container = document.createElement('div');
      const results = [];

      container.addEventListener('click', e => {
        const button = e.target.closest('button');
        if (button) {
          results.push(button.id);
        }
      });

      document.body.appendChild(container);

      // Add buttons dynamically
      for (let i = 0; i < 5; i++) {
        const button = document.createElement('button');
        button.id = `btn-${i}`;
        container.appendChild(button);
      }

      // Click each button
      container.querySelectorAll('button').forEach(btn => btn.click());

      expect(results).toEqual(['btn-0', 'btn-1', 'btn-2', 'btn-3', 'btn-4']);
    });
  });
});
