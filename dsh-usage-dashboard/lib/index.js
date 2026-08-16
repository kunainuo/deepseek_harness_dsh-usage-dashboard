// dsh-usage-dashboard - host half (persistent composition plugin).
// Registers an HTTP route serving DeepSeek API balance + local session token usage as JSON.
const BALANCE_TTL_MS = 60 * 1000
const USAGE_TTL_MS = 5 * 60 * 1000
const MAX_SESSIONS = 100

function safeError(e) {
  if (e === null || e === undefined) return '未知错误'
  return String(e && e.message !== undefined ? e.message : e)
}

function pad2(n) { return String(n).padStart(2, '0') }

function dateKey(ts) {
  const d = new Date(ts)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

function addAcc(acc, input, output) {
  acc.input += input
  acc.output += output
  acc.calls += 1
}

/**
* Parse raw JSONL session-log rows into lightweight event envelopes
* ({ type, time, data }) — enough for usage aggregation, without the cost of
* full replay validation. Rows that fail to parse are skipped.
*/
function parseRawEvents(content) {
  const events = []
  for (const line of content.split('\n')) {
    if (!line) continue
    let row
    try { row = JSON.parse(line) } catch (e) { continue }
    if (!row || typeof row !== 'object' || typeof row.type !== 'string') continue
    events.push({ type: row.type, time: row.time, data: row.data })
  }
  return events
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i
      i += 1
      try { results[idx] = await fn(items[idx]) } catch (e) { results[idx] = null }
    }
  }
  const n = Math.min(limit, items.length)
  const workers = []
  for (let k = 0; k < n; k += 1) workers.push(worker())
  await Promise.all(workers)
  return results
}

const apply = (ctx) => {
  let balanceCache = null

  async function fetchBalance() {
    const credentials = ctx.get('credentials')
    if (credentials === undefined) return { error: '凭据服务(credentials)不可用' }
    let cred = null
    try { cred = await credentials.resolve('DEEPSEEK_API_KEY') } catch (e) { return { error: '读取 API Key 失败: ' + safeError(e) } }
    if (!cred || !cred.value) return { error: '未配置 DEEPSEEK_API_KEY（请先在“设置 → 模型”中填入 DeepSeek API Key）' }
    const subprocess = ctx.get('subprocess')
    if (subprocess === undefined) return { error: '子进程服务(subprocess)不可用' }
    let curl = null
    for (const candidate of ['curl.exe', 'C:\\Windows\\System32\\curl.exe']) {
      try { curl = await subprocess.resolveExecutable(candidate); break } catch (e) { /* try next */ }
    }
    if (!curl) return { error: '未找到 curl 可执行文件，无法查询余额' }
    const sp = ctx.get('sandboxPolicy')
    const cwd = sp && sp.workspaceRoot ? sp.workspaceRoot : 'C:\\'
    let proc = null
    try {
      proc = subprocess.spawn({
        argv: [curl, '-sS', '--max-time', '20', '-H', 'Authorization: Bearer ' + cred.value, 'https://api.deepseek.com/user/balance'],
        cwd,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 262144 }, stderr: { maxBytes: 262144 } },
        graceMs: 5000
      })
    } catch (e) { return { error: '启动 curl 失败: ' + safeError(e) } }
    let outcome = null
    try { outcome = await proc.done } catch (e) { return { error: 'curl 执行失败: ' + safeError(e) } }
    const stdout = proc.collected && proc.collected.stdout ? proc.collected.stdout.readFrom(0).text : ''
    const stderr = proc.collected && proc.collected.stderr ? proc.collected.stderr.readFrom(0).text : ''
    if (outcome.exitCode !== 0) return { error: '余额接口请求失败(exit ' + String(outcome.exitCode) + '): ' + String(stderr).slice(0, 200) }
    let json = null
    try { json = JSON.parse(stdout) } catch (e) { return { error: '余额接口返回非 JSON 数据' } }
    if (json && typeof json === 'object' && json.error) {
      const m = json.error && json.error.message !== undefined ? json.error.message : json.error
      return { error: '余额接口错误: ' + safeError(m) }
    }
    return { data: json }
  }

  async function getBalance() {
    const now = Date.now()
    if (balanceCache && now - balanceCache.at < BALANCE_TTL_MS) return balanceCache
    const result = await fetchBalance()
    balanceCache = {
      at: now,
      ...(result.error !== undefined ? { error: result.error } : {}),
      ...(result.data !== undefined ? { data: result.data } : {})
    }
    return balanceCache
  }

  async function collectUsage() {
    const sessionQuery = ctx.get('sessionQuery')
    const sessionPersistence = ctx.get('sessionPersistence')
    if (sessionQuery === undefined) return { error: '会话查询服务(sessionQuery)不可用' }
    if (sessionPersistence === undefined) return { error: '会话持久化服务(sessionPersistence)不可用' }
    let sessions = []
    try { sessions = await sessionQuery.listSessions() } catch (e) { return { error: '列出会话失败: ' + safeError(e) } }
    const all = sessions || []
    const capped = all.slice(0, MAX_SESSIONS)
    const snapshots = await mapLimit(capped, 8, async (rec) => {
      // Fast path: read the backend's raw artifact (no replay validation) and
      // parse the JSONL rows ourselves. Falls back to the validated log read.
      try {
        const raw = await sessionPersistence.readRaw(rec.header.id)
        if (raw && typeof raw.content === 'string') return { events: parseRawEvents(raw.content) }
      } catch (e) { /* fall through */ }
      try {
        const snapshot = await sessionQuery.readSession(rec.header.id)
        return { events: snapshot && snapshot.events ? snapshot.events : [] }
      } catch (e) { return null }
    })
    const totals = { input: 0, output: 0, calls: 0 }
    const byModel = Object.create(null)
    const byDay = Object.create(null)
    const bySession = []
    let scanned = 0
    for (let idx = 0; idx < capped.length; idx += 1) {
      const rec = capped[idx]
      const snapshot = snapshots[idx]
      if (!snapshot || !snapshot.events) continue
      scanned += 1
      const acc = { input: 0, output: 0, calls: 0 }
      for (const ev of snapshot.events) {
        if (!ev || ev.type !== 'assistant/message' || !ev.data || !ev.data.usage) continue
        const usage = ev.data.usage
        const input = Number(usage.inputTokens) || 0
        const output = Number(usage.outputTokens) || 0
        if (input === 0 && output === 0) continue
        addAcc(totals, input, output)
        addAcc(acc, input, output)
        const src = ev.data.message && ev.data.message.source
        const model = src && src.model ? String(src.model) : 'unknown'
        const m = byModel[model] || (byModel[model] = { model, input: 0, output: 0, calls: 0 })
        addAcc(m, input, output)
        const day = dateKey(Number(ev.time) || Date.now())
        const d = byDay[day] || (byDay[day] = { day, input: 0, output: 0, calls: 0 })
        addAcc(d, input, output)
      }
      bySession.push({ id: rec.header.id, createdAt: Number(rec.header.createdAt) || 0, input: acc.input, output: acc.output, calls: acc.calls })
    }
    const now = new Date()
    const days = []
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const key = dateKey(d.getTime())
      days.push(byDay[key] || { day: key, input: 0, output: 0, calls: 0 })
    }
    const models = Object.keys(byModel).map((k) => byModel[k]).sort((a, b) => (b.input + b.output) - (a.input + a.output))
    const topSessions = bySession.slice().sort((a, b) => (b.input + b.output) - (a.input + a.output)).slice(0, 5)
    return {
      totals,
      days,
      models,
      topSessions,
      scannedSessions: scanned,
      totalSessions: all.length,
      capped: capped.length < all.length
    }
  }

  let usageCache = null

  async function getUsage() {
    const now = Date.now()
    if (usageCache && now - usageCache.at < USAGE_TTL_MS) return usageCache.value
    const result = await collectUsage()
    usageCache = { at: now, value: result }
    return result
  }

  async function handleData() {
    const [balance, usage] = await Promise.all([getBalance(), getUsage()])
    return { balance, usage, serverTime: Date.now() }
  }

  ctx.webServer.register({
    kind: 'exact',
    path: '/usage-dashboard/data',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      let payload
      try {
        payload = await handleData()
      } catch (e) {
        payload = { error: safeError(e) }
      }
      const body = JSON.stringify(payload)
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-cache'
      })
      res.end(body)
    }
  })
}

export default { name: 'usage-dashboard', inject: ['webServer'], apply }
