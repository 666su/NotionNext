/**
 * Blog Pet 桌宠主组件
 *
 * 职责：角色展示、待机动画、点击开合对话、右键/长按菜单、自由拖动、
 *       自动气泡调度、设置加载与持久化
 *
 * 挂载位置：pages/_app.js（全站页面共用一套实例）
 */
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/router'
import { PET_CONFIG } from './blogPetConfig'
import { loadSettings, sanitizeSettings, saveSettings } from './blogPetSettings'
import {
  buildIndex,
  latestPosts,
  mapByHref,
  randomPosts,
  searchPosts
} from './blogPetSearch'
import {
  clamp,
  clampPosition,
  defaultPosition,
  getPetSize,
  getViewport,
  pickRandom,
  prefersReducedMotion,
  randomInt,
  truncate
} from './blogPetUtils'
import BlogPetBubble from './BlogPetBubble'
import BlogPetContextMenu from './BlogPetContextMenu'
import BlogPetDialog from './BlogPetDialog'
import Live2DPet from './Live2DPet'
import PetEffects from './PetEffects'
import SpritePet from './SpritePet'
import { LIVE2D_CONFIG } from './live2dConfig'

export function BlogPet() {
  const router = useRouter()

  const [mounted, setMounted] = useState(false)
  const [settings, setSettings] = useState(null)
  const [viewport, setViewport] = useState({ width: 1280, height: 800 })
  const [position, setPosition] = useState(null)
  const [reducedMotion, setReducedMotion] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [menu, setMenu] = useState({ open: false, x: 0, y: 0 })
  const [bubble, setBubble] = useState(null)
  const [messages, setMessages] = useState([])
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [postsError, setPostsError] = useState(false)
  const [mood, setMood] = useState('idle') // idle | happy | sleepy
  const [walking, setWalking] = useState(false)
  const [live2dStatus, setLive2dStatus] = useState('unavailable') // unavailable | ready
  const [live2dActive, setLive2dActive] = useState(false)
  const [action, setAction] = useState(null) // null | fireworks | eating
  const actionTimerRef = useRef(null)
  const live2dRef = useRef(null)
  const messagesRef = useRef([])
  const moodTimerRef = useRef(null)
  const wanderTimerRef = useRef(null)
  const walkTimerRef = useRef(null)
  const sleepTimerRef = useRef(null)
  const lastInteractionRef = useRef(Date.now())

  const petRef = useRef(null)
  const tiltRef = useRef(null)
  const dragRef = useRef(null)
  const longPressRef = useRef(null)
  const pressTimerRef = useRef(null)
  const dragArmedRef = useRef(false)
  const suppressClickRef = useRef(false)
  const settingsRef = useRef(null)
  const messageIdRef = useRef(0)
  const postsRef = useRef([])
  const postsStatusRef = useRef('idle')
  const postsPendingRef = useRef(null)
  const historyRef = useRef([])
  const bubblePauseRef = useRef(null)
  const bubbleResumeRef = useRef(null)

  const petSize = getPetSize(viewport.width, PET_CONFIG.size)
  const petPos = useMemo(
    () =>
      position ||
      defaultPosition(petSize, viewport, PET_CONFIG.offset, PET_CONFIG.edge),
    [position, petSize, viewport]
  )

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // ---------- 设置 ----------
  const updateSettings = useCallback(patch => {
    const current = settingsRef.current || loadSettings()
    const next = sanitizeSettings({ ...current, ...patch })
    settingsRef.current = next
    setSettings(next)
    saveSettings(next)
  }, [])

  useEffect(() => {
    const loaded = loadSettings()
    settingsRef.current = loaded
    setSettings(loaded)
    setViewport(getViewport())
    setReducedMotion(prefersReducedMotion())
    setMounted(true)
  }, [])

  // 视口变化时重新夹紧位置，避免桌宠跑到屏幕外
  useEffect(() => {
    if (!mounted) return undefined
    const handleResize = () => {
      const nextViewport = getViewport()
      const nextSize = getPetSize(nextViewport.width, PET_CONFIG.size)
      setViewport(nextViewport)
      setPosition(prev =>
        prev
          ? clampPosition(prev, nextSize, nextViewport, PET_CONFIG.edge)
          : null
      )
    }
    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
    }
  }, [mounted])

  // ---------- Live2D：模型存在则启用，否则保持静态立绘 ----------
  useEffect(() => {
    if (!mounted || !LIVE2D_CONFIG.enabled) return undefined
    let cancelled = false
    const probe = async () => {
      try {
        const response = await fetch(LIVE2D_CONFIG.modelUrl, { method: 'HEAD' })
        if (!cancelled && response.ok) setLive2dStatus('ready')
      } catch {
        // 模型不存在时静默降级
      }
    }
    probe()
    return () => {
      cancelled = true
    }
  }, [mounted])

  const handleLive2DReady = useCallback(() => {
    setLive2dActive(true)
    setLive2dStatus('ready')
  }, [])
  const handleLive2DUnavailable = useCallback(() => {
    setLive2dActive(false)
    setLive2dStatus('unavailable')
  }, [])

  // ---------- 生命感：唤醒、开心、困倦、自己散步 ----------
  const wake = useCallback(() => {
    lastInteractionRef.current = Date.now()
    setMood(prev => (prev === 'sleepy' ? 'idle' : prev))
  }, [])

  const flashHappy = useCallback(() => {
    lastInteractionRef.current = Date.now()
    setMood('happy')
    clearTimeout(moodTimerRef.current)
    moodTimerRef.current = setTimeout(() => setMood('idle'), 900)
  }, [])

  // 小剧场：看烟花 / 吃小鱼干
  const triggerAction = useCallback(
    kind => {
      wake()
      setAction(kind)
      setBubble(null)
      clearTimeout(actionTimerRef.current)
      const duration =
        kind === 'fireworks'
          ? PET_CONFIG.actions.fireworksDuration
          : PET_CONFIG.actions.eatingDuration
      actionTimerRef.current = setTimeout(() => {
        setAction(null)
        // 吃完小鱼干开心一下
        if (kind === 'eating') flashHappy()
      }, duration)
    },
    [wake, flashHappy]
  )

  // 长时间无人互动 -> 打瞌睡
  useEffect(() => {
    if (!mounted || !settings || !settings.animation || reducedMotion) return undefined
    sleepTimerRef.current = setInterval(() => {
      if (dialogOpen || menu.open) return
      if (Date.now() - lastInteractionRef.current > PET_CONFIG.idle.sleepAfter) {
        setMood('sleepy')
      }
    }, 5000)
    return () => clearInterval(sleepTimerRef.current)
  }, [mounted, settings, reducedMotion, dialogOpen, menu.open])

  // 隔一段时间自己挪一小步，像看板娘一样有存在感
  useEffect(() => {
    if (!mounted || !settings || !settings.animation || reducedMotion) return undefined
    let cancelled = false

    const schedule = () => {
      clearTimeout(wanderTimerRef.current)
      wanderTimerRef.current = setTimeout(() => {
        if (cancelled) return
        const blocked =
          dialogOpen ||
          menu.open ||
          mood === 'sleepy' ||
          dragRef.current ||
          (typeof document !== 'undefined' &&
            document.visibilityState === 'hidden')
        if (!blocked) {
          const nextViewport = getViewport()
          const nextSize = getPetSize(nextViewport.width, PET_CONFIG.size)
          const base =
            position ||
            defaultPosition(nextSize, nextViewport, PET_CONFIG.offset, PET_CONFIG.edge)
          const target = clampPosition(
            {
              x: base.x + randomInt(-PET_CONFIG.wander.range, PET_CONFIG.wander.range),
              y:
                base.y +
                randomInt(
                  Math.round(-PET_CONFIG.wander.range / 2),
                  Math.round(PET_CONFIG.wander.range / 2)
                )
            },
            nextSize,
            nextViewport,
            PET_CONFIG.edge
          )
          setWalking(true)
          setPosition(target)
          updateSettings({ position: target })
          clearTimeout(walkTimerRef.current)
          walkTimerRef.current = setTimeout(
            () => setWalking(false),
            PET_CONFIG.wander.duration
          )
        }
        schedule()
      }, randomInt(PET_CONFIG.wander.interval[0], PET_CONFIG.wander.interval[1]))
    }

    schedule()
    return () => {
      cancelled = true
      clearTimeout(wanderTimerRef.current)
      clearTimeout(walkTimerRef.current)
    }
  }, [
    mounted,
    settings,
    reducedMotion,
    dialogOpen,
    menu.open,
    mood,
    position,
    updateSettings
  ])

  // 组件卸载时清理所有动画定时器
  useEffect(
    () => () => {
      clearTimeout(moodTimerRef.current)
      clearTimeout(wanderTimerRef.current)
      clearTimeout(walkTimerRef.current)
      clearTimeout(actionTimerRef.current)
      clearInterval(sleepTimerRef.current)
    },
    []
  )

  // 鼠标在页面任意位置移动时，桌宠会「看向」光标（像看板娘一样）
  useEffect(() => {
    if (!mounted || !settings?.animation || reducedMotion) return undefined
    let raf = 0
    const handleMove = event => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const pet = petRef.current
        const tilt = tiltRef.current
        if (!pet || !tilt || dragRef.current) return
        const rect = pet.getBoundingClientRect()
        if (!rect.width || !rect.height) return
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2
        const nx = Math.max(-1, Math.min(1, (event.clientX - centerX) / 320))
        const ny = Math.max(-1, Math.min(1, (event.clientY - centerY) / 320))
        tilt.style.setProperty('--pet-ry', `${(nx * 18).toFixed(2)}deg`)
        tilt.style.setProperty('--pet-rx', `${(-ny * 12).toFixed(2)}deg`)
      })
    }
    window.addEventListener('pointermove', handleMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', handleMove)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [mounted, settings?.animation, reducedMotion])

  // ---------- 文章索引 ----------
  const ensurePosts = useCallback(async () => {
    if (postsStatusRef.current === 'ready') return postsRef.current
    if (postsStatusRef.current === 'loading' && postsPendingRef.current) {
      return postsPendingRef.current
    }
    postsStatusRef.current = 'loading'
    const pending = fetch(PET_CONFIG.api.posts, { headers: { accept: 'application/json' } })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then(data => {
        const list = Array.isArray(data?.posts) ? data.posts : []
        postsRef.current = list
        postsStatusRef.current = 'ready'
        setPostsError(false)
        return list
      })
      .catch(() => {
        postsStatusRef.current = 'error'
        setPostsError(true)
        return []
      })
    postsPendingRef.current = pending
    return pending
  }, [])

  // 空闲时预热文章索引：首次打开对话/弹出气泡时不必再等接口
  useEffect(() => {
    if (!mounted) return undefined
    const timer = setTimeout(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      ensurePosts()
    }, 4000)
    return () => clearTimeout(timer)
  }, [mounted, ensurePosts])

  // ---------- 消息 ----------
  const pushMessage = useCallback((role, text) => {
    messageIdRef.current += 1
    const id = messageIdRef.current
    setMessages(prev => [...prev.slice(-18), { id, role, text }])
  }, [])

  const openArticle = useCallback(
    post => {
      if (!post?.href) return
      setDialogOpen(false)
      setBubble(null)
      router.push(post.href)
    },
    [router]
  )

  const openDialog = useCallback(() => {
    wake()
    setMenu(prev => ({ ...prev, open: false }))
    setBubble(null)
    setDialogOpen(true)
    if (messagesRef.current.length === 0) {
      messageIdRef.current += 1
      setMessages([
        {
          id: messageIdRef.current,
          role: 'pet',
          text: pickRandom(PET_CONFIG.welcome) || '想找点什么？'
        }
      ])
    }
    ensurePosts()
  }, [ensurePosts, wake])

  const closeDialog = useCallback(() => setDialogOpen(false), [])

  // ---------- 检索 ----------
  const runSearch = useCallback(
    async rawQuery => {
      const query = String(rawQuery || '').trim()
      if (!query) return
      pushMessage('user', query)
      setSearching(true)
      setResults([])
      const list = await ensurePosts()
      if (list.length === 0) {
        setSearching(false)
        pushMessage('pet', '文章索引暂时取不到，稍后再试，或直接浏览博客吧。')
        return
      }
      const currentIndex = buildIndex(list)
      const found = searchPosts(currentIndex, query, PET_CONFIG.search.limit)
      setResults(found)
      setSearching(false)
      pushMessage(
        'pet',
        found.length > 0
          ? `找到 ${found.length} 篇相关文章，点标题就能打开：`
          : '没有找到相关文章，换个关键词试试？也可以点下面的「最新」看看。'
      )
    },
    [ensurePosts, pushMessage]
  )

  const runQuickAction = useCallback(
    async action => {
      setSearching(true)
      setResults([])
      const list = await ensurePosts()
      if (list.length === 0) {
        setSearching(false)
        pushMessage('pet', '文章索引暂时取不到，稍后再试试。')
        return
      }
      const currentIndex = buildIndex(list)

      if (action === 'latest') {
        const found = latestPosts(currentIndex, PET_CONFIG.search.limit)
        setResults(found)
        pushMessage('pet', '这是最近更新的文章：')
      } else if (action === 'random') {
        const found = randomPosts(currentIndex, 3)
        setResults(found)
        pushMessage('pet', '随便挑了几篇，看看有没有感兴趣的：')
      } else if (action === 'hot') {
        let found = []
        try {
          const response = await fetch('/api/rank/top?limit=10')
          if (response.ok) {
            const data = await response.json()
            const hrefs = (data?.views || []).map(item => item.href)
            found = mapByHref(currentIndex, hrefs)
          }
        } catch {
          found = []
        }
        if (found.length === 0) {
          found = latestPosts(currentIndex, 3)
          pushMessage('pet', '暂时取不到阅读榜，先看看最新文章：')
        } else {
          pushMessage('pet', '这些是大家读得最多的文章：')
        }
        setResults(found)
      }
      setSearching(false)
    },
    [ensurePosts, pushMessage]
  )

  // ---------- 自动气泡 ----------
  const makeBubble = useCallback(list => {
    const currentIndex = buildIndex(list)
    if (currentIndex.length === 0) {
      return { text: pickRandom(PET_CONFIG.fallbackTips), post: null }
    }
    const fresh = currentIndex.filter(
      post => !historyRef.current.includes(post.id)
    )
    const picked = pickRandom(fresh.length > 0 ? fresh : currentIndex)
    if (!picked) return { text: pickRandom(PET_CONFIG.fallbackTips), post: null }
    historyRef.current = [...historyRef.current, picked.id].slice(
      -PET_CONFIG.bubble.maxHistory
    )
    const summary = truncate(picked.summary, 40)
    return {
      text: summary ? `《${truncate(picked.title, 20)}》${summary}` : `《${truncate(picked.title, 24)}》`,
      post: picked
    }
  }, [])

  useEffect(() => {
    if (!mounted || !settings) return undefined
    const { autoBubble, bubbleFrequency } = settings
    if (!autoBubble || bubbleFrequency === 'off' || dialogOpen || menu.open) {
      setBubble(null)
      return undefined
    }

    const range =
      PET_CONFIG.bubble.interval[bubbleFrequency] ||
      PET_CONFIG.bubble.interval.standard
    let cancelled = false
    let showTimer = null
    let hideTimer = null

    const hide = () => {
      if (cancelled) return
      setBubble(null)
      scheduleNext(randomInt(range[0], range[1]))
    }

    const scheduleNext = delay => {
      clearTimeout(showTimer)
      showTimer = setTimeout(() => {
        fire()
      }, delay)
    }

    const fire = async () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        scheduleNext(60000)
        return
      }
      const list = await ensurePosts()
      if (cancelled) return
      setBubble(makeBubble(list))
      clearTimeout(hideTimer)
      hideTimer = setTimeout(hide, PET_CONFIG.bubble.visibleFor)
      bubblePauseRef.current = () => clearTimeout(hideTimer)
      bubbleResumeRef.current = () => {
        clearTimeout(hideTimer)
        hideTimer = setTimeout(hide, 1500)
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        clearTimeout(showTimer)
        clearTimeout(hideTimer)
        setBubble(null)
      } else {
        scheduleNext(randomInt(range[0], range[1]))
      }
    }

    scheduleNext(randomInt(PET_CONFIG.bubble.firstDelay[0], PET_CONFIG.bubble.firstDelay[1]))
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      clearTimeout(showTimer)
      clearTimeout(hideTimer)
      bubblePauseRef.current = null
      bubbleResumeRef.current = null
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [mounted, settings, dialogOpen, menu.open, ensurePosts, makeBubble])

  // ---------- 键盘与外部点击 ----------
  useEffect(() => {
    if (!mounted) return undefined
    const handleKeyDown = event => {
      if (event.key !== 'Escape') return
      if (dialogOpen) {
        setDialogOpen(false)
      } else if (menu.open) {
        setMenu(prev => ({ ...prev, open: false }))
      } else if (bubble) {
        setBubble(null)
      }
    }
    const handlePointerDown = event => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.blog-pet-menu')) return
      if (menu.open) setMenu(prev => ({ ...prev, open: false }))
      if (!dialogOpen) return
      if (target.closest('.blog-pet-dialog') || target.closest('.blog-pet-pet')) return
      setDialogOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [mounted, dialogOpen, menu.open, bubble])

  // ---------- 拖动与点击 ----------
  const clearLongPress = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
  }, [])

  /** 鼠标悬停时的轻微 3D 倾斜，增强立体感（直接改样式，不触发重渲染） */
  const applyTilt = event => {
    const el = tiltRef.current
    const pet = petRef.current
    if (!el || !pet || dragRef.current?.moved) return
    const rect = pet.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const nx = (event.clientX - rect.left) / rect.width - 0.5
    const ny = (event.clientY - rect.top) / rect.height - 0.5
    el.style.setProperty('--pet-ry', `${(nx * 18).toFixed(2)}deg`)
    el.style.setProperty('--pet-rx', `${(-ny * 12).toFixed(2)}deg`)
  }

  const resetTilt = () => {
    const el = tiltRef.current
    if (!el) return
    el.style.setProperty('--pet-ry', '0deg')
    el.style.setProperty('--pet-rx', '0deg')
  }

  const handlePointerDown = event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    wake()
    const el = petRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
      last: null
    }
    if (settings?.freeMove) {
      try {
        el.setPointerCapture(event.pointerId)
      } catch {
        // 某些浏览器不支持 pointer capture，忽略
      }
    }
    if (event.pointerType !== 'mouse') {
      clearLongPress()
      longPressRef.current = setTimeout(() => {
        longPressRef.current = null
        suppressClickRef.current = true
        setMenu({ open: true, x: event.clientX, y: event.clientY })
      }, PET_CONFIG.longPressMs)
    } else {
      // 鼠标：长按左键进入「可拖动」状态，不必先打开自由移动
      clearLongPress()
      dragArmedRef.current = false
      pressTimerRef.current = setTimeout(() => {
        pressTimerRef.current = null
        dragArmedRef.current = true
        const node = petRef.current
        if (node) node.classList.add('is-drag-armed')
        const cursor = petRef.current
        if (cursor) cursor.style.cursor = 'grabbing'
      }, PET_CONFIG.longPressDragMs)
    }
  }

  const handlePointerMove = event => {
    const drag = dragRef.current
    if (!drag) {
      applyTilt(event)
      return
    }

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const distance = Math.hypot(dx, dy)
    const canDrag = settings?.freeMove || dragArmedRef.current || drag.moved

    // 自由移动关闭且还处于长按等待期：只做倾斜，不移动桌宠
    if (!canDrag) {
      applyTilt(event)
      return
    }
    if (!drag.moved && distance < PET_CONFIG.dragThreshold) return

    drag.moved = true
    clearLongPress()
    applyTilt(event)
    const nextViewport = getViewport()
    const nextSize = getPetSize(nextViewport.width, PET_CONFIG.size)
    const next = clampPosition(
      { x: drag.left + dx, y: drag.top + dy },
      nextSize,
      nextViewport,
      PET_CONFIG.edge
    )
    drag.last = next
    const el = petRef.current
    if (el) {
      el.style.left = `${next.x}px`
      el.style.top = `${next.y}px`
      el.style.transition = 'none'
    }
  }

  /** 结束一次按下/拖动，清理临时样式 */
  const finishInteraction = () => {
    clearLongPress()
    dragArmedRef.current = false
    const drag = dragRef.current
    dragRef.current = null
    const el = petRef.current
    if (el) {
      el.style.transition = ''
      el.style.cursor = ''
      el.classList.remove('is-drag-armed')
    }
    resetTilt()
    return drag
  }

  const handlePointerUp = event => {
    const drag = finishInteraction()

    // 右键（或中键）抬手不能被当成“左键点击”，否则会和右键菜单同时打开
    if (typeof event?.button === 'number' && event.button > 0) {
      return
    }

    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (drag?.moved && drag.last) {
      setPosition(drag.last)
      updateSettings({ position: drag.last })
      return
    }
    if (menu.open) {
      setMenu(prev => ({ ...prev, open: false }))
      return
    }
    if (dialogOpen) {
      setDialogOpen(false)
    } else {
      flashHappy()
      live2dRef.current?.playTap?.()
      openDialog()
    }
  }

  const handlePointerCancel = () => {
    finishInteraction()
  }

  const handlePointerLeave = () => {
    if (dragRef.current?.moved) return
    clearLongPress()
    dragArmedRef.current = false
    resetTilt()
    const el = petRef.current
    if (el) {
      el.style.cursor = ''
      el.classList.remove('is-drag-armed')
    }
  }

  const handleContextMenu = event => {
    event.preventDefault()
    event.stopPropagation()
    // 右键只弹菜单：先把对话/气泡收起来，避免两层浮层叠在一起
    setDialogOpen(false)
    setBubble(null)
    setMenu({ open: true, x: event.clientX, y: event.clientY })
  }

  // 键盘用户：Enter / 空格 与点击等价
  const handlePetKeyDown = event => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    wake()
    if (dialogOpen) {
      setDialogOpen(false)
    } else {
      flashHappy()
      openDialog()
    }
  }

  const handleMenuAction = (action, value) => {
    switch (action) {
      case 'dialog':
        openDialog()
        break
      case 'freeMove':
      case 'autoBubble':
      case 'animation':
        updateSettings({ [action]: value })
        break
      case 'bubbleFrequency':
        updateSettings({ bubbleFrequency: value })
        break
      case 'resetPosition': {
        const nextViewport = getViewport()
        const nextSize = getPetSize(nextViewport.width, PET_CONFIG.size)
        const next = defaultPosition(nextSize, nextViewport, PET_CONFIG.offset, PET_CONFIG.edge)
        setPosition(next)
        updateSettings({ position: next })
        break
      }
      case 'glasses':
        live2dRef.current?.toggleGlasses?.()
        break
      case 'fireworks':
        triggerAction('fireworks')
        break
      case 'feed':
        triggerAction('eating')
        break
      case 'about':
        setMenu(prev => ({ ...prev, open: false }))
        setDialogOpen(true)
        pushMessage('pet', `${PET_CONFIG.name}：戴墨镜的博客小助手，能帮你翻找站内文章。`)
        break
      case 'hide':
        setMenu(prev => ({ ...prev, open: false }))
        setDialogOpen(false)
        setBubble(null)
        updateSettings({ visible: false })
        break
      default:
        break
    }
    if (action !== 'about' && action !== 'hide') {
      setMenu(prev => ({ ...prev, open: false }))
    }
  }

  if (!mounted || !settings || !PET_CONFIG.enabled) return null

  const animationOn = settings.animation && !reducedMotion
  const bubbleVisible = settings.visible && bubble
  const abovePet = petPos.y > 150

  const bubbleStyle = {
    left: clamp(petPos.x + petSize / 2 - 118, 8, Math.max(8, viewport.width - 244)),
    ...(abovePet
      ? { bottom: viewport.height - petPos.y + 10 }
      : { top: petPos.y + petSize + 10 })
  }

  return createPortal(
    <>
      {settings.visible ? (
        <button
          ref={petRef}
          type='button'
          className={`blog-pet-pet ${animationOn ? 'is-animated' : ''} ${
            mood === 'happy' ? 'is-happy' : ''
          } ${mood === 'sleepy' ? 'is-sleepy' : ''} ${
            walking ? 'is-walking' : ''
          }`}
          style={{ left: petPos.x, top: petPos.y, width: petSize, height: petSize }}
          aria-label={`${PET_CONFIG.name}，点击打开博客助手`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerLeave}
          onContextMenu={handleContextMenu}
          onKeyDown={handlePetKeyDown}
          onDragStart={event => event.preventDefault()}
        >
          {live2dStatus === 'ready' ? (
            <Live2DPet
              ref={live2dRef}
              size={petSize}
              onReady={handleLive2DReady}
              onUnavailable={handleLive2DUnavailable}
            />
          ) : null}
          <span
            className='blog-pet-tilt'
            ref={tiltRef}
            style={live2dActive ? { display: 'none' } : undefined}
          >
            <SpritePet
              animate={animationOn}
              mood={mood}
              walking={walking}
              searching={searching}
              dialogOpen={dialogOpen}
              action={action}
            />
          </span>
          <PetEffects action={action} />
          <span className='blog-pet-ground' aria-hidden='true' />
          {mood === 'happy' && (
            <span className='blog-pet-hearts' aria-hidden='true'>
              <i>♥</i>
              <i>♥</i>
              <i>♥</i>
            </span>
          )}
          {mood === 'sleepy' && (
            <span className='blog-pet-zzz' aria-hidden='true'>
              Zzz
            </span>
          )}
        </button>
      ) : (
        <button
          type='button'
          className='blog-pet-restore'
          onClick={() => updateSettings({ visible: true })}
          aria-label='显示桌宠'
        >
          显示桌宠
        </button>
      )}

      {bubbleVisible && (
        <BlogPetBubble
          bubble={bubble}
          style={bubbleStyle}
          placement={abovePet ? 'above' : 'below'}
          onClose={() => setBubble(null)}
          onOpenArticle={openArticle}
          onMouseEnter={() => bubblePauseRef.current?.()}
          onMouseLeave={() => bubbleResumeRef.current?.()}
        />
      )}

      <BlogPetContextMenu
        menu={menu}
        settings={settings}
        live2dReady={live2dStatus === 'ready' && !!LIVE2D_CONFIG.parameters.glassesUp}
        onAction={handleMenuAction}
        onClose={() => setMenu(prev => ({ ...prev, open: false }))}
      />

      <BlogPetDialog
        open={dialogOpen}
        anchorRect={{
          left: petPos.x,
          top: petPos.y,
          width: petSize,
          height: petSize
        }}
        messages={messages}
        results={results}
        searching={searching}
        error={postsError && results.length === 0}
        quickDisabled={searching}
        onClose={closeDialog}
        onSubmit={runSearch}
        onQuickAction={runQuickAction}
        onOpenArticle={openArticle}
      />
    </>,
    document.body
  )
}

export default BlogPet
