import assert from 'node:assert/strict';
import test from 'node:test';
import { NotePlayer, type AudioPort, type Bookmark, type PlayerDependencies } from '../src/player';
import { synthesize, type SpeechConfig } from '../src/provider';

const config: SpeechConfig = { region: 'eastasia', voice: 'zh-CN-XiaoxiaoNeural', key: 'test-only', authorized: true };
const audioResponse = () => ({ status: 200, contentType: 'audio/mpeg', data: new Uint8Array([1, 2, 3]).buffer });

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
    src: '', currentTime: 0, playbackRate: 1, paused: true,
    onended: null, onerror: null, onpause: null, onplaying: null, onloadedmetadata: null,
    async play() { this.paused = false; this.onplaying?.(new Event('playing')); },
    pause() { this.paused = true; this.onpause?.(new Event('pause')); },
    load() { this.currentTime = 0; this.onloadedmetadata?.(new Event('loadedmetadata')); },
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