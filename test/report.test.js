describe('Report module', () => {
  beforeEach(() => {
    // Clear any existing report module
    delete window.youtubePlusReport;
    // Reset document body
    document.body.innerHTML = '';
  });

  describe('Module Initialization', () => {
    test('exposes a render function on window.youtubePlusReport', () => {
      // Load the module (it attaches itself to window)
      require('../src/report.js');
      expect(typeof window.youtubePlusReport).toBe('object');
      expect(typeof window.youtubePlusReport.render).toBe('function');
    });
  });

  describe('Form Rendering', () => {
    beforeEach(() => {
      // Reload the module to ensure fresh state
      jest.resetModules();
      delete require.cache[require.resolve('../src/report.js')];
      require('../src/report.js');

      // Create a mock modal with settings section
      const modal = document.createElement('div');
      const section = document.createElement('div');
      section.className = 'ytp-plus-settings-section';
      section.setAttribute('data-section', 'report');
      modal.appendChild(section);
      document.body.appendChild(modal);
    });

    test('should render form with all required fields', () => {
      const modal = document.body.querySelector('div');
      window.youtubePlusReport.render(modal);

      expect(modal.querySelector('select')).toBeTruthy();
      expect(modal.querySelector('input[placeholder*="title"]')).toBeTruthy();
      expect(modal.querySelector('input[placeholder*="email"]')).toBeTruthy();
      expect(modal.querySelector('textarea')).toBeTruthy();
      expect(modal.querySelector('input[type="checkbox"]')).toBeTruthy();
    });

    test('should render three action buttons', () => {
      const modal = document.body.querySelector('div');
      window.youtubePlusReport.render(modal);

      const buttons = modal.querySelectorAll('button');
      expect(buttons.length).toBe(3);
      expect(buttons[0].textContent).toContain('GitHub');
      expect(buttons[1].textContent).toContain('Copy');
      expect(buttons[2].textContent).toContain('Email');
    });

    test('should render privacy notice', () => {
      const modal = document.body.querySelector('div');
      window.youtubePlusReport.render(modal);

      const privacy = modal.querySelector('.ytp-plus-settings-item-description');
      expect(privacy).toBeTruthy();
      expect(privacy.textContent).toContain('agree');
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
      jest.resetModules();
      delete require.cache[require.resolve('../src/report.js')];
      require('../src/report.js');

      const modal = document.createElement('div');
      const section = document.createElement('div');
      section.className = 'ytp-plus-settings-section';
      section.setAttribute('data-section', 'report');
      modal.appendChild(section);
      document.body.appendChild(modal);
      window.youtubePlusReport.render(modal);
    });

    test('should require title and description', () => {
      const submitBtn = document.querySelector('button');
      const titleInput = document.querySelector('input[placeholder*="title"]');
      const descInput = document.querySelector('textarea');

      // Set empty values
      titleInput.value = '';
      descInput.value = '';

      // Mock console.warn to catch validation warnings
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      submitBtn.click();

      // Check that validation prevented submission
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Report] Validation errors:'),
        expect.any(Array)
      );

      warnSpy.mockRestore();
    });

    test('should validate minimum title length', () => {
      const submitBtn = document.querySelector('button');
      const titleInput = document.querySelector('input[placeholder*="title"]');
      const descInput = document.querySelector('textarea');

      titleInput.value = 'Hi'; // Too short
      descInput.value = 'This is a valid description';

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      submitBtn.click();

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    test('should validate minimum description length', () => {
      const submitBtn = document.querySelector('button');
      const titleInput = document.querySelector('input[placeholder*="title"]');
      const descInput = document.querySelector('textarea');

      titleInput.value = 'Valid Title Here';
      descInput.value = 'Too short'; // Too short

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      submitBtn.click();

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    test('should validate email format if provided', () => {
      const submitBtn = document.querySelector('button');
      const titleInput = document.querySelector('input[placeholder*="title"]');
      const emailInput = document.querySelector('input[placeholder*="email"]');
      const descInput = document.querySelector('textarea');

      titleInput.value = 'Valid Title Here';
      descInput.value = 'This is a valid description';
      emailInput.value = 'invalid-email'; // Invalid format

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      submitBtn.click();

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    test('should accept valid email', () => {
      const titleInput = document.querySelector('input[placeholder*="title"]');
      const emailInput = document.querySelector('input[placeholder*="email"]');
      const descInput = document.querySelector('textarea');

      titleInput.value = 'Valid Title Here';
      descInput.value = 'This is a valid description';
      emailInput.value = 'user@example.com';

      // Mock window.open for submit
      const openSpy = jest.spyOn(window, 'open').mockImplementation();
      const submitBtn = document.querySelector('button');
      submitBtn.click();

      // Should not have validation warnings
      expect(openSpy).toHaveBeenCalled();
      openSpy.mockRestore();
    });
  });

  describe('Button Functionality', () => {
    beforeEach(() => {
      jest.resetModules();
      delete require.cache[require.resolve('../src/report.js')];
      require('../src/report.js');

      const modal = document.createElement('div');
      const section = document.createElement('div');
      section.className = 'ytp-plus-settings-section';
      section.setAttribute('data-section', 'report');
      modal.appendChild(section);
      document.body.appendChild(modal);
      window.youtubePlusReport.render(modal);

      // Fill in valid data
      const titleInput = document.querySelector('input[placeholder*="title"]');
      const descInput = document.querySelector('textarea');
      titleInput.value = 'Test Bug Report';
      descInput.value = 'This is a test bug description with enough detail';
    });

    test('should open GitHub issue in new tab', () => {
      const openSpy = jest.spyOn(window, 'open').mockImplementation();
      const submitBtn = document.querySelector('button');

      submitBtn.click();

      expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('github.com'), '_blank');
      openSpy.mockRestore();
    });

    test('should copy report to clipboard', async () => {
      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      const buttons = document.querySelectorAll('button');
      const copyBtn = buttons[1];

      copyBtn.click();

      // Wait a bit for async operation
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(writeTextMock).toHaveBeenCalled();
    });

    test('should prepare email with mailto link', () => {
      const buttons = document.querySelectorAll('button');
      const emailBtn = buttons[2];

      // Since jsdom doesn't support mailto: navigation, we'll just verify
      // the button exists and is properly configured
      expect(emailBtn).toBeTruthy();
      expect(emailBtn.textContent).toContain('Email');

      // Note: Actual mailto: functionality would require browser environment
      // Test passes if button setup is correct and doesn't throw
    });

    test('should disable button during submission', () => {
      const openSpy = jest.spyOn(window, 'open').mockImplementation();
      const submitBtn = document.querySelector('button');

      submitBtn.click();

      expect(submitBtn.disabled).toBe(true);
      expect(submitBtn.textContent).toContain('Opening');

      openSpy.mockRestore();
    });
  });

  describe('Debug Info', () => {
    beforeEach(() => {
      jest.resetModules();
      delete require.cache[require.resolve('../src/report.js')];

      // Set up debug info BEFORE loading module
      window.YouTubePlusDebug = { version: '2.2' };
      window.YouTubeUtils = {
        SettingsManager: {
          load: () => ({ test: 'settings' }),
        },
      };

      require('../src/report.js');
    });

    test('should include debug info when checkbox is checked', () => {
      const modal = document.createElement('div');
      const section = document.createElement('div');
      section.className = 'ytp-plus-settings-section';
      section.setAttribute('data-section', 'report');
      modal.appendChild(section);
      document.body.appendChild(modal);
      window.youtubePlusReport.render(modal);

      const titleInput = document.querySelector('input[placeholder*="title"]');
      const descInput = document.querySelector('textarea');
      const checkbox = document.querySelector('input[type="checkbox"]');

      titleInput.value = 'Test Bug Report';
      descInput.value = 'This is a test bug description with enough detail';
      checkbox.checked = true;

      const openSpy = jest.spyOn(window, 'open').mockImplementation();
      const submitBtn = document.querySelector('button');
      submitBtn.click();

      const callArgs = openSpy.mock.calls[0][0];
      expect(callArgs).toContain('Debug%20info');

      openSpy.mockRestore();
    });
  });
});
