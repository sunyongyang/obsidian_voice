import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSpeechRequest, configScope, decodeDoubao, endpointUrl, HTTP_PRESETS, synthesize, validateConfig, type SpeechConfig } from '../src/provider';

function config(engine: 'siliconflow' | 'doubao' | 'openai'): SpeechConfig {
  const profile = { ...HTTP_PRESETS[engine], ...(engine === 'doubao' ? { voice: 'test-speaker' } : {}) };
  return { engine, profile, desktop: false, voice: profile.voice, region: '', key: 'test-session-secret', authorized: true };
}

test('SiliconFlow and custom OpenAI-compatible requests use editable model and voice', () => {
  for (const engine of ['siliconflow', 'openai'] as const) {
    const value = config(engine);
    value.profile!.endpoint = 'https://tts.example.com/v1/audio/speech';
    value.profile!.model = 'custom-model';
    value.voice = 'custom-voice';
    const request = buildSpeechRequest('测试正文', value);
    assert.equal(request.url, value.profile!.endpoint);
    assert.equal(request.headers.Authorization, 'Bearer test-session-secret');
    assert.deepEqual(JSON.parse(request.body), { model: 'custom-model', voice: 'custom-voice', input: '测试正文', response_format: 'mp3' });
    assert.ok(!request.body.includes(value.key));
  }
});

test('Doubao supports new API Key and old App ID plus Access Token without mixing headers', () => {
  const value = config('doubao');
  const request = buildSpeechRequest('测试', value);
  assert.equal(request.headers['X-Api-Key'], value.key);
  assert.equal(request.headers['X-Api-Resource-Id'], 'seed-tts-2.0');
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(JSON.parse(request.body).req_params.speaker, value.voice);
  value.profile!.authMode = 'app-token';
  assert.throws(() => validateConfig(value), /App ID/);
  value.profile!.appId = 'app-id';
  const legacy = buildSpeechRequest('测试', value);
  assert.equal(legacy.headers['X-Api-App-Id'], 'app-id');
  assert.equal(legacy.headers['X-Api-Access-Key'], value.key);
  assert.equal(legacy.headers['X-Api-Key'], undefined);
});

test('endpoint safety and consent gate block credential leakage before network', async () => {
  for (const url of ['http://example.com/speech', 'https://key@example.com/speech', 'https://example.com/speech?key=secret', 'https://example.com/#secret']) {
    assert.throws(() => endpointUrl(url));
  }
  const value = config('siliconflow');
  let calls = 0;
  await assert.rejects(synthesize('test', { ...value, authorized: false }, new AbortController().signal, async () => { calls++; throw new Error('unexpected'); }));
  assert.equal(calls, 0);
  const scope = configScope(value);
  assert.equal(configScope({ ...value, voice: 'another' }), scope);
  assert.notEqual(configScope({ ...value, profile: { ...value.profile!, endpoint: 'https://another.example.com/speech' } }), scope);
  assert.notEqual(configScope({ ...value, profile: { ...value.profile!, model: 'another' } }), scope);
  assert.ok(!scope.includes(value.key));
});

const stream = (lines: unknown[]) => new TextEncoder().encode(lines.map(value => `data: ${JSON.stringify(value)}\n\n`).join('')).buffer;

test('Doubao SSE assembles all audio frames and requires successful completion', async () => {
  const audio = decodeDoubao(stream([{ code: 0, data: btoa('abc') }, { code: 0, data: null }, { code: 0, data: btoa('def') }, { code: 20000000, data: null }]));
  assert.equal(await audio.text(), 'abcdef');
  assert.throws(() => decodeDoubao(stream([{ code: 0, data: btoa('partial') }])), /未完整/);
  assert.throws(() => decodeDoubao(stream([{ code: 45000000, message: 'secret' }])), /45000000/);
  assert.throws(() => decodeDoubao(stream([{ code: 0, data: '??' }, { code: 20000000 }])), /编码/);
  assert.throws(() => decodeDoubao(stream([{ code: 20000000 }, { code: 0, data: btoa('late') }])), /结束事件/);
});

test('Doubao protocol response and compatible binary response pass through synthesize', async () => {
  const response = { status: 200, contentType: 'text/event-stream', data: stream([{ code: 0, data: btoa('audio') }, { code: 20000000 }]) };
  const audio = await synthesize('test', config('doubao'), new AbortController().signal, async () => response);
  assert.equal(await audio.text(), 'audio');
  await assert.rejects(synthesize('test', config('doubao'), new AbortController().signal, async () => ({ ...response, contentType: 'application/json' })), /SSE/);
  const binary = await synthesize('test', config('siliconflow'), new AbortController().signal, async () => ({ status: 200, contentType: 'application/octet-stream', data: new Uint8Array([73, 68, 51, 0]).buffer }));
  assert.equal(binary.type, 'audio/mpeg');
});