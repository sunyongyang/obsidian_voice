# Note Listener

Read your Markdown notes aloud in Obsidian. Note Listener adds a play/pause button to each note header, voice selection, playback speed, paragraph navigation, saved progress, and randomized review of folders you explicitly select.

**Desktop only. Requires Obsidian 1.14.4 or later.** Windows Edge TTS playback is tested. Android and iOS are not supported.

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [GitHub release](https://github.com/sunyongyang/obsidian_voice/releases/latest). The release tag must match the manifest version; do not mix files from different releases.
2. Create `<your-vault>/.obsidian/plugins/note-listener/` and place all three files directly inside it. Use your actual configuration directory if it is not `.obsidian`.
3. Restart Obsidian or reload the plugin, then enable **Note Listener** under **Settings → Community plugins**.

## Usage

1. Open a Markdown note and click the play button in its header. The first attempt opens an online-speech consent dialog.
2. Confirm the destination and grant consent. Edge TTS is the default and needs no API key. It is an online service, not an offline model.
3. Use the adjacent settings button to choose a voice, change speed, pause, skip paragraphs, or open the speech service configuration.
4. For randomized review, configure allowed folders under **Settings → Note Listener**. An empty list scans nothing; only an explicit `/` allows the whole vault. Excluded subtrees are skipped.
5. Azure Speech, SiliconFlow, Doubao V3 SSE, and OpenAI-compatible endpoints are optional. Configure the endpoint, model, and voice, enter your key in the consent dialog, and test with the fixed sample before using personal notes. These services may require accounts and incur charges.

## Privacy and Network Use

- After consent, the selected provider receives the current note title, cleaned text segments, and limited next-segment prefetch. There is no full-vault upload. `tts: false` and excluded folders prevent reading aloud.
- Edge connects to Microsoft speech services, including `api.msedgeservices.com`; its handshake may use `speech.platform.bing.com`. Azure uses the configured regional `tts.speech.microsoft.com` endpoint. Optional presets use `api.siliconflow.cn`, `openspeech.bytedance.com`, or `api.openai.com`. A custom endpoint also receives the submitted text and credentials — only use one you trust.
- Keys and consent stay in memory for the current session. Changing providers or endpoint/model/authentication revokes consent. Ordinary settings and the latest playback position are stored in the plugin data file and may be synced by your vault's sync software.
- Audio is kept in bounded memory, not exported to files. The runtime bundle has no Node `fs` import. There is no client telemetry, advertising, automatic code installation, or self-update.
- Stopping Edge closes its network connection. Other providers use Obsidian's non-cancellable HTTP API; an already-sent request may still complete and be billed. There is no silent provider fallback.

## License and Attribution

Project source is licensed under [MIT](LICENSE). Edge networking uses a pinned MIT-licensed [MsEdgeTTS](https://github.com/Migushthe2nd/MsEdgeTTS) dependency. The build applies a checked TypeScript-AST transform to remove unused file-export and voice-list methods and select the desktop transport. Project and bundled-dependency license notices are embedded in `main.js`.

<details>
<summary>中文说明</summary>

Obsidian 桌面在线听读插件，使用 [MIT 许可证](LICENSE)。仅支持桌面端，最低要求 Obsidian 1.14.4。已验收范围是 Windows 桌面端的 Edge 在线朗读及播放器；macOS/Linux、长时间锁屏和其他平台仍待进一步验收，Android/iOS 不在本版本支持范围内。

安装文件：[GitHub Releases](https://github.com/sunyongyang/obsidian_voice/releases)。本版本只需 main.js、manifest.json 和 styles.css，Edge 已合并进主文件。更新记录见 [CHANGELOG.md](CHANGELOG.md)。

默认使用 Edge TTS，无需账号、密钥或额外 Python 安装。在 Windows Obsidian 内授权后按需在线合成并播放。另提供 Azure、硅基流动、豆包及自定义 OpenAI 兼容 TTS，可在统一窗口配置。其他平台可能收费，不会自动切换。Edge 是微软在线服务，不是本地模型，也不是长期免费、无限量或稳定性的承诺。

此版本按官方要求设置 isDesktopOnly=true，不允许在 Android/iOS 安装。

### 统一语音服务配置

入口：笔记顶部“音色与播放设置” → 面板内“语音服务配置”；或 Obsidian 设置 → Note Listener → “配置平台、模型与音色”。

| 平台 | 可以配置 | 凭据 |
| --- | --- | --- |
| Edge TTS（默认） | 已内置的中文音色 | 无密钥，仍需在线授权 |
| Azure Speech | 资源区域、中文音色 | 本次会话的 Speech 密钥 |
| 硅基流动 | 完整接口地址、TTS 模型 ID、音色 ID | 本次会话的 API Key |
| 火山引擎 · 豆包 | V3 SSE 接口地址、资源 ID、speaker、可选模型 ID、鉴权方式 | 新版 API Key，或旧版 App ID + Access Token |
| OpenAI 兼容 TTS | 完整 `/audio/speech` 地址、模型 ID、音色 ID | 本次会话的 Bearer API Key |

每个平台独立保存不含密钥的配置。编辑字段后按 Tab 或点击其他控件提交；改动接口、模型、区域、资源或鉴权方式会停止播放并撤回旧授权。切换平台也会清除旧密钥，不会静默回退。更换同一配置的音色只停止旧音频，保留段落。

首次配置流程：选择平台 → 填写参数 → “输入凭据并授权” → 确认接收服务 → 输入密钥并同意费用 → “试听当前配置”。测试使用固定文本，不读取日记。不要把密钥写进接口地址、普通字段、Markdown 或聊天。

#### 硅基流动示例

- 完整接口：`https://api.siliconflow.cn/v1/audio/speech`
- 模型：`FunAudioLLM/CosyVoice2-0.5B`
- 音色：`FunAudioLLM/CosyVoice2-0.5B:alex`，或该模型下已授权的其他音色。
- 平台支持的模型可能变化，以控制台为准；模型和音色须匹配。插件请求 MP3，使用 `model`、`input`、`voice` 和 `response_format`。

#### 豆包示例

- 接口：`https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse`
- 新版控制台选“API Key”；旧版选“App ID + Access Token”。
- 资源 ID：例如 `seed-tts-2.0`，必须与已开通的服务和音色匹配。
- 普通合成通常由资源 ID 选择模型版本，“模型 ID”可以留空；仅在接口要求 `req_params.model` 时填写。
- 插件拼接 SSE 中的 Base64 MP3，仅在收到成功结束码 `20000000` 后播放。

#### 其他平台

使用“OpenAI 兼容 TTS”填写完整地址，例如 `https://your-provider.example/v1/audio/speech`。它要求 Bearer 鉴权、OpenAI 风格的 JSON 请求，以及直接返回可播放音频。仅兼容聊天接口不代表兼容语音接口。

接口地址仅接受 HTTPS。只有确认可信的平台地址后才授权；插件不会替你核实第三方代理的隐私政策。

参考：[硅基流动语音合成](https://docs.siliconflow.cn/cn/userguide/capabilities/text-to-speech)、[豆包 V3 SSE 官方接口](https://docs.volcengine.com/docs/6561/1598757)。

### 功能

- 朗读当前 Markdown 笔记，随机抽取指定目录的笔记，本轮不重复。
- 每篇已打开的 Markdown 笔记顶部提供播放/暂停按钮，直接朗读该笔记；旁边的“音色与播放设置”按钮可打开面板。分屏时按按钮所属笔记播放。
- 开启随机连续播放，跨段和跨篇推进，候选耗尽后停止。
- 暂停、继续、停止、重试当前段、上一段、下一段和 0.75x 至 2x 倍速。
- 在播放面板直接选择音色：晓晓（女声）、云希（男声）、晓伊（女声）。
- 清理 Markdown、YAML、代码块、链接地址和嵌入，遵守 `tts: false` 及排除目录。
- 保存最近一篇的进度，正文变化后从头开始。
- 一次只保留当前段及下一段预取音频，不把音频缓存写入仓库。
- 如果宿主暴露 Media Session，注册系统播放、暂停、停止及切换操作。

尚未实现：安卓 Edge 直连、持久缓存管理、日记日期筛选、逐句高亮等；锁屏控制、来电和耳机断开等场景未实机验收。

### Edge TTS 的接入边界

1.0.2 起改用 MIT 许可的 msedge-tts 内存音频流，构建时移除文件导出、音色列表和浏览器连接分支，不包含 Node fs 模块。停止、超时或超过大小限制时关闭连接，不在磁盘写正文或 MP3。用户未授权时不发送正文；服务失效时提示错误，不擅自切换服务或关闭 TLS 校验。

已在 Windows Obsidian 1.14.4 的真实实例验证加载、Edge 在线合成、解码与播放事件，测试使用固定非私密短句，未上传真实笔记。

### 构建

固定构建环境：Node.js 24.15.0、npm 11.12.1。发布复现与工件证明流程见 [docs/RELEASING.md](docs/RELEASING.md)。

```powershell
npm ci --ignore-scripts
npm run lint
npm test
npm run build
npm run verify:build
```

构建生成 dist/note-listener 目录中的三个安装文件，Edge 已合并到主文件：

```text
note-listener/
  manifest.json
  main.js
  styles.css
```

第三方许可说明嵌入 main.js 的保留注释中。开发时可运行 `npm run dev` 监听源码；编译完成后需要在 Obsidian 中禁用再启用插件才会重载。

### 安装到自己的 Obsidian

插件文件要放进你正在使用的笔记仓库的配置目录。

1. 找到 Obsidian 仓库的实际文件夹（不是 Obsidian 软件安装目录）。
2. 关闭该仓库的 Obsidian 窗口。
3. 将整个 dist/note-listener 文件夹放到 `<仓库>/.obsidian/plugins/note-listener/`。如配置目录不是默认的 `.obsidian`，使用你实际的配置目录。
4. 重新打开仓库，在“设置 → 第三方插件”启用第三方插件，再启用 **Note Listener**。
5. 打开任意 Markdown 笔记，点击顶部的播放按钮即可朗读；旁边的“音色与播放设置”按钮可选择音色。也可使用命令面板或左侧耳机图标。

如果面板或插件启用报错，可按 `Ctrl+Shift+I` 打开开发者工具，在 Console 查看错误。反馈前删除密钥和真实笔记内容。

### 配置与首次朗读

1. Windows 默认引擎为 Edge TTS，不需要账号、区域或密钥。先确认联网，选择一种中文音色。
2. 改用其他平台时，在“语音服务配置”中填写该平台参数并确认计费方案。
3. 随机听读目录每行一个，例如 `日记`、`知识/复习`；路径相对当前仓库。空列表表示不启用随机范围，`/` 显式表示全库。排除目录同样每行一个，例如 `日记/私密`。
4. 点击“连接与授权”，同意发送到当前引擎。其他平台在插件内输入本次会话凭据并确认费用授权。
5. 打开听读面板，先点“试听”。测试文本是固定示例，试听结束不会自动转入随机日记。
6. 再打开一篇测试笔记，点击“朗读当前笔记”；或配置好范围后点击随机按钮。

授权和所有平台密钥仅存内存，重启、禁用或卸载插件后需重新输入及授权。密钥不会写入 data.json；该文件只保存非敏感平台配置、普通设置及最近播放进度。

### 隐私与网络

- 用户授权后，Edge 将当前笔记标题、清理后的正文片段及下一段预取文本发送到微软 Edge 服务；只有主动选择 Azure 才发送到配置的区域端点。不上传全库，不静默切换引擎。
- 硅基流动、豆包及自定义接口将相同的当前篇文字片段发送到你填写并授权的地址。切换到新地址后必须重新授权。
- 音频只在内存中保存当前段和下一段；停止、切篇、撤权或卸载时释放其引用。
- 最近播放进度包含笔记路径和内容哈希，保存在插件的 data.json，可能被仓库同步软件同步。可在设置中“清除进度与音频”。
- 用 `tts: false` 禁止指定笔记被朗读。
- 无客户端遥测，不记录正文或密钥到日志，不读取仓库外用户文件，不需要麦克风权限。

```yaml
---
tts: false
---
```

</details>
