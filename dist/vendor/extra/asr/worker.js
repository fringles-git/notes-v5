/* Notes — speech to text on the device (Whisper tiny, 8-bit). The model downloads once from Hugging Face and is kept by
   the browser; the audio never leaves this worker. One job at a time: { id, audio: Float32Array (16 kHz mono) } → { id, text }. */
import { env, pipeline } from './transformers.min.js';

const here = new URL('./', import.meta.url).href;
env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = { mjs: here + 'ort-wasm-simd-threaded.mjs', wasm: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/ort-wasm-simd-threaded.wasm' };
env.backends.onnx.wasm.numThreads = 1;   // no cross-origin isolation here: one thread, no SharedArrayBuffer

let asr = null, queue = Promise.resolve();
const load = () => (asr ||= pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
  dtype: 'q8', device: 'wasm',
  progress_callback: p => { if (p.status === 'progress' && p.total > 1e6) self.postMessage({ progress: { file: p.file, loaded: p.loaded, total: p.total } }); },
}).catch(e => { asr = null; throw e; }));

self.onmessage = ({ data: { id, audio } }) => {
  queue = queue.then(async () => {
    try {
      const out = await (await load())(audio, { language: 'french', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
      self.postMessage({ id, text: String(out.text || '').trim() });
    } catch (e) {
      self.postMessage({ id, error: String((e && e.message) || e) });
    }
  });
};
