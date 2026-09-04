(function () {
	"use strict";

	const FACE_API_SRC = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
	const FACE_API_MODEL_URL =
		"https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";
	const SCAN_TIMEOUT_MS = 15000;
	const SCAN_POLL_MS = 350;

	const $app = document.getElementById("kiosk-app");
	const csrfMeta = document.querySelector('meta[name="csrf-token"]');
	const csrfToken = csrfMeta ? csrfMeta.content : "";

	const app = {
		modelsLoaded: false,
		modelsLoading: null,
		deviceContext: null,
	};

	// -----------------------------------------------------------------
	// PWA install prompt (persists across screen re-renders)
	// -----------------------------------------------------------------

	let deferredInstallPrompt = null;
	const $installBtn = document.createElement("button");
	$installBtn.id = "kiosk-install-btn";
	$installBtn.type = "button";
	$installBtn.textContent = "⤓ Install App";
	$installBtn.style.cssText =
		"position:fixed;right:16px;bottom:16px;z-index:1000;display:none;" +
		"padding:10px 16px;border:none;border-radius:999px;background:#0d7377;" +
		"color:#fff;font-weight:600;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.2);";
	document.body.appendChild($installBtn);

	function isStandalone() {
		return (
			window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone
		);
	}

	if (!isStandalone()) {
		window.addEventListener("beforeinstallprompt", (e) => {
			e.preventDefault();
			deferredInstallPrompt = e;
			$installBtn.style.display = "block";
		});
	}

	$installBtn.addEventListener("click", async () => {
		if (!deferredInstallPrompt) return;
		$installBtn.style.display = "none";
		deferredInstallPrompt.prompt();
		await deferredInstallPrompt.userChoice.catch(() => {});
		deferredInstallPrompt = null;
	});

	window.addEventListener("appinstalled", () => {
		$installBtn.style.display = "none";
	});

	// -----------------------------------------------------------------
	// API / auth helpers
	// -----------------------------------------------------------------

	function apiCall(method, args) {
		return fetch(`/api/method/${method}`, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				"X-Frappe-CSRF-Token": csrfToken || "",
			},
			body: JSON.stringify(args || {}),
		}).then(async (res) => {
			let data = {};
			try {
				data = await res.json();
			} catch (e) {
				/* no JSON body */
			}
			if (!res.ok) {
				throw new Error(extractError(data, res.status));
			}
			return data.message;
		});
	}

	function extractError(data, status) {
		if (data && data._server_messages) {
			try {
				const msgs = JSON.parse(data._server_messages).map((m) => JSON.parse(m).message);
				if (msgs.length) return msgs.join(" ");
			} catch (e) {
				/* ignore */
			}
		}
		if (data && data.exception) {
			const parts = String(data.exception).split(": ");
			return parts[parts.length - 1];
		}
		return `Request failed (${status})`;
	}

	function login(usr, pwd) {
		return fetch("/api/method/login", {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: `usr=${encodeURIComponent(usr)}&pwd=${encodeURIComponent(pwd)}`,
		}).then(async (res) => {
			if (!res.ok) {
				let data = {};
				try {
					data = await res.json();
				} catch (e) {
					/* ignore */
				}
				throw new Error(extractError(data, res.status) || "Invalid login.");
			}
		});
	}

	function signOut() {
		return fetch("/api/method/logout", {
			method: "POST",
			credentials: "same-origin",
			headers: { "X-Frappe-CSRF-Token": csrfToken || "" },
		}).catch(() => {});
	}

	// -----------------------------------------------------------------
	// Camera / face-api / geolocation helpers
	// -----------------------------------------------------------------

	function loadScript(src) {
		return new Promise((resolve, reject) => {
			if (document.querySelector(`script[src="${src}"]`)) {
				resolve();
				return;
			}
			const s = document.createElement("script");
			s.src = src;
			s.onload = resolve;
			s.onerror = () => reject(new Error("Could not load " + src));
			document.head.appendChild(s);
		});
	}

	function loadFaceModels() {
		if (app.modelsLoaded) return Promise.resolve();
		if (app.modelsLoading) return app.modelsLoading;
		app.modelsLoading = loadScript(FACE_API_SRC)
			.then(() =>
				Promise.all([
					faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL),
					faceapi.nets.faceLandmark68Net.loadFromUri(FACE_API_MODEL_URL),
					faceapi.nets.faceRecognitionNet.loadFromUri(FACE_API_MODEL_URL),
				])
			)
			.then(() => {
				app.modelsLoaded = true;
			});
		return app.modelsLoading;
	}

	function getPosition() {
		return new Promise((resolve, reject) => {
			if (!navigator.geolocation) {
				reject(new Error("Geolocation is not supported on this device."));
				return;
			}
			navigator.geolocation.getCurrentPosition(
				(pos) => resolve(pos.coords),
				(err) => reject(new Error("Location error: " + err.message)),
				{ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
			);
		});
	}

	function startCamera() {
		return navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
	}

	function stopCamera(stream) {
		if (stream) stream.getTracks().forEach((t) => t.stop());
	}

	async function detectWithTimeout(video, timeoutMs) {
		const options = new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 });
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			try {
				const detection = await faceapi
					.detectSingleFace(video, options)
					.withFaceLandmarks()
					.withFaceDescriptor();
				if (detection) return detection;
			} catch (e) {
				/* keep trying until timeout */
			}
			await new Promise((r) => setTimeout(r, SCAN_POLL_MS));
		}
		return null;
	}

	function escapeHtml(str) {
		const div = document.createElement("div");
		div.textContent = str == null ? "" : String(str);
		return div.innerHTML;
	}

	// -----------------------------------------------------------------
	// Screens
	// -----------------------------------------------------------------

	function renderLoadingCard(text) {
		$app.innerHTML = `<div class="kiosk-boot">${escapeHtml(text || "Loading…")}</div>`;
	}

	function renderLogin(errorMsg) {
		$app.innerHTML = `
			<div class="kiosk-card">
				<div class="kiosk-header">Attendance Kiosk Setup</div>
				<div class="kiosk-welcome-title">Sign in this device</div>
				<p class="kiosk-scan-subtitle">
					Sign in once with this location's dedicated Kiosk Device account.
					The device stays signed in after that.
				</p>
				<form class="kiosk-login-form" id="kiosk-login-form">
					<label>Username</label>
					<input type="text" id="kiosk-usr" autocomplete="username" required>
					<label>Password</label>
					<input type="password" id="kiosk-pwd" autocomplete="current-password" required>
					<button type="submit" class="kiosk-primary-btn" id="kiosk-login-btn">Sign In</button>
					<div class="kiosk-error-text">${escapeHtml(errorMsg || "")}</div>
				</form>
			</div>
		`;
		document.getElementById("kiosk-login-form").addEventListener("submit", async (e) => {
			e.preventDefault();
			const btn = document.getElementById("kiosk-login-btn");
			const usr = document.getElementById("kiosk-usr").value.trim();
			const pwd = document.getElementById("kiosk-pwd").value;
			btn.disabled = true;
			btn.innerHTML = `<span class="kiosk-spinner"></span>`;
			try {
				await login(usr, pwd);
				window.location.reload();
			} catch (err) {
				renderLogin(err.message);
			}
		});
	}

	function tickClock() {
		const clockEl = document.getElementById("kiosk-clock");
		const dateEl = document.getElementById("kiosk-date");
		if (!clockEl) return;
		const now = new Date();
		clockEl.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		if (dateEl) {
			dateEl.textContent = now.toLocaleDateString([], {
				weekday: "long",
				year: "numeric",
				month: "long",
				day: "numeric",
			});
		}
	}

	function renderWelcome() {
		if (window.__kioskReturnTimer) clearTimeout(window.__kioskReturnTimer);

		const ctx = app.deviceContext || {};
		const locationLabel =
			(ctx.office_location && ctx.office_location.location_name) ||
			ctx.device_name ||
			"Attendance Kiosk";

		$app.innerHTML = `
			<div class="kiosk-card">
				<div class="kiosk-header">📍 ${escapeHtml(locationLabel)}</div>
				<div class="kiosk-clock" id="kiosk-clock">--:--</div>
				<div class="kiosk-date" id="kiosk-date"></div>
				<div class="kiosk-welcome-title">What do you want to do?</div>
				<div class="kiosk-action-row">
					<button class="kiosk-action-btn checkout" id="kiosk-btn-out" disabled>
						<span class="kiosk-action-icon">⏻</span>
						Check Out
					</button>
					<button class="kiosk-action-btn checkin" id="kiosk-btn-in" disabled>
						<span class="kiosk-action-icon">✓</span>
						Check In
					</button>
				</div>
				<div class="kiosk-status-line" id="kiosk-ready-status">Preparing camera…</div>
				${
					ctx.is_registered_device === false
						? `<div class="kiosk-status-line">⚠ Preview mode — this device isn't registered as a Kiosk Device yet.</div>`
						: ""
				}
				<button class="kiosk-link-btn" id="kiosk-signout">Sign out this device</button>
			</div>
		`;

		tickClock();
		if (window.__kioskClockInterval) clearInterval(window.__kioskClockInterval);
		window.__kioskClockInterval = setInterval(tickClock, 1000);

		const btnIn = document.getElementById("kiosk-btn-in");
		const btnOut = document.getElementById("kiosk-btn-out");
		const readyStatus = document.getElementById("kiosk-ready-status");

		const setReady = () => {
			btnIn.disabled = !app.modelsLoaded;
			btnOut.disabled = !app.modelsLoaded;
			readyStatus.textContent = app.modelsLoaded ? "" : "Preparing camera…";
		};
		setReady();
		loadFaceModels()
			.then(setReady)
			.catch((err) => {
				readyStatus.textContent = "Face recognition failed to load: " + err.message;
			});

		btnIn.addEventListener("click", () => startScan("IN"));
		btnOut.addEventListener("click", () => startScan("OUT"));
		document.getElementById("kiosk-signout").addEventListener("click", async () => {
			await signOut();
			window.location.reload();
		});
	}

	async function startScan(logType) {
		if (window.__kioskClockInterval) clearInterval(window.__kioskClockInterval);
		renderScanning(logType);

		let stream;
		try {
			stream = await startCamera();
		} catch (err) {
			renderError("Could not access the camera: " + err.message, logType);
			return;
		}

		const video = document.getElementById("kiosk-video");
		video.srcObject = stream;
		await video.play().catch(() => {});

		try {
			await loadFaceModels();
		} catch (err) {
			stopCamera(stream);
			renderError("Face recognition failed to load: " + err.message, logType);
			return;
		}

		const detection = await detectWithTimeout(video, SCAN_TIMEOUT_MS);
		if (!detection) {
			stopCamera(stream);
			renderError("No face detected. Please try again.", logType);
			return;
		}

		const canvas = document.createElement("canvas");
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
		const image = canvas.toDataURL("image/jpeg", 0.85);

		stopCamera(stream);

		let coords;
		try {
			coords = await getPosition();
		} catch (err) {
			renderError(err.message, logType);
			return;
		}

		try {
			const result = await apiCall(
				"laundry_cloud.attendance.kiosk_api.identify_and_mark_attendance",
				{
					latitude: coords.latitude,
					longitude: coords.longitude,
					descriptor: JSON.stringify(Array.from(detection.descriptor)),
					image,
					log_type: logType,
				}
			);
			renderResult(result, logType);
		} catch (err) {
			renderError(err.message, logType);
		}
	}

	function renderScanning(logType) {
		$app.innerHTML = `
			<div class="kiosk-card">
				<div class="kiosk-scan-ring searching">
					<video id="kiosk-video" autoplay muted playsinline></video>
				</div>
				<div class="kiosk-scan-title">Scanning…</div>
				<div class="kiosk-scan-subtitle">Look at the camera to ${
					logType === "OUT" ? "check out" : "check in"
				}</div>
			</div>
		`;
	}

	function renderResult(result, logType) {
		const isOut = logType === "OUT";
		const locationGood = result.location_status === "Within Range";
		const hours = result.hours_since_in;
		const time = result.time ? new Date(result.time.replace(" ", "T")) : new Date();

		$app.innerHTML = `
			<div class="kiosk-card">
				<div class="kiosk-result-badge">✓</div>
				<div class="kiosk-result-title">You have been ${isOut ? "checked out" : "checked in"}!</div>
				<div class="kiosk-result-subtitle">Face verified. Thank you.</div>
				${
					result.selfie
						? `<img class="kiosk-result-photo" src="${escapeHtml(result.selfie)}" alt="">`
						: ""
				}
				<div class="kiosk-result-card">
					<div class="kiosk-result-name">${escapeHtml(result.employee_name)}</div>
					<div class="kiosk-result-meta">${escapeHtml(result.employee)} · ${time.toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		})}</div>
					${
						isOut && hours
							? `<div class="kiosk-hours">${hours} Hrs</div><div class="kiosk-result-meta">Worked today</div>`
							: ""
					}
					<div class="kiosk-badge-row">
						<span class="kiosk-badge ${locationGood ? "good" : "warn"}">${escapeHtml(
			result.location_status || "Unknown"
		)}${result.office_location ? " · " + escapeHtml(result.office_location) : ""}</span>
					</div>
				</div>
			</div>
		`;

		scheduleReturnToWelcome(4500);
	}

	function renderError(message, logType) {
		$app.innerHTML = `
			<div class="kiosk-card">
				<div class="kiosk-result-badge error">✕</div>
				<div class="kiosk-result-title">Could not ${
					logType === "OUT" ? "check you out" : "check you in"
				}</div>
				<div class="kiosk-error-text">${escapeHtml(message)}</div>
				<button class="kiosk-primary-btn" id="kiosk-retry">Try Again</button>
			</div>
		`;
		document.getElementById("kiosk-retry").addEventListener("click", renderWelcome);
		scheduleReturnToWelcome(8000);
	}

	function scheduleReturnToWelcome(delay) {
		if (window.__kioskReturnTimer) clearTimeout(window.__kioskReturnTimer);
		window.__kioskReturnTimer = setTimeout(renderWelcome, delay);
	}

	// -----------------------------------------------------------------
	// Boot
	// -----------------------------------------------------------------

	async function init() {
		if (!window.KIOSK_IS_LOGGED_IN) {
			renderLogin();
			return;
		}

		renderLoadingCard("Connecting…");
		try {
			app.deviceContext = await apiCall("laundry_cloud.attendance.kiosk_api.get_device_context");
		} catch (err) {
			renderLogin(err.message);
			return;
		}

		renderWelcome();
		loadFaceModels().catch(() => {});

		// Prime the location permission prompt early so it isn't blocking
		// the first check-in/check-out attempt.
		if (navigator.geolocation) {
			navigator.geolocation.getCurrentPosition(
				() => {},
				() => {},
				{ timeout: 5000 }
			);
		}

		if ("serviceWorker" in navigator) {
			navigator.serviceWorker.register("/sw.js").catch(() => {});
		}
	}

	init();
})();
