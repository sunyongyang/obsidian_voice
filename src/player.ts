import { digestText } from './core';

export interface Snapshot {
  path: string;
  title: string;
  chunks: string[];
  hash: string;
}

export interface Bookmark {
  path: string;
  hash: string;
  chunk: number;
  seconds: number;
}

export type PlayerStatus = 'idle' | 'preparing' | 'playing' | 'paused' | 'buffering' | 'error' | 'finished';

export interface AudioPort {
  src: string;
  currentTime: number;
  playbackRate: number;
  paused: boolean;
  ended: boolean;
  error: { code: number } | null;
  onended: ((event: Event) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  onpause: ((event: Event) => unknown) | null;
  onplaying: ((event: Event) => unknown) | null;
  onloadedmetadata: ((event: Event) => unknown) | null;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
}

export interface PlayerDependencies {
  audio: AudioPort;
  read: (path: string) => Promise<Snapshot>;
  check: (path: string) => Promise<void>;
  synthesize: (text: string, signal: AbortSignal) => Promise<Blob>;
  next: () => Promise<string | null>;
  changed: () => void;
  bookmark: (value: Bookmark) => void;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
}

export class NotePlayer {
  status: PlayerStatus = 'idle';
  message = '';
  snapshot: Snapshot | null = null;
  index = 0;
  continuous = false;
  speed = 1;
  private generation = 0;
  private controller = new AbortController();
  private url = '';
  private wanted = false;
  private ready = false;
  private savedAt = 0;
  private loading: Promise<void> | null = null;
  private prefetch: { index: number; promise: Promise<Blob | null> } | null = null;

  constructor(private readonly dependencies: PlayerDependencies) {
    const audio = dependencies.audio;
    audio.onended = () => { this.persist(); void this.advance(); };
    audio.onerror = () => {
      if (!this.ready || !this.url || !audio.error) return;
      this.ready = false;
      this.fail(new Error('音频无法解码或播放，请重试当前段。'));
    };
    audio.onpause = () => {
      if (this.status === 'playing' && audio.paused && !audio.ended) {
        this.wanted = false;
        this.status = 'paused';
        this.persist();
        this.emit();
      }
    };
    audio.onplaying = () => {
      if (!this.ready || audio.paused) return;
      if (!this.wanted) { audio.pause(); return; }
      this.status = 'playing';
      this.emit();
    };
  }

  async start(path: string, bookmark?: Bookmark, autoplay = true): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.wanted = autoplay;
    this.status = autoplay ? 'preparing' : 'paused';
    this.message = '';
    this.emit();
    try {
      const snapshot = await this.dependencies.read(path);
      if (generation !== this.generation) return;
      if (!snapshot.chunks.length) throw new Error('这篇笔记没有可朗读的正文。');
      this.snapshot = snapshot;
      const restore = bookmark?.path === path && bookmark.hash === snapshot.hash &&
        Number.isInteger(bookmark.chunk) && bookmark.chunk >= 0 && bookmark.chunk < snapshot.chunks.length;
      this.index = restore ? bookmark.chunk : 0;
      if (bookmark && !restore) this.message = '正文已变化或进度失效，从头开始。';
      await this.loadChunk(restore ? Math.max(0, bookmark.seconds) : 0);
    } catch (error) { if (generation === this.generation) this.fail(error); }
  }

  async resume(): Promise<void> {
    if (!this.snapshot) return;
    this.wanted = true;
    const generation = this.generation;
    try {
      await this.dependencies.check(this.snapshot.path);
      if (generation !== this.generation) return;
      if (!this.ready) await this.loadChunk();
      else {
        await this.dependencies.audio.play();
        if (generation !== this.generation) return;
        this.status = this.wanted ? 'playing' : 'paused';
        this.emit();
      }
    } catch (error) { if (generation === this.generation) this.fail(error); }
  }

  async preview(): Promise<void> {
    this.stop(true);
    this.snapshot = { path: '', title: '连接测试', chunks: ['你好，这是笔记听读的连接测试。'], hash: 'preview' };
    this.index = 0;
    this.wanted = true;
    await this.loadChunk();
  }

  pause(): void {
    this.wanted = false;
    this.dependencies.audio.pause();
    if (this.snapshot || this.status === 'preparing' || this.status === 'buffering') this.status = 'paused';
    this.persist();
    this.emit();
  }

  stop(clear = false): void {
    this.persist();
    this.wanted = false;
    this.generation++;
    this.controller.abort();
    this.controller = new AbortController();
    this.dependencies.audio.pause();
    this.dependencies.audio.removeAttribute('src');
    this.dependencies.audio.load();
    this.ready = false;
    this.loading = null;
    this.prefetch = null;
    if (this.url) this.dependencies.revokeUrl(this.url);
    this.url = '';
    if (clear) this.snapshot = null;
    this.status = 'idle';
    this.message = '';
    this.emit();
  }

  async seekChunk(offset: number): Promise<void> {
    if (!this.snapshot) return;
    const snapshot = this.snapshot;
    const target = this.index + offset;
    if (target < 0 || target >= snapshot.chunks.length) return;
    this.stop();
    this.snapshot = snapshot;
    this.index = target;
    this.wanted = true;
    await this.loadChunk();
  }

  async random(): Promise<void> {
    this.stop(true);
    const generation = this.generation;
    this.wanted = true;
    this.status = 'preparing';
    this.emit();
    try {
      const path = await this.dependencies.next();
      if (generation !== this.generation) return;
      if (path) await this.start(path, undefined, this.wanted);
      else { this.status = 'finished'; this.message = '本轮已听完，或所选范围没有可朗读笔记。'; this.emit(); }
    } catch (error) { if (generation === this.generation) this.fail(error); }
  }

  tick(): void {
    if (this.status === 'playing' && Date.now() - this.savedAt >= 5000) this.persist();
  }

  setSpeed(speed: number): void {
    this.speed = Math.min(2, Math.max(0.75, speed));
    this.dependencies.audio.playbackRate = this.speed;
    this.emit();
  }

  destroy(): void {
    this.stop(true);
    const audio = this.dependencies.audio;
    audio.onended = audio.onerror = audio.onpause = audio.onplaying = audio.onloadedmetadata = null;
  }

  private loadChunk(seconds = 0): Promise<void> {
    if (this.loading) return this.loading;
    const pending = this.prepareChunk(seconds);
    this.loading = pending;
    void pending.finally(() => { if (this.loading === pending) this.loading = null; });
    return pending;
  }

  private async prepareChunk(seconds = 0): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    const generation = this.generation;
    const index = this.index;
    this.status = this.wanted ? 'buffering' : 'paused';
    this.ready = false;
    this.emit();
    try {
      await this.dependencies.check(snapshot.path);
      if (generation !== this.generation) return;
      const cached = this.prefetch?.index === index ? await this.prefetch.promise : null;
      if (generation !== this.generation) return;
      const blob = cached ?? await this.dependencies.synthesize(snapshot.chunks[index], this.controller.signal);
      if (generation !== this.generation) return;
      this.prefetch = null;
      const audio = this.dependencies.audio;
      audio.pause();
      if (this.url) this.dependencies.revokeUrl(this.url);
      this.url = this.dependencies.createUrl(blob);
      audio.src = this.url;
      audio.playbackRate = this.speed;
      audio.onloadedmetadata = () => {
        if (generation === this.generation && Number.isFinite(seconds)) audio.currentTime = seconds;
      };
      audio.load();
      this.ready = true;
      if (!this.wanted) { this.status = 'paused'; this.emit(); return; }
      await audio.play();
      if (generation !== this.generation) return;
      if (!this.wanted) { audio.pause(); return; }
      this.status = 'playing';
      this.emit();
      if (index + 1 < snapshot.chunks.length) {
        this.prefetch = {
          index: index + 1,
          promise: this.prefetchChunk(snapshot, index + 1, generation),
        };
      }
    } catch (error) { if (generation === this.generation) this.fail(error); }
  }

  private async prefetchChunk(snapshot: Snapshot, index: number, generation: number): Promise<Blob | null> {
    try {
      await this.dependencies.check(snapshot.path);
      if (generation !== this.generation || !this.wanted) return null;
      return await this.dependencies.synthesize(snapshot.chunks[index], this.controller.signal);
    } catch { return null; }
  }

  private async advance(): Promise<void> {
    if (!this.snapshot || !this.wanted) return;
    if (this.index + 1 < this.snapshot.chunks.length) {
      this.index++;
      await this.loadChunk();
    } else if (this.continuous && this.snapshot.path) await this.random();
    else {
      this.wanted = false;
      this.status = 'finished';
      this.message = '本篇已读完。';
      this.emit();
    }
  }

  private persist(): void {
    if (!this.snapshot?.path || !this.ready) return;
    this.savedAt = Date.now();
    this.dependencies.bookmark({
      path: this.snapshot.path, hash: this.snapshot.hash, chunk: this.index,
      seconds: Number.isFinite(this.dependencies.audio.currentTime) ? this.dependencies.audio.currentTime : 0,
    });
  }

  private fail(error: unknown): void {
    this.wanted = false;
    this.dependencies.audio.pause();
    this.status = 'error';
    this.message = error instanceof DOMException && error.name === 'NotAllowedError'
      ? '系统需要再次点击播放，请点击继续。'
      : error instanceof Error ? error.message : '播放失败，请重试。';
    this.emit();
  }

  private emit(): void { this.dependencies.changed(); }
}

export async function snapshotHash(chunks: string[]): Promise<string> {
  return digestText(`parser-v1\n${JSON.stringify(chunks)}`);
}