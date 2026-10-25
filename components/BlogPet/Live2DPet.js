/**
 * Live2D 渲染器
 *
 * - 优先加载自托管的 Pixi + pixi-live2d-display + Cubism Core
 * - 模型文件缺失、脚本加载失败、模型解析失败，都会回调 onUnavailable()
 *   由外层桌宠自动降级为静态立绘，绝不阻塞页面
 */
'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { LIVE2D_CONFIG } from './live2dConfig'

const scriptCache = new Map()

function loadScript(src, timeout) {
  if (!src) return Promise.reject(new Error('empty script url'))
  if (scriptCache.has(src)) return scriptCache.get(src)

  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-live2d="${src}"]`)
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve()
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error(`script error: ${src}`)), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.dataset.live2d = src
    const timer = setTimeout(() => {
      reject(new Error(`script timeout: ${src}`))
    }, timeout)

    script.addEventListener(
      'load',
      () => {
        clearTimeout(timer)
        script.dataset.loaded = '1'
        resolve()
      },
      { once: true }
    )
    script.addEventListener(
      'error',
      () => {
        clearTimeout(timer)
        reject(new Error(`script error: ${src}`))
      },
      { once: true }
    )
    document.head.appendChild(script)
  })

  scriptCache.set(src, promise)
  // 失败后允许下次重试，不缓存错误
  promise.catch(() => scriptCache.delete(src))
  return promise
}

/** 依次尝试 vendor 与 CDN，任意一个成功即可 */
async function loadOneOf(paths, timeout) {
  let lastError = null
  for (const src of paths) {
    try {
      await loadScript(src, timeout)
      return src
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('sdk load failed')
}

async function ensureSdk() {
  if (typeof window === 'undefined') throw new Error('ssr')
  const { vendor, cdn, scriptTimeout } = LIVE2D_CONFIG

  if (!window.Live2DCubismCore) {
    await loadOneOf([vendor.core, cdn.core], scriptTimeout)
  }
  if (!window.PIXI) {
    await loadOneOf([vendor.pixi, cdn.pixi], scriptTimeout)
  }
  if (!window.Live2DModel) {
    await loadOneOf([vendor.display, cdn.display], scriptTimeout)
  }
  if (!window.PIXI || !window.Live2DModel) {
    throw new Error('Live2D SDK globals missing')
  }
}

function hasParam(coreModel, id) {
  try {
    return typeof coreModel?.setParameterValueById === 'function' && !!id
  } catch {
    return false
  }
}

function setParam(coreModel, id, value) {
  if (!id) return
  try {
    coreModel?.setParameterValueById?.(id, value)
  } catch {
    // 模型没有该参数时忽略
  }
}

export const Live2DPet = forwardRef(function Live2DPet(
  { size, onReady, onUnavailable },
  ref
) {
  const canvasRef = useRef(null)
  const appRef = useRef(null)
  const modelRef = useRef(null)
  const stateRef = useRef({
    glasses: 0,
    tapAt: 0,
    pointer: { x: 0, y: 0 }
  })
  const [ready, setReady] = useState(false)

  useImperativeHandle(
    ref,
    () => ({
      toggleGlasses: () => {
        stateRef.current.glasses = stateRef.current.glasses ? 0 : 1
        return stateRef.current.glasses === 1
      },
      glassesAreUp: () => stateRef.current.glasses === 1,
      playTap: () => {
        const model = modelRef.current
        if (!model) return
        try {
          model.motion?.(LIVE2D_CONFIG.motions.tap)
        } catch {
          // 没有对应动作组时忽略
        }
      }
    }),
    []
  )

  useEffect(() => {
    let cancelled = false
    let tickerHandler = null

    const dispose = () => {
      tickerHandler = null
      try {
        appRef.current?.ticker?.remove(tickerHandler)
      } catch {
        /* noop */
      }
      try {
        appRef.current?.destroy?.(true, { children: true })
      } catch {
        /* noop */
      }
      appRef.current = null
      modelRef.current = null
    }

    const fail = error => {
      if (cancelled) return
      console.warn('[blog-pet] Live2D 不可用，回退静态立绘：', error?.message || error)
      setReady(false)
      onUnavailable?.()
    }

    const boot = async () => {
      try {
        // 先探测模型是否存在，不存在就不加载任何 SDK
        const probe = await fetch(LIVE2D_CONFIG.modelUrl, { method: 'HEAD' })
        if (!probe.ok) throw new Error(`model not found (${probe.status})`)
        if (cancelled) return

        await ensureSdk()
        if (cancelled) return

        const PIXI = window.PIXI
        const canvas = canvasRef.current
        if (!canvas) throw new Error('canvas missing')

        const resolution = Math.max(1, size * LIVE2D_CONFIG.resolutionScale)
        const app = new PIXI.Application({
          view: canvas,
          width: resolution,
          height: resolution,
          transparent: true,
          antialias: true,
          backgroundAlpha: 0,
          autoStart: true
        })
        appRef.current = app

        const model = await window.Live2DModel.from(LIVE2D_CONFIG.modelUrl, {
          autoInteract: false
        })
        if (cancelled) {
          try {
            app.destroy(true, { children: true })
          } catch {
            /* noop */
          }
          return
        }

        model.anchor.set(LIVE2D_CONFIG.anchor.x, LIVE2D_CONFIG.anchor.y)
        const naturalWidth = model.width || 1
        const naturalHeight = model.height || 1
        const fitScale =
          (resolution * LIVE2D_CONFIG.fitRatio) /
          Math.max(naturalWidth, naturalHeight)
        model.scale.set(fitScale)
        model.position.set(resolution / 2, resolution)
        app.stage.addChild(model)
        modelRef.current = model

        const core = model.internalModel?.coreModel
        const param = LIVE2D_CONFIG.parameters

        // 视线跟随 + 呼吸 + 耳朵/尾巴轻微摆动
        tickerHandler = () => {
          const t = performance.now() / 1000
          const state = stateRef.current
          const target = state.pointer
          state.angleX = (state.angleX || 0) + (target.x - (state.angleX || 0)) * 0.08
          state.angleY = (state.angleY || 0) + (target.y - (state.angleY || 0)) * 0.08

          setParam(core, param.angleX, state.angleX * 30)
          setParam(core, param.angleY, state.angleY * 20)
          setParam(core, param.angleZ, state.angleX * 8)
          setParam(core, param.bodyAngleZ, state.angleX * 4)
          setParam(core, param.eyeBallX, state.angleX)
          setParam(core, param.eyeBallY, -state.angleY)
          setParam(core, param.breath, (Math.sin(t * 1.6) + 1) / 2)
          setParam(core, param.earL, Math.sin(t * 1.2) * 0.15)
          setParam(core, param.earR, Math.sin(t * 1.2 + 1.1) * 0.15)
          setParam(core, param.tail, Math.sin(t * 1.4) * 0.5)
          setParam(core, param.bell, Math.sin(t * 1.4 + 0.5) * 0.4)

          // 墨镜平滑推移
          const current = state.glassesCurrent ?? 0
          state.glassesCurrent = current + (state.glasses - current) * 0.12
          setParam(core, param.glassesUp, state.glassesCurrent)

          // 点击后 1.2 秒内做表情
          if (state.tapAt && performance.now() - state.tapAt < 1200) {
            setParam(core, param.mouthOpen, 0.35)
            setParam(core, param.mouthForm, 0.6)
          } else {
            setParam(core, param.mouthOpen, 0)
            setParam(core, param.mouthForm, 0)
            if (state.tapAt) state.tapAt = 0
          }
        }
        app.ticker.add(tickerHandler)

        const handlePointer = event => {
          const rect = canvas.getBoundingClientRect()
          if (!rect.width || !rect.height) return
          stateRef.current.pointer.x = Math.max(
            -1,
            Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1)
          )
          stateRef.current.pointer.y = Math.max(
            -1,
            Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1)
          )
        }
        window.addEventListener('pointermove', handlePointer, { passive: true })
        const removePointer = () => window.removeEventListener('pointermove', handlePointer)
        appRef.current.__removePointer = removePointer

        if (cancelled) return
        setReady(true)
        onReady?.()
      } catch (error) {
        fail(error)
      }
    }

    boot()

    return () => {
      cancelled = true
      try {
        appRef.current?.__removePointer?.()
      } catch {
        /* noop */
      }
      dispose()
    }
  }, [size, onReady, onUnavailable])

  return (
    <canvas
      ref={canvasRef}
      className='blog-pet-live2d-canvas'
      style={{ display: ready ? 'block' : 'none' }}
      aria-hidden={!ready}
    />
  )
})

export default Live2DPet
