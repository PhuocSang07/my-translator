/**
 * Settings Manager for Chrome Extension
 * Uses chrome.storage.local instead of Tauri IPC
 */

const DEFAULT_SETTINGS = {
    stt_provider: 'elevenlabs',        // 'elevenlabs' | 'soniox'
    soniox_api_key: '',
    elevenlabs_api_key: '',            // Shared for STT + TTS
    source_language: 'auto',
    target_language: 'vi',
    audio_source: 'microphone',
    overlay_opacity: 0.9,
    font_size: 16,
    max_lines: 5,
    show_original: true,
    translation_mode: 'soniox',
    custom_context: null,
    tts_enabled: false,
    tts_provider: 'web-speech',
    tts_voice_id: 'FTYCiQT21H9XQvhRu0ch',
    tts_speed: 1.2,
    edge_tts_voice: 'vi-VN-HoaiMyNeural',
    edge_tts_speed: 20,
    tts_auto_read: false,
};

class SettingsManager {
    constructor() {
        this._cache = { ...DEFAULT_SETTINGS };
        this._listeners = [];
        this._savingTimeout = null;
    }

    /**
     * Load settings from chrome.storage.local
     */
    async load() {
        return new Promise((resolve) => {
            chrome.storage.local.get('settings', (data) => {
                if (data.settings) {
                    this._cache = { ...DEFAULT_SETTINGS, ...data.settings };
                } else {
                    this._cache = { ...DEFAULT_SETTINGS };
                }
                console.log('[Settings] Loaded:', Object.keys(this._cache).length, 'keys');
                resolve(this._cache);
            });
        });
    }

    /**
     * Save settings to chrome.storage.local (debounced)
     */
    async save(settings) {
        return new Promise((resolve) => {
            // Update cache immediately
            this._cache = { ...DEFAULT_SETTINGS, ...settings };

            // Debounce actual storage write
            if (this._savingTimeout) {
                clearTimeout(this._savingTimeout);
            }

            this._savingTimeout = setTimeout(() => {
                chrome.storage.local.set({ settings: this._cache }, () => {
                    console.log('[Settings] Saved to storage');
                    this._notifyListeners();
                    resolve();
                });
            }, 300); // Wait 300ms before saving
        });
    }

    /**
     * Get cached settings (synchronous)
     */
    getSync() {
        return { ...this._cache };
    }

    /**
     * Get a specific setting
     */
    getSetting(key) {
        return this._cache[key];
    }

    /**
     * Update a single setting
     */
    async setSetting(key, value) {
        this._cache[key] = value;
        return this.save(this._cache);
    }

    /**
     * Subscribe to settings changes
     */
    onChange(callback) {
        this._listeners.push(callback);
        return () => {
            this._listeners = this._listeners.filter(cb => cb !== callback);
        };
    }

    /**
     * Notify all listeners of changes
     */
    _notifyListeners() {
        this._listeners.forEach(cb => cb(this._cache));
    }
}

const settingsManager = new SettingsManager();
