/**
 * Audio Capture Manager
 * Handles microphone and tab audio capture using Web Audio API
 * Converts audio to PCM s16le 16kHz mono via AudioWorklet
 */

class AudioCapture {
    constructor() {
        this._ctx = null;
        this._worklet = null;
        this._micStream = null;
        this._tabStream = null;
        this._merger = null;
        this.onAudio = null;  // callback(buffers) where buffers are ArrayBuffer[]
        this._isRunning = false;
    }

    /**
     * Start audio capture
     * @param {string} source - 'microphone' | 'tab' | 'both'
     * @param {number} tabId - current tab ID (for tab capture)
     */
    async start(source = 'microphone', tabId = null) {
        if (this._isRunning) return;

        try {
            // Create AudioContext at 16kHz
            this._ctx = new AudioContext({ sampleRate: 16000 });

            // Load and create AudioWorklet
            await this._ctx.audioWorklet.addModule('js/audio-worklet.js');
            this._worklet = new AudioWorkletNode(this._ctx, 'pcm-processor');

            // Set up message handler for PCM data
            this._worklet.port.onmessage = (event) => {
                if (event.data.type === 'pcm') {
                    this.onAudio?.(event.data.buffers);
                }
            };

            // Create merger to combine multiple audio sources
            this._merger = this._ctx.createChannelMerger(2);

            // Capture microphone
            if (source === 'microphone' || source === 'both') {
                try {
                    this._micStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            echoCancellation: false,
                            noiseSuppression: false,
                            autoGainControl: false,
                        },
                        video: false,
                    });
                    const micSource = this._ctx.createMediaStreamSource(this._micStream);
                    micSource.connect(this._merger, 0, 0);
                    console.log('[AudioCapture] Microphone connected');
                } catch (err) {
                    console.error('[AudioCapture] Microphone failed:', err.message);
                    throw new Error(`Microphone access denied: ${err.message}`);
                }
            }

            // Capture tab audio
            if (source === 'tab' || source === 'both') {
                if (!tabId) {
                    throw new Error('Tab ID required for tab capture');
                }
                try {
                    const { streamId } = await chrome.runtime.sendMessage({
                        type: 'GET_TAB_STREAM_ID',
                        tabId,
                    });

                    if (!streamId) {
                        throw new Error('Failed to get tab stream ID');
                    }

                    this._tabStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            mandatory: {
                                chromeMediaSource: 'tab',
                                chromeMediaSourceId: streamId,
                            },
                        },
                        video: false,
                    });

                    const tabSource = this._ctx.createMediaStreamSource(this._tabStream);
                    tabSource.connect(this._merger, 0, 1);
                    console.log('[AudioCapture] Tab audio connected');
                } catch (err) {
                    console.error('[AudioCapture] Tab audio failed:', err.message);
                    throw new Error(`Tab audio capture failed: ${err.message}`);
                }
            }

            // Connect merger to worklet
            this._merger.connect(this._worklet);

            // Connect worklet to destination so it stays active
            this._worklet.connect(this._ctx.destination);

            this._isRunning = true;
            console.log('[AudioCapture] Started, source:', source);
        } catch (err) {
            this.stop();
            throw err;
        }
    }

    /**
     * Stop audio capture
     */
    stop() {
        this._isRunning = false;

        // Stop all tracks
        if (this._micStream) {
            this._micStream.getTracks().forEach(track => track.stop());
            this._micStream = null;
        }

        if (this._tabStream) {
            this._tabStream.getTracks().forEach(track => track.stop());
            this._tabStream = null;
        }

        // Close audio context
        if (this._ctx && this._ctx.state !== 'closed') {
            this._ctx.close().catch(() => {});
        }

        this._ctx = null;
        this._worklet = null;
        this._merger = null;

        console.log('[AudioCapture] Stopped');
    }

    get isRunning() {
        return this._isRunning;
    }
}

const audioCapture = new AudioCapture();
