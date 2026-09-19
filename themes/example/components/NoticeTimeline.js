import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'

// 解析不出时间线时，回退渲染原始 Notion 内容
const NotionPage = dynamic(() => import('@/components/NotionPage'))

/**
 * 新增公告时间线功能
 * 公告页按日期分组展示：最新更新在最上面，较早更新在下面
 * 支持在 Notion 中按「@今天 / @明天 / @昨天 / @2026-09-20 / @9月20日」书写日期标记
 */

// 解析 Notion 块的富文本：提取纯文本，并识别日期 mention
// 在 Notion 中输入 @今天 / @明天 会被自动转换为「日期 mention」，占位符为 ‣
function parseBlock(block) {
  const title = block?.properties?.title
  const info = { text: '', mentionDate: '' }
  if (!Array.isArray(title)) return info

  title.forEach(segment => {
    if (!Array.isArray(segment)) {
      info.text += String(segment ?? '')
      return
    }
    const [rawText, decorations] = segment

    // 日期 mention：装饰中带 ["d", { start_date }]
    if (Array.isArray(decorations)) {
      decorations.forEach(deco => {
        if (
          Array.isArray(deco) &&
          deco[0] === 'd' &&
          deco[1]?.start_date &&
          !info.mentionDate
        ) {
          info.mentionDate = String(deco[1].start_date)
        }
      })
    }

    // mention 占位符不作为正文
    if (rawText === '\u2023') return
    info.text += String(rawText ?? '')
  })

  info.text = info.text.trim()
  return info
}

// 取某天的零点
function startOfDay(value) {
  const d = new Date(value)
  d.setHours(0, 0, 0, 0)
  return d
}

// 相对日期关键词
const RELATIVE_DAYS = {
  今天: 0,
  今日: 0,
  本日: 0,
  昨天: -1,
  昨日: -1,
  前天: -2,
  明天: 1,
  明日: 1,
  后天: 2
}

// 把文本解析为日期，失败返回 null
function toDate(text, base) {
  const raw = String(text || '').trim()
  if (!raw) return null

  if (Object.prototype.hasOwnProperty.call(RELATIVE_DAYS, raw)) {
    const d = startOfDay(base)
    d.setDate(d.getDate() + RELATIVE_DAYS[raw])
    return d
  }

  // 2026-09-20 / 2026/9/20 / 2026年9月20日
  let m = raw.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))

  // 9-20 / 9月20日（默认当年）
  m = raw.match(/^(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/)
  if (m) return new Date(new Date(base).getFullYear(), Number(m[1]) - 1, Number(m[2]))

  return null
}

// 判断一行是否为日期标记，返回 { date, rest }
function matchDateMarker(text, base) {
  const raw = String(text || '').trim()
  if (!raw) return null

  const hasAt = /^[@＠]/.test(raw)
  const body = raw.replace(/^[@＠]\s*/, '').trim()
  if (!body) return null

  // 整行就是日期
  const whole = toDate(body, base)
  if (whole) return { date: whole, rest: '' }

  // 允许「@明天 具体内容」写在同一行
  if (hasAt) {
    const parts = body.split(/\s+/)
    if (parts.length > 1) {
      const head = toDate(parts[0], base)
      if (head) return { date: head, rest: parts.slice(1).join(' ').trim() }
    }
  }
  return null
}

// 格式化为「2026年9月20日」
export function formatCnDate(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

// 相对今天的中文标签
function relativeLabel(date, base) {
  const diff = Math.round((startOfDay(date) - startOfDay(base)) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  if (diff === 2) return '后天'
  if (diff === -2) return '前天'
  return ''
}

// 解析公告内容为日期分组
function buildGroups(post) {
  const blockMap = post?.blockMap?.block
  if (!blockMap || !post?.id) return null

  const parent = blockMap[post.id]?.value
  const childIds =
    Array.isArray(parent?.content) && parent.content.length > 0
      ? parent.content
      : Object.keys(blockMap).filter(
          key => blockMap[key]?.value?.parent_id === post.id
        )

  const base = post?.publishDate ? new Date(post.publishDate) : new Date()
  const groups = []
  const leading = []
  let current = null

  childIds.forEach((id, index) => {
    const block = blockMap[id]?.value
    if (!block) return
    // 分隔线与数据库视图不参与时间线
    if (['divider', 'collection_view', 'collection_view_page'].includes(block.type)) {
      return
    }

    const info = parseBlock(block)

    // 优先采用 Notion 日期 mention（@今天/@明天 已被 Notion 解析为具体日期）
    let markerDate = info.mentionDate ? toDate(info.mentionDate, base) : null
    let rest = info.text

    // 其次识别纯文本日期标记（@2026-09-20 / @9月20日）
    if (!markerDate && info.text) {
      const created = block.created_time || block.createdTime
      const marker = matchDateMarker(
        info.text,
        created ? new Date(created) : base
      )
      if (marker) {
        markerDate = marker.date
        rest = marker.rest
      }
    }

    if (markerDate) {
      current = { key: id || `day-${index}`, date: markerDate, items: [] }
      groups.push(current)
      if (rest) current.items.push(rest)
      return
    }

    if (!info.text) return

    if (current) {
      current.items.push(info.text)
    } else {
      leading.push(info.text)
    }
  })

  // 没有写日期标记时，整体归到公告自身日期，保证页面不空
  if (groups.length === 0) {
    if (leading.length === 0) return null
    return [{ key: 'notice-all', date: startOfDay(base), items: leading }]
  }

  // 第一条标记之前的内容，挂到最早的一条上
  if (leading.length > 0) {
    groups[0].items.unshift(...leading)
  }

  // 同一天合并，并按日期倒序（最新在上）
  const merged = new Map()
  groups
    .filter(g => g.items.length > 0)
    .forEach(g => {
      const key = `${g.date.getFullYear()}-${g.date.getMonth() + 1}-${g.date.getDate()}`
      if (merged.has(key)) {
        merged.get(key).items.push(...g.items)
      } else {
        merged.set(key, { ...g, key })
      }
    })

  return Array.from(merged.values()).sort((a, b) => b.date - a.date)
}

export const NoticeTimeline = ({ post }) => {
  const groups = useMemo(() => buildGroups(post), [post])

  // 相对标签（今天/昨天）延迟到挂载后计算，避免服务端与客户端渲染不一致
  const [today, setToday] = useState(null)
  useEffect(() => {
    setToday(new Date())
  }, [])

  if (!groups || groups.length === 0) {
    // 没有任何可解析内容时，回退为原始公告内容，避免页面空白
    return <NotionPage post={post} />
  }

  return (
    <div className='notice-timeline'>
      {groups.map((group, index) => {
        const label = today ? relativeLabel(group.date, today) : ''
        return (
          <div key={group.key} className='notice-timeline-item'>
            {/* 左侧轴线与圆点 */}
            <div className='notice-timeline-rail'>
              <span
                className={`notice-timeline-dot ${index === 0 ? 'is-latest' : ''}`}
              />
            </div>

            {/* 右侧日期与内容 */}
            <div className='notice-timeline-main'>
              <div className='notice-timeline-head'>
                <i className='far fa-calendar-alt notice-timeline-cal' />
                <span className='notice-timeline-date'>{formatCnDate(group.date)}</span>
                {label && <span className='notice-timeline-badge'>{label}</span>}
                {index === 0 && (
                  <span className='notice-timeline-badge is-new'>最新</span>
                )}
              </div>
              <div className='notice-timeline-lines'>
                {group.items.map((line, i) => (
                  <p key={i} className='notice-timeline-line'>
                    {line}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default NoticeTimeline
