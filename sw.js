 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/sw.js b/sw.js
index a21cfa0cc0b91dbb269bb04ed99df86444f8e3f1..032c818a33f3dfc6fec39457fab91840bcd95a99 100644
--- a/sw.js
+++ b/sw.js
@@ -1,165 +1,31 @@
-// sw.js - Fixed Service Worker for GOAT KIDS
-const CACHE_NAME = 'goat-kids-v1.1';
-const ASSETS_TO_CACHE = [
-  './',                    // Current directory
-  './index.html',          // Your main HTML file
-  // Add other assets ONLY if they exist
-];
+// sw.js - Service Worker cleanup for GOAT KIDS
+// This version unregisters itself and clears old caches to prevent stale assets.
+
+const CACHE_PREFIX = 'goat-kids';
 
-// Install event - cache assets
 self.addEventListener('install', event => {
-  console.log('📦 Service Worker: Installing...');
-  
-  event.waitUntil(
-    caches.open(CACHE_NAME)
-      .then(cache => {
-        console.log('📁 Attempting to cache:', ASSETS_TO_CACHE);
-        
-        // Use Promise.all to cache individually with error handling
-        return Promise.all(
-          ASSETS_TO_CACHE.map(url => {
-            return fetch(url)
-              .then(response => {
-                if (!response.ok) {
-                  throw new Error(`Failed to fetch ${url}: ${response.status}`);
-                }
-                return cache.put(url, response);
-              })
-              .catch(error => {
-                console.warn(`⚠️ Could not cache ${url}:`, error.message);
-                // Continue even if one file fails
-                return Promise.resolve();
-              });
-          })
-        );
-      })
-      .then(() => {
-        console.log('✅ All assets cached successfully');
-        return self.skipWaiting();
-      })
-      .catch(error => {
-        console.error('❌ Cache installation failed:', error);
-        // Don't fail the installation if caching fails
-        return self.skipWaiting();
-      })
-  );
+  event.waitUntil(self.skipWaiting());
 });
 
-// Activate event - clean up old caches
 self.addEventListener('activate', event => {
-  console.log('🔄 Service Worker: Activating...');
-  
   event.waitUntil(
-    caches.keys().then(cacheNames => {
-      return Promise.all(
-        cacheNames.map(cacheName => {
-          if (cacheName !== CACHE_NAME) {
-            console.log('🗑️ Deleting old cache:', cacheName);
-            return caches.delete(cacheName);
-          }
-        })
+    (async () => {
+      const cacheNames = await caches.keys();
+      await Promise.all(
+        cacheNames
+          .filter(cacheName => cacheName.startsWith(CACHE_PREFIX))
+          .map(cacheName => caches.delete(cacheName))
       );
-    }).then(() => {
-      console.log('✅ Service Worker activated');
-      return self.clients.claim();
-    })
-  );
-});
 
-// Fetch event - serve from cache or network
-self.addEventListener('fetch', event => {
-  // Skip non-GET requests
-  if (event.request.method !== 'GET') {
-    return;
-  }
-  
-  // Skip Chrome extensions and external URLs
-  if (event.request.url.startsWith('chrome-extension://') ||
-      !event.request.url.startsWith(self.location.origin)) {
-    return;
-  }
-  
-  event.respondWith(
-    caches.match(event.request)
-      .then(cachedResponse => {
-        // Return cached response if found
-        if (cachedResponse) {
-          console.log('📂 Serving from cache:', event.request.url);
-          return cachedResponse;
-        }
-        
-        console.log('🌐 Fetching from network:', event.request.url);
-        
-        // Clone the request
-        const fetchRequest = event.request.clone();
-        
-        return fetch(fetchRequest)
-          .then(response => {
-            // Check if valid response
-            if (!response || response.status !== 200 || response.type !== 'basic') {
-              return response;
-            }
-            
-            // Clone the response
-            const responseToCache = response.clone();
-            
-            // Cache the response
-            caches.open(CACHE_NAME)
-              .then(cache => {
-                cache.put(event.request, responseToCache);
-                console.log('💾 Cached new resource:', event.request.url);
-              });
-            
-            return response;
-          })
-          .catch(error => {
-            console.error('❌ Network fetch failed:', error.message);
-            
-            // You could return a custom offline page here
-            if (event.request.url.includes('.html')) {
-              return caches.match('./index.html');
-            }
-            
-            // Return a simple offline message for other requests
-            return new Response(`
-              <!DOCTYPE html>
-              <html>
-                <head>
-                  <title>Offline - GOAT KIDS</title>
-                  <style>
-                    body { 
-                      font-family: Arial, sans-serif; 
-                      text-align: center; 
-                      padding: 50px; 
-                      background: #f5f7ff;
-                      color: #2d3436;
-                    }
-                    h1 { color: #4a6ee0; }
-                  </style>
-                </head>
-                <body>
-                  <h1>🐐 GOAT KIDS</h1>
-                  <h2>You're Offline</h2>
-                  <p>Please check your internet connection and try again.</p>
-                  <button onclick="window.location.reload()">Retry</button>
-                </body>
-              </html>
-            `, {
-              headers: { 'Content-Type': 'text/html' }
-            });
-          });
-      })
-  );
-});
+      const registrations = await self.registration.unregister();
+      console.log('Service worker unregistered:', registrations);
 
-// Message handling
-self.addEventListener('message', event => {
-  if (event.data === 'skipWaiting') {
-    self.skipWaiting();
-  }
+      await self.clients.claim();
+    })()
+  );
 });
 
-// Error handling
-self.addEventListener('error', error => {
-  console.error('Service Worker Error:', error);
+self.addEventListener('fetch', event => {
+  if (event.request.method !== 'GET') return;
+  event.respondWith(fetch(event.request));
 });
 
EOF
)
