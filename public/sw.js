// sw.js — KILL-SWITCH
// This service worker's only job is to remove itself and clear all
// caches, so old devices stop running whatever stale sw.js they had
// installed previously. Keep this file in place going forward
// (deleting it again would just recreate the original problem, since
// browsers can't tell "file removed" from "network error").

self.addEventListener('install', function () {
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        (async function () {
            const keys = await caches.keys();
            await Promise.all(keys.map(function (k) { return caches.delete(k); }));
            await self.registration.unregister();
            const clientsList = await self.clients.matchAll({ type: 'window' });
            clientsList.forEach(function (client) { client.navigate(client.url); });
        })()
    );
});

// Let any in-flight requests pass straight through untouched.
self.addEventListener('fetch', function () {});
