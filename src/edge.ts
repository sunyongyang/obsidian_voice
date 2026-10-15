import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { escapeXml } from './core';

interface SynthesisOptions { signal: AbortSignal; timeout: number; }
type EdgeGenerator = (text: string, voice: string, options: SynthesisOptions) => Promise<{ audio: Uint8Array }>;

async function generateEdge(text: string, voice: string, options: SynthesisOptions): Promise<{ audio: Uint8Array }> {
  options.signal.throwIfAborted();
  const client = new MsEdgeTTS({ connectionTimeoutMs: options.timeout, synthesisTimeoutMs: options.timeout, enableLogger: false });
  const abort = (): void => client.close();
  options.signal.addEventListener('abort', abort, { once: true });
  try {
    await client.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    options.signal.throwIfAborted();
    const { audioStream } = client.toStream(escapeXml(text));
    return await new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      let ended = false;
      audioStream.on('data', (data: unknown) => {
        if (!(data instanceof Uint8Array)) { reject(new Error('Invalid Edge audio chunk')); client.close(); return; }
        size += data.byteLength;
        if (size > 5 * 1024 * 1024) { reject(new Error('Edge audio limit exceeded')); client.close(); return; }
        chunks.push(Uint8Array.from(data));
      });
      audioStream.once('error', reject);
      audioStream.once('end', () => {
        ended = true;
        const audio = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.byteLength; }
        resolve({ audio });
      });
      audioStream.once('close', () => { if (!ended) reject(new Error('Edge stream closed before completion')); });
    });
  } finally {
    options.signal.removeEventListener('abort', abort);
    client.close();
  }
}

export function synthesizeEdge(
  text: string,
  voice: string,
  signal: AbortSignal,
  generate: EdgeGenerator = generateEdge,
  timeoutMs = 30000,
): Promise<Blob> {
  signal.throwIfAborted();
  if (!text.trim()) return Promise.reject(new Error('没有可朗读文字。'));
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (error?: Error, audio?: Blob): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      controller.abort();
      if (error) reject(error);
      else resolve(audio!);
    };
    const abort = (): void => finish(new DOMException('Aborted', 'AbortError'));
    const timer = window.setTimeout(() => finish(new Error('Edge TTS 连接超时，请检查网络；不会自动切换到 Azure。')), timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    void Promise.resolve().then(() => {
      if (settled) return null;
      return generate(text, voice, {
        signal: controller.signal,
        timeout: timeoutMs,
      });
    }).then(result => {
      if (settled || !result) return;
      if (!(result.audio instanceof Uint8Array) || !result.audio.byteLength || result.audio.byteLength > 5 * 1024 * 1024) {
        finish(new Error('Edge 音频为空或超出单段安全上限。'));
        return;
      }
      const data = Uint8Array.from(result.audio).buffer;
      finish(undefined, new Blob([data], { type: 'audio/mpeg' }));
    }, () => finish(new Error('Edge 在线连接失败，请检查网络或稍后重试；不会自动切换到 Azure。')));
  });
}