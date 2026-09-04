const CACHE_NAME = "laundry-cloud-kiosk-v1";
const APP_SHELL = [
	"/kiosk",
	"/manifest.json",
	"/assets/laundry_cloud/css/kiosk.css",
	"/assets/laundry_cloud/js/kiosk.js",
	"/assets/laundry_cloud/images/icon-192.png",
	"/assets/laundry_cloud/images/icon-512.png",
];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll(APP_SHELL))
			.catch(() => {
				/* best-effort; a slow/offline first install shouldn't fail install */
			})
	);
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);

	// Never serve API calls, login/logout, or cross-origin requests (face-api
	// CDN, geolocation, etc.) from the cache — attendance actions must always
	// hit the network live.
	if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
		return;
	}

	event.respondWith(
		caches.match(event.request).then((cached) => {
			const network = fetch(event.request)
				.then((response) => {
					if (response && response.status === 200) {
						const clone = response.clone();
						caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
					}
					return response;
				})
				.catch(() => cached);
			return cached || network;
		})
	);
});
