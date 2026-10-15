import { Constants, EdgeTTS, type SynthesisOptions } from '@andresaya/edge-tts';

type EdgeGenerator = (text: string, voice: string, options: SynthesisOptions) => Promise<{ audio: Uint8Array }>;

export function synthesizeEdge(
  text: string,
  voice: string,
  signal: AbortSignal,
  generate: EdgeGenerator = (text, voice, options) => new EdgeTTS().generate(text, voice, options),
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
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      controller.abort();
      if (error) reject(error);
      else resolve(audio!);
    };
    const abort = (): void => finish(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Edge TTS 连接超时，请检查网络；不会自动切换到 Azure。')), timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    void Promise.resolve().then(() => {
      if (settled) return null;
      return generate(text, voice, {
        signal: controller.signal,
        timeout: timeoutMs,
        outputFormat: Constants.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
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