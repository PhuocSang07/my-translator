/**
 * AudioWorklet Processor
 * Converts multi-channel Float32 audio to mono PCM s16le, 16kHz sample rate
 * Runs in a separate audio thread for efficiency
 */

class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._buffer = [];
        this._sampleCount = 0;
        // Flush every 200ms = 200ms * 16000 samples/s = 3200 samples
        this._flushInterval = 3200;
    }

    process(inputs) {
        const input = inputs[0];

        if (!input || input.length === 0) {
            return true;
        }

        const frameSize = input[0].length;
        if (frameSize === 0) {
            return true;
        }

        // Convert multi-channel Float32 to mono
        const mono = new Float32Array(frameSize);

        // Mix all channels into mono
        for (const channel of input) {
            for (let i = 0; i < frameSize; i++) {
                mono[i] += channel[i];
            }
        }

        // Normalize by number of channels
        if (input.length > 1) {
            for (let i = 0; i < frameSize; i++) {
                mono[i] /= input.length;
            }
        }

        // Convert Float32 [-1, 1] to Int16 [-32768, 32767]
        const i16 = new Int16Array(frameSize);
        for (let i = 0; i < frameSize; i++) {
            let s = Math.floor(mono[i] < 0 ? mono[i] * 32768 : mono[i] * 32767);
            i16[i] = Math.max(-32768, Math.min(32767, s));
        }

        // Accumulate samples
        this._buffer.push(i16.buffer);
        this._sampleCount += i16.length;

        // Flush if we have enough samples
        if (this._sampleCount >= this._flushInterval) {
            this.port.postMessage({
                type: 'pcm',
                buffers: this._buffer,
            });
            this._buffer = [];
            this._sampleCount = 0;
        }

        return true;
    }
}

registerProcessor('pcm-processor', PCMProcessor);
