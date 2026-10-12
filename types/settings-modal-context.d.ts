/**
 * Context object the settings modal passes into the modal-handlers
 * delegates (`applySettingLive`, `handleSimpleSettingToggle`, the
 * click/blur dispatchers). Shared by settings-modal.js, basic.js and
 * modal-handlers.js, so it lives here as an ambient global type.
 */
interface SettingsModalContext {
  settings: YoutubePlusSettings;
  saveSettings?: () => void;
  saveSettingsBound?: () => void;
  showNotification?: (message: string, duration?: number) => void;
  showNotificationBound?: (message: string, duration?: number) => void;
  getElement: (selector: string, useCache?: boolean) => Element | null;
  addDownloadButton: (controls?: Element) => void;
  addSpeedControlButton: (controls?: Element) => void;
  refreshDownloadButton: () => void;
  updatePageBasedOnSettings: () => void;
  [key: string]: unknown;
}