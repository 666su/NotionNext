/**
 * 页头私信入口（与设置按钮同排）
 *
 * 对齐要点：设置按钮是 `flex items-center justify-center w-9 h-9` + FontAwesome `text-sm`，
 * 这里完全照抄同一套（盒子尺寸 + 图标字体 + 圆角 hover），
 * 否则 SVG 的行内基线会让它比旁边的齿轮高/低 1–2px。
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
      className={`flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-zinc-800 dark:hover:text-gray-100 ${className}`}>
      <i className='fas fa-comment-dots text-sm' aria-hidden='true'></i>
    </button>
  )
}
