#!/usr/bin/env node
/**
 * Jason Blog Messages —— 数据库核查与迁移执行器（Phase 1）
 *
 * 设计约束（管理员 2026-11-15 明确要求）：
 *   1. 复用现有 Supabase 项目，**不新建项目**；
 *   2. 迁移通过**迁移文件**管理，先核查、后执行；
 *   3. 不直接改生产：`--target=prod` 需要双重显式开关；
 *   4. 凭据只从本地文件/环境变量读取，**不出现在命令行与日志**。
 *
 * 凭据（二选一，写到 `.dsh-ops/messages-db.env`，不要提交、不要贴聊天）：
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx     # 只读核查与执行 SQL 都走 Management API
 *   SUPABASE_PROJECT_REF=abcdefghijkl # 项目 ref（Dashboard URL 里那串）
 *
 * 用法：
 *   node scripts/messages-db.mjs inspect            # 只读：库大小/表/行数/角色/RLS
 *   node scripts/messages-db.mjs plan               # 待执行迁移清单（不执行）
 *   node scripts/messages-db.mjs migrate --target=dev
 *   node scripts/messages-db.mjs verify             # 迁移后结构自检
 *   node scripts/messages-db.mjs print              # 直接打印 SQL（给 SQL Editor 手动执行）
 *   node scripts/messages-db.mjs export --target=dev  # 导出私信数据为 JSON（备份）
 *   node scripts/messages-db.mjs backup               # 同 export，默认 target=prod
 *   node scripts/messages-db.mjs cleanup --spamDays=30 --deletedDays=90 [--apply]
 *
 * 未提供凭据时：只读命令会退出码 2 并给出提示；`print` 永远可用。
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = path.resolve(process.cwd())
const MIGRATIONS_DIR = path.join(ROOT, 'docs', 'messages', 'migrations')
const ENV_FILE = path.join(ROOT, '.dsh-ops', 'messages-db.env')
const API = 'https://api.supabase.com/v1'

/* ------------------------------------------------------------------ *
 * 参数与凭据
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = { _: [] }
  for (const raw of argv) {
    if (!raw.startsWith('--')) {
      args._.push(raw)
      continue
    }
    const [key, value] = raw.slice(2).split('=')
    args[key] = value === undefined ? true : value
  }
  return args
}

function readEnvFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    const out = {}
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx <= 0) continue
      const key = trimmed.slice(0, idx).trim()
      let value = trimmed.slice(idx + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      out[key] = value
    }
    return out
  } catch (err) {
    return {}
  }
}

/** 从项目 URL（https://<ref>.supabase.co）里推导 ref —— 免得去翻 Reference ID */
function refFromUrl(url) {
  const value = String(url || '').trim()
  if (!value) return ''
  try {
    const host = new URL(value.startsWith('http') ? value : `https://${value}`).hostname
    const match = host.match(/^([a-z0-9]{15,30})\.supabase\.(co|in)$/i)
    return match ? match[1] : ''
  } catch (err) {
    return ''
  }
}

function resolveCredentials() {
  const fromFile = readEnvFile(ENV_FILE)
  const token = process.env.SUPABASE_ACCESS_TOKEN || fromFile.SUPABASE_ACCESS_TOKEN || ''
  const explicitRef = process.env.SUPABASE_PROJECT_REF || fromFile.SUPABASE_PROJECT_REF || ''
  const projectUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    fromFile.SUPABASE_URL ||
    fromFile.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  // 容错：有人会把整条 URL（甚至 .../rest/v1/）填到 REF 里，这里只认纯 ref
  const rawRef = String(explicitRef).trim()
  const looksLikeRef = /^[a-z0-9]{15,30}$/i.test(rawRef)
  const ref = looksLikeRef ? rawRef : refFromUrl(rawRef) || refFromUrl(projectUrl)
  return {
    token,
    ref,
    refSource: looksLikeRef ? 'SUPABASE_PROJECT_REF' : ref ? (refFromUrl(rawRef) ? 'SUPABASE_PROJECT_REF(从URL解析)' : 'SUPABASE_URL') : 'missing',
    configured: !!(token && ref),
    source: fromFile.SUPABASE_ACCESS_TOKEN ? ENV_FILE : 'process.env'
  }
}

function requireCredentials() {
  const creds = resolveCredentials()
  if (!creds.configured) {
    console.error('缺少凭据：需要在 .dsh-ops/messages-db.env 里提供')
    console.error('  SUPABASE_ACCESS_TOKEN=sbp_xxx')
    console.error('  SUPABASE_PROJECT_REF=xxxxxxxxxxxx')
    console.error('（也可以放进环境变量；脚本不会打印这两个值）')
    process.exit(2)
  }
  return creds
}

/* ------------------------------------------------------------------ *
 * Management API：执行 SQL
 * ------------------------------------------------------------------ */

async function runSql(creds, sql) {
  const response = await fetch(`${API}/projects/${creds.ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(60000)
  })

  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (err) {
    data = { raw: text.slice(0, 500) }
  }

  if (!response.ok) {
    const message = data?.message || data?.error || data?.raw || `HTTP ${response.status}`
    throw new Error(`SQL 执行失败（${response.status}）：${message}`)
  }
  return Array.isArray(data) ? data : []
}

function rowsToTable(rows) {
  if (!rows || !rows.length) return '（无数据）'
  const cols = Object.keys(rows[0])
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)))
  const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ')
  return [line(cols), widths.map(w => '-'.repeat(w)).join('  '), ...rows.map(r => line(cols.map(c => r[c])))]
    .join('\n')
}

/* ------------------------------------------------------------------ *
 * 迁移文件
 * ------------------------------------------------------------------ */

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return []
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(name => /^\d{4}_.*\.sql$/.test(name) && !name.endsWith('.down.sql'))
    .sort()
    .map(name => {
      const file = path.join(MIGRATIONS_DIR, name)
      const sql = fs.readFileSync(file, 'utf8')
      return {
        version: name.replace(/\.sql$/, ''),
        file,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16)
      }
    })
}

async function appliedVersions(creds) {
  // schema 不存在时查询会报错 → 视为"未应用"
  try {
    const rows = await runSql(
      creds,
      `select version, checksum, applied_at from messages.schema_migrations order by version;`
    )
    return rows
  } catch (err) {
    return []
  }
}

/* ------------------------------------------------------------------ *
 * 命令：inspect（只读）
 * ------------------------------------------------------------------ */

async function cmdInspect() {
  const creds = requireCredentials()
  console.log(`# 目标项目 ref: ${creds.ref.slice(0, 4)}***（凭据来源：${creds.source}）`)
  console.log('# 只读查询，不做任何写操作\n')

  console.log('== 1. 数据库总体 ==')
  console.log(rowsToTable(await runSql(creds, `
    select current_database() as db,
           pg_size_pretty(pg_database_size(current_database())) as total_size,
           current_setting('server_version') as pg_version;
  `)))

  console.log('\n== 2. 现有 schema ==')
  console.log(rowsToTable(await runSql(creds, `
    select nspname as schema,
           pg_size_pretty(coalesce(sum(pg_total_relation_size(c.oid)), 0)) as size,
           count(c.oid) as relations
    from pg_namespace n
    left join pg_class c on c.relnamespace = n.oid and c.relkind in ('r','p','v','m')
    where n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'
    group by nspname order by nspname;
  `)))

  console.log('\n== 3. public 业务表（行数估算，判断是否会被影响）==')
  console.log(rowsToTable(await runSql(creds, `
    select relname as table, n_live_tup as rows_est, n_dead_tup as dead_est,
           pg_size_pretty(pg_total_relation_size(relid)) as size
    from pg_stat_user_tables
    where schemaname = 'public'
    order by n_live_tup desc limit 30;
  `)))

  console.log('\n== 4. 名称冲突检查（public 下是否已有 conversations/messages）==')
  console.log(rowsToTable(await runSql(creds, `
    select schemaname, relname
    from pg_stat_user_tables
    where relname in ('conversations','messages','access_logs','schema_migrations')
    order by schemaname, relname;
  `)))

  console.log('\n== 5. messages schema 是否已存在 ==')
  console.log(rowsToTable(await runSql(creds, `
    select nspname as schema from pg_namespace where nspname = 'messages';
  `)))

  console.log('\n== 6. 现有角色（RLS 授权依赖）==')
  console.log(rowsToTable(await runSql(creds, `
    select rolname, rolbypassrls from pg_roles
    where rolname in ('anon','authenticated','service_role','postgres') order by rolname;
  `)))

  console.log('\n== 7. 连接/容量关键指标 ==')
  console.log(rowsToTable(await runSql(creds, `
    select (select count(*) from pg_stat_activity) as connections,
           current_setting('max_connections') as max_conn,
           (select count(*) from pg_stat_activity where state = 'active') as active;
  `)))
}

/* ------------------------------------------------------------------ *
 * 命令：plan / migrate / verify / print / export
 * ------------------------------------------------------------------ */

async function cmdPlan() {
  const migrations = listMigrations()
  const creds = resolveCredentials()
  const applied = creds.configured ? await appliedVersions(creds) : []
  const appliedSet = new Set(applied.map(r => r.version))
  console.log(`迁移目录：${path.relative(ROOT, MIGRATIONS_DIR)}`)
  console.log(`共 ${migrations.length} 个迁移文件\n`)
  for (const m of migrations) {
    const state = appliedSet.has(m.version) ? '已应用' : '待执行'
    console.log(`  ${m.version}  [${state}]  checksum=${m.checksum}`)
  }
  if (!creds.configured) {
    console.log('\n（未配置凭据：以上"待执行"是按本地文件推断的，无法确认远端状态）')
  }
}

async function cmdMigrate(args) {
  const target = String(args.target || '')
  if (!['dev', 'prod'].includes(target)) {
    console.error('必须指定 --target=dev 或 --target=prod')
    process.exit(2)
  }
  if (target === 'prod') {
    console.error('拒绝直接对生产执行。生产迁移流程：')
    console.error('  1) node scripts/messages-db.mjs print > /tmp/messages.sql')
    console.error('  2) 提交 SQL + 影响分析 + 回滚方案，等待管理员确认')
    console.error('  3) 确认后设置 MESSAGES_ALLOW_PROD=1 并加 --yes 再执行')
    if (process.env.MESSAGES_ALLOW_PROD !== '1' || args.yes !== true) process.exit(3)
  }

  const creds = requireCredentials()
  const migrations = listMigrations()
  const applied = await appliedVersions(creds)
  const appliedSet = new Set(applied.map(r => r.version))
  const pending = migrations.filter(m => !appliedSet.has(m.version))

  if (!pending.length) {
    console.log('没有待执行的迁移。')
    return
  }
  console.log(`目标：${target} · 待执行 ${pending.length} 个\n`)

  for (const m of pending) {
    if (args['dry-run']) {
      console.log(`--- ${m.version} (dry-run，不执行) ---\n${m.sql}\n`)
      continue
    }
    process.stdout.write(`执行 ${m.version} ... `)
    // 迁移体（含 create schema）在单个隐式事务中提交；失败即整体回滚
    await runSql(creds, `begin;\n${m.sql}\ncommit;`)
    await runSql(
      creds,
      `insert into messages.schema_migrations (version, checksum) values ($1, $2)
       on conflict (version) do nothing;`.replace('$1', `'${m.version}'`).replace('$2', `'${m.checksum}'`)
    )
    console.log('ok')
  }
  console.log('\n完成。请运行：node scripts/messages-db.mjs verify')
}

async function cmdVerify() {
  const creds = requireCredentials()
  console.log('# 迁移后结构自检\n')

  console.log('== 表是否齐全 ==')
  console.log(rowsToTable(await runSql(creds, `
    select tablename, tableowner
    from pg_tables where schemaname = 'messages' order by tablename;
  `)))

  console.log('\n== RLS 是否开启（期望全为 true）==')
  console.log(rowsToTable(await runSql(creds, `
    select c.relname as table, c.relrowsecurity as rls_enabled
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'messages' and c.relkind = 'r' order by c.relname;
  `)))

  console.log('\n== 策略数量（期望 0：anon/authenticated 无任何策略）==')
  console.log(rowsToTable(await runSql(creds, `
    select tablename, count(*) as policies
    from pg_policies where schemaname = 'messages' group by tablename order by tablename;
  `)))

  console.log('\n== 关键索引 ==')
  console.log(rowsToTable(await runSql(creds, `
    select tablename, indexname from pg_indexes
    where schemaname = 'messages' order by tablename, indexname;
  `)))

  console.log('\n== 迁移台账 ==')
  console.log(rowsToTable(await runSql(creds, `
    select version, checksum, applied_at from messages.schema_migrations order by version;
  `)))

  console.log('\n== service_role 权限 ==')
  console.log(rowsToTable(await runSql(creds, `
    select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privileges
    from information_schema.role_table_grants
    where table_schema = 'messages' and grantee in ('service_role','anon','authenticated')
    group by grantee, table_name order by grantee, table_name;
  `)))
}

async function cmdCleanup(args) {
  const creds = requireCredentials()
  const spamDays = Math.max(1, Number(args.spamDays) || 30)
  const deletedDays = Math.max(1, Number(args.deletedDays) || 90)
  const apply = args.apply === true

  // 先统计（永远只读）
  const preview = await runSql(creds, `
    select
      (select count(*) from messages.conversations
        where status = 'spam' and spam_at < now() - interval '${spamDays} days') as spam_ready,
      (select count(*) from messages.conversations
        where deleted_at is not null and deleted_at < now() - interval '${deletedDays} days') as soft_deleted_ready;
  `)
  console.log('待清理：', JSON.stringify(preview[0] || {}))

  if (!apply) {
    console.log('')
    console.log('这是 dry-run。确认无误后加 --apply 真正执行：')
    console.log(`  node scripts/messages-db.mjs cleanup --spamDays=${spamDays} --deletedDays=${deletedDays} --apply`)
    return
  }

  const purge = (label, where) => `
    with gone as (delete from messages.conversations where ${where} returning id)
    select '${label}' as kind, count(*) as removed from gone;
  `
  console.log(JSON.stringify(await runSql(creds, purge('spam', `status = 'spam' and spam_at < now() - interval '${spamDays} days'`))))
  console.log(JSON.stringify(await runSql(creds, purge('soft_deleted', `deleted_at is not null and deleted_at < now() - interval '${deletedDays} days'`))))
  console.log('完成（消息由外键级联删除）。建议随后跑一次 backup。')
}

function cmdPrint() {
  const migrations = listMigrations()
  console.log('-- 由 scripts/messages-db.mjs print 生成')
  console.log('-- 请在 Supabase SQL Editor 中整段执行（仅创建 messages schema，不动 public）\n')
  for (const m of migrations) {
    console.log(`-- ===== ${m.version} (checksum ${m.checksum}) =====`)
    console.log(m.sql)
  }
}

async function cmdExport(args) {
  const creds = requireCredentials()
  const target = String(args.target || 'dev')
  const out = String(args.out || path.join(ROOT, '.dsh-ops', `messages-export-${target}-${Date.now()}.json`))
  const limit = Math.max(1, Math.min(5000, Number(args.limit) || 2000))

  console.log(`导出来源：${target}（最多 ${limit} 个会话）`)
  const convs = await runSql(creds, `
    select * from messages.conversations order by created_at desc limit ${limit};
  `)
  const ids = convs.map(c => `'${String(c.id).replace(/'/g, "''")}'`)
  let msgs = []
  if (ids.length) {
    msgs = await runSql(creds, `
      select * from messages.messages where conversation_id in (${ids.join(',')}) order by created_at asc;
    `)
  }

  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(
    out,
    JSON.stringify({ exportedAt: new Date().toISOString(), target, schemaVersion: 1, conversations: convs, messages: msgs }, null, 2),
    'utf8'
  )
  console.log(`已写入 ${out}`)
  console.log(`会话 ${convs.length} 个，消息 ${msgs.length} 条`)
  console.log('提醒：该文件含访客邮箱与正文，已放在 .dsh-ops/（gitignored），不要提交、不要外发。')
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

const args = parseArgs(process.argv.slice(2))
const command = args._[0] || 'plan'

const commands = {
  inspect: cmdInspect,
  plan: cmdPlan,
  migrate: () => cmdMigrate(args),
  verify: cmdVerify,
  print: cmdPrint,
  export: () => cmdExport(args),
  cleanup: () => cmdCleanup(args),
  backup: () => cmdExport({ ...args, target: args.target || 'prod' })
}

if (!commands[command]) {
  console.error(`未知命令：${command}`)
  console.error(`可用：${Object.keys(commands).join(' / ')}`)
  process.exit(2)
}

Promise.resolve(commands[command]()).catch(err => {
  console.error('\n执行失败：', err?.message || err)
  process.exit(1)
})
