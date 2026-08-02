import NotionIcon from '@/components/NotionIcon'
import { siteConfig } from '@/lib/config'

export default function TitleBar(props) {

  const { post } = props


  // 首页不显示
  if (!post) {
    return null
  }


  return (
    <div className='px-6 py-4 mb-4 border-b'>

      <h1 className='text-2xl font-semibold'>
        {siteConfig('POST_TITLE_ICON') && (
          <NotionIcon icon={post.pageIcon}/>
        )}

        {post.title}
      </h1>


      {
        post.description && (
          <p className='mt-2 text-sm text-gray-500'>
            {post.description}
          </p>
        )
      }

    </div>
  )
}
