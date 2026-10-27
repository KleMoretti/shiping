识屏 Windows 自用版 v3.4.1

- `win` 为本仓库的默认开发、发布分支；`main` 保留用于同步上游。
- 设置 → 语音新增模型下拉框：Fun-ASR（默认）、Fun-ASR 2026-02-28 固定版本、Paraformer v2。两个模式共用，切换后下次开始转录时生效，配置随设置保存。
- 资料库明确支持批量导入：Ctrl / Shift 多选或一次拖入多个 PDF、DOCX、Markdown、TXT 文件。
- 文件选择框绑定主窗口，避免被悬浮窗口遮挡；增加导入中状态、成功/失败数量和逐文件失败原因。
- Windows 安装包的更新源改为 KleMoretti/shiping。

验证：单元测试、TypeScript 检查及 Windows 构建。未使用真实百炼 API Key 验证在线语音转录。

下载 `shiping-3.4.1-setup.exe` 安装。此版本仅发布 Windows 安装包。

基于 [ooboqoo/shiping](https://github.com/ooboqoo/shiping)，保留原项目许可证。
