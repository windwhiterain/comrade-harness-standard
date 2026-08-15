# UI 覆盖层

本 core 的 UI = 此目录优先 + lib 自带 UI（`comrade-harness-lib/ui/`）兜底。

- 把 lib ui/ 里的同名文件复制到此处即覆盖（如改配色：复制 app.css 到这里再改）。
- 不在此处的文件自动回落 lib——模板/新 fork 的 public/ 天然是空的，只有变体差异才需要文件。
- 改了 lib 的 ui/（`local:on` 本地开发时）刷新即生效，无需重启。
