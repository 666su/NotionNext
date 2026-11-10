/**
 * 未接入模块的统一占位说明
 * 重要：**不展示任何模拟数据**，只说明将接入什么、依赖什么。
 */

export default function PlaceholderPanel({
  phase = 'Phase 3',
  dataSource = '自建统计服务（/api/track）',
  metrics = [],
  notes = [],
  blocked = false
}) {
  return (
    <div className='space-y-4'>
      <div className='rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200'>
        <p className='font-medium'>该模块尚未接入真实数据</p>
        <p className='mt-1 text-xs leading-relaxed'>
          计划在 <strong>{phase}</strong> 实现，数据来源：{dataSource}。
          在数据落库之前，本页面<strong>不会显示任何模拟数值</strong>。
        </p>
      </div>

      {metrics.length > 0 && (
        <section className='rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-[#0f1115]'>
          <h2 className='text-sm font-semibold'>计划展示的指标</h2>
          <ul className='mt-2 grid gap-1.5 text-sm text-gray-600 sm:grid-cols-2 dark:text-gray-300'>
            {metrics.map(item => (
              <li key={item} className='flex items-start gap-2'>
                <span className='mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400' />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {notes.length > 0 && (
        <section className='rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-[#0f1115]'>
          <h2 className='text-sm font-semibold'>口径与限制</h2>
          <ul className='mt-2 space-y-1.5 text-xs leading-relaxed text-gray-600 dark:text-gray-300'>
            {notes.map(item => (
              <li key={item}>· {item}</li>
            ))}
          </ul>
        </section>
      )}

      {blocked && (
        <p className='text-xs text-gray-500 dark:text-gray-400'>
          该模块当前处于“未连接”状态，需先在系统设置中完成外部服务授权。
        </p>
      )}
    </div>
  )
}
