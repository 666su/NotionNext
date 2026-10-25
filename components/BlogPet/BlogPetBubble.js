/**
 * Blog Pet 自动气泡：展示真实文章标题/摘要，可点击跳转
 */
'use client'

export function BlogPetBubble({ bubble, style, placement = 'above', onClose, onOpenArticle, onMouseEnter, onMouseLeave }) {
  if (!bubble) return null

  return (
    <div
      className={`blog-pet-bubble ${placement === 'below' ? 'is-below' : ''}`}
      style={style}
      role='status'
      aria-live='polite'
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        type='button'
        className='blog-pet-bubble-close'
        onClick={onClose}
        aria-label='关闭提示'
      >
        ×
      </button>
      <p className='blog-pet-bubble-text'>{bubble.text}</p>
      {bubble.post && (
        <button
          type='button'
          className='blog-pet-bubble-link'
          onClick={() => onOpenArticle(bubble.post)}
        >
          阅读《{bubble.post.title}》
        </button>
      )}
    </div>
  )
}

export default BlogPetBubble
