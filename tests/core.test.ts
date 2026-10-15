import assert from 'node:assert/strict';
import test from 'node:test';
import { digestText, eligiblePath, escapeXml, inFolder, RandomRound, speechText, splitSpeech } from '../src/core';

test('private notes never produce speech', () => {
  assert.deepEqual(speechText('---\ntts: false\n---\n秘密'), { allowed: false, text: '', chunks: [] });
  assert.throws(() => speechText('---\na: [\n---\n正文'), /YAML/);
});

test('markdown becomes readable text without private metadata, code or URLs', () => {
  const result = speechText('---\ntitle: 隐藏属性\n---\n# 标题\n\n正文 **重点** [链接](https://example.com) [[目录/笔记#标题|别名]]。\n\nhttps://example.com\n\n- [x] 完成\n\n```js\nsecret()\n```\n\n![[image.png]]\n\n<!-- secret -->\n\n%%私密注释%%\n\n| a | b |\n| - | - |\n| 1 | 2 |');
  assert.match(result.text, /标题/);
  assert.match(result.text, /正文 重点 链接 别名/);
  assert.match(result.text, /完成/);
  assert.doesNotMatch(result.text, /secret|https|隐藏属性|image|私密|\[x\]|\|/);
});

test('chunk limits preserve Unicode characters and content', () => {
  const text = '中文😀'.repeat(230);
  const chunks = splitSpeech(text, 50);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(chunk => Array.from(chunk).length <= 50));
  assert.deepEqual(splitSpeech('   '), []);
});

test('folder boundaries, recursion and empty include list are respected', () => {
  assert.equal(inFolder('日记本/a.md', '日记'), false);
  assert.equal(inFolder('日记/旧/a.md', '日记', false), false);
  assert.equal(eligiblePath('日记/a.md', ['日记'], ['日记/私密'], true), true);
  assert.equal(eligiblePath('日记/私密/a.md', ['日记'], ['日记/私密'], true), false);
  assert.equal(eligiblePath('a.md', [], [], true), false);
});

test('random round never repeats, notices new files and stops at exhaustion', () => {
  const round = new RandomRound();
  assert.equal(round.next(['a', 'b'], () => 0), 'a');
  assert.equal(round.next(['a', 'b'], () => 0), 'b');
  assert.equal(round.next(['a', 'b']), null);
  assert.equal(round.next(['a', 'c'], () => 0), 'c');
  round.reset();
  assert.equal(round.next(['a'], () => 0), 'a');
});

test('SSML escaping and content digest', async () => {
  assert.equal(escapeXml('<&"\'>'), '&lt;&amp;&quot;&apos;&gt;');
  assert.equal(await digestText('a'), await digestText('a'));
  assert.notEqual(await digestText('a'), await digestText('b'));
});