/**
 * 后台数据页的统一区块容器（标题 / 说明 / 右侧操作 / 底部口径注释）
 *
 * 约定：任何区块都必须写清"口径"（footnote），避免读者把 PV/UV/Session 混淆。
 */

export default function AdminPanel({
  title,
  description,
  actions,
  footnote,
  className = '',
  bodyClassName = '',
  children
}) {
  return (
    <section
      className={`rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-[#0f1115] ${className}`}>
      {(title || actions) && (
        <header className='flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800'>
          <div className='min-w-0'>
            {title && <h2 className='text-sm font-semibold'>{title}</h2>}
            {description && (
              <p className='mt-0.5 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400'>
                {description}
              </p>
            )}
          </div>
          {actions && <div className='flex shrink-0 items-center gap-2'>{actions}</div>}
        </header>
      )}
      <div className={`px-4 py-3 ${bodyClassName}`}>{children}</div>
      {footnote && (
        <p className='border-t border-gray-100 px-4 py-2 text-[11px] leading-relaxed text-gray-400 dark:border-gray-800 dark:text-gray-500'>
          {footnote}
        </p>
      )}
    </section>
  )
}
