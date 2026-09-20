/**
 * 新增推送通知功能 - Service Worker
 * 处理 Web Push 推送事件和通知点击事件
 */

// 推送事件：收到服务端推送时显示系统通知
self.addEventListener('push', event => {
  const data = event.data?.json() || { title: '博客更新', body: '', url: '/' }
  event.waitUntil(
    self.registration.showNotification(data.title || '博客更新', {
      body: data.body || '点击查看详情',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      data: { url: data.url || '/' },
      tag: data.url || '/',
      renotify: true
    })
  )
})

// 通知点击事件：打开对应文章页面
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          client.focus()
          client.navigate(url)
          return
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
