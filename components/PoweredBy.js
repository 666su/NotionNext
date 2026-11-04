import { siteConfig } from '@/lib/config'

/**
 * 驱动版权
 * @param {*} props href 可覆盖默认的项目链接
 * @returns
 */
export default function PoweredBy(props) {
  const href = props.href || 'https://github.com/tangly1024/NotionNext'
  return (
    <div className={`inline text-sm font-serif ${props.className || ''}`}>
      <span className='mr-1'>Powered by</span>
      <a href={href} className='underline justify-start'>
        NotionNext {siteConfig('VERSION')}
      </a>
      .
    </div>
  )
}
