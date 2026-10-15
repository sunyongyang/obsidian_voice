import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import type ListenerPlugin from '../src/main';
import { NotePlayer, type AudioPort, type Bookmark, type PlayerDependencies } from '../src/player';
import { configScope, DEFAULT_ENGINE, synthesize, validateConfig, VOICES, type SpeechConfig } from '../src/provider';

const config: SpeechConfig = { engine: 'azure', region: 'eastasia', voice: 'zh-CN-XiaoxiaoNeural', key: 'test-only', authorized: true };
const audioResponse = () => ({ status: 200, contentType: 'audio/mpeg', data: new Uint8Array([1, 2, 3]).buffer });

async function pluginWithoutHost(): Promise<ListenerPlugin> {
  const result = await build({ entryPoints: ['src/main.ts'], bundle: true, write: false, platform: 'browser', format: 'cjs', external: ['obsidian', '@andresaya/edge-tts'] });
  const module = { exports: {} as { default: new () => ListenerPlugin } };
  const host = { Plugin: class {}, Modal: class {}, PluginSettingTab: class {}, Platform: { isDesktopApp: true } };
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: () => host, navigator: {}, URL });
  const plugin = new module.exports.default();
  plugin.app = { workspace: { getLeavesOfType: () => [] } } as unknown as ListenerPlugin['app'];
  plugin.persist = async () => {};
  return plugin;
}

test('voice selection preserves the note and paragraph, resets seconds and keeps consent', async () => {
  const plugin = await pluginWithoutHost();
  const snapshot = { path: 'note.md', title: 'note', chunks: ['one', 'two'], hash: 'hash' };
  let stopped = 0;
  plugin.player = { snapshot, index: 1, stop: () => { stopped++; } } as unknown as NotePlayer;
  plugin.authorized = true;
  plugin.bookmark = { path: 'note.md', hash: 'hash', chunk: 1, seconds: 12 };
  plugin.setVoice('zh-CN-YunxiNeural');
  assert.equal(plugin.settings.voice, 'zh-CN-YunxiNeural');
  assert.equal(plugin.player.snapshot, snapshot);
  assert.equal(plugin.player.index, 1);
  assert.equal(plugin.bookmark.seconds, 0);
  assert.equal(plugin.bookmark.chunk, 1);
  assert.equal(plugin.authorized, true);
  assert.equal(stopped, 1);
  plugin.setVoice('invalid');
  plugin.setVoice('zh-CN-YunxiNeural');
  assert.equal(stopped, 1);
});

test('note toolbar targets its own note, toggles playback and waits for consent', async () => {
  const plugin = await pluginWithoutHost();
  const calls: string[] = [];
  plugin.player = {
    snapshot: { path: 'first.md' }, status: 'playing',
    stop: () => {},
    pause: () => { calls.push('pause'); }, resume: async () => { calls.push('resume'); },
    start: async (path: string) => { calls.push(path); },
  } as unknown as NotePlayer;
  plugin.grantSession('', configScope(plugin.config()));
  plugin.toggleNote('second.md');
  plugin.toggleNote('first.md');
  plugin.player.status = 'paused';
  plugin.toggleNote('first.md');
  assert.deepEqual(calls, ['second.md', 'pause', 'resume']);
  plugin.authorized = false;
  let authorize: (() => void) | undefined;
  plugin.showCredentials = callback => { authorize = callback; };
  plugin.toggleNote('second.md');
  assert.equal(calls.length, 3);
  assert.ok(authorize);
  plugin.authorized = true;
  authorize();
  assert.equal(calls.at(-1), 'second.md');
});

test('platform configuration changes revoke credentials and authorization scope', async () => {
  const plugin = await pluginWithoutHost();
  plugin.player = { stop: () => {}, snapshot: null } as unknown as NotePlayer;
  plugin.setEngine('siliconflow');
  const originalScope = configScope(plugin.config());
  plugin.grantSession('session-secret-only', originalScope);
  assert.equal(plugin.config().authorized, true);
  assert.equal(JSON.stringify(plugin.settings).includes('session-secret-only'), false);
  plugin.setProfileField('endpoint', 'https://other.example.com/v1/audio/speech');
  assert.equal(plugin.config().authorized, false);
  assert.equal(plugin.sessionKey, '');
  assert.throws(() => plugin.grantSession('old-secret', originalScope), /配置已变化/);
  plugin.grantSession('new-session-secret', configScope(plugin.config()));
  plugin.setProfileField('model', 'another-model');
  assert.equal(plugin.config().authorized, false);
  assert.equal(plugin.sessionKey, '');
  assert.equal(plugin.settings.profiles.siliconflow.model, 'another-model');
  plugin.setEngine('edge');
  assert.equal(plugin.settings.voice, 'zh-CN-XiaoxiaoNeural');
});

test('every selectable voice is passed to the selected provider', async () => {
  for (const voice of Object.keys(VOICES)) {
    let selected = '';
    const edgeConfig: SpeechConfig = { ...config, engine: 'edge', desktop: true, voice, key: '' };
    await synthesize('固定试听', edgeConfig, new AbortController().signal, async () => { throw new Error('Unexpected Azure request'); }, 30000,
      async (_text, value) => { selected = value; return new Blob(['audio']); });
    assert.equal(selected, voice);
    await synthesize('固定试听', { ...config, voice }, new AbortController().signal, async request => {
      assert.ok(request.body.includes(`<voice name="${voice}">`));
      return audioResponse();
    });
  }
  assert.throws(() => validateConfig({ ...config, voice: 'unknown-voice' }), /音色/);
});

test('default Edge requires consent but no Azure key, and never silently falls back', async () => {
  assert.equal(DEFAULT_ENGINE, 'edge');
  const edgeConfig: SpeechConfig = { ...config, engine: DEFAULT_ENGINE, desktop: true, key: '', region: '' };
  validateConfig(edgeConfig);
  assert.throws(() => validateConfig({ ...edgeConfig, desktop: false }), /仅支持桌面/);
  assert.throws(() => validateConfig({ ...edgeConfig, authorized: false }), /授权/);
  let azureCalls = 0;
  const transport = async () => { azureCalls++; return audioResponse(); };
  const blob = await synthesize('测试', edgeConfig, new AbortController().signal, transport, 30000, async (text, voice) => {
    assert.equal(text, '测试');
    assert.equal(voice, edgeConfig.voice);
    return new Blob(['edge audio']);
  });
  assert.equal(blob.size, 10);
  await assert.rejects(synthesize('测试', edgeConfig, new AbortController().signal, transport, 30000, async () => {
    throw new Error('Edge unavailable');
  }), /Edge unavailable/);
  assert.equal(azureCalls, 0);
});

test('cloud request is gated by consent and credentials, and SSML is escaped', async () => {
  let calls = 0;
  const transport = async (request: { body: string }) => {
    calls++;
    assert.match(request.body, /&lt;private&gt;/);
    return audioResponse();
  };
  await assert.rejects(synthesize('<private>', { ...config, authorized: false }, new AbortController().signal, transport));
  await assert.rejects(synthesize('<private>', { ...config, region: 'evil.example/' }, new AbortController().signal, transport));
  assert.equal(calls, 0);
  assert.equal((await synthesize('<private>', config, new AbortController().signal, transport)).size, 3);
  assert.equal(calls, 1);
});

test('requests stop waiting on abort and timeout, service errors expose no key', async () => {
  const controller = new AbortController();
  const request = synthesize('test', config, controller.signal, () => new Promise(() => {}));
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  await assert.rejects(synthesize('test', config, new AbortController().signal, () => new Promise(() => {}), 5), /超时/);
  await assert.rejects(synthesize('test', config, new AbortController().signal, async () => ({ ...audioResponse(), status: 401 })), /鉴权/);
  await assert.rejects(synthesize('test', config, new AbortController().signal, async () => ({ ...audioResponse(), contentType: 'text/html' })), /有效音频/);
});

function setup(overrides: Partial<PlayerDependencies> = {}) {
  const audio: AudioPort = {
    src: '', currentTime: 0, playbackRate: 1, paused: true, ended: false, error: null,
    onended: null, onerror: null, onpause: null, onplaying: null, onloadedmetadata: null,
    async play() { this.paused = false; this.ended = false; this.onplaying?.(new Event('playing')); },
    pause() { this.paused = true; this.onpause?.(new Event('pause')); },
    load() { this.currentTime = 0; this.onloadedmetadata?.(new Event('loadedmetadata')); },
    removeAttribute(name) { if (name === 'src') this.src = ''; },
  };
  const saved: Bookmark[] = [];
  const revoked: string[] = [];
  const player = new NotePlayer({
    audio,
    read: async path => ({ path, title: path, chunks: ['first', 'second'], hash: 'hash' }),
    check: async () => {}, synthesize: async () => new Blob(['audio']),
    next: async () => null, changed: () => {}, bookmark: value => saved.push(value),
    createUrl: () => 'blob:test', revokeUrl: url => revoked.push(url),
    ...overrides,
  });
  return { player, audio, saved, revoked };
}

test('stop while synthesis is in flight never starts stale audio', async () => {
  let complete!: (audio: Blob) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const { player, audio } = setup({ synthesize: () => { entered(); return new Promise(resolve => { complete = resolve; }); } });
  const request = player.start('a.md');
  await started;
  player.stop();
  complete(new Blob(['stale']));
  await request;
  assert.equal(audio.src, '');
  assert.equal(player.status, 'idle');
});

test('pause during buffering remains paused when audio arrives', async () => {
  let complete!: (audio: Blob) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const { player, audio } = setup({ synthesize: () => { entered(); return new Promise(resolve => { complete = resolve; }); } });
  const request = player.start('a.md');
  await started;
  player.pause();
  complete(new Blob(['audio']));
  await request;
  assert.equal(audio.paused, true);
  assert.equal(player.status, 'paused');
});

test('resuming during synthesis reuses the pending request instead of generating twice', async () => {
  let complete!: (audio: Blob) => void;
  let entered!: () => void;
  let calls = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const { player } = setup({ synthesize: () => {
    calls++;
    entered();
    return new Promise(resolve => { complete = resolve; });
  } });
  const first = player.preview();
  await started;
  player.pause();
  const resumed = player.resume();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  complete(new Blob(['audio']));
  await Promise.all([first, resumed]);
  assert.equal(player.status, 'playing');
});

test('pause during random selection is preserved after the selected note is ready', async () => {
  let select!: (path: string) => void;
  const { player, audio } = setup({ next: () => new Promise(resolve => { select = resolve; }) });
  const pending = player.random();
  player.pause();
  select('a.md');
  await pending;
  assert.equal(player.snapshot?.path, 'a.md');
  assert.equal(player.status, 'paused');
  assert.equal(audio.paused, true);
  await player.resume();
  assert.equal(player.status, 'playing');
});

test('stale source-reset error does not cancel the pending new audio', async () => {
  let complete!: (audio: Blob) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const { player, audio } = setup({ synthesize: () => { entered(); return new Promise(resolve => { complete = resolve; }); } });
  const pending = player.preview();
  await started;
  audio.onerror?.(new Event('error'));
  complete(new Blob(['audio']));
  await pending;
  assert.equal(player.status, 'playing');
  assert.equal(audio.paused, false);
});

test('stale pause events do not interrupt a currently playing source', async () => {
  const { player, audio } = setup();
  await player.preview();
  audio.onpause?.(new Event('pause'));
  assert.equal(player.status, 'playing');
  audio.error = { code: 3 };
  audio.onerror?.(new Event('error'));
  assert.equal(player.status, 'error');
});

test('natural media pause before ended advances to the next chunk and completes the note', async () => {
  const { player, audio } = setup();
  await player.start('a.md');
  audio.ended = true;
  audio.paused = true;
  audio.onpause?.(new Event('pause'));
  audio.onended?.(new Event('ended'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(player.index, 1);
  assert.equal(player.status, 'playing');
  audio.ended = true;
  audio.paused = true;
  audio.onpause?.(new Event('pause'));
  audio.onended?.(new Event('ended'));
  assert.equal(player.status, 'finished');
});

test('resume restores position only for the same content and disposes URLs', async () => {
  const { player, audio, saved, revoked } = setup();
  await player.start('a.md', { path: 'a.md', hash: 'hash', chunk: 1, seconds: 7 });
  assert.equal(player.index, 1);
  assert.equal(audio.currentTime, 7);
  player.pause();
  assert.equal(saved.at(-1)?.seconds, 7);
  player.stop();
  assert.deepEqual(revoked, ['blob:test']);
  await player.start('a.md', { path: 'a.md', hash: 'old', chunk: 1, seconds: 7 });
  assert.equal(player.index, 0);
  assert.equal(audio.currentTime, 0);
  player.destroy();
});

test('automatic continuation advances across chunks and stops when the pool is exhausted', async () => {
  const { player, audio } = setup();
  await player.start('a.md');
  audio.onended?.(new Event('ended'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(player.index, 1);
  assert.equal(player.status, 'playing');
  player.continuous = true;
  audio.onended?.(new Event('ended'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(player.status, 'finished');
});

test('connection preview never starts random diary playback or stores a preview bookmark', async () => {
  let nextCalls = 0;
  const { player, audio, saved } = setup({ next: async () => { nextCalls++; return 'private.md'; } });
  player.continuous = true;
  await player.preview();
  audio.onended?.(new Event('ended'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nextCalls, 0);
  assert.equal(saved.length, 0);
  assert.equal(player.status, 'finished');
});