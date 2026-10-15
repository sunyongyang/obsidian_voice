import { App, Modal, Notice, Plugin, PluginSettingTab, requestUrl, Setting, setIcon, TFile } from 'obsidian';
import { eligiblePath, inFolder, RandomRound, speechText } from './core';
import { NotePlayer, snapshotHash, type Bookmark, type Snapshot } from './player';
import { synthesize, validateConfig, VOICES, type SpeechConfig } from './provider';

interface ListenerSettings {
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
  private round = new RandomRound();
  private panel: PlayerModal | null = null;
  private audio!: HTMLAudioElement;
  private mediaActions: MediaSessionAction[] = [];
  private saveQueue: Promise<void> = Promise.resolve();
  private saveErrorShown = false;
  private disposed = false;

  async onload(): Promise<void> {
    const stored = await this.loadData() as Partial<StoredData> | null;
    this.settings = { ...defaults, ...stored?.settings };
    this.settings.folders = Array.isArray(this.settings.folders) ? this.settings.folders.filter(value => typeof value === 'string') : [];
    this.settings.excludes = Array.isArray(this.settings.excludes) ? this.settings.excludes.filter(value => typeof value === 'string') : [];
    if (!Object.hasOwn(VOICES, this.settings.voice)) this.settings.voice = defaults.voice;
    this.settings.speed = Number.isFinite(this.settings.speed) ? Math.min(2, Math.max(0.75, this.settings.speed)) : 1;
    this.bookmark = stored?.bookmark ?? null;
    this.audio = document.createElement('audio');
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
      }),
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
    this.installMediaSession();
  }

  onunload(): void {
    this.disposed = true;
    this.panel?.close();
    this.player?.destroy();
    this.audio?.remove();
    this.sessionKey = '';
    this.authorized = false;
    if ('mediaSession' in navigator) {
      for (const action of this.mediaActions) {
        try { navigator.mediaSession.setActionHandler(action, null); } catch { continue; }
      }
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    }
  }

  config(): SpeechConfig {
    return { region: this.settings.region, voice: this.settings.voice, key: this.sessionKey, authorized: this.authorized };
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
    if (revoke) { this.authorized = false; this.sessionKey = ''; }
    void this.persist();
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

  showCredentials(): void { new CredentialModal(this.app, this).open(); }

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
    const candidates = this.app.vault.getMarkdownFiles().filter(file =>
      eligiblePath(file.path, this.settings.folders, this.settings.excludes, this.settings.recursive));
    for (let attempt = 0; attempt < candidates.length; attempt++) {
      const path = this.round.next(candidates.map(file => file.path));
      if (!path) return null;
      try { if ((await this.allowedText(path)).chunks.length) return path; } catch { continue; }
    }
    return null;
  }

  private changed(): void {
    if (this.disposed) return;
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

  onOpen(): void { this.setTitle('笔记听读 · 技术预览'); this.render(); }

  render(): void {
    const focused = this.contentEl.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.action : undefined;
    this.contentEl.empty();
    this.contentEl.addClass('note-listener');
    const player = this.plugin.player;
    if (!player) return;
    const heading = this.contentEl.createDiv({ cls: 'note-listener-heading' });
    setIcon(heading.createSpan({ cls: 'note-listener-mark' }), 'headphones');
    heading.createEl('h3', { text: player.snapshot?.title ?? '尚未选择笔记' });
    this.contentEl.createDiv({ cls: 'note-listener-status', text: labels[player.status] });
    if (player.snapshot) {
      this.contentEl.createDiv({ text: `第 ${player.index + 1} / ${player.snapshot.chunks.length} 段` });
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
    button('skip-back', '上一段', () => this.plugin.run(() => player.seekChunk(-1)), !player.snapshot || player.index === 0);
    const active = player.status === 'playing' || player.status === 'buffering' || player.status === 'preparing';
    button(active ? 'pause' : 'play', active ? '暂停' : '继续或重试', () => {
      if (active) player.pause();
      else if (player.snapshot) this.plugin.run(() => player.resume());
      else if (this.plugin.bookmark) this.plugin.run(() => player.start(this.plugin.bookmark!.path, this.plugin.bookmark!));
      else this.plugin.run(() => this.plugin.readCurrent());
    });
    button('skip-forward', '下一段', () => this.plugin.run(() => player.seekChunk(1)), !player.snapshot || player.index + 1 >= player.snapshot.chunks.length);
    button('square', '停止', () => player.stop());
    button('shuffle', '随机换一篇', () => this.plugin.run(() => player.random()));
    new Setting(this.contentEl).setName('连续随机播放').addToggle(toggle => toggle.setValue(player.continuous).onChange(value => { player.continuous = value; }));
    new Setting(this.contentEl).setName('倍速').addDropdown(dropdown => {
      for (const speed of [0.75, 1, 1.25, 1.5, 1.75, 2]) dropdown.addOption(String(speed), `${speed}x`);
      dropdown.setValue(String(player.speed)).onChange(value => {
        player.setSpeed(Number(value)); this.plugin.settings.speed = player.speed; void this.plugin.persist();
      });
    });
    const actions = this.contentEl.createDiv({ cls: 'note-listener-actions' });
    const command = (label: string, action: () => void): void => {
      actions.createEl('button', { text: label }).addEventListener('click', action);
    };
    command('朗读当前笔记', () => this.plugin.run(() => this.plugin.readCurrent()));
    command('连接与授权', () => this.plugin.showCredentials());
    command('试听', () => this.plugin.run(() => player.preview()));
    command('新一轮随机', () => this.plugin.resetRound());
    if (player.snapshot) command('打开原文', () => {
      const file = this.app.vault.getFileByPath(player.snapshot!.path);
      if (file) this.plugin.run(() => this.app.workspace.getLeaf(false).openFile(file));
    });
    const diagnostics = this.contentEl.createDiv({ cls: 'note-listener-diagnostics' });
    diagnostics.setText(`Azure · ${this.plugin.settings.region} · ${this.plugin.authorized && this.plugin.sessionKey ? '本次会话已连接配置' : '未授权或未输入密钥'} · 媒体会话 ${'mediaSession' in navigator ? '接口存在，锁屏未验收' : '接口不可用'}`);
    if (focused) this.contentEl.querySelector<HTMLElement>(`[data-action="${focused}"]`)?.focus();
  }

  onClose(): void { this.contentEl.empty(); this.closed(); }
}

class CredentialModal extends Modal {
  constructor(app: App, private readonly plugin: ListenerPlugin) { super(app); }

  onOpen(): void {
    this.setTitle('在线朗读授权');
    const { contentEl } = this;
    contentEl.createEl('p', { text: '朗读会把当前笔记标题、正文片段及下一段预取发送到 Microsoft Azure Speech，可能产生你账户上的费用。不发送全库。密钥仅留在本次插件会话内存，重启后需重新输入。' });
    let key = '';
    let agreed = false;
    new Setting(contentEl).setName('Azure Speech 密钥').addText(text => {
      text.inputEl.type = 'password';
      text.inputEl.autocomplete = 'off';
      text.onChange(value => { key = value; });
    });
    new Setting(contentEl).setName('同意发送到 Azure 并承担可能的调用费用').addToggle(toggle => toggle.onChange(value => { agreed = value; }));
    new Setting(contentEl).addButton(button => button.setButtonText('启用本次会话').setCta().onClick(() => {
      try {
        validateConfig({ ...this.plugin.config(), key, authorized: agreed });
        this.plugin.player.stop(true);
        this.plugin.sessionKey = key.trim();
        this.plugin.authorized = true;
        key = '';
        this.close();
        this.plugin.showPanel();
      } catch (error) { new Notice(error instanceof Error ? error.message : '配置无效。'); }
    }));
  }

  onClose(): void { this.contentEl.empty(); }
}

class ListenerSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ListenerPlugin) { super(app, plugin); }

  display(): void {
    this.containerEl.empty();
    const settings = this.plugin.settings;
    new Setting(this.containerEl).setName('Azure 区域').setDesc('例如 eastasia、southeastasia、eastus。必须与 Speech 资源一致。').addText(text => text.setValue(settings.region).onChange(value => {
      settings.region = value.trim(); this.plugin.settingsChanged(true);
    }));
    new Setting(this.containerEl).setName('中文音色').addDropdown(dropdown => dropdown.addOptions(VOICES).setValue(settings.voice).onChange(value => {
      settings.voice = value; this.plugin.settingsChanged();
    }));
    const listSetting = (name: string, field: 'folders' | 'excludes'): void => {
      new Setting(this.containerEl).setName(name).setDesc('仓库相对路径，每行一个目录。空白不代表整个仓库；填写 / 表示整个仓库。').addTextArea(text => text.setValue(settings[field].join('\n')).onChange(value => {
        settings[field] = value.split(/\r?\n/).map(path => path.trim()).filter(Boolean);
        this.plugin.settingsChanged();
      }));
    };
    listSetting('随机听读目录', 'folders');
    listSetting('排除目录', 'excludes');
    new Setting(this.containerEl).setName('包含子目录').addToggle(toggle => toggle.setValue(settings.recursive).onChange(value => {
      settings.recursive = value; this.plugin.settingsChanged();
    }));
    new Setting(this.containerEl).setName('锁屏显示真实标题').addToggle(toggle => toggle.setValue(settings.revealTitle).onChange(value => {
      settings.revealTitle = value; void this.plugin.persist();
    }));
    new Setting(this.containerEl).setName('本次会话授权').addButton(button => button.setButtonText('输入密钥并授权').onClick(() => this.plugin.showCredentials()));
    new Setting(this.containerEl).setName('撤回授权').addButton(button => button.setButtonText('停止并清除凭据').onClick(() => {
      this.plugin.sessionKey = ''; this.plugin.authorized = false; this.plugin.forget(); new Notice('本次会话授权已撤回。');
    }));
    new Setting(this.containerEl).setName('播放历史').addButton(button => button.setButtonText('清除进度与音频').onClick(() => this.plugin.forget()));
  }
}