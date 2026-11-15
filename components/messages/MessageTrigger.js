/**
 * 页头私信入口（与设置按钮同排）
 *
 * 只做"派发事件"，抽屉状态仍由 MessageWidget 管理：
 *   window.dispatchEvent(new CustomEvent('jbm:open'))
 * 这样主题文件只多一个按钮，不需要引入抽屉/状态。
 */

export default function MessageTrigger({ className = '' }) {
  function open() {
    try {
      window.dispatchEvent(new CustomEvent('jbm:open'))
    } catch (err) {
      /* 忽略 */
    }
  }

  return (
    <button
      type='button'
      onClick={open}
      aria-label='打开私信'
      title='给 Jason 发私信'
      className={`text-gray-500 transition hover:text-black dark:text-gray-400 dark:hover:text-white ${className}`}>
      <svg viewBox='0 0 24 24' aria-hidden='true' className='h-[18px] w-[18px]' fill='none' stroke='currentColor' strokeWidth='1.8'>
        <path
          d='M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H9l-4 4v-4.2A2.5 2.5 0 0 1 4 13.5z'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    </button>
  )
}
