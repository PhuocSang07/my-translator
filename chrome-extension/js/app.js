/**
 * My Translator Chrome Extension - Main Controller
 * Wires: settings, UI, Soniox client, audio capture, and TTS
 */

class App {
    constructor() {
        this.isRunning = false;
        this.isStarting = false;
        this.currentSource = 'microphone';
        this.transcriptUI = null;
        this.recordingStartTime = null;
        this.ttsEnabled = false;
        this.currentTabId = null;
        this.targetTabId = null;
        this._isUpdatingForm = false;
        this._lastSavedSettings = null;
        this._sttClient = null;  // Will point to sonioxClient or elevenLabsSTT
    }

    async init() {
        try {
            // Load settings
            await settingsManager.load();

            // Get current tab ID
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            this.currentTabId = tabs[0]?.id;

            // Init transcript UI
            const transcriptContainer = document.getElementById('transcript-content');
            this.transcriptUI = new TranscriptUI(transcriptContainer);

            // Apply saved settings to UI
            this._applySettings(settingsManager.getSync());

            // Bind event listeners
            this._bindEvents();
            this._bindFormInputs();
            this._bindTabs();
            this._bindKeyboardShortcuts();

            // Subscribe to settings changes
            settingsManager.onChange((settings) => this._applySettings(settings));

            // Init audio player for TTS
            audioPlayer.init();

            // Wire TTS callbacks
            elevenLabsTTS.onAudioChunk = (base64Audio, isFinal) => {
                audioPlayer.enqueue(base64Audio);
            };

            webSpeechTTS.onError = (error) => {
                console.error('[WebSpeech]', error);
                this._showToast(error, 'error');
            };

            elevenLabsTTS.onError = (error) => {
                console.error('[ElevenLabs]', error);
                this._showToast(error, 'error');
            };

            // Set up Soniox callbacks
            sonioxClient.onOriginal = (text, speaker) => {
                this.transcriptUI.addOriginal(text, speaker);
            };

            sonioxClient.onTranslation = (text) => {
                this.transcriptUI.addTranslation(text);
                if (this.ttsEnabled) {
                    this._speak(text);
                }
            };

            sonioxClient.onProvisional = (text, speaker) => {
                this.transcriptUI.setProvisional(text, speaker);
            };

            sonioxClient.onStatusChange = (status) => {
                this._updateStatus(status);
            };

            sonioxClient.onError = (error) => {
                console.error('[Soniox]', error);
                this._showToast(error, 'error');
            };

            this.transcriptUI.showPlaceholder();
            console.log('🌐 My Translator Chrome Extension initialized');
        } catch (err) {
            console.error('[App] Init failed:', err);
            this._showToast(`Init failed: ${err.message}`, 'error');
        }
    }

    // ─── Event Binding ──────────────────────────────────────

    _bindEvents() {
        // Settings button
        document.getElementById('btn-settings')?.addEventListener('click', () => {
            this._showView('settings');
        });

        // Back from settings
        document.getElementById('btn-back')?.addEventListener('click', () => {
            this._showView('overlay');
        });

        // Start/Stop button
        document.getElementById('btn-start')?.addEventListener('click', async () => {
            if (this.isStarting) return;
            try {
                if (this.isRunning) {
                    await this.stop();
                } else {
                    this.isStarting = true;
                    await this.start();
                }
            } catch (err) {
                console.error('[App] Start/Stop error:', err);
                this._showToast(`Error: ${err}`, 'error');
                this.isRunning = false;
                this._updateStartButton();
                this._updateStatus('error');
                this.transcriptUI.clear();
                this.transcriptUI.showPlaceholder();
            } finally {
                this.isStarting = false;
            }
        });

        // Source buttons
        document.getElementById('btn-source-mic')?.addEventListener('click', () => {
            this._setSource('microphone');
        });

        document.getElementById('btn-source-tab')?.addEventListener('click', () => {
            this._setSource('tab');
        });

        document.getElementById('btn-source-both')?.addEventListener('click', () => {
            this._setSource('both');
        });

        // Clear button
        document.getElementById('btn-clear')?.addEventListener('click', () => {
            this.transcriptUI.clear();
            this.transcriptUI.showPlaceholder();
            this.recordingStartTime = null;
        });

        // Copy button
        document.getElementById('btn-copy')?.addEventListener('click', async () => {
            const text = this.transcriptUI.getPlainText();
            if (text) {
                await navigator.clipboard.writeText(text);
                this._showToast('Copied to clipboard', 'success');
            } else {
                this._showToast('Nothing to copy', 'info');
            }
        });

        // Download button
        document.getElementById('btn-download')?.addEventListener('click', async () => {
            this._downloadTranscript();
        });

        // TTS toggle
        document.getElementById('btn-tts')?.addEventListener('click', () => {
            this.ttsEnabled = !this.ttsEnabled;
            this._updateTTSButton();
            settingsManager.setSetting('tts_enabled', this.ttsEnabled);
        });
    }

    _bindFormInputs() {
        // Save Settings button - collect all form values and save
        const saveBtnBtn = document.getElementById('btn-save-settings');
        if (saveBtnBtn) {
            saveBtnBtn.addEventListener('click', () => {
                this._saveAllFormSettings();
            });
        }

        // STT Provider - toggle between ElevenLabs and Soniox
        const sttProviderSelect = document.getElementById('select-stt-provider');
        if (sttProviderSelect) {
            sttProviderSelect.addEventListener('change', (e) => {
                if (this._isUpdatingForm) return;
                this._toggleSTTProviderUI(e.target.value);
            });
        }

        // TTS Provider - just toggle UI, don't save yet
        const ttsProviderSelect = document.getElementById('select-tts-provider');
        if (ttsProviderSelect) {
            ttsProviderSelect.addEventListener('change', (e) => {
                if (this._isUpdatingForm) return;
                this._toggleElevenLabsSettings(e.target.value === 'elevenlabs');
            });
        }

        // Tab Picker - select tab for capture
        const selectTab = document.getElementById('select-tab');
        if (selectTab) {
            selectTab.addEventListener('change', (e) => {
                this.targetTabId = e.target.value ? parseInt(e.target.value) : null;
            });
        }

        // Refresh tabs button
        const btnRefreshTabs = document.getElementById('btn-refresh-tabs');
        if (btnRefreshTabs) {
            btnRefreshTabs.addEventListener('click', () => {
                this._loadTabs();
            });
        }
    }

    /**
     * Collect all form settings and save them
     */
    async _saveAllFormSettings() {
        const updates = {};

        // Collect simple inputs
        const inputMap = {
            'input-soniox-key': 'soniox_api_key',
            'input-elevenlabs-key': 'elevenlabs_api_key',
            'select-source-lang': 'source_language',
            'select-target-lang': 'target_language',
            'input-tts-voice-id': 'tts_voice_id',
            'input-domain': 'domain',
        };

        for (const [elemId, settingKey] of Object.entries(inputMap)) {
            const el = document.getElementById(elemId);
            if (el && el.value) {
                if (settingKey === 'domain') {
                    updates.custom_context = { ...settingsManager.getSetting('custom_context') || {}, domain: el.value };
                } else {
                    updates[settingKey] = el.value;
                }
            }
        }

        // Numeric inputs
        const fontSizeInput = document.getElementById('input-font-size');
        if (fontSizeInput) {
            updates.font_size = parseInt(fontSizeInput.value) || 16;
        }

        const maxLinesInput = document.getElementById('input-max-lines');
        if (maxLinesInput) {
            updates.max_lines = parseInt(maxLinesInput.value) || 5;
        }

        const ttsSpeedInput = document.getElementById('input-tts-speed');
        if (ttsSpeedInput) {
            updates.tts_speed = parseFloat(ttsSpeedInput.value) || 1.2;
        }

        // Checkboxes
        const showOriginalCheck = document.getElementById('checkbox-show-original');
        if (showOriginalCheck) {
            updates.show_original = showOriginalCheck.checked;
        }

        const autoReadCheck = document.getElementById('checkbox-tts-auto-read');
        if (autoReadCheck) {
            updates.tts_auto_read = autoReadCheck.checked;
        }

        // STT Provider
        const sttProviderSelect = document.getElementById('select-stt-provider');
        if (sttProviderSelect) {
            updates.stt_provider = sttProviderSelect.value;
        }

        // TTS Provider
        const ttsProviderSelect = document.getElementById('select-tts-provider');
        if (ttsProviderSelect) {
            updates.tts_provider = ttsProviderSelect.value;
        }

        // Custom Terms
        const termsInput = document.getElementById('textarea-terms');
        if (termsInput && termsInput.value.trim()) {
            const context = updates.custom_context || settingsManager.getSetting('custom_context') || {};
            const lines = termsInput.value.trim().split('\n');
            context.translation_terms = lines
                .filter(line => line.includes('='))
                .map(line => {
                    const [source, target] = line.split('=').map(s => s.trim());
                    return { source, target };
                });
            updates.custom_context = context;
        }

        // Save to settings manager
        await settingsManager.save(updates);
        this._showToast('Settings saved', 'success');
    }

    _bindTabs() {
        // Tab switching for settings
        const tabs = document.querySelectorAll('.settings-tab');
        if (tabs.length === 0) return;

        // Create tab buttons if they don't exist
        const tabHeader = document.querySelector('.settings-header');
        if (tabHeader && !document.querySelector('.settings-tabs-nav')) {
            const nav = document.createElement('div');
            nav.className = 'settings-tabs-nav';
            nav.innerHTML = `
                <button class="tab-btn active" data-tab="0">General</button>
                <button class="tab-btn" data-tab="1">TTS</button>
                <button class="tab-btn" data-tab="2">Translation</button>
            `;
            tabHeader.parentElement.insertBefore(nav, document.querySelector('.settings-content'));

            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const tabIndex = parseInt(e.target.dataset.tab);
                    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
                    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
                    tabs[tabIndex].classList.add('active');
                    e.target.classList.add('active');
                });
            });
        }

        // Activate first tab
        if (tabs.length > 0) {
            tabs[0].classList.add('active');
        }
    }

    _bindKeyboardShortcuts() {
        document.addEventListener('keydown', async (e) => {
            const isMeta = e.metaKey || e.ctrlKey;

            if (isMeta && e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('btn-start')?.click();
            } else if (isMeta && e.key === ',') {
                e.preventDefault();
                document.getElementById('btn-settings')?.click();
            } else if (isMeta && e.key === '1') {
                e.preventDefault();
                this._setSource('microphone');
            } else if (isMeta && e.key === '2') {
                e.preventDefault();
                this._setSource('tab');
            } else if (isMeta && e.key === 't') {
                e.preventDefault();
                document.getElementById('btn-tts')?.click();
            } else if (e.key === 'Escape') {
                this._showView('overlay');
            }
        });
    }

    // ─── Start/Stop ─────────────────────────────────────────

    async start() {
        if (this.isRunning) return;

        const settings = settingsManager.getSync();

        // Select STT provider
        const sttProvider = settings.stt_provider || 'elevenlabs';

        if (sttProvider === 'soniox') {
            if (!settings.soniox_api_key) {
                this._showToast('Please enter Soniox API key in Settings', 'info');
                this._showView('settings');
                return;
            }
            this._sttClient = sonioxClient;
        } else {
            // ElevenLabs default
            if (!settings.elevenlabs_api_key) {
                this._showToast('Please enter ElevenLabs API key in Settings', 'info');
                this._showView('settings');
                return;
            }
            this._sttClient = elevenLabsSTT;
        }

        // Check if tab source is selected but no tab is chosen
        if ((this.currentSource === 'tab' || this.currentSource === 'both') && !this.targetTabId) {
            this._showToast('Please select a tab first', 'info');
            return;
        }

        try {
            this.recordingStartTime = Date.now();
            this._updateStartButton();

            try {
                await audioCapture.start(this.currentSource, this.targetTabId || this.currentTabId);
            } catch (err) {
                this._showToast(`Audio capture failed: ${err.message}`, 'error');
                throw err;
            }

            audioCapture.onAudio = (buffers) => {
                for (const buffer of buffers) {
                    this._sttClient.sendAudio(buffer);
                }
            };

            // Connect to appropriate STT provider
            if (sttProvider === 'soniox') {
                this._sttClient.connect({
                    apiKey: settings.soniox_api_key,
                    sourceLanguage: settings.source_language,
                    targetLanguage: settings.target_language,
                    customContext: settings.custom_context,
                });
            } else {
                this._sttClient.connect({
                    apiKey: settings.elevenlabs_api_key,
                    sourceLanguage: settings.source_language,
                });
            }

            this.ttsEnabled = settings.tts_enabled;
            this._updateTTSButton();
            this._setupTTS(settings);

            this.isRunning = true;
            this.transcriptUI.showListening();
            console.log('[App] Started, source:', this.currentSource);
        } catch (err) {
            this.isRunning = false;
            this._updateStartButton();
            throw err;
        }
    }

    async stop() {
        if (!this.isRunning) return;

        this.isRunning = false;
        this._updateStartButton();

        audioCapture.stop();
        if (this._sttClient) this._sttClient.disconnect();
        webSpeechTTS.disconnect();
        elevenLabsTTS.disconnect();
        audioPlayer.stop();

        console.log('[App] Stopped');
    }

    // ─── TTS Setup ──────────────────────────────────────────

    _setupTTS(settings) {
        const provider = settings.tts_provider;

        if (provider === 'web-speech') {
            webSpeechTTS.configure({
                voice: null,
                lang: `${settings.target_language}-${settings.target_language.toUpperCase()}`,
                rate: settings.tts_speed,
            });
            webSpeechTTS.connect();
        } else if (provider === 'elevenlabs') {
            elevenLabsTTS.configure({
                apiKey: settings.elevenlabs_api_key,
                voiceId: settings.tts_voice_id,
            });
            elevenLabsTTS.connect();
        }
    }

    _speak(text) {
        const settings = settingsManager.getSync();
        const provider = settings.tts_provider;

        if (!this.ttsEnabled) return;

        if (provider === 'web-speech') {
            webSpeechTTS.speak(text);
        } else if (provider === 'elevenlabs') {
            elevenLabsTTS.speak(text);
        }
    }

    // ─── UI Updates ─────────────────────────────────────────

    _setSource(source) {
        this.currentSource = source;
        document.querySelectorAll('[data-source-btn]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.sourceBtnValue === source);
        });
        settingsManager.setSetting('audio_source', source);

        // Show/hide tab picker based on source
        this._toggleTabPicker(source === 'tab' || source === 'both');
    }

    _updateStartButton() {
        const btn = document.getElementById('btn-start');
        if (!btn) return;
        btn.classList.toggle('running', this.isRunning);
        btn.textContent = this.isRunning ? '■' : '▶';
    }

    _updateTTSButton() {
        const btn = document.getElementById('btn-tts');
        if (!btn) return;
        btn.classList.toggle('active', this.ttsEnabled);
    }

    _updateStatus(status) {
        const indicator = document.getElementById('status-indicator');
        if (!indicator) return;
        indicator.className = `status-indicator ${status}`;
        const labels = { connected: '●', disconnected: '○', connecting: '◐', error: '◌' };
        indicator.textContent = labels[status] || '◌';
    }

    _toggleElevenLabsSettings(show) {
        const settingsDiv = document.getElementById('elevenlabs-settings');
        if (settingsDiv) {
            settingsDiv.classList.toggle('hidden', !show);
        }
    }

    /**
     * Toggle visibility of STT provider API key inputs
     */
    _toggleSTTProviderUI(provider) {
        const elevenLabsGroup = document.getElementById('elevenlabs-stt-key-group');
        const sonioxGroup = document.getElementById('soniox-key-group');

        if (provider === 'elevenlabs') {
            if (elevenLabsGroup) elevenLabsGroup.classList.remove('hidden');
            if (sonioxGroup) sonioxGroup.classList.add('hidden');
        } else {
            if (elevenLabsGroup) elevenLabsGroup.classList.add('hidden');
            if (sonioxGroup) sonioxGroup.classList.remove('hidden');
        }
    }

    _showView(viewName) {
        document.querySelectorAll('[data-view]').forEach(view => {
            view.classList.toggle('active', view.dataset.view === viewName);
        });
    }

    _applySettings(settings) {
        const source = settings.audio_source || 'microphone';
        this._setSource(source);

        // Set flag to prevent change events while updating form
        this._isUpdatingForm = true;

        // Update form inputs
        const inputs = {
            'select-stt-provider': settings.stt_provider || 'elevenlabs',
            'input-soniox-key': settings.soniox_api_key,
            'input-elevenlabs-key': settings.elevenlabs_api_key,
            'select-source-lang': settings.source_language,
            'select-target-lang': settings.target_language,
            'input-font-size': settings.font_size,
            'input-max-lines': settings.max_lines,
            'checkbox-show-original': settings.show_original,
            'select-tts-provider': settings.tts_provider,
            'input-tts-speed': settings.tts_speed,
            'input-tts-voice-id': settings.tts_voice_id,
            'checkbox-tts-auto-read': settings.tts_auto_read,
            'input-domain': settings.custom_context?.domain || '',
        };

        for (const [id, value] of Object.entries(inputs)) {
            const el = document.getElementById(id);
            if (!el) continue;
            if (el.type === 'checkbox') {
                el.checked = value || false;
            } else {
                el.value = value || '';
            }
        }

        // Terms
        if (settings.custom_context?.translation_terms) {
            const termsStr = settings.custom_context.translation_terms
                .map(t => `${t.source} = ${t.target}`)
                .join('\n');
            const termsInput = document.getElementById('textarea-terms');
            if (termsInput) termsInput.value = termsStr;
        }

        // Reset flag after form update
        this._isUpdatingForm = false;

        // Toggle STT provider UI (show/hide API key fields)
        this._toggleSTTProviderUI(settings.stt_provider || 'elevenlabs');

        this.ttsEnabled = settings.tts_enabled;
        this._updateTTSButton();
        this._toggleElevenLabsSettings(settings.tts_provider === 'elevenlabs');

        const container = document.getElementById('transcript-container');
        if (container) {
            container.style.setProperty('--transcript-font-size', `${settings.font_size}px`);
        }

        this.transcriptUI.configure({
            maxLines: settings.max_lines,
            showOriginal: settings.show_original,
            fontSize: settings.font_size,
        });
    }

    /**
     * Toggle tab picker visibility and load tabs when showing
     */
    _toggleTabPicker(show) {
        const tabPickerBar = document.getElementById('tab-picker-bar');
        if (!tabPickerBar) return;

        if (show) {
            tabPickerBar.classList.remove('hidden');
            this._loadTabs();
        } else {
            tabPickerBar.classList.add('hidden');
            this.targetTabId = null;
            const selectTab = document.getElementById('select-tab');
            if (selectTab) selectTab.value = '';
        }
    }

    /**
     * Load all open tabs and populate the tab selector dropdown
     */
    async _loadTabs() {
        const selectTab = document.getElementById('select-tab');
        if (!selectTab) return;

        try {
            const tabs = await chrome.tabs.query({});

            // Filter out extension tabs and get only tabs with valid info
            const validTabs = tabs.filter(tab =>
                tab.url &&
                !tab.url.startsWith('chrome-extension://') &&
                !tab.url.startsWith('chrome://') &&
                tab.title
            );

            // Preserve current selection
            const currentValue = selectTab.value;

            // Rebuild options (keep placeholder)
            selectTab.innerHTML = '<option value="">-- Select a tab --</option>';

            for (const tab of validTabs) {
                const option = document.createElement('option');
                option.value = tab.id;
                // Use emoji or just title if no favIcon
                const label = tab.title.length > 50 ? tab.title.substring(0, 47) + '...' : tab.title;
                option.textContent = label;
                selectTab.appendChild(option);
            }

            // Restore selection if valid
            if (currentValue && validTabs.some(t => t.id === parseInt(currentValue))) {
                selectTab.value = currentValue;
                this.targetTabId = parseInt(currentValue);
            }
        } catch (err) {
            console.error('[App] Failed to load tabs:', err);
            this._showToast('Failed to load tabs', 'error');
        }
    }

    _downloadTranscript() {
        if (!this.transcriptUI.hasSegments()) {
            this._showToast('No transcript to download', 'info');
            return;
        }

        const settings = settingsManager.getSync();
        const content = this.transcriptUI.getFormattedContent({
            sourceLang: settings.source_language,
            targetLang: settings.target_language,
            audioSource: settings.audio_source,
        });

        if (!content) return;

        const blob = new Blob([content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `transcript-${Date.now()}.md`;
        a.click();
        URL.revokeObjectURL(url);

        this._showToast('Transcript downloaded', 'success');
    }

    _showToast(message, type = 'info') {
        console.log(`[Toast] ${type}: ${message}`);
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#3b82f6'};
            color: white;
            padding: 12px 16px;
            border-radius: 4px;
            font-size: 14px;
            z-index: 1000;
            animation: slideInUp 0.3s ease-out;
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const app = new App();
    await app.init();
    window.app = app;
});
