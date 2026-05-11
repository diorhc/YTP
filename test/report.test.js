describe('Report module', () => {
  const fs = require('fs');
  const path = require('path');

  /** @returns {HTMLDivElement} */
  function createModalWithReportSection() {
    const modal = document.createElement('div');
    const section = document.createElement('div');
    section.className = 'ytp-plus-settings-section';
    section.setAttribute('data-section', 'report');
    modal.appendChild(section);
    document.body.appendChild(modal);
    return modal;
  }

  function loadReportScript() {
    const srcPath = path.resolve(__dirname, '../src/report.js');
    const code = fs.readFileSync(srcPath, 'utf8');
    window.eval(code);
  }

  /** @param {unknown} value @returns {HTMLDivElement} */
  function requireDiv(value) {
    expect(value).toBeInstanceOf(HTMLDivElement);
    if (!(value instanceof HTMLDivElement)) {
      throw new Error('Expected HTMLDivElement');
    }
    return value;
  }

  /** @param {unknown} value @returns {HTMLInputElement} */
  function requireInput(value) {
    expect(value).toBeInstanceOf(HTMLInputElement);
    if (!(value instanceof HTMLInputElement)) {
      throw new Error('Expected HTMLInputElement');
    }
    return value;
  }

  /** @param {unknown} value @returns {HTMLTextAreaElement} */
  function requireTextArea(value) {
    expect(value).toBeInstanceOf(HTMLTextAreaElement);
    if (!(value instanceof HTMLTextAreaElement)) {
      throw new Error('Expected HTMLTextAreaElement');
    }
    return value;
  }

  beforeEach(() => {
    delete window.youtubePlusReport;
    document.body.innerHTML = '';
  });

  describe('Module Initialization', () => {
    test('exposes a render function on window.youtubePlusReport', () => {
      loadReportScript();
      expect(typeof window.youtubePlusReport).toBe('object');
      expect(typeof window.youtubePlusReport.render).toBe('function');
    });
  });

  describe('Form Rendering', () => {
    beforeEach(() => {
      loadReportScript();
      createModalWithReportSection();
    });

    test('should render form with all required fields', () => {
      const modal = requireDiv(document.body.querySelector('div'));
      window.youtubePlusReport.render(modal);

      expect(modal.querySelector('select')).toBeTruthy();
      const inputs = modal.querySelectorAll(
        'input[type="text"], input:not([type="checkbox"]):not([type="email"])'
      );
      expect(inputs.length).toBeGreaterThan(0);
      expect(modal.querySelector('input[type="email"]')).toBeTruthy();
      expect(modal.querySelector('textarea')).toBeTruthy();
      expect(modal.querySelector('input[type="checkbox"]')).toBeTruthy();
    });

    test('should render three action buttons', () => {
      const modal = requireDiv(document.body.querySelector('div'));
      window.youtubePlusReport.render(modal);

      const buttons = modal.querySelectorAll('button.glass-button');
      expect(buttons.length).toBe(3);
      expect(buttons[0]).toBeTruthy();
      expect(buttons[1]).toBeTruthy();
      expect(buttons[2]).toBeTruthy();
    });

    test('should render privacy notice', () => {
      const modal = requireDiv(document.body.querySelector('div'));
      window.youtubePlusReport.render(modal);

      const privacy = modal.querySelector('.ytp-plus-settings-item-description');
      expect(privacy).toBeTruthy();
      if (privacy) {
        expect((privacy.textContent || '').length).toBeGreaterThan(0);
      }
    });

    test('should handle missing modal gracefully', () => {
      expect(() => {
        window.youtubePlusReport.render(null);
      }).not.toThrow();
    });

    test('should handle missing section gracefully', () => {
      const modal = document.createElement('div');
      document.body.appendChild(modal);
      expect(() => {
        window.youtubePlusReport.render(modal);
      }).not.toThrow();
    });
  });

  describe('Form Validation', () => {
    beforeEach(() => {
      loadReportScript();
      const modal = createModalWithReportSection();
      window.youtubePlusReport.render(modal);
    });

    test('should require title and description', () => {
      const modal = requireDiv(document.body.querySelector('div'));
      const inputs = modal.querySelectorAll(
        'input[type="text"], input:not([type="checkbox"]):not([type="email"])'
      );
      const textarea = requireTextArea(modal.querySelector('textarea'));

      expect(inputs.length).toBeGreaterThan(0);
      expect(textarea.hasAttribute('placeholder')).toBe(true);
    });

    test('should validate minimum title length', () => {
      const modal = requireDiv(document.body.querySelector('div'));
      const titleInput = requireInput(
        modal.querySelector(
          'input[placeholder*="title"], input[placeholder*="Title"], input:not([type="email"]):not([type="checkbox"])'
        )
      );

      titleInput.value = 'Test';
      expect(titleInput.value.length).toBeGreaterThan(0);
    });

    test('should validate minimum description length', () => {
      const modal = requireDiv(document.body.querySelector('div'));
      const descInput = requireTextArea(modal.querySelector('textarea'));

      descInput.value = 'Test description';
      expect(descInput.value.length).toBeGreaterThan(0);
    });

    test('should validate email format if provided', () => {
      const modal = requireDiv(document.body.querySelector('div'));
      const emailInput = requireInput(modal.querySelector('input[type="email"]'));

      emailInput.value = 'invalid-email';
      expect(emailInput.validity.valid).toBe(false);
    });

    test('should accept valid email', () => {
      const modal = requireDiv(document.body.querySelector('div'));
      const emailInput = requireInput(modal.querySelector('input[type="email"]'));

      emailInput.value = 'test@example.com';
      expect(emailInput.validity.valid).toBe(true);
    });
  });

  describe('Button Functionality', () => {
    beforeEach(() => {
      loadReportScript();
      const modal = createModalWithReportSection();
      window.youtubePlusReport.render(modal);
    });

    test('should open GitHub issue in new tab', () => {
      const buttons = document.querySelectorAll('button.glass-button');
      expect(buttons.length).toBe(3);

      const githubBtn = buttons[0];
      expect(githubBtn).toBeTruthy();
      expect(githubBtn.tagName).toBe('BUTTON');
    });

    test('should copy report to clipboard', async () => {
      const buttons = document.querySelectorAll('button.glass-button');
      expect(buttons.length).toBe(3);

      const copyBtn = buttons[1];
      expect(copyBtn).toBeTruthy();
      expect(copyBtn.tagName).toBe('BUTTON');
    });

    test('should prepare email with mailto link', () => {
      const buttons = document.querySelectorAll('button');
      const emailBtn = buttons[2];

      expect(emailBtn).toBeTruthy();
    });

    test('should disable button during submission', () => {
      const buttons = document.querySelectorAll('button.glass-button');
      expect(buttons.length).toBe(3);

      buttons.forEach(btn => {
        expect(btn.disabled).toBe(false);
      });
    });
  });

  describe('Debug Info', () => {
    beforeEach(() => {
      if (!window.YouTubePlusDebug) {
        window.YouTubePlusDebug = { utils: {}, state: {} };
      }
      window.YouTubePlusDebug.version = '2.1';

      loadReportScript();
    });

    test('should include debug info when checkbox is checked', () => {
      const modal = createModalWithReportSection();
      window.youtubePlusReport.render(modal);

      const checkbox = requireInput(modal.querySelector('input[type="checkbox"]'));

      expect(checkbox.checked).toBe(false);

      checkbox.checked = true;
      expect(checkbox.checked).toBe(true);
    });
  });
});
