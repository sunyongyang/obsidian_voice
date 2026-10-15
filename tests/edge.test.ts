import assert from 'node:assert/strict';
import test from 'node:test';
import './browser-env';
import { synthesizeEdge } from '../src/edge';

test('desktop adapter returns audio without requiring Node workers', async () => {
  const audio = await synthesizeEdge('测试', 'zh-CN-XiaoxiaoNeural', new AbortController().signal,
    async (text, voice, options) => {
      assert.equal(text, '测试');
      assert.equal(voice, 'zh-CN-XiaoxiaoNeural');
      assert.equal(options.signal?.aborted, false);
      return { audio: new Uint8Array([1, 2, 3]) };
    });
  assert.equal(audio.type, 'audio/mpeg');
  assert.equal(audio.size, 3);
});

test('desktop cancellation aborts the actual generator signal', async () => {
  const controller = new AbortController();
  let internalSignal: AbortSignal | undefined;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = synthesizeEdge('test', 'voice', controller.signal,
    (_text, _voice, options) => {
      internalSignal = options.signal;
      entered();
      return new Promise(() => {});
    });
  await started;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(internalSignal?.aborted, true);
  await assert.rejects(async () => synthesizeEdge('test', 'voice', controller.signal), { name: 'AbortError' });
});

test('desktop failure and timeout stop the request without leaking raw errors', async () => {
  await assert.rejects(synthesizeEdge('test', 'voice', new AbortController().signal,
    async () => { throw new Error('secret text'); }), /在线连接失败/);
  let internalSignal: AbortSignal | undefined;
  await assert.rejects(synthesizeEdge('test', 'voice', new AbortController().signal,
    (_text, _voice, options) => { internalSignal = options.signal; return new Promise(() => {}); }, 10), /连接超时/);
  assert.equal(internalSignal?.aborted, true);
});