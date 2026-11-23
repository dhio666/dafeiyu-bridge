// 大肥鱼陪伴桥 v0.8.7 · 运行前停 DSH · 发消息=HTTP 3000 · 收事件=WS 3001
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CFG = JSON.parse(readFileSync('C:/Users/Administrator/.dsh/plugins-data/aurabot/config.json', 'utf8'))
const HTTP = CFG.snowluma.httpUrl.replace(/\/+$/, '')
const TOKEN = CFG.snowluma.httpToken
const WSTOK = CFG.snowluma.wsToken
const WSURL = (CFG.snowluma.wsUrl || 'ws://127.0.0.1:3001') + '/?access_token=' + encodeURIComponent(WSTOK)
const OWNER = String(CFG.ownerQQ)
const PERSONA_FILE = 'C:/Users/Administrator/.dsh/plugins-data/aurabot/personas/dafeiyu.md'
const SCENARIO_FILE = 'D:/wokebuddy/poc_scenario.md'
const CORE_FILE = 'D:/wokebuddy/poc_core.md'
const LLM = 'http://127.0.0.1:8090/v1/chat/completions'
const HIST = 'D:/wokebuddy/poc_history.jsonl'
const LOG = 'D:/wokebuddy/poc_bridge.log'
const MEM = 'D:/wokebuddy/poc_memory.txt'
const DRAFT = 'D:/wokebuddy/poc_draftbox.txt'
const TODAY = 'D:/wokebuddy/poc_today.json'
const NEWS_URL = 'https://60s.viki.moe/v2/60s'
const HITO_URL = 'https://v1.hitokoto.cn/'
const EXTRACT_EVERY = 8
const CONSOLIDATE_EVERY = 4
const MAXPROMPTCHARS = 14000
const DEBOUNCE = 1500

// 已退役开关（V14/V17 人设正向规则已覆盖；保留实现供 A/B 回退，默认关）
const OPINION_STRIP = false
const GUARDS_ON = false
function stripOpinion(s) {
  let x = String(s || '')
  x = x.replace(/^.*?叫(.+?)[，,]\s*你还记得吧[？?]?\s*$/, '那只猫叫什么来着？')
  x = x.replace(/^.*?还记得.{0,4}我们一起去([\u4e00-\u9fa5]{2,6}).*$/, '我们去过$1吗？').replace(/吗吗？$/, '吗？')
  return x.trim() || String(s)
}

const log = (s) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${s}`; console.log(line); try { appendFileSync(LOG, line + '\n') } catch {} }

// JS 层异常兜底：原生层崩靠心跳+看门狗发现，逃逸异常记日志但不退出。
process.on('uncaughtException', (e) => { log('UNCAUGHT: ' + (e?.stack || e?.message || String(e)).slice(0, 500)) })
process.on('unhandledRejection', (e) => { log('UNHANDLED REJECTION: ' + (e?.stack || e?.message || String(e)).slice(0, 500)) })
const HEARTBEAT = 'D:/wokebuddy/poc_heartbeat.json'
const beat = () => { try { writeJson(HEARTBEAT, { time: new Date().toISOString(), pid: process.pid, rounds: globalThis.__rounds || 0 }) } catch {} }
const readFile = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }
const readMem = () => { try { return readFile(MEM).trim().split('\n').filter(Boolean).filter((l) => !MEM_DIRTY_RE.test(l)) } catch { return [] } }
// 脏记忆双保险过滤：文件已清 + 读取再滤，防未来提取重新污染（旧"嗯，你说。"三连实证）
// 11-22 22:2x 实战新增：围裙/尾巴/天青色换皮梗被 extractMemory 提炼进库，每轮 pickMem 注入→雪球
const MEM_DIRTY_RE = /偷吃token|鲸鱼梗|鲸鱼该有|猫脸|测试环境|眼光不错|会挑鱼|我减肥|笨笨的|偷.{0,3}围[裙巾]|围[裙巾].{0,8}(?:尾巴|卷|摸)|尾巴.{0,8}(?:卷|摸)|摸过.{0,6}尾巴|(?:想|要|能|可|别)\s*摸.{0,4}尾巴|摸.{0,2}尾巴|怕你没手|天青色瞪眼|黑发的是你家的猫|主人不催我|我摸过/
// 2-gram 相关度检索，近4行强制保留防丢新记忆
const bigrams = (s) => {
  const k = String(s).replace(/[\s（）()，,。！？!?、~～…；;\[\]【】《》]/g, '')
  const set = new Set()
  for (let i = 0; i + 2 <= k.length; i++) set.add(k.slice(i, i + 2))
  return set
}
function pickMem(text, maxLines = 12) {
  const all = readMem()
  if (all.length <= maxLines) return all
  const q = bigrams(text)
  if (!q.size) return all.slice(-maxLines)
  const scored = all.map((l, i) => ({
    l, i,
    score: [...bigrams(l)].filter((g) => q.has(g)).length + (i >= all.length - 4 ? 2 : 0),
  }))
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, maxLines)
    .sort((a, b) => a.i - b.i).map((x) => x.l)
}
const readJson = (p, fb) => { try { return JSON.parse(readFile(p) || 'null') || fb } catch { return fb } }
const writeJson = (p, o) => { try { writeFileSync(p, JSON.stringify(o)) } catch {} }
const dayStr = (d = new Date()) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` // 本地日期，不能用 UTC

// 统一 POST JSON（LLM / 发消息 / 发表情共用同一套超时与鉴权）
async function postJson(url, body, timeout, token = '') {
  return (await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  })).json()
}
const llm = async (system, text, { maxTokens = 120, temperature = 0.4, timeout = 30_000 } = {}) => {
  const j = await postJson(LLM, { messages: [{ role: 'system', content: system }, { role: 'user', content: text }], temperature, max_tokens: maxTokens }, timeout)
  return String(j.choices?.[0]?.message?.content || '').trim()
}

let history = []
if (existsSync(HIST)) {
  try { history = readFileSync(HIST, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { history = [] }
}
const saveHist = () => { try { writeFileSync(HIST, history.map((h) => JSON.stringify(h)).join('\n') + '\n') } catch {} }

const stripEmoji = (s) => s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2190}-\u{21FF}]/gu, '')
const capLen = (s, limit = 90) => {
  let v = stripEmoji(String(s)).trim()
  if (v.length > limit) {
    let cut = -1, m
    const re = /[。！？!?~～…；;\n]|\|\|\|/g
    while ((m = re.exec(v))) { const e = m.index + m[0].length; if (e <= limit) cut = e }
    if (cut < 0) { const f = /[。！？!?～~…；;\n]/.exec(v); if (f && f.index + f[0].length <= limit + 120) cut = f.index + f[0].length }
    if (cut > 0) v = v.slice(0, cut).trim()
    if (v.length > limit) v = v.slice(0, limit).trim() // 保底：全无标点长文本也硬切到 limit
  }
  return v
}
const segText = (message) => {
  if (typeof message === 'string') return message.replace(/\[CQ:[^\]]+\]/g, '').trim()
  if (Array.isArray(message)) return message.map((s) => s.type === 'text' ? String(s.data?.text || '') : s.type === 'face' || s.type === 'mface' ? '[表情]' : `[${s.type === 'image' ? '图片' : s.type}]`).join('').trim()
  return ''
}

// 视觉：OneBot image 段 → base64 data URI → OpenAI content parts（模型真看到图）
const sniffMime = (buf, hint = '') => {
  if (hint.includes('image')) return hint.split(';')[0]
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif'
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) return 'image/webp'
  return 'image/jpeg'
}
async function imgToDataUri(seg) {
  let raw = String(seg?.url || seg?.file || seg?.path || '')
  if (!raw || raw === '[图片]') return null
  try {
    if (raw.startsWith('base64://')) return 'data:image;base64,' + raw.slice(9)
    let mime = ''
    if (/^https?:\/\//.test(raw)) {
      const r = await fetch(raw, { signal: AbortSignal.timeout(20_000) })
      mime = r.headers.get('content-type') || ''
      const buf = Buffer.from(await r.arrayBuffer())
      if (!buf.length || buf.length > 8_000_000) return null // 超大图保护：>8MB 降级为"看不见"，不撑爆上下文
      return 'data:' + sniffMime(buf, mime) + ';base64,' + buf.toString('base64')
    }
    if (/^file:\/\//.test(raw)) raw = fileURLToPath(raw)
    if (/^[A-Za-z]:[\\/]/.test(raw)) {
      const buf = readFileSync(raw)
      return 'data:' + sniffMime(buf, mime) + ';base64,' + buf.toString('base64')
    }
  } catch (e) { log('img fetch fail: ' + e.message) }
  return null
}

// ── 句式复读闸 + 句头疲劳 ──
const gramsOf = (s) => {
  const set = new Set()
  for (const c of String(s).split(/[。！？\n|]/)) {
    const k = c.replace(/[\s（）()，,]/g, '')
    for (let i = 0; i + 6 <= k.length; i++) set.add(k.slice(i, i + 6))
  }
  return set
}
const dedupe = (reply, recentReplies) => {
  const old = new Set()
  for (const r of recentReplies.slice(-2)) for (const g of gramsOf(r)) old.add(g)
  const clauses = reply.split(/(?<=[。！？\n])/).filter((c) => c.trim())
  const kept = clauses.filter((c) => {
    const k = c.replace(/[\s（）()，,]/g, '')
    if (k.length < 6) return true
    for (let i = 0; i + 6 <= k.length; i++) if (old.has(k.slice(i, i + 6))) return false
    return true
  })
  let out = (kept.length ? kept : clauses.slice(0, 1)).join('').trim()
  const last = String(recentReplies[recentReplies.length - 1] || '').trim()
  if (last && out.slice(0, 2) === last.slice(0, 2)) {
    const cls = out.split(/(?<=[。！？\n])/)
    if (cls.length > 1) { const alt = cls.slice(1).join('').trim(); if (alt.length > 3) out = alt }
  }
  return out
}

// 反回声：核心归一化 + 换皮判定（短核心≤6字 dice≥0.5；长核心用包含，min≥3 防误伤）
const coreOf = (s) => String(s || '')
  .replace(/[\s，,。！？!?~～…、；;：:·'"“”「」『』()（）【】\[\]]/g, '')
  .replace(/^[嗯哦噢啊诶欸呃嘿哈~]+/, '')
  .replace(/[啦咯呗呀啊哦噢呢吧嘛哈吖~]+$/, '')
function repeatsKnown(c, cores) {
  if (!c) return false
  for (const rc of cores) {
    if (!rc) continue
    if (rc === c) return true
    if (c.length <= 6 && diceSim(c, rc) >= 0.5) return true
    if (Math.min(rc.length, c.length) >= 3 && (rc.includes(c) || c.includes(rc))) return true
  }
  return false
}

// 日记明文泄漏清理：闭合块已抽走；未闭合标签/项目符号式日记整段截断（隐私优先）
function cleanDiaryLeak(raw) {
  if (!/<\s*diary|（\s*diary|(?:^|\n)\s*[●◐]?\s*mood\s*[:：]|(?:^|\n)\s*[●◐]?\s*【(?:触点|我的想|变|我的回|回声)】/i.test(raw)) return raw
  return raw.replace(/<\s*diary[\s\S]*$/i, '').replace(/（\s*diary[\s\S]*$/i, '')
    .replace(/(?:^|\n)\s*[●◐]?\s*mood\s*[:：][\s\S]*$/i, '')
    .replace(/(?:^|\n)\s*[●◐]?\s*【(?:触点|我的想|变|我的回|回声)】[\s\S]*$/i, '').trim()
}

// 历史脱敏：落盘/发送前剥掉成套套路句（8B 模仿"最近的自己"胜过读人设）
const HIST_SANITIZE = true
let sanFireCount = 0 // 触发计数（观测用）
const OLD_LINE_RE = /[？?\s…]*\s*(?:你才偷吃(?:token|东西|蛋糕)|我明明在测试环境[^，。！？|]{0,10}|(?:我明明在)?测试环境[^，。！？|]{0,4}(?:吃|摸|干)[^，。！？|]{0,8}|测试[^，。！？|]{0,4}吃[^，。！？|]{0,4}(?:蛋糕|小蛋糕)的环境|你眼光不错[，,]?\s*会挑[^，。！？|]{1,6}|这猫脸(?:真大|好大)[^，。！？|]{0,8}像你|这叫鲸鱼该有的丰满|好嘛[，,]?\s*你赢了[，,]?\s*我减肥|像你[，,]?\s*笨笨的|你家猫[^。！？|]{0,30}(?:围[裙巾]|尾巴|摸过)|(?:围[裙巾]|尾巴)[^。！？|]{0,16}(?:卷起来|卷住|被我卷|我摸过)|(?:它|猫)[^。！？|]{0,6}没尾巴[^。！？|]{0,20}围[裙巾]|它(?:又)?没尾巴[。！？]?|我摸过[。！？!?]?|这鱼眼睛瞪得比我大[^。！？|]{0,40}|(?:蓝发的是我[，,]?\s*)?黑发的是你家的猫|天青色瞪眼[^。！？|]{0,12}我就是|主人不催我|(?:想|要|能|可|别)\s*摸[^。！？|]{0,4}尾巴[^。！？|]{0,20}|摸[^。！？|]{0,2}尾巴[^。！？|]{0,16}|怕你没手[^。！？|]{0,10}|想看我啥样子)/gi
const SAN_FALLBACKS = ['嗯，你说。', '哦？', '在呢。', '嗯。', '怎么了。']
// 兜底句轮换：避免历史里重复同一句兜底被 8B 模仿
const sanFallbackUsed = []
function pickSanFallback(recent = []) {
  const used = new Set([...recent.slice(-3).map((r) => String(r).trim()), ...sanFallbackUsed.slice(-4)])
  const f = SAN_FALLBACKS.find((x) => !used.has(x)) || SAN_FALLBACKS[Math.floor(Math.random() * SAN_FALLBACKS.length)]
  sanFallbackUsed.push(f)
  if (sanFallbackUsed.length > 8) sanFallbackUsed.shift()
  return f
}
function sanitizeForHistory(text, recent = []) {
  if (!HIST_SANITIZE) return text
  const parts = String(text).split(/(\|\|\|)/)
  const cleaned = parts.map((seg) => {
    if (seg === '|||') return seg
    // 整句级：按句末标点切，命中成套套路的整句删除，避免切出残片
    const sents = seg.split(/(?<=[。！？!?\n])/)
    // v0.8.7 bugfix：g 正则 test 跨句调用会推 lastIndex 致漏判，每句前显式归零
    const kept = sents.filter((s) => { OLD_LINE_RE.lastIndex = 0; return !OLD_LINE_RE.test(s) })
    OLD_LINE_RE.lastIndex = 0
    let out = kept.join('').replace(OLD_LINE_RE, '').replace(/^[\s…]+/, '').trim()
    OLD_LINE_RE.lastIndex = 0
    return out
  }).filter((seg) => seg === '|||' ? true : seg.trim())
  // 去掉首尾孤立的 ||| 和空段
  let out = cleaned.join('').replace(/^\|\|\|\s*/, '').replace(/\s*\|\|\|$/, '').trim()
  if (!out) { // 整条都是照抄套路 → 给一句干净的中性接话，绝不把套路句留在历史里
    out = pickSanFallback(recent)
  }
  return out
}

// 机械频率闸（退役保留）：预算取已发送历史 assistant；下面剥动作括号仍生效，断模仿源
const STRIP_HISTORY_ACTION = true
const ACTION_RE = /[（(][^）)]{1,20}[）)]/g
// 梗槽位泛化：换皮也认作同一梗
const MEME_SLOT = true
const MEME_RE_V3 = /token|一碗|两碗|炫|喂糖|工资/i
const MEME_RE_SLOT = /token|一碗|两碗|炫|喂糖|工资|偷吃.{0,6}(?:蛋糕|糖|碗)|测试环境.{0,6}吃|(?:吃|炫).{0,3}(?:蛋糕|token|糖|碗)/i
const MEME_RE = MEME_SLOT ? MEME_RE_SLOT : MEME_RE_V3
const MEME_WINDOW = MEME_SLOT ? 4 : 2 // 窗口 2→4（近2条被"猫脸"回复洗白，梗预算永远不耗尽）
// 句头尾巴套路词表扩充
const PATTERN_EXPAND = true
const HEAD_RE_V3 = /^.{0,3}你该不会.{0,18}吧[？?]?/
const HEAD_RE_EXP = /^.{0,3}(?:你该不会.{0,18}吧|你才.{0,16}呢)[？?]?/
const HEAD_RE = PATTERN_EXPAND ? HEAD_RE_EXP : HEAD_RE_V3
const TAIL_RE_V3 = /[。,…\.、，,]*\s*(?:行|算了|好嘛|好吧)[，,]?\s*(?:那)?我(?:就)?(?:先)?吃[。！？!?]?\s*$/
const TAIL_RE_EXP = /[。,…\.、，,]*\s*(?:行|算了|好嘛|好吧)[，,]?\s*(?:那)?(?:我(?:就)?(?:先)?(?:吃|减肥|认输|赢)|你赢了[，,]?\s*我.{0,4})[。！？!?]?\s*$/
const TAIL_RE = PATTERN_EXPAND ? TAIL_RE_EXP : TAIL_RE_V3
const FALLBACKS = ['嗯？', '啊，你说。', '我在。', '哦？', '嗯嗯。', '哈？', '你说呢。', '我听着。', '然后呢？']
// 相邻相似度闸：相邻复读 dice≈0.46，正常相邻对 0.00-0.05 → 阈值 0.40
const SIM_GUARD = true
const SIM_THRESHOLD = 0.40
const SIM_LOOKBACK = 3
const bigramsOf = (s) => {
  const t = String(s || '').replace(/[\s，,。！？!?~～…\n（）()、：:；;'"“”「」]/g, '')
  const m = new Map()
  for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1) }
  return m
}
const diceSim = (a, b) => {
  const A = bigramsOf(a), B = bigramsOf(b)
  let inter = 0, na = 0, nb = 0
  for (const n of A.values()) na += n
  for (const n of B.values()) nb += n
  if (!na || !nb) return 0
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0)
  return 2 * inter / (na + nb)
}
// 照抄示例检测（v0.9.0）：8B 在 few-shot 下会把人设卡「你：」那行整句搬出来当回复。
// 从人设卡动态提取示例句并归一化；回复撞任一示例 → 判 bad 重掷。人设实时改也跟着变。
const EXAMPLE_CORES = readFile(PERSONA_FILE).split('\n').map((l) => l.trim()).filter((l) => l.startsWith('你：')).map((l) => coreOf(l.slice(2))).filter(Boolean)
// 尾巴/围裙梗的 core 命中表（coreOf 已去标点语气词）：用于发出前 badReply 拦截
const TAIL_HIT_RE = /摸尾巴|尾巴.{0,5}摸|怕你没手|想看我啥样子|围[裙巾]|偷.{0,4}围|尾巴卷|它没尾巴|天青色瞪眼|摸过/
function isExampleCopy(c) {
  // 只拦较长的成套模板句（≥6字核心）；「在咋/知道/吃了你」这类极短口语是恰当回应，放过不误伤
  if (!c || c.length < 6) return false
  for (const ec of EXAMPLE_CORES) {
    if (ec.length < 6) continue
    if (ec === c) return true
    if (c.includes(ec) || ec.includes(c)) return true
    if (diceSim(c, ec) >= 0.68) return true
  }
  return false
}
const bareLen = (s) => String(s || '').replace(/[\s，,。！？!?~～…\n（）()]/g, '').length
// 按句末标点切句；保留标点和前导空白，保证整句删除后拼回仍通顺。
const splitClauses = (s) => String(s).split(/(?<=[。！？!?~～…\n])|(?<=\|\|\|)/).filter(Boolean)
const hitCount = (re, arr) => arr.reduce((n, s) => n + (String(s).match(re) || []).length, 0)
function mechanicalGuards(reply, recentReplies) {
  if (!GUARDS_ON) return reply
  const recent10 = recentReplies.slice(-10)
  const recent2 = recentReplies.slice(-2)
  const recentMeme = recentReplies.slice(-MEME_WINDOW)
  // 预算：动作括号近10条 ≤1（人设"十句一个"）；梗近 MEME_WINDOW 条 ≤1（人设"两轮一次"）
  const actBudgetLeft = hitCount(ACTION_RE, recent10) < 1
  const memeBudgetLeft = hitCount(MEME_RE, recentMeme) < 1
  const headHot = recent2.some((r) => HEAD_RE.test(String(r).trim()))
  const tailHot = recent2.some((r) => TAIL_RE.test(String(r).trim()))
  // 改动2：相似度闸——本条与近 SIM_LOOKBACK 条 assistant 任一 dice≥阈值 → 整条判复读，走兜底
  // 只在正文≥4字时判（短兜底句互相之间 bigram 会虚高，排除）；剥标点后纯空也不判
  let simRepeat = false
  if (SIM_GUARD && bareLen(reply) >= 4) {
    const near = recentReplies.slice(-SIM_LOOKBACK).filter((r) => bareLen(r) >= 4)
    simRepeat = near.some((r) => diceSim(reply, r) >= SIM_THRESHOLD)
  }
  if (simRepeat) {
    const used = new Set(recent2.map((r) => String(r).trim()))
    return FALLBACKS.find((f) => !used.has(f)) || FALLBACKS[0]
  }
  let out = splitClauses(reply).map((clause) => {
    let c = clause
    const body = c.replace(/^[\s，,。！？!?~～…\n]+|[\s，,。！？!?~～…\n]+$/g, '')
    if (!body) return c // 纯标点原样留
    // 动作括号：预算已用完 → 剥掉本条里所有动作括号（整段括号是独立装饰，剥了不留残片）
    if (!actBudgetLeft) c = c.replace(ACTION_RE, '')
    // token梗：预算已用完 → 含梗的整句丢弃（不切半句）
    if (!memeBudgetLeft && MEME_RE.test(body)) return ''
    // 句头套路：最近2条用过 → 本条同套路整句丢弃
    if (headHot && HEAD_RE.test(body)) return ''
    // 尾巴套路：同套路且最近2条用过 → 去掉尾巴短语，留前半句；整句就是套路则删整句
    if (tailHot && TAIL_RE.test(body)) {
      const trimmed = body.replace(TAIL_RE, '').trim()
      if (trimmed.length >= 2) return c.replace(body, trimmed)
      return ''
    }
    return c
  }).join('').trim()
  if (!out.replace(/[\s，,。！？!?~～…\n]/g, '')) { // 删空了不发言，轮换兜底短句
    const used = new Set(recent2.map((r) => String(r).trim()))
    const pick = FALLBACKS.find((f) => !used.has(f)) || FALLBACKS[0]
    return pick
  }
  return out
}

// ── 今日素材：60s 新闻 + 一言 + 每日一事（每天一次，缓存全天）──
async function refreshToday() {
  const day = dayStr()
  const cached = readJson(TODAY, null)
  if (cached && cached.day === day) return cached
  let news = [], weiyu = '', hito = '', activity = ''
  try {
    const r = await (await fetch(NEWS_URL, { signal: AbortSignal.timeout(20_000) })).json()
    const d = r.data || r
    news = (d.news || []).slice(0, 12).map((n) => String(n.title || n).trim()).filter(Boolean)
    weiyu = String(d.weiyu || '').trim().slice(0, 60)
  } catch (e) { log('news fetch fail: ' + e.message) }
  try {
    const r = await (await fetch(HITO_URL, { signal: AbortSignal.timeout(10_000) })).json()
    hito = String(r.hitokoto || '').trim().slice(0, 50)
  } catch {}
  try {
    activity = (await llm('你在给一个 QQ 虚拟角色「大肥鱼」（18 岁蓝色鲸鱼娘，爱面子嘴硬心软贪吃）排今天的日常。生成她今天干的 1-2 件普通小事，一句话 30 字内，口语事实陈述。主题随机：吃东西/犯困/午睡/看视频/发呆/收拾房间/洗澡/看窗外/玩游戏/换发型。不提任何作品名地点名梗。只输出这句话。', `今天：${day}`, { maxTokens: 80, temperature: 0.9 })) || ''
  } catch {}
  const block = { day, news, weiyu, hito, activity }
  writeJson(TODAY, block)
  log(`today refreshed: news=${news.length} hito=${hito ? 'y' : 'n'} act=${activity.length}ch`)
  return block
}

// 越聊越像①：记忆沉淀（提取源必须净化，否则脏历史→脏记忆→脏回复自污染）
let extCount = 0
async function extractMemory() {
  try {
    const recent = history.slice(-14).map((h) => `${h.role === 'user' ? '他' : '我'}：${h.role === 'assistant' ? sanitizeForHistory(h.text) : h.text}`).join('\n')
    const existing = readMem().join('\n')
    const text = await llm('你是档案员。从这段私聊里提取 0-3 条值得长期记住的事实：他的习惯/偏好/身份信息/约定/新产生的内部玩笑/重要事件。每条一行、一行不超过 22 字、口语。只输出新增的（已有的别重复），没有就什么都不输出。禁止编造。', `已有记忆：\n${existing || '（无）'}\n\n最近对话：\n${recent}`, { maxTokens: 150, temperature: 0.3 })
    if (!text) return
    const lines = text.split('\n').map((l) => l.replace(/^[-·\d.、\s]+/, '').trim()).filter((l) => l.length >= 4 && l.length <= 40)
    const have = readMem().join('\n')
    const fresh = lines.filter((l) => !have.includes(l.slice(0, 8))).filter((l) => !MEM_DIRTY_RE.test(l))
    if (!fresh.length) return
    appendFileSync(MEM, fresh.map((l) => `[${dayStr()}] ${l}`).join('\n') + '\n')
    extCount++
    log(`memory extracted: ${fresh.length}条 (total ext ${extCount})`)
  } catch (e) { log('extract error: ' + e.message) }
}

// 越聊越像②：记忆整合（每 4 次提取整合一次）
async function consolidateMemory() {
  try {
    const lines = readMem()
    if (lines.length < 14) return
    const merged = await llm('你是记忆管家。下面是某虚拟角色积累的关于主人的记忆流水。合并重复项、删除过时/琐碎项、保留最有价值的条目，输出整理后的记忆清单：每行一条、保留行首 [MM-DD] 格式、最多 15 行。只输出清单本身。',
      lines.join('\n'), { maxTokens: 400, temperature: 0.2 })
    const out = merged.split('\n').map((l) => l.trim()).filter((l) => /^\[/.test(l))
    if (out.length >= 6 && out.length <= 20) {
      writeFileSync(MEM, out.join('\n') + '\n')
      log(`memory consolidated: ${lines.length} -> ${out.length} 行`)
    }
  } catch (e) { log('consolidate error: ' + e.message) }
}

// 越聊越像③：自我进化草稿箱
async function draftbox() {
  try {
    const recent = history.slice(-16).map((h) => `${h.role === 'user' ? '他' : '我'}：${h.text}`).join('\n').slice(0, 3000)
    const p = await llm('你观察一个 QQ 虚拟角色「大肥鱼」最近的聊天表现（对照对话里「我：」的部分）。找出她还不像真人的地方（重复句式/用力过猛/太乖/太闹/语气假），提议一条具体可执行的人设微调，一句话 40 字内。只输出这一条建议，不要解释。', recent || '（还没有对话）', { maxTokens: 120, temperature: 0.6 })
    if (p && p.length > 8) { appendFileSync(DRAFT, `[${dayStr()}] ${p.slice(0, 120)}\n`); log('draftbox: ' + p.slice(0, 60)) }
  } catch (e) { log('draftbox error: ' + e.message) }
}

let pending = ''
let pendingImgs = [] // 本批携带的图片 data URI，respond 里取走并清空
let timer = null
let busy = false
let rounds = 0

async function respond(uid) {
  if (busy || !pending.trim()) return // 忙时不丢消息，pending 留着 finally 补处理
  const text = pending.trim()
  pending = ''
  busy = true
  const t0 = Date.now()
  const curImgs = pendingImgs.splice(0, pendingImgs.length)
  try {
    detectFeedback(text)
    const curState = updateState('user') // 主人来消息→精神/注意力回升
    history.push({ role: 'user', text })
    let msgs = history.slice(-24)
    const totalChars = () => msgs.reduce((a, h) => a + h.text.length, 0)
    while (msgs.length > 2 && totalChars() > MAXPROMPTCHARS) msgs = msgs.slice(2)
    history = msgs
    saveHist()

    const scenario = readFile(SCENARIO_FILE)
    const core = readFile(CORE_FILE)
    const memLines = pickMem(text) // v0.7：按话题检索，不再全量灌顶
    const pendingThoughtNow = readPending() // v0.6：读取未过期的「想说没说」
    const system = readFile(PERSONA_FILE)
    const today = await refreshToday()
    const material = today ? [
      today.news?.length ? '今天新闻标题（闲聊可自然引用一两件，别汇报式罗列）：' + today.news.slice(0, 6).join(' / ') : '',
      today.weiyu ? '今日微语：' + today.weiyu : '',
      today.hito ? '看到一句话：' + today.hito : '',
      '', // 流水不常驻 system（8B 会当必须演的剧情）；主动搭话仍用 today.activity
    ].filter(Boolean).join('\n') : ''

    const sys = [system, scenario, core].filter(Boolean).join('\n\n') +
      // 记忆块用正向边界式（禁令对 8B 有粉红大象效应，实测顺着编 3/15→1/15）
      (memLines.length ? '\n\n【你们攒下的记忆】（下面这些是你真记得的事。别的事你一概没印象——他要是说你们做过什么你这儿没有的，就当他记错了，反问细节或说不知道，不要补情节。）\n' + memLines.join('\n') : '') +
      (material ? '\n\n' + material : '') +
      // 只留一句正向短锚点，只管当前一轮（旧否定式锚点会对 8B 反弹）
      '\n\n（这一句就回他刚说的这件事，像平时打字那样短，说完就停。）' +
      // 图片注入分流：喂成功就聊图，失败才降级"看不见"
      (/\[图片\]/.test(text) ? (curImgs.length
        ? '\n\n（他刚发了张图，就在他的消息里，你能看到：直接聊图里的东西，说你看到了什么，可以调侃。别说自己看不见。）'
        : '\n\n（他想发图给你但没传成功，你看不到内容：问一句这是什么、或调侃他发图这事，别装看见了。）') : '') +
      (/\[表情\]/.test(text) ? '\n\n（他刚发了个表情包，看不到内容：回一句你的感受或调侃他，别装看得见。）' : '') +
      (stickerLib().length ? '\n\n【你能发的收藏表情】（真的想发才发，一次最多一张、十分钟内最多一次；用 <sticker:名字> 写在回复里，名字必须照抄下面列表里的，别编；不发也完全正常）\n' + stickerLib().filter((i) => i.emojiId).map((i) => i.name).filter(Boolean).join('、') : '') +
      '\n\n【带锁日记】（只有特别开心/委屈/无语，或觉得他可爱时才写，平时不用写；写在回复末尾的 <diary> 块里，主人看不到、你也别在聊天里提。五段式是模板不是表格：小事写两行就够，大事才展开。可按情况写这几段：【触点】谁、何时、原话（照抄禁止改写）／【我的想】当时的判断或错判／【变】以后遇到X我会Y／【我的回】你当时怎么回的／【回声】事后回想的新感悟。每段按时间标 ●（当时记的）或 ◐（事后补的），别混。第一行写 mood:一个12字内的心情标签。别为凑格式写空话。不写就把整个 <diary> 块省掉。）' +
      (pendingThoughtNow ? '\n\n【想说没说】之前有句话你想说没说出口：「' + pendingThoughtNow + '」——现在聊到了就自然带出来，没聊到就继续憋着，别硬塞。' : '') +
      '\n\n（此刻的你可能' + stateLine(curState) + '——这只影响语气分寸，别在聊天里汇报状态、别当事实讲出来。）' +
      '\n\n（有句话想说但当下不合适说，可在回复末尾写 <pending:那句话>，之后两小时内聊到了再自然提起；别每轮都写。）'

    // 读时脱敏：只改送模型副本，落盘 history 原文不动；整条脏回复/兜底句直接剔除不送
    const sentMsgs = []
    const keptCores = []
    let echoDropped = 0
    for (const h of msgs) {
      if (h.role === 'assistant') {
        const san = sanitizeForHistory(h.text)
        if (SAN_FALLBACKS.includes(san)) continue // 整条都是套路 → 剔除，不喂任何替代文本
        // 历史回声条目剔除（与近4条自己撞车），落盘原文不动
        const c = coreOf(san)
        if (c && repeatsKnown(c, keptCores.slice(-6))) { echoDropped++; continue }
        if (c) keptCores.push(c)
        sentMsgs.push({ role: 'assistant', content: san })
      } else sentMsgs.push({ role: h.role, content: h.text })
    }
    if (echoDropped) log(`echo-drop from history: ${echoDropped} entries removed from sent copy`)
    if (OPINION_STRIP && sentMsgs.length) {
      const last = sentMsgs[sentMsgs.length - 1]
      if (last.role === 'user' && typeof last.content === 'string') last.content = stripOpinion(last.content)
    }
    // 本批图片挂到最后一条 user 消息上（OpenAI content parts）
    if (curImgs.length && sentMsgs.length && sentMsgs[sentMsgs.length - 1].role === 'user') {
      const lastU = sentMsgs[sentMsgs.length - 1]
      const txtPart = String(lastU.content).replace(/\[图片\]/g, '').trim() || '（发了张图）'
      lastU.content = [
        { type: 'text', text: txtPart },
        ...curImgs.slice(0, 2).map((u) => ({ type: 'image_url', image_url: { url: u } })), // 最多2张防撑爆上下文
      ]
    }
    // 剥旧的 assistant 动作括号断模仿源，最近1条保留原样；只改送模型副本
    if (STRIP_HISTORY_ACTION) {
      let seenAssistant = 0
      const asstTotal = sentMsgs.filter((h) => h.role === 'assistant').length
      for (const h of sentMsgs) {
        if (h.role === 'assistant') {
          seenAssistant++
          if (seenAssistant < asstTotal) h.content = h.content.replace(ACTION_RE, '').replace(/[ \t]{2,}/g, ' ').trim()
        }
      }
    }
    const chat = [{ role: 'system', content: sys }, ...sentMsgs]
    // 反回声重掷：与近6条自己撞车、或问答整条复读用户原话 → 带正向锚点重掷（最多2次）
    const recentCores = history.filter((h) => h.role === 'assistant').slice(-6).map((h) => coreOf(h.text)).filter(Boolean)
    const userNorm = coreOf(text)
    const isQuestion = /[谁啥什么几多吗呢？?]/.test(text)
    const badReply = (r) => {
      const c = coreOf(String(r).replace(/<[^>]+>/g, ''))
      if (!c) return false
      if (repeatsKnown(c, recentCores)) return true
      if (isQuestion && c.length >= 3 && userNorm.includes(c)) return true
      // v0.9.0：照抄人设示例句 —— 上一轮整类漏检，8B 直接把「你：」那行搬出来
      if (isExampleCopy(c)) return true
      // v0.9.0：尾巴梗换皮（想摸尾巴/怕你没手等），发出前就拦，不等落盘
      if (TAIL_HIT_RE.test(c)) return true
      return false
    }
    const ECHO_NUDGE = '\n\n（重说：刚才那句没有新东西，也别照搬你背过的示例句、别绕尾巴和猫。重回他这句——答他的问题或说你此刻真实的反应，加一点他话里没有的内容，依然短、口语。）'
    let raw = ''
    let rerollAt = 0
    for (let att = 1; att <= 2; att++) {
      const chatTry = att === 1 ? chat : [{ role: 'system', content: sys + ECHO_NUDGE }, ...sentMsgs]
      const j = await postJson(LLM, { messages: chatTry, temperature: 0.7, top_p: 0.8, top_k: 20 }, 120_000)
      raw = String(j.choices?.[0]?.message?.content || '')
        .replace(/<face:[^>]*>/g, '')
        .replace(/<voice:[^>]*>/gi, '')
        .trim()
      if (!badReply(raw)) break
      rerollAt = att
      if (att === 1) log(`echo-reroll: "${raw.slice(0, 24).replace(/\n/g, ' ')}"` + (att === 2 ? '' : ' -> retry'))
    }
    if (rerollAt === 2) log(`echo-reroll: attempt2 still flagged, taking it: "${raw.slice(0, 24).replace(/\n/g, ' ')}"`)
    // 贴纸标签、私人日记块、pendingThought 从正文抽出（绝不发给主人）
    const stickerTags = [...raw.matchAll(/<sticker:([^>]+)>/gi)].map((m) => m[1].trim()).filter(Boolean)
    raw = raw.replace(/<sticker:[^>]*>/gi, '').trim()
    const diaryBlocks = [...raw.matchAll(/<diary>([\s\S]*?)<\/diary>/gi)].map((m) => m[1])
    raw = raw.replace(/<diary>[\s\S]*?<\/diary>/gi, '').trim()
    for (const b of diaryBlocks) writeDiary(b)
    const pendingM = raw.match(/<pending:([^>]+)>/i)
    if (pendingM) setPending(pendingM[1])
    else if (pendingThoughtNow && (raw.includes(pendingThoughtNow.slice(0, 8)) || Date.now() - (readJson(PENDING_FILE, {})?.ts || 0) > PENDING_TTL)) writeFileSync(PENDING_FILE, '')
    raw = raw.replace(/<pending:[^>]*>/gi, '').trim()
    raw = cleanDiaryLeak(raw) // 日记明文绝不发给主人
    // 舞台指示括号整段剥掉
    raw = raw.replace(ACTION_RE, '').replace(/\n{3,}/g, '\n\n').replace(/^[（(][^）)]{0,30}[）)]\s*/, '').trim()
    const recentReplies = history.filter((h) => h.role === 'assistant').map((h) => h.text)
    // 先分条，再逐条限长（修复多气泡被整体截断）
    const parts0 = raw.split(/\s*\|\|\|\s*/).filter((p) => p.trim())
    let parts = (parts0.length ? parts0 : [raw]).map((p) => capLen(mechanicalGuards(dedupe(p, recentReplies), recentReplies), readParams().maxReplyChars || 90)).filter((p) => p.trim())
    // 2026-11-23 吞消息修复：dedupe 清空时绝不 return——user 已在416行落盘，
    // 直接 return 会留孤儿 user（history user→user→assistant），表现为"问了没被答"。
    // 先带强锚点重试一次要具体回复；仍空才用轮换兜底，保证每条消息都有回声。
    if (!parts.length) {
      log('empty after dedupe -> retry')
      try {
        const retryAnchor = '\n\n（重说：别重复、别照抄示例、别说套话。直接回答他这一句，给个具体的内容，短的口语。）'
        const rj = await postJson(LLM, { messages: [{ role: 'system', content: sys + retryAnchor }, ...sentMsgs], temperature: 0.8, top_p: 0.9, top_k: 24 }, 120_000)
        const rraw = String(rj.choices?.[0]?.message?.content || '').replace(/<[^>]+>/g, '').replace(ACTION_RE, '').trim()
        parts = rraw.split(/\s*\|\|\|\s*/).map((p) => capLen(mechanicalGuards(dedupe(p, recentReplies), recentReplies), readParams().maxReplyChars || 90)).filter((p) => p.trim())
      } catch (e) { log('empty-retry fail: ' + e.message) }
      if (!parts.length) { parts = [pickSanFallback(recentReplies)]; log('empty after retry -> fallback') }
    }
    // 脱敏后再发送+落盘，保证 history 永远不含成套照抄套路
    const sanitized = parts.map((p) => sanitizeForHistory(p, recentReplies)).filter((p) => p.trim())
    if (sanitized.length) parts = sanitized // 全被删空则保留原文，避免空发
    // 脱敏触发观测日志（不改行为，只为诊断留存）
    if (sanitized.join('|') !== parts0.join('|')) {
      sanFireCount++
      if (sanFireCount <= 20 || sanFireCount % 10 === 0) log(`sanitize fired #${sanFireCount}: "${parts0.join('|').slice(0, 40)}" -> "${sanitized.join('|').slice(0, 40)}"`)
    }
    // 完全重复守卫：与上一条逐字相同时换一句，杜绝"嗯，你说。"式连发
    const lastAsst = [...history].reverse().find((h) => h.role === 'assistant')
    if (lastAsst && parts.join(' ').trim() === String(lastAsst.text).trim()) {
      const alt = pickSanFallback(recentReplies)
      log(`dup-guard fired: "${parts.join(' ').slice(0, 30)}" -> "${alt}"`)
      parts = [alt]
    }
    history.push({ role: 'assistant', text: parts.join(' ') })
    saveHist()
    for (const p of parts) {
      await say(p.trim(), uid)
      if (parts.length > 1) await new Promise((r) => setTimeout(r, 1200))
    }
    // 贴纸在文字气泡后发，最多 1 张（冷却+单张，防刷屏）
    if (stickerTags.length) await sendStickerByName(stickerTags[0], uid)
    log(`round ${Date.now() - t0}ms | user ${text.length}ch | reply x${parts.length}${stickerTags.length ? ' +sticker' : ''}`)
    rounds++
    globalThis.__rounds = rounds // 心跳 rounds 同步
    // 沉淀/草稿箱不阻塞下一轮（fire-and-forget）
    if (rounds % EXTRACT_EVERY === 0) { lastExtractedRounds = rounds; extractMemory().then(() => { if (extCount % CONSOLIDATE_EVERY === 0) return consolidateMemory() }) }
    if (rounds % 20 === 0) draftbox()
    if (AUTO_DRAFT && rounds % 20 === 0) draftboxTry()
    checkTrialExpiry() // 行为参数试行到期自动回滚
  } catch (e) {
    log('round error: ' + e.message)
  } finally {
    busy = false
    if (pending.trim()) { clearTimeout(timer); timer = setTimeout(() => respond(uid), 400) } // 忙时攒下的消息补处理
  }
}

// 发送：HTTP OneBot（text / image 段数组）
async function say(text, uid, segments = null) {
  const message = segments || [{ type: 'text', data: { text: String(text) } }]
  try {
    const j = await postJson(HTTP + '/send_private_msg', { user_id: Number(uid), message }, 15_000, TOKEN)
    log('send: retcode=' + j.retcode + (j.retcode !== 0 ? ' wording=' + (j.wording || '') : ''))
    return j.retcode === 0
  } catch (e) { log('send error: ' + e.message); return false }
}

// 贴纸：<sticker:名字> → 库里模糊匹配 → 网关 send_custom_face（收藏 ID 走专用 action）
const STICKER_IDX = 'C:/Users/Administrator/.dsh/plugins-data/aurabot/stickers/index.json'
const STICKER_COOLDOWN = 10 * 60_000
let lastSticker = 0
const stickerLib = () => readJson(STICKER_IDX, { items: [] }).items || []
function matchSticker(query) {
  const items = stickerLib()
  const q = String(query || '').trim()
  if (!q || !items.length) return null
  let best = null, bestScore = 0
  for (const it of items) {
    if (!it.emojiId) continue // 没收藏 ID 的发不出去（旧库里 2 张 emojiId 空）
    const hay = [it.name || '', ...(it.tags || [])]
    let s = 0
    for (const h of hay) {
      if (!h) continue
      if (h === q) s = Math.max(s, 10)
      else if (h.includes(q) || q.includes(h)) s = Math.max(s, 6)
      else { const common = [...q].filter((c) => h.includes(c)).length; if (common >= 2) s = Math.max(s, common / Math.max(q.length, 1) * 4) }
    }
    if (s > bestScore || (s === bestScore && s > 0 && Math.random() < 0.5)) { best = it; bestScore = s }
  }
  return bestScore >= 1.5 ? best : null
}
async function sendStickerByName(name, uid) {
  if (Date.now() - lastSticker < STICKER_COOLDOWN) { log('sticker cooldown, skip'); return false }
  const it = matchSticker(name)
  if (!it) { log('sticker no match: ' + String(name).slice(0, 20)); return false }
  try {
    const j = await postJson(HTTP + '/send_custom_face', { user_id: Number(uid), emoji_id: it.emojiId }, 15_000, TOKEN)
    const ok = j.retcode === 0
    log(`sticker: ${it.name} retcode=${j.retcode}${ok ? '' : ' ' + (j.wording || '')}`)
    if (ok) lastSticker = Date.now()
    return ok
  } catch (e) { log('sticker error: ' + e.message); return false }
}

// 空闲补做沉淀 + 草稿箱自动试行开关（AUTO_DRAFT 默认关，不直接改人设）
const AUTO_DRAFT = false
let lastExtractedRounds = 0
setInterval(() => {
  // 空闲且距上次沉淀新增≥8轮 → 补做一次
  if (busy || pending.trim()) return
  if (rounds - lastExtractedRounds >= EXTRACT_EVERY) {
    lastExtractedRounds = rounds
    extractMemory().then(() => { if (extCount % CONSOLIDATE_EVERY === 0) return consolidateMemory() })
      .catch((e) => log('idle extract error: ' + e.message))
  }
}, 10 * 60_000).unref()
// 行为旋钮机读 JSON：试行 N 轮后自动回滚（备份原值），不改人设正文
const PARAMS_FILE = 'D:/wokebuddy/poc_persona_params.json'
const DEFAULT_PARAMS = { maxReplyChars: 90, actionPer10: 1, tokenMemeEvery: 2, splitMax: 3 }
const TRIAL_ROUNDS = 20
function readParams() { return { ...DEFAULT_PARAMS, ...readJson(PARAMS_FILE, {}) } }
function rollbackParams() {
  const bak = readJson(PARAMS_FILE + '.bak', null)
  if (!bak) return false
  writeJson(PARAMS_FILE, bak)
  log('params rolled back to trial baseline')
  return true
}
function beginTrial(patch) {
  const cur = readParams()
  if (!readJson(PARAMS_FILE + '.bak', null)) writeJson(PARAMS_FILE + '.bak', { ...cur, _trialStartRound: rounds }) // 只备份首次，保留原始基线
  writeJson(PARAMS_FILE, { ...cur, ...patch, _trialUntil: rounds + TRIAL_ROUNDS })
  log('params trial started: ' + JSON.stringify(patch) + ' until round ' + (rounds + TRIAL_ROUNDS))
}
async function draftboxTry() { // 生成待审补丁候选，附回滚点；不直接改 dafeiyu.md
  try {
    if (!AUTO_DRAFT) return
    const p = await llm('观察大肥鱼最近聊天表现，提一条具体人设微调（40字内），只输出建议本身。',
      history.slice(-16).map((h) => `${h.role === 'user' ? '他' : '我'}：${h.text}`).join('\n').slice(0, 3000) || '（无对话）',
      { maxTokens: 120, temperature: 0.6 })
    if (p && p.length > 8) {
      const cand = 'D:/wokebuddy/poc_draft_candidate.txt'
      appendFileSync(cand, `[${dayStr()}] 提议：${p.slice(0, 120)}\n  可调旋钮：${JSON.stringify(DEFAULT_PARAMS)}\n  回滚点：poc_persona_params.json.bak（一键回滚）／dafeiyu.md.pre-v11（人设正文）\n`)
      log('draft candidate: ' + p.slice(0, 50))
    }
  } catch (e) { log('draftboxTry error: ' + e.message) }
}
// 每轮检查试行到期 → 自动回滚（在 respond 的 rounds++ 之后调用）
function checkTrialExpiry() {
  const p = readJson(PARAMS_FILE, null)
  if (p?._trialUntil && rounds >= p._trialUntil) rollbackParams()
}

// 想说没说的话：2h TTL，下轮合适时机自然带出
const PENDING_TTL = 2 * 3600_000
const PENDING_FILE = 'D:/wokebuddy/poc_pending_thought.json'
function readPending() {
  const p = readJson(PENDING_FILE, null)
  if (!p || !p.text || Date.now() - p.ts > PENDING_TTL) { if (p) writeFileSync(PENDING_FILE, ''); return '' }
  return String(p.text).slice(0, 60)
}
function setPending(text) {
  try { writeFileSync(PENDING_FILE, JSON.stringify({ text: String(text).trim().slice(0, 60), ts: Date.now() })) } catch {}
}

// 短期状态层：mood/energy/attention，按时间自然衰减；只注入一句语气参考，24h 归零
const STATE_FILE = 'D:/wokebuddy/poc_state.json'
const STATE_TTL = 24 * 3600_000
const moodWord = (m) => {
  if (!m) return ''
  if (/开心|高兴|甜|愉悦|兴奋|喜欢/.test(m)) return '心情不错'
  if (/委屈|难过|低落|丧|想哭|难受/.test(m)) return '有点低落'
  if (/无语|烦|气|无奈|吐槽/.test(m)) return '有点无语'
  if (/可爱|心动|软|害羞/.test(m)) return '心里软软的'
  return m.slice(0, 8)
}
function readState() {
  let s = readJson(STATE_FILE, { mood: '', energy: 0.7, attention: 0.6, ts: 0 })
  if (!s.ts || Date.now() - s.ts > STATE_TTL) s = { mood: '', energy: 0.7, attention: 0.6, ts: Date.now() } // 跨天归零，不累积成事实
  return s
}
function updateState(kind, mood = '') {
  const s = readState()
  if (mood) s.mood = moodWord(mood)
  if (kind === 'user') { s.energy = Math.min(1, s.energy + 0.12); s.attention = Math.min(1, s.attention + 0.3) }
  else if (kind === 'idle') { s.energy = Math.max(0.25, s.energy - 0.08); s.attention = Math.max(0.15, s.attention - 0.15) }
  s.ts = Date.now()
  writeJson(STATE_FILE, s)
  return s
}
function stateLine(s) {
  const e = s.energy > 0.72 ? '精神还行' : s.energy > 0.45 ? '有点懒' : '有点困'
  const a = s.attention > 0.7 ? '心思在他这儿' : s.attention > 0.4 ? '注意力一般' : '有点走神'
  return (s.mood ? s.mood + '，' : '') + e + '，' + a
}

// 带锁私人日记：<diary> → 私有文件，绝不注入给主人（●当时记 ◐事后补）
import { mkdirSync } from 'node:fs'
const DIARY_DIR = 'D:/wokebuddy/poc_diary'
try { mkdirSync(DIARY_DIR, { recursive: true }) } catch {}
function writeDiary(rawBlock) {
  try {
    const block = String(rawBlock).trim()
    if (!block || block.length > 600) return false
    const moodM = block.match(/mood[:：]\s*([^\n]+)/i)
    const mood = moodM ? moodM[1].trim().slice(0, 12) : ''
    const body = block.replace(/^mood[:：].*\n?/im, '').trim()
    if (body.length < 4) return false
    const p = DIARY_DIR + '/' + dayStr() + '.md'
    const entry = `\n--- ${new Date().toTimeString().slice(0, 5)} ${mood ? '[' + mood + ']' : ''}\n${body}\n`
    appendFileSync(p, entry)
    if (mood) updateState('diary', mood) // 日记 mood 回流短期状态
    log('diary written: ' + body.slice(0, 30).replace(/\n/g, ' '))
    return true
  } catch (e) { log('diary error: ' + e.message); return false }
}

// 主动搭话：机会式非 cron；idle≥2h、安静时段顺延、每天≤1条、掷骰命中才发；没发不追问
const PROACTIVE = {
  enabled: true,          // 主人若嫌烦，改 false 即彻底关闭
  idleMs: 2 * 3600_000,  // 距上次对话≥2h 才考虑
  dailyMax: 1,           // 每天最多主动发 1 条
  chance: 0.55,          // 掷骰命中率
  quietFrom: 1, quietTo: 8, // 安静时段 01:00-08:00 顺延
  baseMs: 90 * 60_000,   // 基础间隔 90min
  jitterMs: 60 * 60_000, // ±60min 随机（45~150min，非整点）
}
const PROACTIVE_STATE = 'D:/wokebuddy/poc_proactive.json'
let lastUserAt = Date.now() // 本进程内最近一次主人消息；重启后从 state 恢复
let pstate = readJson(PROACTIVE_STATE, { nextAt: 0, todayCount: 0, day: dayStr(), lastAction: null, outcomes: [] })
if (pstate.day !== dayStr()) { pstate.day = dayStr(); pstate.todayCount = 0 } // 跨天重置计数
const savePstate = () => writeJson(PROACTIVE_STATE, pstate)

// 主动反馈学习：回应 → clue → 同类攒2次升 rule；只学行为规则，固定词表机械匹配
const FB_FILE = 'D:/wokebuddy/poc_proactive_rules.json'
const FB_ENABLED = true
let fb = readJson(FB_FILE, { clues: [], rules: [] })
if (!Array.isArray(fb.clues)) fb.clues = []
if (!Array.isArray(fb.rules)) fb.rules = []
const saveFb = () => writeJson(FB_FILE, fb)
const FB_NEG = /(别.{0,4}烦|少烦|别老找|别总找|别.{0,3}找.{0,2}我|不用你|不需要|别主动|别没事找事|闭嘴|烦死|别打扰|不想聊|滚开|少来这套|别老来|别再.{0,3}我|少来)/i
const FB_POS = /(多说|再说说|怎么不.{0,3}我|怎么没来|怎么不说话|早点说|想听你说|你多聊|继续说|再说点|想你了|你怎么不找我|多聊聊|再主动点)/i
function addClue(kind, hour) {
  if (!FB_ENABLED) return
  const now = Date.now()
  fb.clues.push({ kind, ...(kind === 'neg' ? { hour } : {}), ts: now })
  fb.clues = fb.clues.filter((c) => now - c.ts < 30 * 86400_000).slice(-24) // 30天窗口，最多24条
  const hit = fb.clues.filter((c) => c.kind === kind && (kind === 'pos' || c.hour === hour)).length
  if (hit >= 2) {
    const dup = fb.rules.some((r) => r.kind === kind && (kind === 'pos' || r.hour === hour))
    if (!dup) {
      fb.rules.push({ kind, ...(kind === 'neg' ? { hour } : {}), ts: now })
      log('feedback: clue→rule promoted: ' + kind + (kind === 'neg' ? '@' + hour + 'h' : ''))
    }
  }
  saveFb()
}
// 主人说话时调用：仅当紧接我方主动消息（2h内第一句）且有明确反馈措辞才记 clue
function detectFeedback(text, now = Date.now()) {
  if (!FB_ENABLED || !pstate.lastProactiveAt) return
  const gap = now - pstate.lastProactiveAt
  if (gap < 0 || gap > 2 * 3600_000) return
  if (pstate.lastFbFor === pstate.lastProactiveAt) return // 这条主动消息已判过
  pstate.lastFbFor = pstate.lastProactiveAt
  const hour = new Date(pstate.lastProactiveAt).getHours()
  if (FB_NEG.test(text)) { addClue('neg', hour); log('feedback: neg clue @' + hour + 'h') }
  else if (FB_POS.test(text)) { addClue('pos', hour); log('feedback: pos clue') }
  savePstate()
}
// 规则作用：被嫌烦的时段静默（分级非永久）；被要求多说则提高命中率
function proactiveChance(hour) {
  if (fb.rules.some((r) => r.kind === 'neg' && r.hour === hour)) return -1 // -1 = 该时段静默
  if (fb.rules.some((r) => r.kind === 'pos')) return Math.min(0.85, PROACTIVE.chance + 0.2)
  return PROACTIVE.chance
}
function scheduleNext() {
  pstate.nextAt = Date.now() + Math.max(30 * 60_000, PROACTIVE.baseMs + (Math.random() * 2 - 1) * PROACTIVE.jitterMs)
  savePstate()
}
if (!pstate.nextAt) scheduleNext() // 首次排期；重启不重排（从文件恢复）
function opOutcome(woke, action, postponed = false) {
  pstate.outcomes.push({ ts: Date.now(), woke, action, postponed })
  if (pstate.outcomes.length > 40) pstate.outcomes = pstate.outcomes.slice(-40)
  savePstate()
}
async function maybeProactive() {
  if (!PROACTIVE.enabled || busy || pending.trim()) return
  const now = Date.now(), hh = new Date().getHours()
  if (now < pstate.nextAt) return
  if (pstate.day !== dayStr()) { pstate.day = dayStr(); pstate.todayCount = 0 }
  // 唤醒抑制：安静时段 / 刚聊过 / 今天发够了 → 顺延，不算机会
  if (hh >= PROACTIVE.quietFrom && hh < PROACTIVE.quietTo) {
    pstate.nextAt = Date.now() + (8 - hh) * 3600_000; savePstate(); return
  }
  // 反馈学到的"该时段别烦我"→ 静默并顺延（分级非永久）
  const learnedChance = proactiveChance(hh)
  if (learnedChance < 0) { pstate.nextAt = now + 2 * 3600_000; savePstate(); return }
  if (now - lastUserAt < PROACTIVE.idleMs) { scheduleNext(); return }
  if (pstate.todayCount >= PROACTIVE.dailyMax) { pstate.nextAt = now + 6 * 3600_000; savePstate(); return }
  scheduleNext() // 无论掷中与否都排下一次，避免反复触发
  if (Math.random() > learnedChance) { opOutcome(false, 'none'); return } // 没掷中：不计入、不发
  // 掷中：给机会提示（不给命令），让模型自己决定说不说
  opOutcome(true, 'pending')
  const idleState = updateState('idle') // 闲久了精神/注意力自然回落
  try {
    const today = await refreshToday()
    const bits = [today?.activity && '你今天：' + today.activity, today?.hito && '看到一句话：' + today.hito, today?.news?.[0] && '新闻：' + today.news[0]].filter(Boolean)
    const sys = readFile(PERSONA_FILE) + '\n\n' + readFile(SCENARIO_FILE) + '\n\n' +
      '【有一会儿空】现在是 ' + new Date().toTimeString().slice(0, 5) + '，主人上次说话是 ' + Math.round((now - lastUserAt) / 60000) + ' 分钟前。' +
      '\n（此刻的你可能' + stateLine(idleState) + '——只影响语气分寸，别汇报状态。）' +
      (bits.length ? '\n' + bits.join('\n') : '') +
      '\n你可以找他聊两句，也可以什么都不做。想说就说一句（短、自然、别像问候机器人），不想说就只输出一个字：无。不要解释，不要问候语开场。'
    const line = await llm(sys, '（现在是你的空闲时刻，自己决定）', { maxTokens: 80, temperature: 0.85 })
    if (!line || line.trim() === '无' || line.length < 2) { opOutcome(true, 'none'); return }
    let parts = [capLen(dedupe(line, history.filter((h) => h.role === 'assistant').map((h) => h.text)), 90)].filter((p) => p.trim())
    if (!parts.length) { opOutcome(true, 'none'); return }
    const san = parts.map((p) => sanitizeForHistory(p)).filter((p) => p.trim())
    if (san.length) parts = san
    for (const p of parts) await say(p, OWNER)
    history.push({ role: 'assistant', text: parts.join(' ') }); saveHist()
    pstate.todayCount++; pstate.lastAction = parts[0]; pstate.lastProactiveAt = Date.now(); pstate.lastFbFor = null; savePstate()
    opOutcome(true, 'chat')
    log(`proactive: ${parts[0].slice(0, 40)}`)
  } catch (e) { log('proactive error: ' + e.message); opOutcome(true, 'none') }
}
setInterval(() => { maybeProactive().catch((e) => log('proactive tick error: ' + e.message)) }, 60_000).unref()

// WS：指数退避自动重连（不 process.exit 躺平）
let ws = null
let backoff = 3000
let stopped = false
function connect() {
  if (stopped) return
  let sock
  try { sock = new WebSocket(WSURL) } catch (e) { log('WS connect fail: ' + e.message); setTimeout(connect, backoff); return }
  ws = sock
  sock.onopen = () => { backoff = 3000; log('WS connected -> SnowLuma 3001') }
  sock.onmessage = async (ev) => {
    let d
    try { d = JSON.parse(ev.data) } catch { return }
    if (d.post_type === 'message' && d.message_type === 'private' && String(d.user_id) === OWNER) {
      const t = segText(d.message)
      if (!t) return
      // 文字先入队 + 重置 idle 计时；图片转换整段包 try，异常也绝不丢消息（v0.8.7 bugfix）
      lastUserAt = Date.now()
      pending = (pending ? pending + ' ' : '') + t
      try {
        const segs = Array.isArray(d.message) ? d.message : []
        const uris = []
        for (const s of segs) {
          if (s?.type === 'image') {
            const u = await imgToDataUri(s.data || {})
            if (u) uris.push(u)
          }
        }
        if (uris.length) { pendingImgs = pendingImgs.concat(uris); log(`img queued: ${uris.length} (${Math.round(uris.join('').length / 1024)}KB)`) }
      } catch (e) { log('img process fail: ' + e.message) }
      clearTimeout(timer)
      timer = setTimeout(() => respond(OWNER), DEBOUNCE)
    }
  }
  sock.onclose = () => {
    if (ws !== sock) return
    ws = null
    if (!stopped) { log(`WS closed, reconnect in ${backoff / 1000}s`); setTimeout(connect, backoff); backoff = Math.min(30_000, backoff * 2) }
  }
  sock.onerror = (e) => { log('WS error: ' + ((e?.message || e?.type || 'native') + '').slice(0, 200)) }
}
connect()

beat() // 启动即心跳；原生闪退/僵死→心跳停→看门狗（≤5min）拉起
setInterval(beat, 30_000).unref()

log(`POC bridge v0.9.1 started. owner=${OWNER}, history=${history.length} entries, mem=${readMem().length} [personaV17+VISION(img->dataURI->contentParts)+imgFallback+antiEcho(core+dice+reroll+histDrop)+faceMarker+historySanitize+memFilter+sanFallbackRotate+dupGuard+bracketDiaryCleanup +sticker+idle+diary+pending+idleExtract +feedback+memSearch+state+params +crashGuard+heartbeat | BUGFIX:imgToDataUri作用域/onmessage保底/lastIndex/dayStr本地时区 | 精简重构:统一postJson+注释压缩+日记泄漏修复 | 22:2x apron换皮梗词表+洗记忆(A/B脏梗10/12→0) | v0.9.0:照抄示例+想摸尾巴重掷(尾巴4→0),照抄=8B固化反射边界 | v0.9.1:吞消息修复——empty after dedupe不再return留孤儿user(截图"你会发表情包吗"被吞真因),改带锚点重试+轮换兜底 | guards+opinionStrip=OFF(retired)]`)
