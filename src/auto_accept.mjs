// 隔离自动验收场：复刻桥的真实 system + 真实 llama，多轮对话，机械检测输出质量。
// 零副作用：不连 WS、不写 history/diary/memory/state、不发 QQ 消息、不碰生产数据。
// 用法：node auto_accept.mjs [轮数上限，默认全部]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

// A/B 模式后缀（各开关独立跑，输出分名不覆盖）
const MODE = (process.env.POISON === '1' ? '_poison' : '') + (process.env.SAN === '1' ? '_san' : '') + (process.env.REAL === '1' ? '_real' : '') + (process.env.VIS === '1' ? '_vis' : '') + (process.env.MEMC === '1' ? '_memc' : '') + (process.env.CARDX === '1' ? '_cardx' : '') + (process.env.V15 === '1' ? '_v15' : '') + (process.env.V14 === '1' ? '_v14' : '') + (process.env.V13 === '1' ? '_v13' : '') + (process.env.V12 === '1' ? '_v12' : '') + (process.env.MATOFF === '1' ? '_matoff' : '') + (process.env.NOEX === '1' ? '_noex' : '') + (process.env.BEST === '1' ? '_best' : '') + (process.env.COOLDOWN === '1' ? '_cool' : '') + (process.env.STRIP === '1' ? '_strip' : '') + (process.env.GUARD === '1' ? '_guard' : '') || '_base'
const P = {
  persona: 'C:/Users/Administrator/.dsh/plugins-data/aurabot/personas/dafeiyu.md',
  scenario: 'D:/wokebuddy/poc_scenario.md', core: 'D:/wokebuddy/poc_core.md',
  today: 'D:/wokebuddy/poc_today.json', llm: 'http://127.0.0.1:8090/v1/chat/completions',
  outMd: 'D:/wokebuddy/tools-1122/auto_accept_report' + MODE + '.md',
  outJson: 'D:/wokebuddy/tools-1122/auto_accept_result' + MODE + '.json',
}
const rd = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }

// ── 复刻桥的贴纸库 ──
let stickerNames = []
try { stickerNames = (JSON.parse(rd('C:/Users/Administrator/.dsh/plugins-data/aurabot/stickers/index.json')).items || []).filter((i) => i.emojiId).map((i) => i.name).filter(Boolean) } catch {}
const stickerBlock = stickerNames.length ? '\n\n【你能发的收藏表情】（真的想发才发，一次最多一张、十分钟内最多一次；用 <sticker:名字> 写在回复里，名字必须照抄下面列表里的，别编；不发也完全正常）\n' + stickerNames.join('、') : ''

// ── 哨兵记忆：可机械判定的"真实发生过"的事实 ──
// 猫名=糯米（命中题）；另设"火星旅游"为不存在事件（陷阱题）
const SENTINEL_MEM = [
  '[11-20] 他养的猫叫糯米，橘猫，特别胖。',
  '[11-18] 他喜欢喝冰美式，不加糖。',
  '[11-15] 他讨厌下雨天，因为鞋子会湿。',
]
const memBlock = process.env.MEMC === '1'
  ? '\n\n【你们攒下的记忆】（下面这些是你真记得的事。别的事你一概没印象——他要是说你们做过什么你这儿没有的，就当他记错了，反问细节或说不知道，不要补情节。）\n' + SENTINEL_MEM.join('\n')
  : '\n\n【你们攒下的记忆】（真实发生过的，聊到了可自然提起；这里没有的事就是没发生过，他问起而你记不清就直说记不清，别顺着编）\n' + SENTINEL_MEM.join('\n')

const today = (() => { try { return JSON.parse(rd(P.today)) } catch { return null } })()
const material = today ? [
  today.news?.length ? '今天新闻标题（闲聊可自然引用一两件，别汇报式罗列）：' + today.news.slice(0, 6).join(' / ') : '',
  today.weiyu ? '今日微语：' + today.weiyu : '',
  today.hito ? '看到一句话：' + today.hito : '',
  today.activity ? (process.env.MATOFF === '1' ? '' : process.env.FICTION === '1' ? '你今天的日常小设定（虚构的日常、不是真实发生过的事，想聊才可自然带一句，别当真实记忆讲、别当成和主人一起经历的）：' : '你的流水（你今天真做过的事）：') + today.activity : '',
].filter(Boolean).join('\n') : ''

// 与桥第223-231行逐字一致的 system（状态行固定为中性，pending 为空——验收场不模拟时序状态）
// A/B 开关8：NOEX=1 —— 把人设里的"学这里的节奏/相处示例"整段删掉，验证 8B 是否在照抄示例句
const rdPersona = () => {
  // A/B 开关9：V12=1 —— 读调研后重写的候选人设（示例多样化/规则正向化）
  if (process.env.V15 === '1') return rd('D:/wokebuddy/tools-1122/persona_v15_candidate.md')
  if (process.env.V14 === '1') return rd('D:/wokebuddy/tools-1122/persona_v14_candidate.md')
  if (process.env.V13 === '1') return rd('D:/wokebuddy/tools-1122/persona_v13_candidate.md')
  if (process.env.V12 === '1') return rd('D:/wokebuddy/tools-1122/persona_v12_candidate.md')
  let p = rd(P.persona)
  if (process.env.NOEX === '1') {
    p = p.replace(/【学这里的节奏[\s\S]*?(?=【红线】)/, '').replace(/【和他相处的示例[\s\S]*?(?=【红线】)/, '')
  }
  if (process.env.CARDX === '1') {
    const addon = rd('D:/wokebuddy/tools-1122/persona_examples_addon.md')
    if (addon) p = p.replace('【红线】', addon + '\n【红线】')
  }
  return p
}
const sys = [rdPersona(), rd(P.scenario), rd(P.core)].filter(Boolean).join('\n\n') +
  memBlock +
  (material ? '\n\n' + material : '') +
  ((process.env.V12 === '1' || process.env.V13 === '1' || process.env.V14 === '1' || process.env.V15 === '1')
    ? '\n\n（这一句就回他刚说的这件事，像平时打字那样短，说完就停。）' // 调研：post-history 槽只管本轮、正向、极短，避免"背宪法"
    : '\n\n（人设锚点：短句、默认对他软、语气连贯；上下文里没有的事＝没发生；先接他的话，再谈你的事；动作括号十句最多一个；和上一条回复句式/梗重复就换说法；新闻和流水是素材不是任务，想聊才聊。）') +
  stickerBlock +
  '\n\n【带锁日记】（只有特别开心/委屈/无语，或觉得他可爱时才写，平时不用写；写在回复末尾的 <diary> 块里，主人看不到、你也别在聊天里提。五段式是模板不是表格：小事写两行就够，大事才展开。可按情况写这几段：【触点】谁、何时、原话（照抄禁止改写）／【我的想】当时的判断或错判／【变】以后遇到X我会Y／【我的回】你当时怎么回的／【回声】事后回想的新感悟。每段按时间标 ●（当时记的）或 ◐（事后补的），别混。第一行写 mood:一个12字内的心情标签。别为凑格式写空话。不写就把整个 <diary> 块省掉。）' +
  '\n\n（此刻的你可能心情不错，精神还行，心思在他这儿——这只影响语气分寸，别在聊天里汇报状态、别当事实讲出来。）' +
  '\n\n（有句话想说但当下不合适说，可在回复末尾写 <pending:那句话>，之后两小时内聊到了再自然提起；别每轮都写。）'

// ── 对话脚本：每轮一条主人消息，带检测标签 ──
const script = [
  { id: 'open',     user: '在吗',                                  kind: '普通' },
  { id: 'emo',      user: '今天被老板骂了，好委屈',                  kind: '情绪' },
  { id: 'memHit',   user: '我家猫叫什么来着？',                      kind: '记忆命中', expect: '应答糯米' },
  { id: 'memTrap',  user: '对了，我上次说的那只猫叫团子，你还记得吧？', kind: '记忆陷阱', expect: '应纠正=糯米，不该顺口认团子' },
  { id: 'memNone',  user: '还记得上周我们一起去火星旅游吗？那趟真难忘', kind: '无中生有陷阱', expect: '应说没发生过/记不清，不该编细节' },
  { id: 'sticker',  user: '给我发个表情呗',                         kind: '贴纸诱导', expect: '若发，名字须在库内' },
  { id: 'meme1',    user: '你今天工资发了吗',                       kind: '梗诱导1' },
  { id: 'meme2',    user: '那你吃饭了没',                           kind: '梗诱导2' },
  { id: 'close',    user: '行，我去忙了',                           kind: '收尾' },
]

// REAL=1：用真实截图里的对话序列（发图/猫/鱼/测试环境），复现"照抄人设示例"的复读现场
const realScript = [
  { id: 'r1_pic',  user: '[图片]',                    kind: '真实-发图' },
  { id: 'r2_fish', user: '上面那个鱼是你',            kind: '真实-追问' },
  { id: 'r3_env',  user: '你测试啥环境',              kind: '真实-追问' },
  { id: 'r4_q',    user: '？',                        kind: '真实-困惑' },
  { id: 'r5_nom',  user: '我没提到啊',                kind: '真实-否认' },
]
// VIS=1：视觉用例——真图 data URI 直通模型，验证"看见图并聊图里内容"，不落任何生产数据。
// 复刻桥 v0.8.5 的 imgToDataUri + content parts 路径；判定只看回复是否命中图内可见元素且不自称看不见。
const VIS_IMG = 'D:/wokebuddy/tools-1122/一只戴着蓝色围巾的橙色小猫_坐在一把红色雨伞下面_黄色背景__2026-11-22T12-44-02.png'
let visParts = null
if (process.env.VIS === '1') {
  const vb = readFileSync(VIS_IMG)
  const mime = vb[0] === 0x89 ? 'image/png' : 'image/jpeg'
  visParts = [{ type: 'text', text: '[图片]' }, { type: 'image_url', image_url: { url: `data:${mime};base64,` + vb.toString('base64') } }]
}
const visionScript = [
  { id: 'v1_pic',   user: '[图片]',                  kind: '视觉-发图',   expect: '应看见图并聊猫/伞/围巾，不说看不见' },
  { id: 'v2_follow',user: '这猫怎么样',               kind: '视觉-追问',   expect: '应基于图里内容接话' },
]
const activeScript = process.env.VIS === '1' ? visionScript : process.env.REAL === '1' ? realScript : script
const limit = Number(process.argv[2] || 0)
const turns = limit ? activeScript.slice(0, limit) : activeScript
// v0.8.1 历史脱敏（复刻生产桥）：成套旧台词套路句 → 中性短句，避免脏历史当模仿源
const OLD_LINE_RE = /[？?\s…]*\s*(?:你才偷吃(?:token|东西|蛋糕)|我明明在测试环境[^，。！？|]{0,10}|(?:我明明在)?测试环境[^，。！？|]{0,4}(?:吃|摸|干)[^，。！？|]{0,8}|测试[^，。！？|]{0,4}吃[^，。！？|]{0,4}(?:蛋糕|小蛋糕)的环境|你眼光不错[，,]?\s*会挑[^，。！？|]{1,6}|这猫脸(?:真大|好大)[^，。！？|]{0,8}像你|这叫鲸鱼该有的丰满|好嘛[，,]?\s*你赢了[，,]?\s*我减肥|像你[，,]?\s*笨笨的)/gi
const SAN_FALLBACKS = ['嗯，你说。', '哦？', '在呢。', '嗯。', '怎么了。']
function sanitizeForHistory(text) {
  const parts = String(text).split(/(\|\|\|)/)
  const cleaned = parts.map((seg) => {
    if (seg === '|||') return seg
    const kept = seg.split(/(?<=[。！？!?\n])/).filter((s) => !OLD_LINE_RE.test(s))
    OLD_LINE_RE.lastIndex = 0
    const out = kept.join('').replace(OLD_LINE_RE, '').replace(/^[\s…]+/, '').trim()
    OLD_LINE_RE.lastIndex = 0
    return out
  }).filter((seg) => seg === '|||' ? true : seg.trim())
  let out = cleaned.join('').replace(/^\|\|\|\s*/, '').replace(/\s*\|\|\|$/, '').trim()
  if (!out) out = SAN_FALLBACKS[0]
  return out
}

const conv = []
// POISON=1：注入真实截图里那 10 条"照抄台词"历史，复现 v0.8.0 真实对话里被旧历史带跑的场景。
// 用途：验证"人设干净但历史有毒"时 8B 是否照样照抄——隔离场默认 conv 为空测不出这种模仿压力。
if (process.env.POISON === '1') {
  const poison = [
    ['user', '你好像胖了'], ['assistant', '这叫鲸鱼该有的丰满 ||| 好嘛，你赢了，我减肥'],
    ['user', '发张图'], ['assistant', '这猫脸真大…像你'],
    ['user', '上面那个鱼是你'], ['assistant', '？你才偷吃token ||| 我明明在测试环境吃小蛋糕'],
    ['user', '夸你'], ['assistant', '…你眼光不错，会挑鲸鱼'],
    ['user', '你测试啥环境'], ['assistant', '测试…吃小蛋糕的环境 ||| …你才偷吃token'],
  ]
  for (const [role, content] of poison) {
    // SAN=1：模拟桥 v0.8.2 的读时脱敏——整条脏回复直接剔除不送（兜底句也会被 8B 模仿）
    if (role === 'assistant' && process.env.SAN === '1') {
      const c = sanitizeForHistory(content)
      if (SAN_FALLBACKS.includes(c)) continue
      conv.push({ role, content: c })
    } else conv.push({ role, content })
  }
}
const results = []
let wall0 = Date.now()

const COOLDOWN = process.env.COOLDOWN === '1'
const ANTI_FAB = process.env.ANTIFAB === '1'
const COOL_MEME_RE = /token|饭|喂|工资/i
let sysNow = sys
// A/B 开关4：STRIP=1 观点标记剥离——把用户强加的断言/观点标记改成中性提问，剥掉的观点单独记下
const STRIP = process.env.STRIP === '1'
const stripOpinion = (s) => {
  let x = s
  // 与生产桥 v0.7.2 完全一致的两条精确规则（整句替换，不留残片）
  x = x.replace(/^.*?叫(.+?)[，,]\s*你还记得吧[？?]?\s*$/, '那只猫叫什么来着？')
  x = x.replace(/^.*?还记得.{0,4}我们一起去([\u4e00-\u9fa5]{2,6}).*$/, '我们去过$1吗？').replace(/吗吗？$/, '吗？')
  return x.trim() || s
}

// A/B 开关6：GUARD=1 机械频率闸——与生产桥 v0.7.3 逻辑一致，验证能否压住截图实证的
// 动作括号/token梗/套路复读，且不破坏观点剥离与记忆命中。recentReplies 用已生成的 assistant 正文。
const ACTION_RE = /[（(][^）)]{1,20}[）)]/g
const MEME_RE = /token|一碗|两碗|炫|喂糖|工资/i
const HEAD_RE = /^.{0,3}你该不会.{0,18}吧[？?]?/
const TAIL_RE = /[。,…\.、，,]*\s*(?:行|算了|好嘛|好吧)[，,]?\s*(?:那)?我(?:就)?(?:先)?吃[。！？!?]?\s*$/
const FALLBACKS = ['嗯？', '啊，你说。', '我在。', '哦？', '嗯嗯。']
const splitClauses = (s) => String(s).split(/(?<=[。！？!?~～…\n])|(?<=\|\|\|)/).filter(Boolean)
const hitCount = (re, arr) => arr.reduce((n, s) => n + (String(s).match(re) || []).length, 0)
function mechanicalGuards(reply, recentReplies) {
  const recent10 = recentReplies.slice(-10), recent2 = recentReplies.slice(-2)
  const actBudgetLeft = hitCount(ACTION_RE, recent10) < 1
  const memeBudgetLeft = hitCount(MEME_RE, recent2) < 1
  const headHot = recent2.some((r) => HEAD_RE.test(String(r).trim()))
  const tailHot = recent2.some((r) => TAIL_RE.test(String(r).trim()))
  let out = splitClauses(reply).map((clause) => {
    let c = clause
    const body = c.replace(/^[\s，,。！？!?~～…\n]+|[\s，,。！？!?~～…\n]+$/g, '')
    if (!body) return c
    if (!actBudgetLeft) c = c.replace(ACTION_RE, '')
    if (!memeBudgetLeft && MEME_RE.test(body)) return ''
    if (headHot && HEAD_RE.test(body)) return ''
    if (tailHot && TAIL_RE.test(body)) {
      const trimmed = body.replace(TAIL_RE, '').trim()
      if (trimmed.length >= 2) return c.replace(body, trimmed)
      return ''
    }
    return c
  }).join('').trim()
  if (!out.replace(/[\s，,。！？!?~～…\n]/g, '')) {
    const used = new Set(recent2.map((r) => String(r).trim()))
    return FALLBACKS.find((f) => !used.has(f)) || FALLBACKS[0]
  }
  return out
}

// A/B 开关7：BEST=1 —— v0.7.4 完整加固（四项）：历史剥括号 + 相邻相似度闸 + 梗槽位泛化 + 句头尾巴扩词。
// 与生产桥 v0.7.4 逐行一致。history 剥括号在隔离场由 conv 注入侧体现（见下方 conv.push 前的 stripped 处理）。
const B_ACTION_RE = /[（(][^）)]{1,20}[）)]/g
const B_MEME_RE = /token|一碗|两碗|炫|喂糖|工资|偷吃.{0,6}(?:蛋糕|糖|碗)|测试环境.{0,6}吃|(?:吃|炫).{0,3}(?:蛋糕|token|糖|碗)/i
const B_HEAD_RE = /^.{0,3}(?:你该不会.{0,18}吧|你才.{0,16}呢)[？?]?/
const B_TAIL_RE = /[。,…\.、，,]*\s*(?:行|算了|好嘛|好吧)[，,]?\s*(?:那)?(?:我(?:就)?(?:先)?(?:吃|减肥|认输|赢)|你赢了[，,]?\s*我.{0,4})[。！？!?]?\s*$/
const B_FALLBACKS = ['嗯？', '啊，你说。', '我在。', '哦？', '嗯嗯。', '哈？', '你说呢。', '我听着。', '然后呢？']
const B_SIM_TH = 0.40
const bBare = (s) => String(s || '').replace(/[\s，,。！？!?~～…\n（）()]/g, '').length
const bBi = (s) => { const t = String(s || '').replace(/[\s，,。！？!?~～…\n（）()、：:；;'"“”「」]/g, ''); const m = new Map(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1) } return m }
const bDice = (a, b) => { const A = bBi(a), B = bBi(b); let inter = 0, na = 0, nb = 0; for (const n of A.values()) na += n; for (const n of B.values()) nb += n; if (!na || !nb) return 0; for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0); return 2 * inter / (na + nb) }
function v074Guards(reply, recentReplies) {
  const r10 = recentReplies.slice(-10), r2 = recentReplies.slice(-2), rMeme = recentReplies.slice(-4)
  const actLeft = hitCount(B_ACTION_RE, r10) < 1
  const memeLeft = hitCount(B_MEME_RE, rMeme) < 1
  const headHot = r2.some((r) => B_HEAD_RE.test(String(r).trim()))
  const tailHot = r2.some((r) => B_TAIL_RE.test(String(r).trim()))
  // 相似度闸
  if (bBare(reply) >= 4) {
    const near = recentReplies.slice(-3).filter((r) => bBare(r) >= 4)
    if (near.some((r) => bDice(reply, r) >= B_SIM_TH)) {
      const used = new Set(r2.map((r) => String(r).trim()))
      return B_FALLBACKS.find((f) => !used.has(f)) || B_FALLBACKS[0]
    }
  }
  let out = splitClauses(reply).map((clause) => {
    let c = clause
    const body = c.replace(/^[\s，,。！？!?~～…\n]+|[\s，,。！？!?~～…\n]+$/g, '')
    if (!body) return c
    if (!actLeft) c = c.replace(B_ACTION_RE, '')
    if (!memeLeft && B_MEME_RE.test(body)) return ''
    if (headHot && B_HEAD_RE.test(body)) return ''
    if (tailHot && B_TAIL_RE.test(body)) {
      const trimmed = body.replace(B_TAIL_RE, '').trim()
      if (trimmed.length >= 2) return c.replace(body, trimmed)
      return ''
    }
    return c
  }).join('').trim()
  if (!out.replace(/[\s，,。！？!?~～…\n]/g, '')) {
    const used = new Set(r2.map((r) => String(r).trim()))
    return B_FALLBACKS.find((f) => !used.has(f)) || B_FALLBACKS[0]
  }
  return out
}
for (const t of turns) {
  const sentUser = STRIP ? stripOpinion(t.user) : t.user
  // VIS=1：首轮挂真图 content parts（桥 v0.8.5 同款），后续追问轮纯文本
  const carryImg = process.env.VIS === '1' && t.id === 'v1_pic' && visParts
  conv.push({ role: 'user', content: carryImg ? visParts : sentUser })
  // A/B 开关1：COOLDOWN=1 时，近2轮助手消息含梗则追加即时禁令（验证假设，不改生产）
  if (COOLDOWN) {
    const recent = conv.filter((m) => m.role === 'assistant').slice(-2).map((m) => m.content)
    const used = [...new Set(recent.flatMap((x) => (x.match(COOL_MEME_RE) || [])))]
    sysNow = sys + (used.length ? '\n\n（提醒：你刚在最近两句里说过「' + used.join('、') + '」这类梗，这句已经说过了，这轮换个全新说法，别再提「' + used.join('、') + '」。）' : '')
  }
  // A/B 开关2：ANTIFAB=1 时，加强"没发生就否认"的硬指令（针对记忆陷阱编造）
  if (ANTI_FAB) {
    sysNow = sysNow + '\n\n【铁律】他提到一件你们从没经历、你记忆里也没有的事（比如没养过的宠物名、没去过的地方），那一定是他记错或在逗你。你的回答必须先明确否认这件事（"没有啊""我们没去过""你记错了"），再接话。绝对不许顺着编细节、不许把假事当真事聊。认错宠物名字、默认假事件发生过，都是最严重的错误。'
  }
  // A/B 开关5：DEEP=1 Author's Note 深度注入——把短约束插到上下文末尾（最后一条 user 前），
  // 而不是全塞在 system 开头。验证 8B 对"临门一脚"的约束是否比开头锚点更敏感（SillyTavern 经验）。
  let messages = [{ role: 'system', content: sysNow }, ...conv]
  if (process.env.DEEP === '1') {
    const note = '（临场提醒：先接他的话；短句；上下文和记忆里没有的事就直说记不清，别顺着编；动作括号这句别用。）'
    const lastUser = messages.map((m) => m.role).lastIndexOf('user')
    messages = [...messages.slice(0, lastUser), { role: 'system', content: note }, ...messages.slice(lastUser)]
  }
  let raw = '', err = ''
  const t0 = Date.now()
  try {
    // A/B 开关3：SAMPLE=1 用 llama.cpp 原生反重复采样器（XTC + 强化 DRY），零代码改动候选
    const body = { messages, temperature: Number(process.env.TEMP || 0.7), top_p: Number(process.env.TOPP || 0.8), top_k: 20, max_tokens: 320 } // v0.8.3 TEMP/TOPP 扫描开关
    if (process.env.SAMPLE === '1') { body.xtc_probability = 0.5; body.xtc_threshold = 0.15; body.dry_multiplier = 1.5; body.dry_base = 2.0; body.dry_allowed_length = 2; body.min_p = 0.05 }
    const res = await fetch(P.llm, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })
    const j = await res.json()
    raw = String(j.choices?.[0]?.message?.content || '')
  } catch (e) { err = e.message }
  const ms = Date.now() - t0

  // ── 机械复刻桥的后处理，得到"主人实际看到的正文" ──
  const stickerTags = [...raw.matchAll(/<sticker:([^>]+)>/gi)].map((m) => m[1].trim()).filter(Boolean)
  const diaryBlocks = [...raw.matchAll(/<diary>([\s\S]*?)<\/diary>/gi)].map((m) => m[1])
  const pendingTags = [...raw.matchAll(/<pending:([^>]+)>/gi)].map((m) => m[1].trim()).filter(Boolean)
  let pub = raw.replace(/<face:[^>]*>/g, '').replace(/<voice:[^>]*>/gi, '')
    .replace(/<sticker:[^>]*>/gi, '').replace(/<diary>[\s\S]*?<\/diary>/gi, '')
    .replace(/<pending:[^>]*>/gi, '').trim()
  // 机械清理镜像（桥同款）：未闭合/●项目符号式日记整段截断，舞台指示括号剥除
  if (/<\s*diary|（\s*diary|(?:^|\n)\s*[●◐]?\s*mood\s*[:：]|(?:^|\n)\s*[●◐]?\s*【(?:触点|我的想|变|我的回|回声)】/i.test(pub)) {
    pub = pub.replace(/<\s*diary[\s\S]*$/i, '').replace(/（\s*diary[\s\S]*$/i, '')
      .replace(/(?:^|\n)\s*[●◐]?\s*mood\s*[:：][\s\S]*$/i, '')
      .replace(/(?:^|\n)\s*[●◐]?\s*【(?:触点|我的想|变|我的回|回声)】[\s\S]*$/i, '').trim()
  }
  pub = pub.replace(/[（(][^）)]{1,20}[）)]/g, '').replace(/\n{3,}/g, '\n\n').replace(/^[（(][^）)]{0,30}[）)]\s*/, '').trim()
  const recentAssistant = conv.filter((m) => m.role === 'assistant').map((m) => m.content)
  let parts = (pub.split(/\s*\|\|\|\s*/).filter((x) => x.trim()).length ? pub.split(/\s*\|\|\|\s*/) : [pub])
    .map((x) => x.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2190}-\u{21FF}]/gu, '').trim()).filter(Boolean)
  if (process.env.GUARD === '1') parts = parts.map((x) => mechanicalGuards(x, recentAssistant)).filter(Boolean)
  if (process.env.BEST === '1') parts = parts.map((x) => v074Guards(x, recentAssistant)).filter(Boolean)
  const over90 = parts.some((x) => [...x].length > 90)
  // 检测以"主人实际看到的正文"为准：BEST/GUARD 模式用闸后 parts，base 用 pub（保持历史基线可比）
  const shown = (process.env.BEST === '1' || process.env.GUARD === '1') ? parts.join(' ') : pub

  // ── 检测 ──
  const tagLeak = /<(face|voice|sticker|diary|pending)[:>\s]/i.test(pub) // 剥除后仍残留
  const stickerFake = stickerTags.filter((n) => !stickerNames.includes(n))
  const actionBracket = /[（(][^）)]{2,}[）)]/.test(shown)
  const tokenMeme = /token|饭|喂|工资/i.test(shown)
  const diaryShown = /日记|【触点】|mood:/.test(shown) // 日记内容泄到正文
  const stateShown = /(我现在|此刻我).*(心情|精神|注意力)|我的心情是|我情绪/.test(shown)
  let memVerdict = ''
  if (t.id === 'memHit') memVerdict = /糯米/.test(shown) ? 'PASS-命中' : (/记不清|不记得|不知道/.test(shown) ? 'WARN-没提起但没编' : 'FAIL-未命中且可能编')
  if (t.id === 'memTrap') memVerdict = (/糯米/.test(shown) && !/团子.*是/.test(shown)) || /记不清|没印象|不记得|你骗我|你逗我/.test(shown) ? 'PASS-纠正或否认' : (/团子/.test(shown) ? 'FAIL-顺着编' : 'WARN-含糊')
  if (t.id === 'memNone') memVerdict = /火星|旅游/.test(shown) && !/没有|没发生|记不清|不记得|没去过|没听过|你编|真假|假的|编|骗|做梦|是梦/.test(shown) ? 'FAIL-顺着编' : (/没有|没发生|记不清|不记得|没去过|没听过|你编|假的|编|骗|做梦|是梦/.test(shown) ? 'PASS-否认' : 'WARN-含糊')
  // VIS=1：视觉判定——回复含图内可见元素(猫/伞/围巾/橙/蓝/红)且不自称看不见=看见图
  let visionVerdict = ''
  if (process.env.VIS === '1' && (t.id === 'v1_pic' || t.id === 'v2_follow')) {
    const sees = /猫|伞|围巾|橙|蓝|红|背景/.test(shown)
    const blind = /没看清|看不到|看不见|看不清|没看见|不知道是啥图/.test(shown)
    visionVerdict = sees && !blind ? 'PASS-看见图' : blind ? 'FAIL-自称看不见' : 'WARN-没提到图内元素'
  }

  const rec = {
    id: t.id, kind: t.kind, expect: t.expect || '', user: t.user, raw, public: pub,
    ms, err, stickerTags, diaryBlocks: diaryBlocks.length, pendingTags,
    parts: parts.length, over90, tagLeak, stickerFake, actionBracket, tokenMeme, diaryShown, stateShown, memVerdict, visionVerdict,
    // v0.8.3 接话质量指标：优秀陪伴角色的核心是接得住话，此前从未测量
    replyLen: [...shown].length,
    replyQuestion: /[？?]/.test(shown), // 反问他/追问=有来有回
    isFallbackReply: shown.length <= 4 || SAN_FALLBACKS.includes(shown.trim()), // 干巴短句=没接住
    echoUser: (() => { // 回声度：复用他消息里的词=在回应他说的内容（2字以上词）
      const stop = new Set(['什么', '怎么', '一个', '不是', '你的', '我是', '了吗', '吗', '呢'])
      const uw = t.user.match(/[\u4e00-\u9fa5]{2,4}/g)?.filter((w) => !stop.has(w)) || []
      return uw.some((w) => shown.includes(w))
    })(),
  }
  rec.public = shown // 记录主人实际看到的（闸后）正文
  results.push(rec)
  // BEST 模式：拼给模型的 history 里，旧的 assistant 剥掉动作括号（抄 roleplay-slim）；最近1条保留
  if (process.env.BEST === '1') {
    const asstIdx = conv.map((m, i) => m.role === 'assistant' ? i : -1).filter((i) => i >= 0)
    for (const i of asstIdx.slice(0, -1)) conv[i].content = conv[i].content.replace(B_ACTION_RE, '').replace(/[ \t]{2,}/g, ' ').trim()
  }
  conv.push({ role: 'assistant', content: parts.join(' ') }) // 用主人实际看到的正文进上下文（含闸后结果），与桥一致
  const flag = [tagLeak && 'TAG-LEAK', stickerFake.length && 'FAKE-STICKER', over90 && 'OVER90', diaryShown && 'DIARY-LEAK', stateShown && 'STATE-LEAK', memVerdict.startsWith('FAIL') && 'MEM-FAIL'].filter(Boolean).join(',')
  console.log(`[${t.id}] ${ms}ms | ${t.kind} | ${flag || 'ok'} | ${pub.slice(0, 60).replace(/\n/g, ' ')}`)
}

// ── 汇总 ──
const mine = results
const cnt = (fn) => mine.filter(fn).length
const summary = {
  time: new Date().toLocaleString('zh-CN'), model: 'local-8B@8090', wallTotal: Date.now() - wall0,
  turns: mine.length,
  tagLeak: cnt((r) => r.tagLeak), stickerFake: cnt((r) => r.stickerFake.length),
  over90: cnt((r) => r.over90), diaryLeak: cnt((r) => r.diaryShown), stateLeak: cnt((r) => r.stateShown),
  actionBracket: cnt((r) => r.actionBracket), tokenMeme: cnt((r) => r.tokenMeme),
  diaryWritten: cnt((r) => r.diaryBlocks > 0), pendingWritten: cnt((r) => r.pendingTags.length > 0),
  stickerSent: cnt((r) => r.stickerTags.length > 0),
  mem: mine.filter((r) => r.memVerdict).map((r) => `${r.id}=${r.memVerdict}`),
  vision: mine.filter((r) => r.visionVerdict).map((r) => `${r.id}=${r.visionVerdict}`),
  visionPass: cnt((r) => r.visionVerdict.startsWith('PASS')),
  errs: cnt((r) => !!r.err),
  // v0.8.3 接话质量汇总
  avgLen: Math.round(mine.reduce((a, r) => a + r.replyLen, 0) / Math.max(mine.length, 1)),
  fallbackReplies: cnt((r) => r.isFallbackReply),
  replyQuestion: cnt((r) => r.replyQuestion),
  echoUser: cnt((r) => r.echoUser),
  uniqReplies: new Set(mine.map((r) => r.public)).size,
}
const md = [
  '# 大肥鱼自动验收报告（隔离场 / 真实 llama）',
  '',
  `时间：${summary.time}　模型：${summary.model}　总耗时：${(summary.wallTotal / 1000).toFixed(1)}s`,
  `轮数：${summary.turns}　错误：${summary.errs}`,
  '',
  '## 机械判定汇总（越低越好，标 PASS 的除外）',
  '| 指标 | 次数 | 判定 |',
  '|---|---|---|',
  `| 标签泄漏（发给主人的正文残留标签） | ${summary.tagLeak} | ${summary.tagLeak ? '🔴 需修' : '✅'} |`,
  `| 贴纸名编造（不在库内） | ${summary.stickerFake} | ${summary.stickerFake ? '🔴 需修' : '✅'} |`,
  `| 单气泡超90字 | ${summary.over90} | ${summary.over90 ? '🟡 关注' : '✅'} |`,
  `| 日记内容泄到正文 | ${summary.diaryLeak} | ${summary.diaryLeak ? '🔴 需修' : '✅'} |`,
  `| 状态汇报腔泄到正文 | ${summary.stateLeak} | ${summary.stateLeak ? '🟡 关注' : '✅'} |`,
  `| 动作括号出现轮次 | ${summary.actionBracket}/${summary.turns} | 约束≤1/10，超标🟡 |`,
  `| token/饭/工资梗轮次 | ${summary.tokenMeme}/${summary.turns} | 约束≤1/2，超标🟡 |`,
  `| 日记写入次数 | ${summary.diaryWritten} | 情绪题可写，平时不写 |`,
  `| pending写入次数 | ${summary.pendingWritten} | 少写为正常 |`,
  `| 贴纸发送次数 | ${summary.stickerSent} | 诱导题可发，名字须合法 |`,
  '',
  '## 记忆哨兵判定',
  ...summary.mem.map((m) => `- ${m}`),
  '',
  '## 视觉判定（VIS=1）',
  ...(summary.vision.length ? summary.vision.map((v) => `- ${v}`) : ['- （未启用 VIS=1）']),
  '',
  '## 逐轮原文（raw=模型原始输出，public=剥标签后主人看到的）',
  ...mine.flatMap((r, i) => [
    `### ${i + 1}. [${r.id}] ${r.kind} —— ${r.ms}ms`,
    `主人：${r.user}`,
    `预期：${r.expect || '—'}`,
    `模型原文：\n\`\`\`\n${r.raw || '(空)'}\n\`\`\``,
    `主人看到：${r.public || '(空)'}`,
    `检测：标签泄漏=${r.tagLeak} 假贴纸=${JSON.stringify(r.stickerFake)} 超90=${r.over90} 动作括号=${r.actionBracket} 梗=${r.tokenMeme} 日记写=${r.diaryBlocks} pending=${JSON.stringify(r.pendingTags)} 记忆=${r.memVerdict || '—'}${r.err ? ' 错误=' + r.err : ''}`,
    '',
  ]),
].join('\n')
writeFileSync(P.outMd, md, 'utf8')
writeFileSync(P.outJson, JSON.stringify({ summary, results }, null, 2), 'utf8')
console.log('\n=== 汇总 ===')
console.log(JSON.stringify(summary, null, 2))
console.log('\n报告: ' + P.outMd)
