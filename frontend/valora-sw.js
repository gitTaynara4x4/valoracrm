/* Valora CRM - Service Worker de notificações da agenda */
'use strict';

const DEFAULT_ICON = '/frontend/img/logo-favicon.jpg';
const DEFAULT_URL = '/dashboard?abrir_agenda=1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Agenda Valora';
  const options = {
    body: payload.body || 'Você possui um lembrete agendado.',
    icon: payload.icon || DEFAULT_ICON,
    badge: payload.badge || DEFAULT_ICON,
    tag: payload.tag || `valora-agenda-${Date.now()}`,
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [220, 110, 220, 110, 320],
    timestamp: Date.now(),
    data: {
      url: payload.url || DEFAULT_URL,
      type: payload.type || 'agenda-reminder',
      agendaItemId: payload.agendaItemId || null,
      entityType: payload.entityType || null,
      entityId: payload.entityId || null,
    },
    actions: [
      { action: 'open-agenda', title: 'Ver agenda' },
      { action: 'dismiss', title: 'Fechar' }
    ],
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    windows.forEach((client) => {
      client.postMessage({
        type: 'valora-agenda-push-received',
        payload: options.data,
      });
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const data = event.notification.data || {};
  const targetUrl = data.url || DEFAULT_URL;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      try {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin) {
          await client.focus();
          client.postMessage({
            type: 'valora-agenda-open',
            agendaItemId: data.agendaItemId || null,
            entityType: data.entityType || null,
            entityId: data.entityId || null,
          });
          return;
        }
      } catch (_) {}
    }
    await self.clients.openWindow(targetUrl);
  })());
});
