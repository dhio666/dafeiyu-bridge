# 大肥鱼桥（dafeiyu-bridge）

一个**本地大模型 QQ 陪伴机器人**的完整 POC：llama.cpp 跑本地视觉模型 + SnowLuma OneBot 网关 + 一个 900 行的 Node.js 桥。不需要任何云端 API，对话数据完全不出本机。

> 这个仓库是大肥鱼项目的开源参考版。它不是通用框架，而是一套**真实跑在生产 QQ 号上**的最小可读实现——读它能看懂"把本地 8B 模型调成一个像人的 QQ 好友"每一步都要解决什么问题。

## 架构

```
QQ 客户端 ← SnowLuma 网关(OneBot, 3000/3001) ← Node 桥(poc_bridge.mjs) ← llama-server(8090, 本地GGUF模型)
```

- **模型**：Qwen3-VL-8B（IQ4_XS 量化，8GB 显存满载，带 mmproj 视觉塔，能看图）
- **网关**：SnowLuma 注入 QQ 客户端，暴露 OneBot HTTP(3000)/WS(3001)
- **桥**：全部逻辑都在一个文件里——收消息、攒批、拼提示词、调 LLM、清洗回复、发回、落盘

## 桥里值得抄的东西

提示词之外，真正让 8B"像人"的是这层软件，每一条都是实测踩坑后加的：

| 机制 | 解决什么 |
|---|---|
| 攒批（DEBOUNCE 1.5s） | 用户连发几条时合成一轮，不疯抢答 |
| 防复读（dedupe + DRY 参数） | 8B 爱复读自己说过的话 |
| antiEcho + 重掷 | 检测到照抄人设示例/尾巴梗就换锚点重生成 |
| 兜底轮换 + empty 重试 | 回复被清洗为空时带锚点重试，**绝不吞消息**（见下） |
| history 脱敏 | 上一轮的测试梗不进下一轮的上下文 |
| 记忆沉淀/合并 | 每 8 轮提取记忆，每 4 段合并，人设长期稳定 |
| 多段回复 `\|\|\|` | 模型输出 `\|\|\|` 拆成多条 QQ 消息，模拟真人补刀 |
| 表情标记 `<face:xx>` | 文字描述表情，让 QQ 发对应表情 |
| 心跳 + 看门狗 | 崩了自动拉起，`poc_heartbeat.json` 可远程监控 |
| 隔离场验收（auto_accept.mjs） | 无人值守跑 N 轮对话打分，改动不伤真人体验 |

## 踩坑实录（最有价值的部分）

### 1. 吞消息 bug：`user→user→assistant` 破损结构
用户"你会发表情包吗"永远没得到回复。日志 `empty after dedupe` 锁定真因：模型回复被清洗清空后代码直接 `return`，但 user 消息**已经落盘**，留下孤儿 user；下一条消息再 push 一条 user，history 结构就坏了。
**修复**：回复为空时不再丢弃——带锚点重试一次，仍空才用轮换兜底句。保证每条消息都有回声。

### 2. 8B 的"固化反射"是容量问题，不是提示词问题
"为什么不能找你"→"找我？你问谁呢"（反问打回）、"你好"→原样照抄示例句。删示例、扫 5 组采样、加正面回答锚点，三轮 A/B 全部无效（打回率 3/12 → 3/12）。
**结论**：提示词层动不了写死在权重里的反射。要么 QLoRA 微调，要么换更大模型。

### 3. 27B（1bit 量化）实测：智力确实够了，你的显卡不够
RTX 2070 8GB 硬塞 Ternary-Bonsai-2-27B-PTQ1_0：反问打回 0/6→4/6 直接回答、照抄消失、还会真推理人设规则。但思考吃 token（150 预算 42% 空回复）、延迟 3–10 秒、且没有配 mmproj 看图直接消失。
**结论**：同一提示词 27B 就能答对 8B 答不对的问题，证实是容量边界；但 8GB 卡上生产不可行。

### 4. 一键启动的依赖顺序
启动器必须按 **模型 → QQ 客户端 → 网关（等 3000/3001 就绪）→ 桥（等心跳）** 拉起。漏了 QQ 客户端，网关没有可注入对象，OneBot 端口永远起不来——v1 只启三个组件就翻车在这里。

## 目录

```
src/
  poc_bridge.mjs      # 桥本体（约900行，全部逻辑）
  verify_bridge.mjs   # 影子回归（100+静态断言，改桥必跑）
  auto_accept.mjs     # 隔离场：无人值守跑对话并打分
  answer_ab.mjs       # A/B 考卷：量化"固化反射"的工具
launcher/
  dafeiyu_start.py    # 一键启动器（PyInstaller 打包成 exe）
  DafeiyuStart.spec   # 打包配置
bat/
  POC_BRIDGE.bat      # 启动桥
  FINGERPRINT_DAILY.bat
prompts/
  persona.example.md  # 人设卡（虚构角色示例）
  scenario.example.md # 情境底稿
  core.example.md     # 核心记忆（模型"永远记住"的行）
  history.example.jsonl # 假对话样例
config/
  config.example.json # 配置结构（令牌占位）
```

## 快速开始（仅供参考，需自备环境）

1. 自备：llama.cpp 的 `llama-server`、SnowLuma 网关、QQ NT 客户端、Node 20+
2. `cp config/config.example.json 你的配置路径`，填入网关地址与令牌
3. 改 `src/poc_bridge.mjs` 顶部的路径常量指向你的文件
4. 用 `prompts/` 里的示例换成你自己的人设
5. `node src/poc_bridge.mjs` 启动；改代码后跑 `node src/verify_bridge.mjs`

## 数据隐私

本仓库不含任何真实对话、记忆、令牌与 QQ 号：历史/记忆/日志/交接文档均已排除，QQ 号在代码里全部为占位符。真实运行数据在你的机器上自行保管。

## License

MIT
