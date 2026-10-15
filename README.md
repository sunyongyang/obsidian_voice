# Note Listener

Read your Markdown notes aloud in Obsidian. Note Listener provides a play/pause button in each note header, voice selection, playback speed, paragraph navigation, saved progress, and randomized review of folders you explicitly select.

**Desktop only. Requires Obsidian 1.14.4 or later.** Windows Edge TTS playback has been tested. Android and iOS are not supported. Other desktop operating systems, long-running background playback, and paid-provider accounts require additional testing.

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [GitHub release](https://github.com/sunyongyang/obsidian_voice/releases/latest). The release tag must match the manifest version. Do not mix files from different releases.
2. Create `<your-vault>/.obsidian/plugins/note-listener/` and place all three files directly inside it. Use your actual configuration directory if it is not `.obsidian`.
3. Restart Obsidian or reload the plugin. Open **Settings → Community plugins**, enable community plugins, and enable **Note Listener**.
4. Community directory review is in progress. A GitHub release or completed automated scan does not mean that the plugin is approved or available in Obsidian's in-app directory.

## Usage

1. Open a Markdown note and click the play button in its header. The first attempt opens an online-speech consent dialog.
2. Confirm the destination and grant consent. Edge TTS is selected by default and does not require an API key. It is an unofficial online service, not an offline model or a promise of unlimited free access.
3. Use the adjacent audio-settings button to select a voice, change speed, pause, skip paragraphs, or open **语音服务配置** (speech service configuration).
4. For randomized review, configure allowed folders in **Settings → Note Listener**. Empty configuration scans nothing. Only an explicit `/` selection permits traversing the whole vault; excluded subtrees are skipped before their children are visited.
5. Azure Speech, SiliconFlow, Doubao V3 SSE, and OpenAI-compatible speech endpoints are optional. Configure the endpoint/model/voice, enter your key inside the consent dialog, and test the fixed sample before using personal notes. These services may require accounts and incur charges.

## Privacy and Network Use

- The selected provider receives the current note title, cleaned text segments, and limited next-segment prefetch only after consent. No full-vault upload is performed. `tts: false` and excluded folders prevent reading aloud.
- Edge connects to Microsoft speech services, including `api.msedgeservices.com`; its handshake may use `speech.platform.bing.com`. Azure uses the configured regional `tts.speech.microsoft.com` endpoint. Optional presets use `api.siliconflow.cn`, `openspeech.bytedance.com`, or `api.openai.com`. A custom endpoint also receives the submitted text and credentials: only use one you trust.
- Keys and consent stay in memory for the current plugin session. Changing providers or endpoint/model/authentication configuration revokes consent. Ordinary settings and the latest playback position are stored in the plugin data file and may be synced by your vault's sync software.
- Audio is kept in bounded memory, not exported to files. The runtime bundle has no Node `fs` import. There is no client telemetry, advertising, automatic code installation, or self-update mechanism.
- Stopping Edge closes its network connection. Other providers use Obsidian's non-cancellable HTTP request API; an already-sent request may still complete and be billed. There is no silent provider fallback.

## License and Attribution

Project source is licensed under [MIT](LICENSE). Edge networking uses a pinned MIT-licensed [MsEdgeTTS](https://github.com/Migushthe2nd/MsEdgeTTS) dependency. The build applies a checked TypeScript-AST transform to remove unused file-export and voice-list methods and select the desktop transport. Project and bundled-dependency license notices are embedded in `main.js`. No GPL/AGPL Edge client is bundled in 1.0.2.

## 中文说明

Obsidian 桌面在线听读插件，使用 [MIT 许可证](LICENSE)。**当前审核修复版本为 1.0.3，仅支持桌面端，最低要求 Obsidian 1.14.4。** 正式验证范围是 Windows 桌面端的 Edge 在线朗读及播放器；macOS/Linux、长时间锁屏和其他平台真实账户合成仍待进一步验收。Android/iOS 不在本版本支持范围内。

安装文件：[GitHub Releases](https://github.com/sunyongyang/obsidian_voice/releases)。本版本只需 main.js、manifest.json 和 styles.css，Edge 已合并进主文件。为符合目录分发方式，候选 Release 不再附加 ZIP。功能及验证边界见下文，更新记录见 [CHANGELOG.md](CHANGELOG.md)。GitHub 发布不等于已经在 Obsidian 社区目录上架。

市场提交准备：维护者已确认 MIT 和桌面限定，三文件分发已完成。账号关联、政策确认和目录审核状态见 [MARKETPLACE.md](MARKETPLACE.md)。旧 1.0.0 Release 保持原样，不与新版本混用。

**默认使用 Edge TTS，无需账号、密钥或额外 Python 安装。** 在 Windows Obsidian 内授权后，按需在线合成并播放，不需要先生成整篇音频。另提供 Azure、硅基流动、豆包及自定义 OpenAI 兼容 TTS，可在统一窗口配置。其他平台可能收费，不会自动切换。Edge 是微软在线服务，不是本地模型，也不是长期免费、无限量或稳定性的承诺。不包含在线中转服务器或手机本地模型。

此版本按官方要求设置 isDesktopOnly=true，不允许在 Android/iOS 安装。未来移动端方案需独立处理无 Node 依赖、网络、音频和后台实机验收，不提供手机可用承诺。

## 统一语音服务配置

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

### 硅基流动示例

- 完整接口：`https://api.siliconflow.cn/v1/audio/speech`
- 模型：`FunAudioLLM/CosyVoice2-0.5B`
- 音色：`FunAudioLLM/CosyVoice2-0.5B:alex`，或该模型下已授权的其他音色。
- 平台支持的模型可能变化，以控制台为准；模型和音色须匹配。插件请求 MP3，使用 `model`、`input`、`voice` 和 `response_format`，不自动添加参考音频或多说话人参数。

### 豆包示例

- 接口：`https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse`
- 新版控制台选“API Key”；旧版选“App ID + Access Token”。这是语音服务凭据，不是其他产品的 Access Key/Secret Key 对。
- 资源 ID：例如 `seed-tts-2.0`，必须与已开通的服务和音色匹配；音色 ID 从你的火山语音控制台复制。
- 普通合成通常由资源 ID 选择模型版本，“模型 ID”可以留空；仅在接口要求 `req_params.model` 时填写。
- 插件拼接 SSE 中的 Base64 MP3，仅在收到成功结束码 `20000000` 后播放。不是旧 V1 JSON 接口，也不是 WebSocket；不要把这些地址填入 SSE 配置。

### 其他平台

使用“OpenAI 兼容 TTS”填写完整地址，例如 `https://your-provider.example/v1/audio/speech`。它要求 Bearer 鉴权、OpenAI 风格的 JSON 请求，以及直接返回可播放音频。仅兼容聊天接口不代表兼容语音接口。当前不支持任意请求模板、自定义鉴权头、返回音频下载链接的 JSON、声音克隆上传或必须自定义附加参数的模型；这些需要另写适配器。

接口地址仅接受 HTTPS，不接受 URL 账号密码、查询参数或片段。只有确认可信的平台地址后才授权；插件不会替你核实第三方代理的隐私政策。

验证边界：Edge 已有 Windows 真实短句播放证据；硅基流动、豆包和自定义兼容接口目前通过协议模拟测试，尚未使用真实账户密钥合成，不保证模型权限、音色权限、额度或服务可用性。

参考：[硅基流动语音合成](https://docs.siliconflow.cn/cn/userguide/capabilities/text-to-speech)、[豆包 V3 SSE 官方接口](https://docs.volcengine.com/docs/6561/1598757)。

## 首版功能

- 朗读当前 Markdown 笔记，随机抽取指定目录的笔记，本轮不重复。
- 每篇已打开的 Markdown 笔记顶部提供播放/暂停按钮，直接朗读该笔记，不必从左侧进入；旁边的“音色与播放设置”按钮可打开面板。首次点击先授权，授权后直接播放，不自动弹出面板。分屏时按按钮所属笔记播放。
- 开启随机连续播放，跨段和跨篇推进，候选耗尽后停止。
- 暂停、继续、停止、重试当前段、上一段、下一段和 0.75x 至 2x 倍速。
- 在播放面板直接选择音色：晓晓（女声）、云希（男声）、晓伊（女声）。选择会保存到插件设置；切换停止旧音频、保留当前笔记和段落，点击继续后从该段开头使用新音色，也可以先点“试听”。不会在选择时自动上传或播放正文。
- 清理 Markdown、YAML、代码块、链接地址和嵌入，遵守 `tts: false` 及排除目录。
- 保存最近一篇的进度，正文变化后从头开始；有正在播放的会话时可以继续，应用重启后通过面板播放按钮恢复最近保存点。
- 一次只保留当前段及下一段预取音频，不把音频缓存写入仓库。
- 如果宿主暴露 Media Session，注册系统播放、暂停、停止及切换操作；接口存在不等于锁屏可用。

尚未实现：安卓 Edge 直连、200 MB 持久缓存管理、日记日期筛选、手动配置日期格式、完整重试策略、播放端音频焦点与拔耳机的原生保证、逐句高亮。锁屏控制、30 分钟锁屏跨段及跨篇、来电和耳机断开均未实机验收，不能声称已经满足通勤使用要求。

## Edge TTS 的接入边界

1.0.2 改用 MIT 许可的 msedge-tts 内存音频流，关闭默认日志；构建时移除文件导出、音色列表和浏览器连接分支，不包含 Node fs 模块。停止、超时或超过音频大小限制时关闭客户端连接，不在磁盘写正文或 MP3。此前 Edge 客户端的 GPL 许可与 MIT 发行说明存在冲突，已移除，并通过产物依赖检查防止回归。旧版本的 Node Worker 方案及其他失败客户端也不再使用。

2026-10-15 已在 Windows Obsidian 1.14.4 的真实插件实例中验证加载、Edge 在线合成、音频解码、开始播放和播放结束事件，固定非私密测试句播放约 3.5 秒。已修复空音源重置事件影响新播放、自然结束被误识别为暂停等浏览器事件问题。此记录不代表人工试听音质、多篇长文稳定性、系统锁屏或 Android 已验收。测试没有上传真实笔记，结束后撤回临时授权。

1.0.2 的 MIT 替代实现也已在同一真实宿主中单独验证：固定测试句返回 21,744 字节 MP3，播放开始和结束事件完整，时长 3.624 秒。声明式设置已注册 8 个条目。未使用真实笔记或付费平台密钥进行测试。

普通 WebView 不能直接复用这个 Node 适配器。用户未授权时不发送正文；服务失效时提示错误，不擅自增加服务器、切换到其他服务或关闭 TLS 证书校验。

## 构建

固定构建环境：Node.js 24.15.0、npm 11.12.1。发布复现与工件证明流程见 [docs/RELEASING.md](docs/RELEASING.md)。

```powershell
npm ci --ignore-scripts
npm run lint
npm test
npm run build
npm run verify:build
```

当前工作区构建生成 dist/note-listener 目录中的三个安装文件，Edge 已合并到主文件：

```text
note-listener/
  manifest.json
  main.js
  styles.css
```

第三方许可说明嵌入 main.js 的保留注释中，不依赖市场下载额外文本文件。已发布的旧 1.0.0 ZIP 仍需保留其中的 edge.cjs 和独立许可说明；请勿混用不同构建的文件。

开发时可运行 `npm run dev` 监听源码。编译完成不代表 Obsidian 已重载插件，需要禁用再启用。

## 安装到自己的 Obsidian

自己使用不需要向 Obsidian 网站“上传”。插件文件要放进你正在使用的笔记仓库的配置目录。

先使用测试仓库；不要一开始拿真实敏感日记做联网验证。

### Windows 安装

1. 找到 Obsidian 仓库的实际文件夹，不是 Obsidian 软件安装目录。
2. 关闭该仓库的 Obsidian 窗口。
3. 将整个 dist/note-listener 文件夹放到 `<仓库>/.obsidian/plugins/note-listener/`。如配置目录不是默认的 `.obsidian`，使用你实际的配置目录。
4. 当前源码构建应直接包含上述三个文件，不要出现 `note-listener/note-listener/` 的重复嵌套。若使用旧 1.0.0 Release ZIP，则必须完整保留其中的 edge.cjs 等文件。
5. 重新打开仓库，在“设置 → 第三方插件”启用第三方插件，再启用 **Note Listener**。
6. 打开任意 Markdown 笔记，点击顶部的播放按钮即可朗读；旁边的“音色与播放设置”按钮可选择音色。也可使用命令面板或左侧耳机图标。

Windows 首次试用要求使用 Obsidian 1.14.4 或更新版本及较新的桌面安装器，并在独立测试仓库内依次检查：启用插件、打开面板、确认引擎为 Edge TTS、点击连接与授权、同意在线发送、固定文本试听、朗读一篇虚构笔记、暂停/继续、随机切篇。默认不需要 Azure 配置。不要把关闭窗口、系统锁屏和电脑休眠视为同一种后台能力，休眠期间不承诺继续播放。

如果面板或插件启用报错，可按 `Ctrl+Shift+I` 打开开发者工具，在 Console 查看错误。反馈前删除密钥和真实笔记内容，不直接发送完整的网络请求或控制台转储。

### Android / iOS

1.0.1 是桌面限定版本，不提供手机安装步骤。不要通过修改清单绕过桌面限制，否则 Node 依赖可能导致加载失败。移动端将另行设计并验证。

### 更新与卸载

- 更新前停止播放、禁用插件，再复制所选发行包的全部文件或当前源码构建的三个文件并重新启用。当前源码不再使用旧 edge.cjs，旧文件可以删除。不要把桌面的 data.json 一起复制到手机。旧版本配置没有引擎字段时迁移为 Edge，需要重新授权；已明确保存的引擎选择会被保留。
- 卸载通过第三方插件设置完成；它会结束插件音频。此预览版没有外置音频目录。
- 项目构建不会自行安装或启用插件。手动安装只涉及目标插件目录；启用状态由 Obsidian 管理。

## 配置与首次朗读

1. Windows 默认引擎为 Edge TTS，不需要账号、区域或密钥。先确认联网，选择一种中文音色。
2. 改用其他平台时，在“语音服务配置”中填写该平台参数并确认计费方案。不确定计费或模型权限前不要授权真实日记。
3. 随机听读目录每行一个，例如 `日记`、`知识/复习`；路径相对当前仓库。空列表表示不启用随机范围，`/` 显式表示全库。排除目录同样每行一个，例如 `日记/私密`。
4. 点击“连接与授权”，同意发送到当前引擎。Edge 不显示密钥输入框；其他平台在插件内输入本次会话凭据并确认费用授权。不要把密钥发到聊天或写入笔记。
5. 打开听读面板，先点“试听”。测试文本是固定示例，试听结束不会自动转入随机日记。
6. 再打开一篇测试笔记，点击“朗读当前笔记”；或配置好范围后点击随机按钮。

授权和所有平台密钥仅存内存，重启、禁用或卸载插件后需重新输入及授权。切换引擎或修改接口、模型等配置会停止播放、撤回旧授权并清除内存凭据。密钥不会写入 data.json；该文件只保存非敏感平台配置、普通设置及最近播放进度。配置可能被仓库同步软件同步。

预览版更改范围或区域会停止当前播放并清除旧进度。更改音色则停止旧音频，但保留当前笔记和段落、清零段内秒数；继续时从该段开头合成，避免把旧音色的时间位置套到新音频。切换音色不撤回同一服务的已有授权，也不会自动出声。这与 SPEC 中“音色下一篇生效”的原始草案不同。

## 隐私与网络

- 用户授权后，Edge 将当前笔记标题、清理后的正文片段及下一段预取文本发送到微软 Edge 服务，包括 `api.msedgeservices.com`，鉴权恢复可能访问 `speech.platform.bing.com`；具体握手以锁定的库实现为准。只有主动选择 Azure 才发送到 `https://<region>.tts.speech.microsoft.com`。不上传全库，不静默切换引擎。
- 硅基流动、豆包及自定义接口将相同的当前篇文字片段发送到你填写并授权的地址。默认分别为 `api.siliconflow.cn`、`openspeech.bytedance.com`、`api.openai.com`；自定义代理也是正文及密钥接收方。切换到新地址后必须重新授权。
- 音频只在内存中保存当前段和下一段；停止、切篇、撤权或卸载时释放其引用及对象 URL。不保证操作系统或宿主内部不会缓存网络数据。
- 最近播放进度包含笔记路径和内容哈希，保存在插件的 data.json，可能被仓库同步软件同步。可在设置中“清除进度与音频”。
- 用 `tts: false` 禁止指定笔记被朗读。笔记删除、重命名或变成禁止听读时，终止相关会话并清除进度。
- 无客户端遥测，不记录正文或密钥到日志，不读取仓库外用户文件，不需要麦克风权限。桌面只加载单个插件主文件及 Node 内置模块，不额外下载或更新代码。
- 停止 Edge 会通过 AbortSignal 取消合成并关闭相关连接，无法撤回已经发送的文字。所有其他 HTTP 平台使用的 requestUrl 没有可取消接口：停止会取消等待并丢弃迟到结果，但已经发送的请求仍可能完成并产生费用。豆包 SSE 目前先收齐单段响应再解析，不是边收到音频边播放。Edge 库可能在握手失败时进行自身的协议恢复；插件不会自动切换引擎或对正文实施额外重试。

```yaml
---
tts: false
---
```

## 后续移动端验收规划（当前不支持）

当前没有 Android 真机或真实 Azure 在线合成测试证据。上述 Windows 真实宿主验证仅覆盖固定短句；其余自动测试使用模拟网络及音频对象，不能替代长时间后台与移动端验收。

在目标手机按以下顺序验证，记录手机型号、Android、Obsidian、Android System WebView 版本及电池策略：

1. 用固定文本试听，确认不是只通过构建，确实能收到并播放在线音频。
2. 打开足够长的测试笔记，前台播放后锁屏，听 30 分钟，期间需要多次新分段合成。
3. 在随机目录放至少三篇足够长的测试笔记，开启连续播放，锁屏验证跨篇自动合成和播放。
4. 测试锁屏暂停、继续、切换到其他应用、断网恢复、来电和蓝牙耳机断开。测试断开时先调低扬声器音量，不能预设宿主一定会暂停。
5. 在“输入密钥并授权”以外不提供任何真实敏感笔记，首次实验失败时用虚构测试笔记复现。

若第一步失败，先核对 Azure 区域、资源权限、网络和密钥。若系统媒体接口不可用、锁屏后停播、不能跨篇，记录现象并暂停完整产品开发；不能靠屏幕常亮或电脑预生成来宣称需求完成。原生辅助方案需要另行评审。

## 公开发布到社区目录

本地安装不等于已上架。当前预览版未提交、未发布，也不建议在锁屏及隐私验收前当作完整产品推广。

准备公开发行时：

1. 在自己的 GitHub 仓库公开可审阅源码，保留 MIT LICENSE 和联网/费用披露。
2. 清单已采用实际验证过的最低版本 `1.14.4`，并声明仅支持桌面。
3. 将清单和包版本同步更新，发布同版本 GitHub Release，例如 `1.0.1`，不加 `v` 前缀。
4. 以 1.0.1 的三文件发行构建提交，单独上传 main.js、manifest.json 和 styles.css。项目 MIT 和所有实际打包第三方许可均包含在 main.js 的保留注释中。已发布的旧 1.0.0 不是这份候选构建。
5. 按[官方当前提交流程](https://docs.obsidian.md/plugins/releasing/submit-plugin)登录 [Community directory](https://community.obsidian.md/)，关联 GitHub 并提交插件，处理审核反馈。不要照旧教程向发布仓库提交 PR。

完整目标见 [SPEC.md](SPEC.md)。