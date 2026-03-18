/**
 * ElevenLabs STT Client — Real-time Scribe v2 Transcription via WebSocket
 * Provides same callback interface as Soniox for easy provider swapping
 * Note: ElevenLabs STT does transcription only, no translation
 */

class ElevenLabsSTTClient {
    constructor() {
        this.ws = null;
        this.apiKey = null;
        this.isConnected = false;
        this._intentionalDisconnect = false;
        this._reconnectAttempts = 0;
        this._isProcessing = false;

        // Callbacks (same interface as SonioxClient)
        this.onOriginal = null;      // (text: string, speaker: null) - final transcript
        this.onTranslation = null;   // NOT USED - ElevenLabs STT has no translation
        this.onProvisional = null;   // (text: string, speaker: null) - interim transcript
        this.onStatusChange = null;  // (status: string)
        this.onError = null;         // (message: string)
    }

    /**
     * Connect to ElevenLabs real-time STT WebSocket
     */
    connect(config) {
        if (this.isConnected || this._isProcessing) return;

        this.apiKey = config.apiKey;
        this._intentionalDisconnect = false;
        this._reconnectAttempts = 0;

        this._setStatus('connecting');
        this._connect(config);
    }

    /**
     * Send PCM audio data to WebSocket
     */
    sendAudio(pcmBuffer) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('[ElevenLabsSTT] WebSocket not ready, audio dropped');
            return;
        }

        try {
            this.ws.send(pcmBuffer);
        } catch (err) {
            console.error('[ElevenLabsSTT] Send audio failed:', err);
            this._handleError(`Audio send failed: ${err.message}`);
        }
    }

    /**
     * Disconnect gracefully
     */
    disconnect() {
        this._intentionalDisconnect = true;
        if (this.ws) {
            try {
                // Send empty buffer to signal end of audio
                this.ws.send(new ArrayBuffer(0));
                this.ws.close(1000, 'Normal closure');
            } catch (err) {
                console.warn('[ElevenLabsSTT] Disconnect error:', err);
            }
            this.ws = null;
        }
        this.isConnected = false;
        this._setStatus('disconnected');
    }

    // ─── Private Methods ──────────────────────────────────────

    _connect(config) {
        const wsUrl = 'wss://api.elevenlabs.io/v1/speech-to-text/stream';

        try {
            this.ws = new WebSocket(wsUrl);
            this.ws.binaryType = 'arraybuffer';

            this.ws.onopen = () => this._onOpen(config);
            this.ws.onmessage = (event) => this._onMessage(event);
            this.ws.onerror = (event) => this._onWsError(event);
            this.ws.onclose = (event) => this._onWsClose(event);
        } catch (err) {
            this._handleError(`WebSocket creation failed: ${err.message}`);
        }
    }

    _onOpen(config) {
        console.log('[ElevenLabsSTT] WebSocket connected');

        // Send connection config
        const connectionMessage = {
            type: 'connection_request',
            xi_api_key: this.apiKey,
            model_id: 'scribe_v2_realtime',
            language_code: config.sourceLanguage === 'auto' ? '' : config.sourceLanguage,
        };

        try {
            this.ws.send(JSON.stringify(connectionMessage));
            this._setStatus('connected');
        } catch (err) {
            this._handleError(`Config send failed: ${err.message}`);
        }
    }

    _onMessage(event) {
        try {
            // ElevenLabs STT sends JSON messages
            const message = JSON.parse(event.data);

            if (message.type === 'transcript') {
                this._handleTranscript(message);
            } else if (message.type === 'error') {
                this._handleError(message.error_message || 'Unknown error from ElevenLabs');
            }
        } catch (err) {
            console.error('[ElevenLabsSTT] Parse message error:', err, 'data:', event.data);
        }
    }

    _handleTranscript(message) {
        const text = message.text || '';

        if (!text.trim()) return;

        // Final transcript (confidence high)
        if (message.is_final) {
            // Fire onOriginal (ElevenLabs doesn't translate, so text is original)
            if (this.onOriginal) this.onOriginal(text, null);
            // Clear provisional
            if (this.onProvisional) this.onProvisional('', null);
        } else {
            // Interim transcript (still being recognized)
            if (this.onProvisional) this.onProvisional(text, null);
        }
    }

    _onWsError(event) {
        console.error('[ElevenLabsSTT] WebSocket error:', event);
        this._handleError('WebSocket connection error');
    }

    _onWsClose(event) {
        console.log('[ElevenLabsSTT] WebSocket closed, code:', event.code);

        this.ws = null;
        this.isConnected = false;

        if (this._intentionalDisconnect) {
            this._setStatus('disconnected');
            return;
        }

        // Attempt reconnect (max 3 times)
        if (this._reconnectAttempts < 3) {
            this._reconnectAttempts++;
            const delay = 2000 * this._reconnectAttempts;
            console.log(`[ElevenLabsSTT] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`);
            setTimeout(() => {
                if (!this._intentionalDisconnect) {
                    this.connect({
                        apiKey: this.apiKey,
                        sourceLanguage: 'auto',
                    });
                }
            }, delay);
        } else {
            this._handleError('Failed to reconnect after 3 attempts');
        }
    }

    _handleError(message) {
        console.error('[ElevenLabsSTT]', message);
        if (this.onError) this.onError(message);
        this._setStatus('error');
    }

    _setStatus(status) {
        if (status === 'connected') {
            this.isConnected = true;
        } else if (status === 'disconnected' || status === 'error') {
            this.isConnected = false;
        }

        if (this.onStatusChange) this.onStatusChange(status);
    }
}

// Singleton instance
const elevenLabsSTT = new ElevenLabsSTTClient();
