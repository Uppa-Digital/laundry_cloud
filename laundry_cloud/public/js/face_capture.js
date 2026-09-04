frappe.provide("laundry_cloud.face_capture");

(function (ns) {
	const FACE_API_SRC = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
	const FACE_API_MODEL_URL =
		"https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";

	let modelsLoadingPromise = null;
	let modelsLoaded = false;

	function loadScript(src) {
		return new Promise((resolve, reject) => {
			if (document.querySelector(`script[src="${src}"]`)) {
				resolve();
				return;
			}
			const script = document.createElement("script");
			script.src = src;
			script.onload = resolve;
			script.onerror = () => reject(new Error("Could not load " + src));
			document.head.appendChild(script);
		});
	}

	// Loads the face-api.js library + models. Safe to call many times
	// (e.g. from multiple pages) — only fetches once per session.
	ns.loadModels = function () {
		if (modelsLoaded) return Promise.resolve();
		if (modelsLoadingPromise) return modelsLoadingPromise;
		modelsLoadingPromise = loadScript(FACE_API_SRC)
			.then(() =>
				Promise.all([
					faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL),
					faceapi.nets.faceLandmark68Net.loadFromUri(FACE_API_MODEL_URL),
					faceapi.nets.faceRecognitionNet.loadFromUri(FACE_API_MODEL_URL),
				])
			)
			.then(() => {
				modelsLoaded = true;
			});
		return modelsLoadingPromise;
	};

	ns.isReady = function () {
		return modelsLoaded;
	};

	// mediaEl can be a <video>, <img>, or <canvas> — face-api.js detects on
	// any of them the same way, which is what makes still-photo enrollment
	// (upload / an existing Employee photo) work identically to a live
	// camera capture.
	ns.detectFace = async function (mediaEl, scoreThreshold) {
		const options = new faceapi.TinyFaceDetectorOptions({
			scoreThreshold: scoreThreshold || 0.5,
		});
		return await faceapi
			.detectSingleFace(mediaEl, options)
			.withFaceLandmarks()
			.withFaceDescriptor();
	};

	// Re-encodes whatever's currently showing in a <video>/<img> element as
	// a JPEG data URL, for both live camera frames and already-loaded
	// still images.
	ns.captureSnapshot = function (mediaEl) {
		const width = mediaEl.videoWidth || mediaEl.naturalWidth || mediaEl.width;
		const height = mediaEl.videoHeight || mediaEl.naturalHeight || mediaEl.height;
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		canvas.getContext("2d").drawImage(mediaEl, 0, 0, width, height);
		return canvas.toDataURL("image/jpeg", 0.85);
	};

	ns.startCamera = function () {
		return navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
	};

	ns.stopCamera = function (stream) {
		if (stream) stream.getTracks().forEach((t) => t.stop());
	};

	// --- Still-photo helpers (upload / existing photo) --------------------

	ns.readFileAsDataUrl = function (file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result);
			reader.onerror = () => reject(new Error("Could not read that file."));
			reader.readAsDataURL(file);
		});
	};

	// Loads any URL (a data: URL from a file picker, or a same-origin file
	// URL like an Employee's existing photo) into an <img> element ready
	// for detectFace()/captureSnapshot().
	ns.loadImage = function (src) {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error("Could not load that image."));
			img.src = src;
		});
	};
})(laundry_cloud.face_capture);
