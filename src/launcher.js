// Mistral Launcher JavaScript
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// Launcher App Class - Encapsulates all launcher functionality
class LauncherApp {
  constructor() {
    // DOM elements
    this.input = document.getElementById('launcher-input');
    this.submitBtn = document.getElementById('submit-btn');
    this.newChatToggle = document.getElementById('new-chat-toggle');
    
    // State
    this.focusTimeout = null;
    this.isSubmitting = false;
    this.newChatMode = true; // Default: start new conversations
    
    // Constants
    this.MAX_MESSAGE_LENGTH = 5000;
    
    // History
    this.history = JSON.parse(localStorage.getItem('launcher_history') || '[]');
    this.historyIndex = -1;
    this.currentDraft = '';

    // History dropdown
    this.dropdown = null;
    this.dropdownItems = [];
    this.dropdownSelectedIndex = -1;
    this.dropdownBlurTimeout = null;

    // Validate elements
    if (!this.input || !this.submitBtn) {
      console.error('Critical UI elements not found. Launcher cannot initialize.');
      return;
    }

    this.initHistoryDropdown();

    // Set platform-aware modifier key labels
    this.initModifierKeys();

    // Initialize event listeners
    this.initEventListeners();
    this.initTauriListeners();
  }

  initHistoryDropdown() {
    const wrapper = document.querySelector('.launcher-input-wrapper')
      || document.querySelector('.launcher-container');
    if (!wrapper) return;

    this.dropdown = document.createElement('div');
    this.dropdown.className = 'launcher-history-dropdown';
    this.dropdown.style.display = 'none';
    wrapper.appendChild(this.dropdown);
  }

  syncWindowHeight() {
    try {
      const baseWindowHeight = 88;
      const baseInputHeight = 24;
      const inputHeight = this.input ? (parseInt(this.input.style.height, 10) || baseInputHeight) : baseInputHeight;
      const extraHeight = Math.max(0, inputHeight - baseInputHeight);
      let height = baseWindowHeight + extraHeight;
      if (this.isDropdownVisible() && this.dropdown) {
        height += this.dropdown.offsetHeight + 8;
      }
      invoke('resize_launcher', { height }).catch(e => {
        console.warn('Could not resize window', e);
      });
    } catch (e) {
      console.warn('Error invoking resize_launcher', e);
    }
  }

  getFilteredHistory() {
    const query = (this.input?.value || '').trim().toLowerCase();
    const seen = new Set();
    const items = [];
    for (const item of this.history) {
      if (query && !item.toLowerCase().startsWith(query)) continue;
      if (seen.has(item)) continue;
      seen.add(item);
      items.push(item);
      if (items.length >= 8) break;
    }
    return items;
  }

  showHistoryDropdown() {
    if (!this.dropdown) return;
    this.dropdownItems = this.getFilteredHistory();
    this.dropdownSelectedIndex = -1;

    if (this.dropdownItems.length === 0) {
      this.hideHistoryDropdown();
      return;
    }

    this.dropdown.innerHTML = '';
    this.dropdownItems.forEach((item, i) => {
      const div = document.createElement('div');
      div.className = 'launcher-history-item';
      div.dataset.index = i;
      const span = document.createElement('span');
      span.className = 'launcher-history-text';
      span.textContent = item.length > 80 ? item.slice(0, 80) + '…' : item;
      div.appendChild(span);
      div.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.selectHistoryItem(i);
      });
      this.dropdown.appendChild(div);
    });

    this.dropdown.style.display = 'block';
    this.syncWindowHeight();
  }

  hideHistoryDropdown() {
    if (!this.dropdown) return;
    const wasVisible = this.isDropdownVisible();
    this.dropdown.style.display = 'none';
    this.dropdown.innerHTML = '';
    this.dropdownItems = [];
    this.dropdownSelectedIndex = -1;
    if (wasVisible) {
      this.syncWindowHeight();
    }
  }

  isDropdownVisible() {
    return !!this.dropdown && this.dropdown.style.display !== 'none';
  }

  navigateHistoryDropdown(direction) {
    if (!this.dropdownItems.length) return;
    this.dropdownSelectedIndex = (this.dropdownSelectedIndex + direction + this.dropdownItems.length) % this.dropdownItems.length;
    this.updateHistoryDropdownSelection();
    const el = this.dropdown.children[this.dropdownSelectedIndex];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  updateHistoryDropdownSelection() {
    Array.from(this.dropdown.children).forEach((el, i) => {
      el.classList.toggle('selected', i === this.dropdownSelectedIndex);
    });
  }

  selectHistoryItem(index) {
    const item = this.dropdownItems[index];
    if (item === undefined || !this.input) return;
    this.input.value = item;
    this.historyIndex = -1;
    this.hideHistoryDropdown();
    this.autoResizeInput();
    this.input.focus();
    this.input.selectionStart = this.input.selectionEnd = this.input.value.length;
  }
  
  initModifierKeys() {
    const isMac = navigator.platform?.toUpperCase().includes('MAC')
      || navigator.userAgent?.includes('Mac');
    const modLabel = isMac ? '⌘' : 'Ctrl';
    
    // Update all .mod-key elements
    document.querySelectorAll('.mod-key').forEach(el => {
      el.textContent = modLabel;
    });
    
    // Update the new-chat toggle tooltip
    if (this.newChatToggle) {
      this.newChatToggle.title = `Start a new conversation (${modLabel}+N)`;
    }
  }
  
  initEventListeners() {
    // Focus input on load
    window.addEventListener('DOMContentLoaded', () => this.focusInput());
    
    // Keyboard events
    document.addEventListener('keydown', (e) => this.handleKeyDown(e), { passive: false });
    
    // Auto-resize textarea
    this.input.addEventListener('input', () => this.autoResizeInput());

    // History dropdown: show on input and on focus, hide on blur
    this.input.addEventListener('input', () => this.showHistoryDropdown());
    this.input.addEventListener('focus', () => this.showHistoryDropdown());
    this.input.addEventListener('blur', () => {
      this.dropdownBlurTimeout = setTimeout(() => this.hideHistoryDropdown(), 120);
    });
    
    // Submit button
    this.submitBtn.addEventListener('click', () => this.submitMessage());
    
    // New chat toggle
    if (this.newChatToggle) {
      this.newChatToggle.addEventListener('click', () => this.toggleNewChat());
    }
    
    // Window focus
    window.addEventListener('focus', () => this.handleWindowFocus());
    
    // Cleanup
    window.addEventListener('beforeunload', () => this.cleanup());
  }
  
  initTauriListeners() {
    // Load new-chat default from settings
    this.loadNewChatDefault();
    
    // Listen for launcher-shown event from Rust to clear and focus input
    listen('launcher-shown', () => {
      if (this.input) {
        this.input.value = '';
        this.hideHistoryDropdown();
        this.autoResizeInput();
        this.input.focus();
      }
      // Re-load setting in case it was changed
      this.loadNewChatDefault();
    }).catch(error => {
      console.error('Failed to listen for launcher-shown event:', error);
    });
    
    // Listen for settings-changed event
    listen('settings-changed', (event) => {
      const settings = event.payload;
      if (settings) {
        if (typeof settings.new_chat_default === 'boolean') {
          this.newChatMode = settings.new_chat_default;
          if (this.newChatToggle) {
            this.newChatToggle.classList.toggle('active', this.newChatMode);
          }
          if (this.input) {
            this.input.placeholder = this.newChatMode
              ? 'Ask Mistral anything...'
              : 'Continue current chat...';
          }
        }
        if (settings.theme) {
          this.applyTheme(settings.theme);
        }
      }
    }).catch(error => {
      console.error('Failed to listen for settings-changed event:', error);
    });

    // Listen for theme-changed event from the main window directly
    listen('theme-changed', (event) => {
      const { theme } = event.payload || {};
      if (theme) {
        this.applyTheme(theme);
      }
    }).catch(error => {
      console.error('Failed to listen for theme-changed event:', error);
    });
    
    // Listen for inject-result from the main window's injected JS
    listen('inject-result', (event) => {
      const { success, error } = event.payload || {};
      if (!success && error) {
        console.error('[Launcher] Message injection failed:', error);
        this.showError(error);
      }
    }).catch(error => {
      console.error('Failed to listen for inject-result event:', error);
    });
  }
  
  async showError(errorMessage) {
    // Briefly re-show the launcher with an error state
    try {
      await invoke('show_launcher');
    } catch (e) {
      // If we can't show the launcher, just log it
      console.error('Failed to show launcher for error display:', e);
      return;
    }
    
    const container = document.querySelector('.launcher-container');
    if (!container) return;
    
    // Show error in the input placeholder
    if (this.input) {
      this.input.value = '';
      this.input.placeholder = 'Failed to send — try again';
      this.input.focus();
    }
    
    // Add error class for visual feedback
    container.classList.add('launcher-error');
    
    // Remove error state after animation completes
    setTimeout(() => {
      container.classList.remove('launcher-error');
      if (this.input) {
        this.input.placeholder = 'Ask Mistral anything...';
      }
    }, 2500);
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

  async loadNewChatDefault() {
    try {
      const settings = await invoke('get_settings');
      if (settings.theme) {
        this.applyTheme(settings.theme);
      }
      this.newChatMode = settings.new_chat_default ?? true;
      if (this.newChatToggle) {
        this.newChatToggle.classList.toggle('active', this.newChatMode);
      }
      if (this.input) {
        this.input.placeholder = this.newChatMode
          ? 'Ask Mistral anything...'
          : 'Continue current chat...';
      }
    } catch (error) {
      // Settings not available yet, use default
      console.warn('Failed to load settings, using defaults:', error);
    }
  }
  
  focusInput() {
    if (this.input) {
      this.input.focus();
    }
  }
  
  handleKeyDown(e) {
    try {
      // Escape to close dropdown first, then hide launcher
      if (e.key === 'Escape') {
        if (this.isDropdownVisible()) {
          e.preventDefault();
          this.hideHistoryDropdown();
          return;
        }
        e.preventDefault();
        invoke('hide_launcher').catch(error => {
          console.error('Failed to hide launcher:', error);
        });
        return;
      }

      // Cmd/Ctrl+N to toggle new chat mode
      if (e.key === 'n' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.toggleNewChat();
        return;
      }

      // Enter: select a dropdown item if one is highlighted, otherwise submit
      if (e.key === 'Enter' && !e.shiftKey && this.input) {
        if (this.isDropdownVisible() && this.dropdownSelectedIndex >= 0) {
          e.preventDefault();
          this.selectHistoryItem(this.dropdownSelectedIndex);
          return;
        }
        e.preventDefault();
        this.hideHistoryDropdown();
        this.submitMessage();
        return;
      }

      // Arrow keys navigate the dropdown when visible, otherwise inline history
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.isDropdownVisible()) {
          this.navigateHistoryDropdown(-1);
        } else {
          this.navigateHistory(1);
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.isDropdownVisible()) {
          this.navigateHistoryDropdown(1);
        } else {
          this.navigateHistory(-1);
        }
        return;
      }
    } catch (error) {
      console.error('Error handling keyboard event:', error);
    }
  }
  
  handleWindowFocus() {
    if (this.focusTimeout) {
      clearTimeout(this.focusTimeout);
    }
    
    this.focusTimeout = setTimeout(() => {
      if (this.input) {
        this.input.focus();
        // Only select text if user hasn't already modified it
        if (this.input.value && document.activeElement === this.input) {
          this.input.select();
        }
      }
      this.focusTimeout = null;
    }, 100);
  }
  
  cleanup() {
    if (this.focusTimeout) {
      clearTimeout(this.focusTimeout);
    }
  }

  async autoResizeInput() {
    if (!this.input) return;

    // Reset height to calculate true scrollHeight
    this.input.style.height = 'auto';
    
    // Max height for the textarea (about 5 lines)
    const maxHeight = 120;
    const paddingOffset = 4; // slight offset for borders/padding

    let newHeight = this.input.scrollHeight;
    if (newHeight > maxHeight) {
      newHeight = maxHeight;
      this.input.style.overflowY = 'auto';
    } else {
      this.input.style.overflowY = 'hidden';
    }

    this.input.style.height = newHeight + 'px';

    // Adjust Tauri window height (default base height is 88)
    // The base input height is roughly 24px.
    this.syncWindowHeight();
  }

  navigateHistory(direction) {
    if (!this.history || this.history.length === 0) return;

    // Save current draft if we're starting to navigate
    if (this.historyIndex === -1 && direction === 1) {
      this.currentDraft = this.input.value;
    }

    this.historyIndex += direction;

    // Bounds checking
    if (this.historyIndex >= this.history.length) {
      this.historyIndex = this.history.length - 1;
    } else if (this.historyIndex < -1) {
      this.historyIndex = -1;
    }

    // Apply value
    if (this.historyIndex === -1) {
      this.input.value = this.currentDraft;
    } else {
      this.input.value = this.history[this.historyIndex];
    }
    
    this.autoResizeInput();

    // Move cursor to end
    setTimeout(() => {
      if (this.input) {
        this.input.selectionStart = this.input.selectionEnd = this.input.value.length;
      }
    }, 0);
  }
  
  toggleNewChat() {
    this.newChatMode = !this.newChatMode;
    if (this.newChatToggle) {
      this.newChatToggle.classList.toggle('active', this.newChatMode);
    }
    // Update placeholder to reflect mode
    if (this.input) {
      this.input.placeholder = this.newChatMode
        ? 'Ask Mistral anything...'
        : 'Continue current chat...';
    }
  }
  
  async submitMessage() {
    // Prevent multiple submissions
    if (this.isSubmitting) {
      return;
    }
    
    this.isSubmitting = true;
    
    // Store original message outside try block so catch can access it
    let originalMessage = '';
    
    try {
      // Validate input element exists and has value
      if (!this.input) {
        console.error('Input element not found');
        return;
      }
      
      const message = this.input.value.trim();
      
      // Validate message content
      if (!message) {
        return;
      }
      
      // Additional validation: limit message length
      if (message.length > this.MAX_MESSAGE_LENGTH) {
        console.error(`Message too long (${message.length}/${this.MAX_MESSAGE_LENGTH})`);
        return;
      }
      
      // Store for restoration on error
      originalMessage = message;
      
      // Show submitting state
      this.submitBtn.classList.add('launcher-submitting');
      this.submitBtn.disabled = true;
      
      // Clear input only after successful validation
      this.input.value = '';
      this.currentDraft = '';
      this.autoResizeInput();
      
      // Send message to Rust backend with timeout
      const newChat = this.newChatMode;
      const submitPromise = invoke('submit_message', { message, newChat });
      
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Submit message timeout')), 10000);
      });
      
      await Promise.race([submitPromise, timeoutPromise]);
      
      // Update history
      if (message && this.history[0] !== message) {
        this.history.unshift(message);
        if (this.history.length > 50) this.history.pop();
        localStorage.setItem('launcher_history', JSON.stringify(this.history));
      }
      this.historyIndex = -1;
      this.currentDraft = '';
      
    } catch (error) {
      console.error('Failed to submit message:', error);
      
      // Restore message on error
      if (this.input && originalMessage) {
        this.input.value = originalMessage;
        this.autoResizeInput();
      }
      
      if (error.message === 'Submit message timeout') {
        console.error('Message submission timed out');
      }
    } finally {
      this.isSubmitting = false;
      this.submitBtn.classList.remove('launcher-submitting');
      this.submitBtn.disabled = false;
    }
  }
}

// Initialize the launcher app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new LauncherApp();
});
