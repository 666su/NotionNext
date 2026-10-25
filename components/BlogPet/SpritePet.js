/**
 * 动作帧精灵图渲染
 *
 * 从一张立绘程序化生成的 9 帧动作（idle×2 / happy / thinking / sleepy /
 * walk×2 / talk×2），按情绪与交互状态切换，做出「有动作」的观感。
 * 真正的分层 PSD / Live2D 模型到位后，直接替换精灵图或走 Live2D 渲染即可。
 */
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { PET_CONFIG } from './blogPetConfig'

const SPRITE = PET_CONFIG.sprite

function resolveSequence({ animate, mood, walking, searching, dialogOpen, action }) {
  if (!animate) return { key: 'idle', frames: [0], fps: 1 }
  if (walking) return { key: 'walking', frames: SPRITE.sequences.walking, fps: SPRITE.fps.walking }
  if (action === 'fireworks') return { key: 'look', frames: SPRITE.sequences.look, fps: SPRITE.fps.look }
  if (action === 'eating') return { key: 'eating', frames: SPRITE.sequences.eating, fps: SPRITE.fps.eating }
  if (dialogOpen) return { key: 'talking', frames: SPRITE.sequences.talking, fps: SPRITE.fps.talking }
  if (searching) return { key: 'thinking', frames: SPRITE.sequences.thinking, fps: SPRITE.fps.thinking }
  if (mood === 'sleepy') return { key: 'sleepy', frames: SPRITE.sequences.sleepy, fps: SPRITE.fps.sleepy }
  if (mood === 'happy') return { key: 'happy', frames: SPRITE.sequences.happy, fps: SPRITE.fps.happy }
  return { key: 'idle', frames: SPRITE.sequences.idle, fps: SPRITE.fps.idle }
}

export function SpritePet({ animate, mood, walking, searching, dialogOpen, action }) {
  const sequence = useMemo(
    () => resolveSequence({ animate, mood, walking, searching, dialogOpen, action }),
    [animate, mood, walking, searching, dialogOpen, action]
  )
  const [step, setStep] = useState(0)
  const preloaded = useRef(false)

  // 预加载精灵图，避免首帧空白
  useEffect(() => {
    if (preloaded.current || typeof window === 'undefined') return
    preloaded.current = true
    const image = new window.Image()
    image.src = SPRITE.src
  }, [])

  useEffect(() => {
    setStep(0)
    if (sequence.frames.length < 2) return undefined
    const timer = setInterval(
      () => setStep(prev => (prev + 1) % sequence.frames.length),
      Math.max(80, Math.round(1000 / sequence.fps))
    )
    return () => clearInterval(timer)
  }, [sequence])

  const frameIndex = sequence.frames[step % sequence.frames.length] || 0
  const total = SPRITE.frameCount
  const position = total > 1 ? (frameIndex / (total - 1)) * 100 : 0

  return (
    <span
      role='img'
      aria-label={PET_CONFIG.assetAlt}
      className='blog-pet-sprite'
      data-frame={frameIndex}
      data-sequence={sequence.key}
      style={{
        backgroundImage: `url(${SPRITE.src})`,
        backgroundSize: `${total * 100}% 100%`,
        backgroundPosition: `${position}% 0`
      }}
    />
  )
}

export default SpritePet
