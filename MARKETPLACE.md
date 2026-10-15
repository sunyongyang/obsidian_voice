# 官方插件市场提交准备

状态：尚未提交，尚未上架。查阅日期：2026-10-15。

目标仓库：https://github.com/sunyongyang/obsidian_voice

## 当前结果

- 已核实官方当前入口为 https://community.obsidian.md/，不是向 obsidian-releases 提交旧式 PR。
- 工作区已把 Edge 适配器合并进 main.js；构建只生成 main.js、manifest.json、styles.css 三个安装文件。
- 实际打包依赖的许可说明嵌入 main.js，不依赖额外下载。
- 新增单 bundle 分发回归，桌面限定、MIT 及描述规则检查。
- 维护者已明确确认 MIT 和仅支持桌面；LICENSE 已加入，清单 isDesktopOnly=true，版本 1.0.1，最低 Obsidian 1.14.4。
- 旧 1.0.0 不覆盖；1.0.1 为市场提交候选，账号关联及目录提交尚未确认完成。

## 账号关联与提交待办

1. 在豆包浏览器打开 https://community.obsidian.md/，确认登录的是 Obsidian 社区目录账号；仅登录 Obsidian 官网不等于已登录目录。
2. 进入 Community profile / Profile，在 GitHub 区域选择 Connect，跳转 GitHub。
3. 核对 GitHub 登录账号为 sunyongyang，授权请求应仅为官方说明中的公开个人资料读取，用于确认仓库所有权。若请求仓库写入、删除或其他未说明权限，停止并核实，不盲目确认。
4. 由账号持有人完成登录、验证码及 OAuth 授权；不把任何密码、验证码、令牌或 Cookie 发到聊天。
5. 回到 Profile 确认 GitHub 显示已关联，再进入 Plugins → New plugin，填写 https://github.com/sunyongyang/obsidian_voice，Owner 选择自己。
6. 阅读开发者政策，并确认持续维护或在无法支持时移除/转移条目的承诺，再提交。只有审核和发布状态通过才算完成上架。

浏览器限制：当前受控浏览器访问社区目录遇到连接关闭，现有豆包进程也未启用可连接的调试端口。未读取浏览器 Cookie、未重启豆包、未代为完成账号关联或提交。

## 完成决定后的执行顺序

1. 加入确认过的 LICENSE，填写准确的作者信息，更新平台及最低版本声明。
2. 增量发布新版本，例如 1.0.1；同步 package.json、manifest.json、versions.json 和更新记录，不覆盖旧 1.0.0。
3. 运行 npm ci、npm test、npm run build，验证三文件产物及 Edge 在真实宿主中的播放。
4. 提交并推送默认分支；创建与清单版本完全一致、无 v 前缀的 GitHub Release，单独附加三个安装文件。
5. 维护者在 Community directory 登录并关联 GitHub，进入 Plugins → New plugin，填写仓库 URL 和 Owner。
6. 阅读并确认政策及维护承诺后提交。处理自动审核返回的问题；只有目录审核和发布状态都通过，才算完成上架。

## 已知审核与产品边界

自查结果（不等于官方审核通过）：许可证、桌面声明、版本与 Release 文件要求已准备；README 披露联网目的、可能费用、凭据保存方式及平台范围。源码检查未发现客户端遥测、自更新、广告、动态代码执行、直接 innerHTML 拼接或全局 app 使用。生命周期事件、计时器、音频和对象 URL 均有卸载清理路径。最终以官方审核反馈为准。

- 默认 Edge 为第三方在线服务，不是微软承诺稳定开放的正式第三方 API；上架审核可能要求进一步说明可用性及服务条款。
- README 已披露联网目的、服务方、可能收费的平台，以及会话密钥和正文发送边界。
- Windows Edge 朗读已有实际播放证据；macOS/Linux、Android/iOS、长时间锁屏及其他平台的真实账户合成并未全部验证。
- 没有遥测、自更新、广告或声音克隆上传功能，不应在提交描述中暗示支持这些能力。

## 官方依据

- https://docs.obsidian.md/plugins/releasing/submit-plugin
- https://docs.obsidian.md/community-directory/submission-requirements-for-plugins
- https://docs.obsidian.md/community-directory/developer-policies
- https://docs.obsidian.md/community-directory/set-up-and-claim