/**
 * 桌宠小剧场特效：看烟花 / 吃小鱼干
 *
 * 纯 CSS 动画 + 内联 SVG，不增加图片体积，也不依赖 Live2D 模型。
 */
'use client'

const BURSTS = [0, 1, 2, 3]

function Fireworks() {
  return (
    <>
      {/* 夜空背景：让烟花在白底页面上也能看清 */}
      <span className='blog-pet-night' aria-hidden='true' />
      <span className='blog-pet-effect is-fireworks' aria-hidden='true'>
        {BURSTS.map(index => (
          <span key={index} className={`blog-pet-firework is-${index}`}>
            {Array.from({ length: 12 }).map((_, ray) => (
              <i key={ray} style={{ '--a': `${ray * 30}deg` }} />
            ))}
          </span>
        ))}
      </span>
    </>
  )
}

function Snack() {
  return (
    <span className='blog-pet-effect is-eating' aria-hidden='true'>
      <svg
        className='blog-pet-snack'
        viewBox='0 0 48 28'
        width='34'
        height='20'
        focusable='false'
      >
        <path
          d='M4 14c8-9 20-11 30-6l10-6-3 9 3 9-10-6c-10 5-22 3-30-6z'
          fill='#f59e0b'
          stroke='#b45309'
          strokeWidth='1.6'
          strokeLinejoin='round'
        />
        <circle cx='14' cy='13' r='2.2' fill='#1f2937' />
      </svg>
      <span className='blog-pet-crumb is-1' />
      <span className='blog-pet-crumb is-2' />
      <span className='blog-pet-crumb is-3' />
    </span>
  )
}

export function PetEffects({ action }) {
  if (action === 'fireworks') return <Fireworks />
  if (action === 'eating') return <Snack />
  return null
}
export default PetEffects
