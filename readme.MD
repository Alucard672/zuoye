# 作业清晰（微信小程序）

一个用于提升作业照片清晰度的微信小程序，支持单图优化、批量拼接、保存到本地与转发分享等功能。

## 目录结构
```
miniprogram/          # 小程序前端代码
  pages/
    index/            # 首页
    process/          # 处理页
    result/           # 结果页（保存区、操作按钮等）
  components/
  images/             # 前端资源（PNG）
cloudfunctions/       # 云函数（imageProcess、batchImageProcess）
cloudbase/            # 云托管/云函数容器配置（如使用）
```

## 快速开始
1. 克隆仓库
   ```
   git clone https://github.com/Alucard672/zuoye.git
   ```
2. 安装云函数依赖（如需）
   ```
   cd cloudfunctions/imageProcess && npm i
   cd ../batchImageProcess && npm i
   ```
3. 使用「微信开发者工具」导入 `miniprogram` 目录：
   - 项目类型选择「小程序」
   - AppID 使用你的测试/正式 AppID
   - 开启「自动热重载」便于开发
4. 运行与预览
   - 在工具中点击「编译」或「预览」
   - 如遇资源未更新，请尝试「清除缓存」后重试

## 使用说明（结果页）
- 保存区图标
  - 保存按钮：使用 `miniprogram/images/save-icon.png`
  - 分享按钮：使用 `miniprogram/images/icon-share.png`
  - 清空记录按钮：使用 `miniprogram/images/clean.png`（靠右、按钮尺寸 56rpx）
- 是否使用 PNG 图标
  - 在 `pages/result/result.js` 中通过 `data.usePngIcons` 控制
  - 设置为 `true` 时显示 PNG 图标；为 `false` 时可走备用分支或不显示
- 路径规范
  - 结果页位于 `pages/result/` 下，静态资源统一用相对路径：`../../images/...`

## 功能概览
- 单图优化：提升清晰度与文字对比度
- 批量拼接：选择多张图片纵向拼接
- 保存到相册：支持临时文件与远程下载后保存
- 优化记录：本地持久化存储，最多保留 10 条（超出覆盖最早）

## 云函数与存储
- `cloudfunctions/imageProcess`：图片处理相关逻辑（如使用）
- 本地持久化键：
  - `optimizeRecords`：保存区记录（包含文件路径、大小、时间等）

## 常见问题
- 图标加载失败（500）
  - 请确认引用路径是否为 `../../images/...`，且文件存在于 `miniprogram/images` 下
  - 避免使用根路径 `/images/...`（在开发者工具中可能导致加载失败）
- WXML 条件块语法错误
  - 确保 `wx:if` 与 `wx:else` 成对出现，避免自闭合/嵌套不匹配
- 资源未刷新
  - 在「微信开发者工具」执行「编译/预览」
  - 如仍异常，清除缓存后重试

## 研发建议
- 样式尽量使用类选择器统一管理，减少内联样式
- 图标统一放置 `miniprogram/images/`，避免多目录混用
- 如需切换图标集，可引入可配置字段（如 `shareIconPath`）减少硬编码

## 许可
本项目仅用于学习与演示，具体授权或开源许可请根据实际需求补充。