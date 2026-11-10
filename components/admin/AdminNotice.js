/**
 * 后台内联提示条：加载 / 错误 / 空数据 / 未连接 / 说明
 *
 * 关键约束：**不允许用模拟数字填空**。没数据就明确说"没有数据"，并说明原因。
 */

const TONES = {
  info: 'border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300',
  warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200',
  error:
    'border-red-300 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200',
  ok: 'border-green-300 bg-green-50 text-green-900 dark:border-green-800/60 dark:bg-green-900/20 dark:text-green-200'
}

export default function AdminNotice({ tone = 'info', title, children, action }) {
  return (
    <div className={`rounded-md border px-3 py-2 text-xs leading-relaxed ${TONES[tone] || TONES.info}`}>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        {title && <p className='font-medium'>{title}</p>}
        {action}
      </div>
      {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
    </div>
  )
}
