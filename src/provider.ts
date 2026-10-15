import { escapeXml } from './core';

export const VOICES = {
  'zh-CN-XiaoxiaoNeural': '晓晓 · 普通话',
  'zh-CN-YunxiNeural': '云希 · 普通话',
  'zh-CN-XiaoyiNeural': '晓伊 · 普通话',
};

export interface SpeechConfig {
  region: string;
  voice: string;
  key: string;
  authorized: boolean;
}

export interface SpeechRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface SpeechResponse {
  status: number;
  contentType: string;
  data: ArrayBuffer;
}

export type SpeechTransport = (request: SpeechRequest) => Promise<SpeechResponse>;

export function validateConfig(config: SpeechConfig): void {
  if (!config.authorized) throw new Error('请先授权将待朗读文字发送到 Microsoft Azure Speech。');
  if (!/^[a-z][a-z0-9]{1,39}$/.test(config.region)) throw new Error('请填写有效的 Azure 区域，例如 eastasia。');
  if (!Object.hasOwn(VOICES, config.voice)) throw new Error('请选择支持的中文音色。');
  if (!config.key.trim()) throw new Error('请先输入本次会话使用的 Azure Speech 密钥。');
}

export async function synthesize(
  text: string,
  config: SpeechConfig,
  signal: AbortSignal,
  transport: SpeechTransport,
  timeoutMs = 30000,
): Promise<Blob> {
  validateConfig(config);
  signal.throwIfAborted();
  if (!text.trim()) throw new Error('没有可朗读文字。');
  const request: SpeechRequest = {
    url: `https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    headers: {
      'Ocp-Apim-Subscription-Key': config.key.trim(),
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
    },
    body: `<speak version="1.0" xml:lang="zh-CN"><voice name="${config.voice}">${escapeXml(text)}</voice></speak>`,
  };
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, audio?: Blob): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(audio!);
    };
    const abort = (): void => finish(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('在线合成超时，请检查网络后重试。')), timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    void transport(request).then(response => {
      if (settled) return;
      if (response.status === 401 || response.status === 403) return finish(new Error('Azure 鉴权失败，请检查区域、密钥及资源权限。'));
      if (response.status === 429) return finish(new Error('Azure 请求受限，请稍后手动重试。'));
      if (response.status !== 200) return finish(new Error(`在线服务返回 HTTP ${response.status}，请稍后重试。`));
      if (!response.contentType.toLowerCase().startsWith('audio/') || !response.data.byteLength) {
        return finish(new Error('在线服务没有返回有效音频。'));
      }
      if (response.data.byteLength > 5 * 1024 * 1024) return finish(new Error('单段音频超过预览版安全上限。'));
      finish(undefined, new Blob([response.data], { type: 'audio/mpeg' }));
    }, () => finish(new Error('网络请求失败，请检查网络连接及 Azure 服务配置。')));
  });
}