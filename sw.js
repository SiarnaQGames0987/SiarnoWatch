/* SiarnoWatch v0.8 device notification service worker */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || new URL('notifications.html', self.registration.scope).href;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      try {
        if ('navigate' in client) await client.navigate(targetUrl);
        if ('focus' in client) return client.focus();
      } catch (_) {}
    }
    if (clients.openWindow) return clients.openWindow(targetUrl);
  })());
});
