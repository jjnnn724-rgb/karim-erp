'use strict';

const CACHE_NAME = 'karim-cashier-shell-v2';
const APP_ROOT = new URL('./', self.location.href);
const SHELL_URL = new URL('./index.html', APP_ROOT).href;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.add(SHELL_URL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key.startsWith('karim-cashier-shell-') && key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin
        || url.pathname.startsWith('/api/')
        || url.pathname.startsWith('/socket.io/')
        || url.pathname.startsWith('/uploads/')) {
        return;
    }

    if (request.mode === 'navigate' && url.pathname.startsWith(APP_ROOT.pathname)) {
        event.respondWith(
            fetch(request).then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    void caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_URL, copy));
                }
                return response;
            }).catch(async () => (await caches.match(SHELL_URL)) || Response.error())
        );
        return;
    }

    if (!url.pathname.startsWith('/app/')) {return;}
    event.respondWith(
        fetch(request).then((response) => {
            if (response.ok) {
                const copy = response.clone();
                void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
        }).catch(async () => (await caches.match(request)) || Response.error())
    );
});
