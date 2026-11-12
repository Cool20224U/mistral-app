// Mistral Settings JavaScript
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

class SettingsApp {
  constructor() {
    this.newChatDefault = document.getElementById('new-chat-default');
    this.notificationsEnabled = document.getElementById('notifications-enabled');
    this.recordShortcutBtn = document.getElementById('record-shortcut-btn');
    this.clearHistoryBtn = document.getElementById('clear-history-btn');

    this.launcherShortcut = 'Alt+Space';
    this.currentZoom = 1;
    this.isRecordingShortcut = false;

    this.initEventListeners();
    this.loadSettings();
  }

  formatShortcut(shortcut) {
    if (!shortcut) return 'Alt + Space';
    return shortcut.split('+').map(p => {
      const part = p.trim();
      if (!part) return '';
      if (part.length === 1) return part.toUpperCase();
      if (/^f\d{1,2}$/i.test(part)) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }).filter(Boolean).join(' + ');
  }

  initEventListeners() {
    if (this.newChatDefault) {
      this.newChatDefault.addEventListener('change', () => this.saveSettings());
    }
    if (this.notificationsEnabled) {
      this.notificationsEnabled.addEventListener('change', () => this.saveSettings());
    }
    if (this.clearHistoryBtn) {
      this.clearHistoryBtn.addEventListener('click', () => this.clearHistory());
    }
    if (this.recordShortcutBtn) {
      this.recordShortcutBtn.addEventListener('click', () => this.startRecordingShortcut());
    }

    // Listen for theme-changed event from the main window directly
    listen('theme-changed', (event) => {
      const { theme } = event.payload || {};
      if (theme) {
        this.applyTheme(theme);
      }
    }).catch(error => {
      console.error('Failed to listen for theme-changed event:', error);
    });

    // Listen for settings-changed event
    listen('settings-changed', (event) => {
      const settings = event.payload;
      if (settings && settings.theme) {
        this.applyTheme(settings.theme);
      }
    }).catch(error => {
      console.error('Failed to listen for settings-changed event:', error);
    });
  }

  applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  }

  clearHistory() {
    localStorage.removeItem('launcher_history');
    
    if (this.clearHistoryBtn) {
      const originalText = this.clearHistoryBtn.textContent;
      this.clearHistoryBtn.textContent = 'Cleared!';
      this.clearHistoryBtn.classList.add('success');
      this.clearHistoryBtn.disabled = true;
      
      setTimeout(() => {
        this.clearHistoryBtn.textContent = originalText;
        this.clearHistoryBtn.classList.remove('success');
        this.clearHistoryBtn.disabled = false;
      }, 2000);
    }
  }

  async loadSettings() {
    try {
      const settings = await invoke('get_settings');
      this.currentTheme = settings.theme; // store the current theme
      if (settings.theme) {
        this.applyTheme(settings.theme);
      }
      if (this.newChatDefault) {
        this.newChatDefault.checked = settings.new_chat_default ?? true;
      }
      if (this.notificationsEnabled) {
        this.notificationsEnabled.checked = settings.notifications_enabled ?? true;
      }
      this.launcherShortcut = settings.launcher_shortcut || 'Alt+Space';
      this.currentZoom = settings.zoom ?? 1;
      if (this.recordShortcutBtn) {
        this.recordShortcutBtn.textContent = this.formatShortcut(this.launcherShortcut);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  startRecordingShortcut() {
    if (this.isRecordingShortcut) return;
    this.isRecordingShortcut = true;
    if (this.recordShortcutBtn) {
      this.recordShortcutBtn.textContent = 'Press keys...';
      this.recordShortcutBtn.classList.add('recording');
    }

    const onKey = (e) => {
      e.preventDefault();

      const key = e.key;
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;

      document.removeEventListener('keydown', onKey, true);
      this.isRecordingShortcut = false;

      const combo = [];
      if (e.ctrlKey) combo.push('Ctrl');
      if (e.altKey) combo.push('Alt');
      if (e.shiftKey) combo.push('Shift');
      if (e.metaKey) combo.push('Super');

      let keyName = null;
      if (key === ' ') keyName = 'Space';
      else if (/^[a-zA-Z]$/.test(key)) keyName = key.toUpperCase();
      else if (/^F\d{1,2}$/i.test(key)) keyName = key.toUpperCase();
      else if (/^[0-9]$/.test(key)) keyName = 'Digit' + key;
      else {
        const punctuationMap = {
          ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon',
          "'": 'Quote', '[': 'BracketLeft', ']': 'BracketRight',
          '`': 'Backquote', '-': 'Minus', '=': 'Equal', '\\': 'Backslash'
        };
        keyName = punctuationMap[key] || null;
      }

      if (!keyName || combo.length === 0) {
        if (this.recordShortcutBtn) {
          this.recordShortcutBtn.textContent = this.formatShortcut(this.launcherShortcut);
          this.recordShortcutBtn.classList.remove('recording');
        }
        return;
      }

      combo.push(keyName);
      this.launcherShortcut = combo.join('+');
      if (this.recordShortcutBtn) {
        this.recordShortcutBtn.textContent = this.formatShortcut(this.launcherShortcut);
        this.recordShortcutBtn.classList.remove('recording');
      }
      this.saveSettings();
    };

    document.addEventListener('keydown', onKey, true);
  }

  async saveSettings() {
    const settings = {
      new_chat_default: this.newChatDefault?.checked ?? true,
      notifications_enabled: this.notificationsEnabled?.checked ?? true,
      theme: this.currentTheme, // Preserve the theme that was synced from Mistral
      launcher_shortcut: this.launcherShortcut,
      zoom: this.currentZoom, // Preserve the zoom factor managed by the main window
    };

    try {
      await invoke('save_settings', { settings });
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SettingsApp();
});
