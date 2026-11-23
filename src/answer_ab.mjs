// 针对性 A/B：治"反问打回"（为什么不能找你 → 找我？你问谁呢）
// A=当前 system  B=加一条正向"问题先给答案"锚点
// 单变量；同 persona/history/采样；真实截图序列各跑3遍抵消波动。
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const rd = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }
const SRC = 'D:/wokebuddy/tools-1122/poc_bridge.mjs'
const TMP = 'D:/wokebuddy/tools-1122/.answer_ab_tmp.mjs'
let src = rd(SRC)
src = src.replace(/^connect\(\)$/m, '/* stub */').replace(/^beat\(\)[^\n]*$/m, '/* stub */')
src = src.replace(/setInterval\([\s\S]*?\)\.unref\(\)/g, '/* stub */').replace(/^const log = .*$/m, 'const log = () => {}')
src += '\nexport { coreOf, sanitizeForHistory }\n'
writeFileSync(TMP, src, 'utf8')
const m = await import('file:///' + TMP.replace(/\\/g, '/') + '?t=' + Date.now())
try { unlinkSync(TMP) } catch {}

const LLM = 'http://127.0.0.1:8090/v1/chat/completions'
const persona = rd('C:/Users/Administrator/.dsh/plugins-data/aurabot/personas/dafeiyu.md')
const scenario = rd('D:/wokebuddy/poc_scenario.md')
const core = rd('D:/wokebuddy/poc_core.md')
const hist = rd('D:/wokebuddy/poc_history.jsonl').trim().split('\n').map(JSON.parse).slice(-20)
const mem = rd('D:/wokebuddy/poc_memory.txt').trim().split('\n').filter(Boolean)
const memBlock = '\n\n【你们攒下的记忆】\n' + mem.join('\n')
const base = [persona, scenario, core].filter(Boolean).join('\n\n') + memBlock +
  '\n\n（这一句就回他刚说的这件事，像平时打字那样短，说完就停。）'
// B 组唯一变量：正向锚点——问题先给答案，别用反问把问题丢回去
const ANCHOR = '\n\n（他问了什么就先正面答他：为什么、能不能、能不能找到你这类问题，先给个明确回答，别把问题反问回去。答完想逗再逗一句。）'

async function call(messages) {
  const r = await fetch(LLM, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, temperature: 0.7, top_p: 0.8, top_k: 20, max_tokens: 150 }),
    signal: AbortSignal.timeout(60000) })
  const j = await r.json()
  return String(j.choices?.[0]?.message?.content || '').trim()
}
// 判"反问打回"：回复本身是个问句、或拿用户原话反问、不含任何实质信息
const isDodge = (raw, user) => {
  const c = m.coreOf(String(raw).replace(/<[^>]+>/g, ''))
  if (!c) return true
  // 反问打回特征：以"找我/你问/谁啊/啥/为什么/咋"开头且整体是问句，没给答案
  if (/^(找我|你问|谁阿|谁啊|问谁|啥|为什么|为啥|咋|怎么)/.test(c) && /[？?]/.test(raw)) return true
  // 纯复述用户关键词
  const uc = m.coreOf(user)
  if (uc.length >= 3 && c.length <= uc.length + 2 && uc.includes(c)) return true
  return false
}
const script = ['为什么不能找你', '你能给我卖个萌吗', '换个话题呢', '你会发表情包吗']
async function run(system, tag) {
  const sent = hist.map((h) => ({ role: h.role, content: h.role === 'assistant' ? m.sanitizeForHistory(h.text) : h.text }))
  const messages = [{ role: 'system', content: system }, ...sent]
  const outs = []
  for (const u of script) {
    messages.push({ role: 'user', content: u })
    const raw = await call(messages)
    if (tag.includes('REP1') && u === script[0]) console.log('DBG sysLen=' + system.length + ' sentN=' + sent.length + ' raw=[' + raw + ']')
    messages.push({ role: 'assistant', content: raw })
    outs.push({ user: u, raw: raw.replace(/\n/g, ' ').slice(0, 70), dodge: isDodge(raw, u) })
  }
  console.log(`\n=== ${tag} ===`)
  outs.forEach((o) => console.log(`  ${o.dodge ? 'DODGE' : 'ANSWER'} | ${o.user} -> ${o.raw}`))
  return outs.filter((o) => o.dodge).length
}
let aD = 0, bD = 0
for (let rep = 1; rep <= 3; rep++) {
  console.log(`\n######## REP ${rep} ########`)
  aD += await run(base, `REP${rep} A(当前)`)
  bD += await run(base + ANCHOR, `REP${rep} B(加正面回答锚点)`)
}
console.log(`\n===== 汇总（3遍×4问=12）: A反问打回 ${aD}/12  B反问打回 ${bD}/12 =====`)
