import { App, MarkdownView, Modal, normalizePath, Notice, Platform, Plugin, PluginSettingTab, requestUrl, Setting, setIcon, TFile, TFolder, type SettingDefinitionItem } from 'obsidian';
import { synthesizeEdge } from './edge';
import { inFolder, RandomRound, speechText } from './core';
import { NotePlayer, snapshotHash, type Bookmark, type Snapshot } from './player';
import { configScope, DEFAULT_ENGINE, ENGINE_LABELS, HTTP_PRESETS, serviceTarget, synthesize, usesMicrosoftVoices, validateConfig, VOICES, type HttpEngine, type HttpProfile, type SpeechConfig, type SpeechEngine } from './provider';

interface ListenerSettings {
  engine: SpeechEngine;
  profiles: Record<HttpEngine, HttpProfile>;
  region: string;
  voice: string;
  folders: string[];
  excludes: string[];
  recursive: boolean;
  revealTitle: boolean;
  speed: number;
}

interface StoredData {
  settings: ListenerSettings;
  bookmark: Bookmark | null;
}

const defaults: ListenerSettings = {
  engine: DEFAULT_ENGINE,
  profiles: { siliconflow: { ...HTTP_PRESETS.siliconflow }, doubao: { ...HTTP_PRESETS.doubao }, openai: { ...HTTP_PRESETS.openai } },
  region: 'eastasia', voice: 'zh-CN-XiaoxiaoNeural', folders: [], excludes: [],
  recursive: true, revealTitle: false, speed: 1,
};

const labels = {
  idle: '已停止', preparing: '准备中', playing: '播放中', paused: '已暂停',
  buffering: '正在获取音频', error: '无法播放', finished: '已完成',
};

export default class ListenerPlugin extends Plugin {
  settings: ListenerSettings = { ...defaults };
  bookmark: Bookmark | null = null;
  player!: NotePlayer;
  sessionKey = '';
  authorized = false;
  private authorizedScope = '';
  private serviceModal: ServiceModal | null = null;
  private credentialModals = new Set<CredentialModal>();
  private round = new RandomRound();
  private panel: PlayerModal | null = null;
  private audio!: HTMLAudioElement;
  private mediaActions: MediaSessionAction[] = [];
  private saveQueue: Promise<void> = Promise.resolve();
  private saveErrorShown = false;
  private disposed = false;
  private noteActions = new Map<MarkdownView, { play: HTMLElement; settings: HTMLElement }>();

  async onload(): Promise<void> {
    const stored = await this.loadData() as Partial<StoredData> | null;
    this.settings = { ...defaults, ...stored?.settings };
    if (!Object.hasOwn(ENGINE_LABELS, this.settings.engine)) this.settings.engine = DEFAULT_ENGINE;
    const storedProfiles = stored?.settings?.profiles;
    this.settings.profiles = Object.fromEntries(Object.entries(HTTP_PRESETS).map(([engine, preset]) => {
      const storedProfile = storedProfiles?.[engine as HttpEngine];
      const profile = Object.fromEntries(Object.entries(preset).map(([field, value]) => {
        const candidate = storedProfile?.[field as keyof HttpProfile];
        return [field, typeof candidate === 'string' ? candidate : value];
      }));
      return [engine, profile];
    })) as unknown as Record<HttpEngine, HttpProfile>;
    this.settings.folders = Array.isArray(this.settings.folders) ? this.settings.folders.filter(value => typeof value === 'string') : [];
    this.settings.excludes = Array.isArray(this.settings.excludes) ? this.settings.excludes.filter(value => typeof value === 'string') : [];
    if (!Object.hasOwn(VOICES, this.settings.voice)) this.settings.voice = defaults.voice;
    this.settings.speed = Number.isFinite(this.settings.speed) ? Math.min(2, Math.max(0.75, this.settings.speed)) : 1;
    this.bookmark = stored?.bookmark ?? null;
    this.audio = createEl('audio');
    this.audio.preload = 'auto';
    this.audio.setAttribute('playsinline', '');
    this.audio.addClass('note-listener-audio');
    document.body.appendChild(this.audio);
    this.player = new NotePlayer({
      audio: this.audio,
      read: path => this.readSnapshot(path),
      check: async path => { validateConfig(this.config()); if (path) await this.allowedText(path); },
      synthesize: (text, signal) => synthesize(text, this.config(), signal, async request => {
        const response = await requestUrl({ ...request, method: 'POST', throw: false });
        const contentType = Object.entries(response.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? '';
        return { status: response.status, contentType, data: response.arrayBuffer };
      }, 30000, (text, voice, signal) => this.edgeSpeech(text, voice, signal)),
      next: () => this.nextPath(),
      changed: () => this.changed(),
      bookmark: value => { this.bookmark = value; void this.persist(); },
      createUrl: blob => URL.createObjectURL(blob), revokeUrl: url => URL.revokeObjectURL(url),
    });
    this.player.setSpeed(this.settings.speed);
    this.addRibbonIcon('headphones', '笔记听读', () => this.showPanel());
    this.addCommand({ id: 'open-player', name: '打开听读面板', callback: () => this.showPanel() });
    this.addCommand({ id: 'read-current-note', name: '朗读当前笔记', checkCallback: checking => {
      const file = this.app.workspace.getActiveFile();
      if (!file || file.extension !== 'md') return false;
      if (!checking) { this.showPanel(); this.run(() => this.player.start(file.path)); }
      return true;
    } });
    this.addCommand({ id: 'random-note', name: '随机听一篇', callback: () => { this.showPanel(); this.run(() => this.player.random()); } });
    this.addCommand({ id: 'pause-resume', name: '暂停或继续', callback: () => {
      if (this.player.status === 'playing' || this.player.status === 'buffering') this.player.pause();
      else this.run(() => this.player.resume());
    } });
    this.addCommand({ id: 'stop', name: '停止朗读', callback: () => this.player.stop() });
    this.addSettingTab(new ListenerSettingTab(this.app, this));
    this.registerInterval(window.setInterval(() => this.player.tick(), 1000));
    this.registerEvent(this.app.vault.on('delete', file => {
      if (this.player.snapshot?.path === file.path || this.bookmark?.path === file.path) this.forget();
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (this.player.snapshot?.path === oldPath || this.bookmark?.path === oldPath) this.forget();
    }));
    this.registerEvent(this.app.vault.on('modify', file => {
      if (this.player.snapshot?.path !== file.path && this.bookmark?.path !== file.path) return;
      void this.allowedText(file.path).catch(() => this.forget());
    }));
    this.registerDomEvent(document, 'visibilitychange', () => { this.player.tick(); });
    this.registerEvent(this.app.workspace.on('layout-change', () => this.refreshNoteActions()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.refreshNoteActions()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refreshNoteActions()));
    this.app.workspace.onLayoutReady(() => this.refreshNoteActions());
    this.installMediaSession();
  }

  onunload(): void {
    this.disposed = true;
    this.panel?.close();
    this.serviceModal?.close();
    for (const modal of this.credentialModals) modal.close();
    this.credentialModals.clear();
    this.player?.destroy();
    for (const action of this.noteActions.values()) { action.play.remove(); action.settings.remove(); }
    this.noteActions.clear();
    this.audio?.remove();
    this.sessionKey = '';
    this.authorized = false;
    this.authorizedScope = '';
    if ('mediaSession' in navigator) {
      for (const action of this.mediaActions) {
        try { navigator.mediaSession.setActionHandler(action, null); } catch { continue; }
      }
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    }
  }

  config(): SpeechConfig {
    const profile = usesMicrosoftVoices(this.settings.engine) ? undefined : this.settings.profiles[this.settings.engine as HttpEngine];
    const config: SpeechConfig = { engine: this.settings.engine, desktop: Platform.isDesktopApp, region: this.settings.region,
      voice: profile?.voice ?? this.settings.voice, key: this.sessionKey, authorized: this.authorized, profile: profile ? { ...profile } : undefined };
    config.authorized = this.authorized && this.authorizedScope === configScope(config);
    return config;
  }

  grantSession(key: string, expectedScope: string): void {
    if (this.disposed || expectedScope !== configScope(this.config())) throw new Error('服务配置已变化，请重新打开授权窗口。');
    const config = { ...this.config(), authorized: true, key };
    validateConfig(config);
    this.player.stop(true);
    this.sessionKey = key.trim();
    this.authorized = true;
    this.authorizedScope = configScope(config);
    this.changed();
  }

  setEngine(engine: SpeechEngine): void {
    if (!Object.hasOwn(ENGINE_LABELS, engine) || engine === this.settings.engine) return;
    this.settings.engine = engine;
    this.settingsChanged(true);
    this.changed();
  }

  setProfileField(field: keyof HttpProfile, value: string): void {
    if (usesMicrosoftVoices(this.settings.engine)) return;
    const profile = this.settings.profiles[this.settings.engine as HttpEngine];
    if (field === 'voice') { this.setVoice(value); return; }
    if (profile[field] === value) return;
    if (field === 'authMode') {
      if (value !== 'api-key' && value !== 'app-token') return;
      profile.authMode = value;
    } else profile[field] = value;
    this.settingsChanged(true);
    this.changed();
  }

  private async edgeSpeech(text: string, voice: string, signal: AbortSignal): Promise<Blob> {
    if (!Platform.isDesktopApp) throw new Error('Edge TTS 直连目前仅支持桌面 Obsidian。');
    return synthesizeEdge(text, voice, signal);
  }

  persist(): Promise<void> {
    const data: StoredData = { settings: { ...this.settings }, bookmark: this.bookmark ? { ...this.bookmark } : null };
    this.saveQueue = this.saveQueue.then(() => this.saveData(data)).catch(() => {
      if (!this.saveErrorShown && !this.disposed) new Notice('听读设置或进度保存失败，请检查仓库写入权限。');
      this.saveErrorShown = true;
    });
    return this.saveQueue;
  }

  settingsChanged(revoke = false): void {
    this.player.stop(true);
    this.bookmark = null;
    this.round.reset();
    if (revoke) { this.authorized = false; this.authorizedScope = ''; this.sessionKey = ''; }
    void this.persist();
  }

  setVoice(voice: string): void {
    const native = usesMicrosoftVoices(this.settings.engine);
    if (native && !Object.hasOwn(VOICES, voice)) return;
    const profile = native ? undefined : this.settings.profiles[this.settings.engine as HttpEngine];
    const nextVoice = voice.trim();
    if (nextVoice === (profile?.voice ?? this.settings.voice)) return;
    this.player.stop();
    if (profile) profile.voice = nextVoice;
    else this.settings.voice = nextVoice;
    if (this.bookmark) this.bookmark = { ...this.bookmark, seconds: 0 };
    void this.persist();
    this.changed();
  }

  forget(): void {
    this.player.stop(true);
    this.bookmark = null;
    void this.persist();
    this.changed();
  }

  run(action: () => Promise<unknown>): void {
    void action().catch(() => { new Notice('操作失败，请检查设置并重试。'); });
  }

  showPanel(): void {
    if (this.panel) { this.panel.render(); return; }
    this.panel = new PlayerModal(this.app, this, () => { this.panel = null; });
    this.panel.open();
  }

  resetRound(): void { this.round.reset(); new Notice('已开始新一轮随机听读。'); }

  showCredentials(afterAuthorized?: () => void): void {
    const modal = new CredentialModal(this.app, this, afterAuthorized, () => this.credentialModals.delete(modal));
    this.credentialModals.add(modal);
    modal.open();
  }

  showServices(): void {
    if (this.serviceModal) { this.serviceModal.render(); return; }
    this.serviceModal = new ServiceModal(this.app, this, () => { this.serviceModal = null; });
    this.serviceModal.open();
  }

  toggleNote(path: string): void {
    const sameNote = this.player.snapshot?.path === path;
    if (sameNote && ['playing', 'buffering', 'preparing'].includes(this.player.status)) {
      this.player.pause();
      return;
    }
    if (!this.config().authorized) {
      this.showCredentials(() => this.toggleNote(path));
      return;
    }
    if (sameNote && this.player.status !== 'finished') this.run(() => this.player.resume());
    else this.run(() => this.player.start(path, !this.player.snapshot && this.bookmark?.path === path ? this.bookmark : undefined));
  }

  private refreshNoteActions(): void {
    if (this.disposed || !this.player) return;
    const views = new Set(this.app.workspace.getLeavesOfType('markdown')
      .map(leaf => leaf.view).filter((view): view is MarkdownView => view instanceof MarkdownView && !!view.file));
    for (const [view, actions] of this.noteActions) {
      if (!views.has(view) || !view.containerEl.contains(actions.play) || !view.containerEl.contains(actions.settings)) {
        actions.play.remove(); actions.settings.remove(); this.noteActions.delete(view);
      }
    }
    for (const view of views) {
      let actions = this.noteActions.get(view);
      if (!actions) {
        const play = view.addAction('play', '朗读当前笔记', () => {
          if (view.file) this.toggleNote(view.file.path);
        });
        const settings = view.addAction('audio-lines', '音色与播放设置', () => this.showPanel());
        play.addClass('note-listener-note-action');
        play.dataset.noteListenerAction = 'play';
        settings.dataset.noteListenerAction = 'settings';
        actions = { play, settings };
        this.noteActions.set(view, actions);
      }
      const playing = this.player.snapshot?.path === view.file?.path && ['playing', 'buffering', 'preparing'].includes(this.player.status);
      const label = playing ? '暂停朗读当前笔记' : '朗读当前笔记';
      setIcon(actions.play, playing ? 'pause' : 'play');
      actions.play.setAttribute('aria-label', label);
      actions.play.setAttribute('aria-pressed', String(playing));
      actions.settings.setAttribute('aria-label', '音色与播放设置');
    }
  }

  async readCurrent(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') { new Notice('请先打开一篇 Markdown 笔记。'); return; }
    await this.player.start(file.path);
  }

  private async allowedText(path: string): Promise<ReturnType<typeof speechText>> {
    const file = this.app.vault.getFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== 'md') throw new Error('笔记不存在或不是 Markdown 文件。');
    if (this.settings.excludes.some(folder => inFolder(path, folder))) throw new Error('这篇笔记位于排除目录。');
    const text = speechText(await this.app.vault.read(file));
    if (!text.allowed) throw new Error('这篇笔记已通过 tts: false 禁止听读。');
    return text;
  }

  private async readSnapshot(path: string): Promise<Snapshot> {
    validateConfig(this.config());
    const text = await this.allowedText(path);
    const title = this.app.vault.getFileByPath(path)!.basename;
    const chunks = text.chunks.length ? [`${title}。`, ...text.chunks] : [];
    return { path, title, chunks, hash: await snapshotHash(chunks) };
  }

  private async nextPath(): Promise<string | null> {
    validateConfig(this.config());
    if (!this.settings.folders.length) throw new Error('请先在插件设置中选择随机听读目录。');
    const candidates = new Set<string>();
    const visited = new Set<string>();
    for (const folder of this.settings.folders) {
      const path = normalizePath(folder);
      const root = path ? this.app.vault.getAbstractFileByPath(path) : this.app.vault.getRoot();
      if (!(root instanceof TFolder)) continue;
      const pending = [root];
      while (pending.length) {
        const current = pending.pop()!;
        if (visited.has(current.path) || this.settings.excludes.some(excluded => inFolder(current.path, excluded))) continue;
        visited.add(current.path);
        for (const entry of current.children) {
          if (this.settings.excludes.some(excluded => inFolder(entry.path, excluded))) continue;
          if (entry instanceof TFile && entry.extension === 'md') candidates.add(entry.path);
          else if (entry instanceof TFolder && this.settings.recursive) pending.push(entry);
        }
      }
    }
    const paths = [...candidates];
    for (let attempt = 0; attempt < paths.length; attempt++) {
      const path = this.round.next(paths);
      if (!path) return null;
      try { if ((await this.allowedText(path)).chunks.length) return path; } catch { continue; }
    }
    return null;
  }

  private changed(): void {
    if (this.disposed) return;
    this.refreshNoteActions();
    this.panel?.render();
    if (!this.player || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.settings.revealTitle ? this.player.snapshot?.title ?? '笔记听读' : '笔记听读',
        artist: 'Note Listener',
      });
      navigator.mediaSession.playbackState = this.player.status === 'playing' ? 'playing'
        : this.player.status === 'paused' ? 'paused' : 'none';
    } catch { return; }
  }

  private installMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    const handlers: Partial<Record<MediaSessionAction, () => void>> = {
      play: () => this.run(() => this.player.resume()), pause: () => this.player.pause(),
      stop: () => this.player.stop(), nexttrack: () => this.run(() => this.player.random()),
      previoustrack: () => this.run(() => this.player.seekChunk(-1)),
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler);
        this.mediaActions.push(action as MediaSessionAction);
      } catch { continue; }
    }
  }
}

class PlayerModal extends Modal {
  constructor(app: App, private readonly plugin: ListenerPlugin, private readonly closed: () => void) { super(app); }

  onOpen(): void { this.modalEl.addClass('note-listener-modal'); this.setTitle('笔记听读'); this.render(); }

  render(): void {
    const focused = this.contentEl.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.action : undefined;
    this.contentEl.empty();
    this.contentEl.addClass('note-listener');
    const player = this.plugin.player;
    if (!player) return;
    this.contentEl.dataset.state = player.status;
    const heading = this.contentEl.createDiv({ cls: 'note-listener-heading' });
    setIcon(heading.createSpan({ cls: 'note-listener-mark' }), 'headphones');
    heading.createEl('h3', { text: player.snapshot?.title ?? '尚未选择笔记' });
    const meta = this.contentEl.createDiv({ cls: 'note-listener-meta' });
    const status = meta.createDiv({ cls: 'note-listener-status', attr: { role: 'status' } });
    status.createSpan({ cls: 'note-listener-status-dot', attr: { 'aria-hidden': 'true' } });
    status.createSpan({ text: labels[player.status] });
    if (player.snapshot) {
      meta.createSpan({ cls: 'note-listener-position', text: `${player.index + 1} / ${player.snapshot.chunks.length} 段` });
      this.contentEl.createEl('progress', { attr: { max: String(player.snapshot.chunks.length), value: String(player.index + 1), 'aria-label': '段落进度' } });
      this.contentEl.createEl('p', { cls: 'note-listener-text', text: player.snapshot.chunks[player.index] ?? '' });
    }
    if (player.message) this.contentEl.createEl('p', { cls: 'note-listener-message', text: player.message, attr: { role: 'status' } });
    const controls = this.contentEl.createDiv({ cls: 'note-listener-controls' });
    const button = (icon: string, title: string, action: () => void, disabled = false): void => {
      const element = controls.createEl('button', { attr: { 'aria-label': title, title, 'data-action': icon } });
      setIcon(element, icon);
      element.disabled = disabled;
      element.addEventListener('click', action);
    };
    button('square', '停止', () => player.stop());
    button('skip-back', '上一段', () => this.plugin.run(() => player.seekChunk(-1)), !player.snapshot || player.index === 0);
    const active = player.status === 'playing' || player.status === 'buffering' || player.status === 'preparing';
    button(active ? 'pause' : 'play', active ? '暂停' : '继续或重试', () => {
      if (active) player.pause();
      else if (player.snapshot) this.plugin.run(() => player.resume());
      else if (this.plugin.bookmark) this.plugin.run(() => player.start(this.plugin.bookmark!.path, this.plugin.bookmark!));
      else this.plugin.run(() => this.plugin.readCurrent());
    });
    button('skip-forward', '下一段', () => this.plugin.run(() => player.seekChunk(1)), !player.snapshot || player.index + 1 >= player.snapshot.chunks.length);
    button('shuffle', '随机换一篇', () => this.plugin.run(() => player.random()));
    const preferences = this.contentEl.createDiv({ cls: 'note-listener-preferences' });
    if (usesMicrosoftVoices(this.plugin.settings.engine)) {
      new Setting(preferences).setName('音色').addDropdown(dropdown => {
        dropdown.selectEl.setAttribute('aria-label', '朗读音色');
        dropdown.selectEl.dataset.action = 'voice';
        dropdown.addOptions(VOICES).setValue(this.plugin.settings.voice).onChange(value => this.plugin.setVoice(value));
      });
    } else {
      new Setting(preferences).setName('音色').setDesc(this.plugin.config().voice || '未配置').addButton(button => button.setButtonText('更改').onClick(() => this.plugin.showServices()));
    }
    new Setting(preferences).setName('倍速').addDropdown(dropdown => {
      dropdown.selectEl.setAttribute('aria-label', '播放倍速');
      dropdown.selectEl.dataset.action = 'speed';
      for (const speed of [0.75, 1, 1.25, 1.5, 1.75, 2]) dropdown.addOption(String(speed), `${speed}x`);
      dropdown.setValue(String(player.speed)).onChange(value => {
        player.setSpeed(Number(value)); this.plugin.settings.speed = player.speed; void this.plugin.persist();
      });
    });
    new Setting(preferences).setName('连续随机播放').addToggle(toggle => {
      toggle.toggleEl.dataset.action = 'continuous';
      toggle.setValue(player.continuous).onChange(value => { player.continuous = value; });
    });
    const actions = this.contentEl.createDiv({ cls: 'note-listener-actions' });
    const command = (icon: string, label: string, action: () => void): void => {
      const element = actions.createEl('button', { attr: { 'data-action': icon } });
      setIcon(element.createSpan({ cls: 'note-listener-command-icon', attr: { 'aria-hidden': 'true' } }), icon);
      element.createSpan({ text: label });
      element.addEventListener('click', action);
    };
    command('book-open', '朗读当前笔记', () => this.plugin.run(() => this.plugin.readCurrent()));
    command('volume-2', '试听音色', () => this.plugin.run(() => player.preview()));
    command('sliders-horizontal', '语音服务配置', () => this.plugin.showServices());
    command('shield-check', '连接与授权', () => this.plugin.showCredentials());
    command('rotate-ccw', '新一轮随机', () => this.plugin.resetRound());
    if (player.snapshot) command('file-text', '打开原文', () => {
      const file = this.app.vault.getFileByPath(player.snapshot!.path);
      if (file) this.plugin.run(() => this.app.workspace.getLeaf(false).openFile(file));
    });
    const diagnostics = this.contentEl.createEl('details', { cls: 'note-listener-diagnostics' });
    diagnostics.createEl('summary', { text: '连接状态' });
    diagnostics.createDiv({ text: `${ENGINE_LABELS[this.plugin.settings.engine]} · ${this.plugin.config().authorized ? '本次会话已授权' : '未授权'} · 媒体会话 ${'mediaSession' in navigator ? '接口存在，锁屏未验收' : '接口不可用'}` });
    if (focused) this.contentEl.querySelector<HTMLElement>(`[data-action="${focused}"]`)?.focus();
  }

  onClose(): void { this.contentEl.empty(); this.closed(); }
}

class CredentialModal extends Modal {
  constructor(app: App, private readonly plugin: ListenerPlugin, private readonly afterAuthorized?: () => void, private readonly closed?: () => void) { super(app); }

  onOpen(): void {
    this.setTitle('在线朗读授权');
    const { contentEl } = this;
    const engine = this.plugin.settings.engine;
    const scope = configScope(this.plugin.config());
    let target: string;
    try { target = serviceTarget(this.plugin.config()); }
    catch (error) { contentEl.createEl('p', { text: error instanceof Error ? error.message : '请先配置服务。' }); return; }
    contentEl.createEl('p', { text: engine === 'edge'
      ? '朗读会把当前笔记标题、正文片段及下一段预取发送到 Microsoft Edge 在线朗读服务。不需要 Azure 账号或密钥，但不是离线模型，也不保证服务永久免费或长期可用。此直连适配器仅支持桌面端。'
      : `朗读会把当前笔记标题、正文片段及下一段预取发送到 ${target}，可能产生你账户上的费用。不发送全库。密钥仅留在本次插件会话内存，重启后需重新输入。` });
    let key = '';
    let agreed = false;
    if (engine !== 'edge') {
      const legacy = engine === 'doubao' && this.plugin.config().profile?.authMode === 'app-token';
      new Setting(contentEl).setName(engine === 'azure' ? 'Azure Speech 密钥' : legacy ? 'Access Token' : 'API Key').addText(text => {
        text.inputEl.type = 'password';
        text.inputEl.autocomplete = 'off';
        text.onChange(value => { key = value; });
      });
    }
    new Setting(contentEl).setName(engine === 'edge' ? '同意发送到 Edge 在线朗读服务' : '同意向当前服务发送文字并承担可能的费用').addToggle(toggle => toggle.onChange(value => { agreed = value; }));
    new Setting(contentEl).addButton(button => button.setButtonText('启用本次会话').setCta().onClick(() => {
      try {
        if (!agreed) throw new Error('请先同意在线朗读授权。');
        this.plugin.grantSession(key, scope);
        key = '';
        this.close();
        if (this.afterAuthorized) this.afterAuthorized();
        else this.plugin.showPanel();
      } catch (error) { new Notice(error instanceof Error ? error.message : '配置无效。'); }
    }));
  }

  onClose(): void { this.contentEl.empty(); this.closed?.(); }
}

class ServiceModal extends Modal {
  constructor(app: App, private readonly plugin: ListenerPlugin, private readonly closed: () => void) { super(app); }

  onOpen(): void { this.setTitle('语音服务配置'); this.modalEl.addClass('note-listener-service-modal'); this.render(); }

  render(): void {
    const container = this.contentEl;
    container.empty();
    const settings = this.plugin.settings;
    new Setting(container).setName('服务平台').addDropdown(dropdown => dropdown.addOptions(ENGINE_LABELS).setValue(settings.engine).onChange(value => {
      this.plugin.setEngine(value as SpeechEngine); this.render();
    }));
    const textField = (name: string, value: string, update: (value: string) => void, description = ''): void => {
      new Setting(container).setName(name).setDesc(description).addText(text => {
        text.setValue(value);
        text.inputEl.setAttribute('aria-label', name);
        text.inputEl.addEventListener('change', () => update(text.getValue().trim()));
      });
    };
    if (usesMicrosoftVoices(settings.engine)) {
      if (settings.engine === 'azure') textField('Azure 区域', settings.region, value => { settings.region = value; this.plugin.settingsChanged(true); }, '例如 eastasia，须与 Speech 资源一致。');
      new Setting(container).setName('音色').addDropdown(dropdown => dropdown.addOptions(VOICES).setValue(settings.voice).onChange(value => this.plugin.setVoice(value)));
    } else {
      const profile = settings.profiles[settings.engine as HttpEngine];
      textField('完整接口地址', profile.endpoint, value => this.plugin.setProfileField('endpoint', value), '只接受 HTTPS。填写完整合成地址，不是平台主页或 Base URL。');
      if (settings.engine === 'doubao') {
        new Setting(container).setName('鉴权方式').addDropdown(dropdown => dropdown.addOption('api-key', '新版 API Key').addOption('app-token', '旧版 App ID + Access Token').setValue(profile.authMode).onChange(value => { this.plugin.setProfileField('authMode', value); this.render(); }));
        textField('资源 ID', profile.resourceId, value => this.plugin.setProfileField('resourceId', value), '例如 seed-tts-2.0，必须匹配已开通的音色与模型版本。');
        if (profile.authMode === 'app-token') textField('App ID', profile.appId, value => this.plugin.setProfileField('appId', value));
        textField('模型 ID（可选）', profile.model, value => this.plugin.setProfileField('model', value), '多数豆包模型由资源 ID 选择，仅在接口要求 req_params.model 时填写。');
      } else textField('TTS 模型 ID', profile.model, value => this.plugin.setProfileField('model', value));
      textField('音色 ID', profile.voice, value => this.plugin.setVoice(value), settings.engine === 'siliconflow' ? '系统音色通常包含模型前缀，例如 FunAudioLLM/CosyVoice2-0.5B:alex。' : '填写平台已授权的音色或 speaker ID，不是 Edge 音色。');
    }
    new Setting(container).setName('本次会话凭据').addButton(button => button.setButtonText(settings.engine === 'edge' ? '授权在线朗读' : '输入凭据并授权').onClick(() => this.plugin.showCredentials()));
    new Setting(container).setName('固定文本测试').addButton(button => button.setButtonText('试听当前配置').onClick(() => this.plugin.run(() => this.plugin.player.preview())));
  }

  onClose(): void { this.contentEl.empty(); this.closed(); }
}

class ListenerSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ListenerPlugin) { super(app, plugin); }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      { name: '语音服务', desc: ENGINE_LABELS[this.plugin.settings.engine], aliases: ['TTS', 'voice', 'model', 'Edge', 'Azure', 'SiliconFlow', 'Doubao'], action: () => this.plugin.showServices() },
      { name: '随机听读目录', desc: '仓库相对路径，每行一个目录。留空不扫描；/ 明确表示整个仓库。', aliases: ['folders', 'random review'], control: { type: 'textarea', key: 'folders', rows: 3 } },
      { name: '排除目录', aliases: ['excluded folders', 'privacy'], control: { type: 'textarea', key: 'excludes', rows: 3 } },
      { name: '包含子目录', aliases: ['recursive', 'subfolders'], control: { type: 'toggle', key: 'recursive' } },
      { name: '锁屏显示真实标题', aliases: ['lock screen', 'title', 'privacy'], control: { type: 'toggle', key: 'revealTitle' } },
      { name: '本次会话授权', aliases: ['API key', 'consent', 'authorization'], action: () => this.plugin.showCredentials() },
      { name: '撤回授权', aliases: ['revoke', 'credentials'], action: () => { this.plugin.settingsChanged(true); new Notice('本次会话授权已撤回。'); } },
      { name: '播放历史', desc: '清除进度与内存音频。', aliases: ['history', 'clear progress'], action: () => this.plugin.forget() },
    ];
  }

  getControlValue(key: string): unknown {
    if (key === 'folders' || key === 'excludes') return this.plugin.settings[key].join('\n');
    if (key === 'recursive' || key === 'revealTitle') return this.plugin.settings[key];
    return undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if ((key === 'folders' || key === 'excludes') && typeof value === 'string') {
      this.plugin.settings[key] = value.split(/\r?\n/).map(path => path.trim()).filter(Boolean).map(normalizePath).map(path => path || '/');
      this.plugin.settingsChanged();
    } else if (key === 'recursive' && typeof value === 'boolean') {
      this.plugin.settings.recursive = value;
      this.plugin.settingsChanged();
    } else if (key === 'revealTitle' && typeof value === 'boolean') {
      this.plugin.settings.revealTitle = value;
      await this.plugin.persist();
    }
  }
}