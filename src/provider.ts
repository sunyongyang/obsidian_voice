import { escapeXml } from './core';

export const VOICES = {
  'zh-CN-XiaoxiaoNeural': '晓晓 · 女声 · 普通话',
  'zh-CN-YunxiNeural': '云希 · 男声 · 普通话',
  'zh-CN-XiaoyiNeural': '晓伊 · 女声 · 普通话',
};

export const ENGINE_LABELS = {
  edge: 'Edge TTS', azure: 'Azure Speech', siliconflow: '硅基流动', doubao: '火山引擎 · 豆包', openai: 'OpenAI 兼容 TTS',
};
export type SpeechEngine = keyof typeof ENGINE_LABELS;
export type HttpEngine = 'siliconflow' | 'doubao' | 'openai';
export interface HttpProfile {
  endpoint: string;
  model: string;
  voice: string;
  resourceId: string;
  appId: string;
  authMode: 'api-key' | 'app-token';
}
export const HTTP_PRESETS: Record<HttpEngine, HttpProfile> = {
  siliconflow: { endpoint: 'https://api.siliconflow.cn/v1/audio/speech', model: 'FunAudioLLM/CosyVoice2-0.5B', voice: 'FunAudioLLM/CosyVoice2-0.5B:alex', resourceId: '', appId: '', authMode: 'api-key' },
  doubao: { endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse', model: '', voice: '', resourceId: 'seed-tts-2.0', appId: '', authMode: 'api-key' },
  openai: { endpoint: 'https://api.openai.com/v1/audio/speech', model: 'gpt-4o-mini-tts', voice: 'alloy', resourceId: '', appId: '', authMode: 'api-key' },
};
export const DEFAULT_ENGINE: SpeechEngine = 'edge';
export type EdgeSynthesizer = (text: string, voice: string, signal: AbortSignal) => Promise<Blob>;

export function usesMicrosoftVoices(engine: SpeechEngine): boolean { return engine === 'edge' || engine === 'azure'; }

export interface SpeechConfig {
  engine: SpeechEngine;
  desktop?: boolean;
  region: string;
  voice: string;
  key: string;
  authorized: boolean;
  profile?: HttpProfile;
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

export function endpointUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('请填写完整的 HTTPS 语音接口地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('接口地址必须使用 HTTPS，且不能包含账号、密钥、查询参数或片段。');
  }
  return url.toString();
}

export function configScope(config: SpeechConfig): string {
  const profile = config.profile;
  return JSON.stringify({ engine: config.engine, region: config.engine === 'azure' ? config.region : '',
    endpoint: profile?.endpoint, model: profile?.model, resourceId: profile?.resourceId, appId: profile?.appId, authMode: profile?.authMode });
}

export function serviceTarget(config: SpeechConfig): string {
  if (config.engine === 'edge') return 'Microsoft Edge 在线朗读服务';
  if (config.engine === 'azure') return `Microsoft Azure Speech（${config.region}）`;
  return `${ENGINE_LABELS[config.engine]}（${new URL(endpointUrl(config.profile?.endpoint ?? '')).host}）`;
}

export function validateConfig(config: SpeechConfig): void {
  if (!Object.hasOwn(ENGINE_LABELS, config.engine)) throw new Error('请选择有效的朗读引擎。');
  if (config.engine === 'edge' && !config.desktop) throw new Error('Edge TTS 直连目前仅支持桌面 Obsidian；移动端请主动选择 Azure，或等待移动端方案。不会自动切换引擎。');
  if (!config.authorized) throw new Error('请先在“连接与授权”中同意向当前语音服务发送文字。');
  if (usesMicrosoftVoices(config.engine) && !Object.hasOwn(VOICES, config.voice)) throw new Error('请选择支持的中文音色。');
  if (config.engine === 'azure') {
    if (!/^[a-z][a-z0-9]{1,39}$/.test(config.region)) throw new Error('请填写有效的 Azure 区域，例如 eastasia。');
    if (!config.key.trim()) throw new Error('请先输入本次会话使用的 Azure Speech 密钥。');
  } else if (config.engine !== 'edge') {
    const profile = config.profile;
    if (!profile) throw new Error('请先配置语音平台。');
    endpointUrl(profile.endpoint);
    if (!config.key.trim()) throw new Error('请先输入本次会话的 API Key 或 Access Token。');
    if (!config.voice.trim()) throw new Error('请填写当前模型支持的音色 ID。');
    if (config.engine === 'doubao') {
      if (!profile.resourceId.trim()) throw new Error('豆包需要填写资源 ID。');
      if (profile.authMode !== 'api-key' && profile.authMode !== 'app-token') throw new Error('请选择豆包鉴权方式。');
      if (profile.authMode === 'app-token' && !profile.appId.trim()) throw new Error('旧版豆包鉴权需要 App ID。');
    } else if (!profile.model.trim()) throw new Error('请填写 TTS 模型 ID。');
  }
}

export function buildSpeechRequest(text: string, config: SpeechConfig): SpeechRequest {
  validateConfig(config);
  if (config.engine === 'azure') return {
    url: `https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    headers: { 'Ocp-Apim-Subscription-Key': config.key.trim(), 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' },
    body: `<speak version="1.0" xml:lang="zh-CN"><voice name="${config.voice}">${escapeXml(text)}</voice></speak>`,
  };
  if (config.engine === 'edge') throw new Error('Edge 使用独立桌面适配器。');
  const profile = config.profile!;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.engine === 'doubao') {
    if (profile.authMode === 'app-token') {
      headers['X-Api-App-Id'] = profile.appId.trim(); headers['X-Api-Access-Key'] = config.key.trim();
    } else headers['X-Api-Key'] = config.key.trim();
    headers['X-Api-Resource-Id'] = profile.resourceId.trim();
    headers['X-Api-Request-Id'] = crypto.randomUUID();
    return { url: endpointUrl(profile.endpoint), headers, body: JSON.stringify({ user: { uid: 'note-listener' }, req_params: {
      text, speaker: config.voice.trim(), ...(profile.model.trim() ? { model: profile.model.trim() } : {}), audio_params: { format: 'mp3', sample_rate: 24000 },
    } }) };
  }
  headers.Authorization = `Bearer ${config.key.trim()}`;
  return { url: endpointUrl(profile.endpoint), headers, body: JSON.stringify({ model: profile.model.trim(), input: text, voice: config.voice.trim(), response_format: 'mp3' }) };
}

export function decodeDoubao(data: ArrayBuffer): Blob {
  if (data.byteLength > 16 * 1024 * 1024) throw new Error('豆包响应超过安全上限。');
  const content = new TextDecoder().decode(data);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  let completed = false;
  for (const event of content.split(/\r?\n\r?\n/)) {
    const payload = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!payload) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(payload); } catch { throw new Error('豆包返回了无法解析的 SSE 数据。'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('豆包响应格式不正确。');
    const record = parsed as Record<string, unknown>;
    if (completed) throw new Error('豆包结束事件后仍有数据。');
    if (record.code === 20000000) { completed = true; continue; }
    if (record.code !== 0) throw new Error(`豆包合成失败（代码 ${typeof record.code === 'number' ? record.code : '未知'}），请检查资源、音色及额度。`);
    if (record.data === null || record.data === undefined) continue;
    if (typeof record.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(record.data)) throw new Error('豆包音频编码不正确。');
    let binary: string;
    try { binary = atob(record.data); } catch { throw new Error('豆包音频编码不正确。'); }
    const bytes = Uint8Array.from(binary, value => value.charCodeAt(0));
    size += bytes.byteLength;
    if (size > 5 * 1024 * 1024) throw new Error('单段音频超过安全上限。');
    chunks.push(bytes);
  }
  if (!completed || !size) throw new Error('豆包音频未完整返回，请重试当前段。');
  return new Blob(chunks, { type: 'audio/mpeg' });
}

export async function synthesize(
  text: string,
  config: SpeechConfig,
  signal: AbortSignal,
  transport: SpeechTransport,
  timeoutMs = 30000,
  edge?: EdgeSynthesizer,
): Promise<Blob> {
  validateConfig(config);
  signal.throwIfAborted();
  if (!text.trim()) throw new Error('没有可朗读文字。');
  if (config.engine === 'edge') {
    if (!edge) throw new Error('桌面 Edge TTS 适配器未加载，请检查安装文件。');
    return edge(text, config.voice, signal);
  }
  const request = buildSpeechRequest(text, config);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, audio?: Blob): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(audio!);
    };
    const abort = (): void => finish(new DOMException('Aborted', 'AbortError'));
    const timer = window.setTimeout(() => finish(new Error('在线合成超时，请检查网络后重试。')), timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    void transport(request).then(response => {
      if (settled) return;
      if (response.status === 401 || response.status === 403) return finish(new Error('语音服务鉴权失败，请检查密钥、区域及资源权限。'));
      if (response.status === 429) return finish(new Error('语音服务请求受限，请稍后手动重试。'));
      if (response.status !== 200) return finish(new Error(`在线服务返回 HTTP ${response.status}，请稍后重试。`));
      if (config.engine === 'doubao') {
        if (!response.contentType.toLowerCase().includes('text/event-stream')) return finish(new Error('豆包需要 SSE 接口响应，请检查完整接口地址。'));
        try { finish(undefined, decodeDoubao(response.data)); } catch (error) { finish(error instanceof Error ? error : new Error('豆包响应无法解析。')); }
        return;
      }
      const mime = response.contentType.split(';')[0].trim().toLowerCase();
      const bytes = new Uint8Array(response.data);
      const mp3 = bytes.length > 2 && ((bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) || (bytes[0] === 255 && (bytes[1] & 224) === 224));
      if ((!mime.startsWith('audio/') && !(mime === 'application/octet-stream' && mp3)) || !response.data.byteLength) {
        return finish(new Error('在线服务没有返回有效音频。'));
      }
      if (response.data.byteLength > 5 * 1024 * 1024) return finish(new Error('单段音频超过预览版安全上限。'));
      finish(undefined, new Blob([response.data], { type: mime.startsWith('audio/') ? mime : 'audio/mpeg' }));
    }, () => finish(new Error('网络请求失败，请检查网络连接及语音服务配置。')));
  });
}