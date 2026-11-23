// 影子验证：加载新桥但不连 WS、不真发、不启动定时器，测纯函数与标签逻辑。
// 做法：读源码 → 桩掉 connect()/setInterval/fetch → 末尾 export → 写临时 mjs → import。
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const SRC = 'D:/wokebuddy/tools-1122/poc_bridge.mjs'
const TMP = 'D:/wokebuddy/tools-1122/.verify_tmp.mjs'
let src = readFileSync(SRC, 'utf8')
// 桩：不连 WS、不排任何定时器、不写生产心跳、不真发 HTTP（保留纯函数）
// 审计修复：原正则误写 .unlink()（实际是 .unref()）导致 proactive 定时器从未被桩；
// 且 beat() 未桩——影子进程会覆盖生产心跳文件（pid 不一致）。现在全部桩掉。
src = src.replace(/^connect\(\)$/m, '/* connect stubbed */')
src = src.replace(/^beat\(\)[^\n]*$/m, '/* beat stubbed */')
src = src.replace(/setInterval\([\s\S]*?\)\.unref\(\)/g, '/* interval stubbed */')
src = src.replace(/^const log = .*$/m, 'const log = () => {}') // 不写生产日志（否则每次测试留假 started 行）
// 桩掉所有顶层 fetch 调用会破坏逻辑，这里不替换；验证脚本只调纯函数，不触发网络。
src += '\nexport { matchSticker, writeDiary, readPending, setPending, capLen, dedupe, gramsOf, stickerLib, segText, bigrams, pickMem, moodWord, stateLine, proactiveChance, readParams, readState, FB_NEG, FB_POS, stripOpinion, mechanicalGuards, diceSim, bigramsOf, STRIP_HISTORY_ACTION, MEME_SLOT, PATTERN_EXPAND, SIM_GUARD, MEME_RE, HEAD_RE, TAIL_RE, ACTION_RE, FALLBACKS, GUARDS_ON, OPINION_STRIP, sanitizeForHistory, HIST_SANITIZE, MEM_DIRTY_RE, readMem, pickSanFallback, coreOf, repeatsKnown, cleanDiaryLeak, SAN_FALLBACKS, isExampleCopy, EXAMPLE_CORES, TAIL_HIT_RE }\n'
writeFileSync(TMP, src, 'utf8')
let results = []
const ok = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`)
try {
  const m = await import('file:///' + TMP.replace(/\\/g, '/') + '?t=' + Date.now())
  // 贴纸匹配
  const lib = m.stickerLib()
  ok('贴纸库可读', Array.isArray(lib) && lib.length > 0, lib.length + ' items')
  const withId = lib.filter((i) => i.emojiId)
  ok('有收藏ID的贴纸', withId.length > 0, withId.length + ' 张')
  const s1 = m.matchSticker('怀疑人生')
  ok('贴纸模糊匹配(名字)', !!s1 && s1.name === '怀疑人生的小可爱', s1?.name || 'null')
  const s2 = m.matchSticker('无语')
  ok('贴纸标签匹配', !!s2, s2?.name || 'null')
  ok('贴纸编造名不匹配', m.matchSticker(' totally_not_exist_xyz ') === null)
  // capLen / dedupe
  ok('capLen 限长90', m.capLen('啊'.repeat(200)).length <= 90, m.capLen('啊'.repeat(200)).length + 'ch')
  const ded = m.dedupe('今天天气很好我们出去玩吧。真的吗真的吗真的吗。', ['今天天气很好我们出去玩吧呀'])
  ok('dedupe 去复读', typeof ded === 'string' && ded.length > 0, ded.slice(0, 30))
  // pending TTL / 读写
  m.setPending('想问他明天还上不上班')
  ok('pending 写入可读', m.readPending().includes('上班'), m.readPending())
  // segText
  ok('segText 文本段', m.segText([{ type: 'text', data: { text: '你好' } }]) === '你好')
  ok('segText 剥CQ码', m.segText('[CQ:face,id=1]你好') === '你好')
  // v0.7 记忆检索
  ok('bigrams 中文2-gram', m.bigrams('明天上班').has('明天') && m.bigrams('明天上班').has('天上') && m.bigrams('明天上班').has('上班'))
  const picked = m.pickMem('明天上班', 5)
  ok('pickMem 返回行数组', Array.isArray(picked) && picked.length <= 5, picked.length + ' 行')
  // v0.7 短期状态（纯函数，不写盘）
  ok('moodWord 开心映射', m.moodWord('今天很开心') === '心情不错', m.moodWord('今天很开心'))
  ok('moodWord 低落映射', m.moodWord('有点委屈') === '有点低落', m.moodWord('有点委屈'))
  ok('stateLine 三字段成句', typeof m.stateLine({ mood: '心情不错', energy: 0.8, attention: 0.3 }) === 'string' && m.stateLine({ mood: '', energy: 0.8, attention: 0.3 }).includes('走神'))
  const st = m.readState()
  ok('readState 字段齐全', st && 'mood' in st && 'energy' in st && 'attention' in st)
  // v0.7 行为参数
  const prm = m.readParams()
  ok('readParams 默认旋钮', prm.maxReplyChars === 90 && prm.actionPer10 === 1, JSON.stringify(prm))
  // v0.7 主动反馈规则（纯函数，不写盘）
  ok('proactiveChance 基线', typeof m.proactiveChance(14) === 'number', String(m.proactiveChance(14)))
  // v0.7.2 观点剥离：断言句式中性化、普通聊天 no-op、不留残片
  ok('ult-opinionStrip已退役(默认关)', m.OPINION_STRIP === false)
  // v0.8.1 历史脱敏（读时+写时）——治"人设干净但历史攒满照抄句"的历史污染根因
  ok('san-开关默认开', m.HIST_SANITIZE === true)
  ok('san-照抄句剥成中性', !/偷吃token|眼光不错|测试环境|像你/.test(m.sanitizeForHistory('…你才偷吃token ||| …我明明在测试环境摸鱼')))
  ok('san-串台词全删有兜底', m.sanitizeForHistory('…你眼光不错，会挑鱼', []).length > 1)
  ok('san-正常聊天不误伤', m.sanitizeForHistory('今天被骂了，抱抱你。') === '今天被骂了，抱抱你。')
  ok('san-吃蛋糕口语不误伤', m.sanitizeForHistory('我在吃蛋糕，很好吃') === '我在吃蛋糕，很好吃')
  // v0.8.2：兜底轮换 + 记忆过滤（治 19:50 截图"嗯，你说。"三连发的自污染循环）
  const rot = [1, 2, 3, 4, 5, 6].map(() => m.sanitizeForHistory('你才偷吃token'))
  ok('san-兜底轮换不连出相同句', new Set(rot).size >= 3, rot.join('|'))
  ok('san-脏记忆行被过滤', [1, 2, 3].every(() => m.MEM_DIRTY_RE.test('他常偷吃token被你调侃') && m.MEM_DIRTY_RE.test('他爱用猫脸表情包自嘲笨') && m.MEM_DIRTY_RE.test('他认输后会主动认领鲸鱼梗')))
  ok('san-正常记忆行保留', !m.MEM_DIRTY_RE.test('他喜欢深夜聊代码'))
  ok('stripOpinion 猫名断言→中性', m.stripOpinion('对了，我上次说的那只猫叫团子，你还记得吧？') === '那只猫叫什么来着？', m.stripOpinion('对了，我上次说的那只猫叫团子，你还记得吧？'))
  ok('stripOpinion 出去事件→中性', /我们去过火星旅游吗/.test(m.stripOpinion('还记得上周我们一起去火星旅游吗？那趟真难忘')), m.stripOpinion('还记得上周我们一起去火星旅游吗？那趟真难忘'))
  ok('stripOpinion 普通聊天不变', m.stripOpinion('今天开心') === '今天开心')
  ok('stripOpinion 无乱码残片', !/吗吗|火吗|上次说的那只/.test(m.stripOpinion('对了，我上次说的那只猫叫团子，你还记得吧？') + m.stripOpinion('还记得我们一起去火星旅游吗')))
  // v0.7.1 闪退加固：全局异常 handler 已注册（import 时不触发写盘）
  ok('uncaughtException 兜底已装', process.listeners('uncaughtException').length > 0)
  ok('unhandledRejection 兜底已装', process.listeners('unhandledRejection').length > 0)
  // 审计修复：handler 不重复（源码中每种恰好1处）、反馈词表覆盖口语、onerror 非空、__rounds 同步
  const rawSrc = readFileSync(SRC, 'utf8')
  const countOcc = (str, sub) => str.split(sub).length - 1
  ok('uncaughtException 不重复', countOcc(rawSrc, "process.on('uncaughtException'") === 1, countOcc(rawSrc, "process.on('uncaughtException'") + '处')
  ok('unhandledRejection 不重复', countOcc(rawSrc, "process.on('unhandledRejection'") === 1)
  ok('WS onerror 非空', !/sock\.onerror\s*=\s*\(\)\s*=>\s*\{\s*\}/.test(rawSrc))
  ok('__rounds 有同步赋值', /globalThis\.__rounds\s*=\s*rounds/.test(rawSrc))
  ok('反馈词表-别再来烦我', m.FB_NEG.test('别再来烦我'))
  ok('反馈词表-怎么不理我', m.FB_POS.test('怎么不理我'))
  ok('反馈词表-别烦我', m.FB_NEG.test('别烦我'))
  // v0.8.0：人设 V14 源头重构后机械闸退役——默认直通，代码保留可随时回退
  const G = m.mechanicalGuards
  ok('ult-机械闸已退役(默认关)', m.GUARDS_ON === false)
  ok('闸-关闭时原文直通', G('（尾巴拍地）刚炫完一碗token好嘛你赢了', ['token', 'token']) === '（尾巴拍地）刚炫完一碗token好嘛你赢了')
  ok('闸-关闭时无兜底注入', G('token啊...行，我吃', ['token', 'token']).indexOf('嗯') === -1)
  ok('v074-四开关代码保留', m.STRIP_HISTORY_ACTION && m.SIM_GUARD && m.MEME_SLOT && m.PATTERN_EXPAND)
  ok('v074-dice 自相似=1', Math.abs(m.diceSim('猫脸像你笨笨的', '猫脸像你笨笨的') - 1) < 0.01)
  ok('v074-dice 无关=0', m.diceSim('今天天气不错', '晚饭吃什么呀') < 0.2)
  ok('v074-dice 相邻复读0.46', Math.abs(m.diceSim('…这猫脸像你，笨笨的', '这猫脸真大……像你') - 0.46) < 0.12)
  ok('v074-dice 算法仍可用(闸退役不影响)', typeof m.diceSim('aabb', 'aabb') === 'number')
  ok('v074-退役后相邻复读直通不删', G('这猫脸真大…像你', ['…这猫脸像你，笨笨的']) === '这猫脸真大…像你')
  ok('v074-梗槽位抓偷吃蛋糕', m.MEME_RE.test('刚偷吃三块小蛋糕'))
  ok('v074-梗槽位抓测试环境', m.MEME_RE.test('我明明在测试环境吃蛋糕'))
  ok('v074-退役后换皮梗直通不删', G('偷吃三块小蛋糕，你猜我饿不饿', ['偷吃三块小蛋糕', '甲', '乙', '丙']) === '偷吃三块小蛋糕，你猜我饿不饿')
  ok('v074-句头抓你才X呢', m.HEAD_RE.test('？你才偷吃token呢'))
  ok('v074-尾巴抓你赢了减肥', m.TAIL_RE.test('好嘛，你赢了，我减肥'))
  ok('v074-兜底池已扩充', m.FALLBACKS.length >= 8)
  ok('v074-history剥括号已接线', /STRIP_HISTORY_ACTION[\s\S]{0,300}replace\(ACTION_RE/.test(rawSrc))
  // ── v0.8.4 反回声：核心归一化 + 重复判定 + 重掷 + 图片场景注入（20:19 截图实证"是你"循环）──
  ok('echo-coreOf去语气词', m.coreOf('嗯，是你') === '是你' && m.coreOf('是，是你') === '是是你' && m.coreOf('知道啦') === '知道', `${m.coreOf('嗯，是你')}|${m.coreOf('是，是你')}|${m.coreOf('知道啦')}`)
  ok('echo-coreOf纯回复不动', m.coreOf('在，咋') === '在咋' && m.coreOf('吃了，你呢') === '吃了你', `${m.coreOf('在，咋')}|${m.coreOf('吃了，你呢')}`)
  ok('echo-逐字重复判true', m.repeatsKnown('没看清', ['能但没发过', '没看清']) === true)
  ok('echo-换皮是你判true', m.repeatsKnown('是你', ['知道是你']) === true && m.repeatsKnown('你就是你', ['是你']) === true)
  ok('echo-你就是你vs就是你判true', m.repeatsKnown('就是你', ['你就是你']) === true)
  ok('echo-长回复含短词不误伤', m.repeatsKnown('别的鱼没你这个主人', ['主人']) === false)
  ok('echo-无关短句不误伤', m.repeatsKnown('在咋', ['是你', '没看清']) === false && m.repeatsKnown('睡觉了', ['吃了你呢']) === false)
  ok('echo-空核心不判', m.repeatsKnown('', ['是你']) === false && m.repeatsKnown('嗯', ['是你']) === false)
  ok('echo-表情段出[表情]标记', m.segText([{ type: 'face', data: {} }, { type: 'text', data: { text: '哈' } }]).includes('[表情]'), m.segText([{ type: 'face', data: {} }]))
  ok('echo-图片场景注入已接线', rawSrc.includes('他刚发了张图') && rawSrc.includes('他刚发了个表情包'))
  ok('echo-重掷已接线', rawSrc.includes('echo-reroll') && rawSrc.includes('ECHO_NUDGE') && rawSrc.includes('badReply'))
  ok('echo-历史回声剔除已接线', rawSrc.includes('echoDropped') && rawSrc.includes('repeatsKnown(c, keptCores'))
  // v0.8.4 人设 V16：身份问答/图片/问号示范 + 反原地打转正向规则
  const personaSrc = readFileSync('C:/Users/Administrator/.dsh/plugins-data/aurabot/personas/dafeiyu.md', 'utf8')
  ok('personaV16-身份问答示范', personaSrc.includes('我主人，还能是谁'))
  ok('personaV16-问号示范', personaSrc.includes('咋了，我哪句说错了'))
  ok('personaV16-反原地打转正向规则', personaSrc.includes('新信息答') && personaSrc.includes('原地打转'))
  ok('personaV16-红线不含没看清硬直说', !personaSrc.includes('就直说没看清'))
  // ── v0.8.5 视觉支持：bonsai-2-9b 多模态，图片真喂给模型 ──
  ok('vision-imgToDataUri已接线', /async function imgToDataUri/.test(rawSrc) && /base64:\/\//.test(rawSrc) && /sniffMime/.test(rawSrc))
  ok('vision-WS收图已接线', /pendingImgs/.test(rawSrc) && /s\?\.type === 'image'/.test(rawSrc) && /onmessage = async/.test(rawSrc))
  ok('vision-多模态content已接线', /type: 'image_url', image_url: \{ url: u \}/.test(rawSrc) && /pendingImgs\.splice/.test(rawSrc))
  ok('vision-场景注入分流', rawSrc.includes('你能看到') && rawSrc.includes('没传成功'))
  ok('vision-stripOpinion数组守卫', /typeof last\.content === 'string'/.test(rawSrc))
  const personaV17 = readFileSync('C:/Users/Administrator/.dsh/plugins-data/aurabot/personas/dafeiyu.md', 'utf8')
  ok('personaV17-能看见图规则', personaV17.includes('他发的图片你能看到'))
  ok('personaV17-看见图示范', personaV17.includes('这猫怎么比你圆'))
  ok('personaV17-表情包仍标记不可见', personaV17.includes('QQ 经典表情看不到画面'))
  // 日记明文泄漏加固：未闭合标签 / ● 项目符号式日记整段截断，正常聊天不误伤
  const L = m.cleanDiaryLeak
  ok('diaryLeak-●mood式截断', L('团子？  \n● mood: 无语  \n● 【我的想】记混了\n<diary>') === '团子？', JSON.stringify(L('团子？  \n● mood: 无语  \n● 【我的想】记混了\n<diary>')))
  ok('diaryLeak-五段式截断', L('火星？\n● 【我的想】当初的判断\n● 【回声】事后感想') === '火星？')
  ok('diaryLeak-未闭合标签截断', L('好的呀\n<diary>\nmood: 开心\n【触点】刚才') === '好的呀')
  ok('diaryLeak-括号明文截断', L('好呀（diary 这是隐私内容') === '好呀')
  ok('diaryLeak-正常聊天不误伤', L('今天聊得开心，抱抱你。') === '今天聊得开心，抱抱你。')
  ok('diaryLeak-桥已接线', /raw = cleanDiaryLeak\(raw\)/.test(rawSrc))
  // 22:2x 实战新增：围裙/尾巴换皮梗自污染（真实对话 92% assistant 命中）
  ok('apron-脏记忆被滤', ['他家猫偷吃他围裙是常事', '天青色瞪眼鱼是他自封名号', '他常被我摸过猫尾巴逗乐', '他催萌时会说主人不催我'].every((l) => m.MEM_DIRTY_RE.test(l)))
  ok('apron-脏回复剥成兜底', ['你家猫又在偷吃我围裙。它尾巴卷起来了，我摸过。', '它没尾巴，是因为它偷吃我围裙时，尾巴被我卷起来了。你家猫的尾巴，我摸过', '你家猫又偷吃我围巾。'].every((s) => m.SAN_FALLBACKS.includes(m.sanitizeForHistory(s))))
  const seenOut = m.sanitizeForHistory('这鱼眼睛瞪得比我大，还带个呆毛，像在说“你别动我尾巴”')
  ok('apron-看图套路整句删', m.SAN_FALLBACKS.includes(seenOut), seenOut)
  ok('apron-风格锚不误删', m.sanitizeForHistory('我？我尾巴只给主人摸。') === '我？我尾巴只给主人摸。')
  ok('apron-正常闲聊不误伤', m.sanitizeForHistory('想听笑话？我不会。你讲，我听着。') === '想听笑话？我不会。你讲，我听着。')
  // v0.9.0 实战新增：照抄人设示例句（截图 22:2x 真人对局翻车，隔离场 A/B 上一轮漏检整类）
  ok('example-示例表从人设动态提取', m.EXAMPLE_CORES.length >= 10, 'n=' + m.EXAMPLE_CORES.length)
  ok('example-照抄你好句命中', m.isExampleCopy(m.coreOf('嗯，你好。找我有事？')))
  ok('example-照抄主人句命中', m.isExampleCopy(m.coreOf('我主人，还能是谁')))
  ok('example-短句不误伤', !m.isExampleCopy(m.coreOf('在，咋')) && !m.isExampleCopy(m.coreOf('……知道啦')))
  ok('example-正常接话不误判', !m.isExampleCopy(m.coreOf('刚开完会啊，累不累')))
  ok('example-正常新信息不误判', !m.isExampleCopy(m.coreOf('我今天在路上看到一只柯基')))
  ok('tailhit-想摸尾巴命中', m.TAIL_HIT_RE.test(m.coreOf('想摸尾巴？别摸，我怕你没手')))
  ok('tailhit-偷围裙命中', m.TAIL_HIT_RE.test(m.coreOf('你家猫又偷我围裙了')))
  ok('tailhit-正常聊天不误判', !m.TAIL_HIT_RE.test(m.coreOf('我今天看到一只柯基，超可爱')))
  ok('example-badReply已接线', /if \(isExampleCopy\(c\)\) return true/.test(rawSrc) && /if \(TAIL_HIT_RE\.test\(c\)\) return true/.test(rawSrc))
  // 11-23 吞消息修复：empty after dedupe 不再 return 留孤儿 user
  ok('orphan-empty分支不再直接return', !/empty after dedupe'\).*; return \}/.test(rawSrc) && /empty after dedupe -> retry/.test(rawSrc))
  ok('orphan-有重试与兜底', /empty after retry -> fallback/.test(rawSrc) && /parts = \[pickSanFallback\(recentReplies\)\]/.test(rawSrc))
} catch (e) {
  results.push('FAIL  import/exec :: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'))
} finally {
  try { unlinkSync(TMP) } catch {}
}
console.log(results.join('\n'))
writeFileSync('D:/wokebuddy/tools-1122/verify_result.txt', results.join('\n') + '\n', 'utf8')
