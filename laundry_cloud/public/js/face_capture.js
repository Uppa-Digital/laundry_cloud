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

	ns.detectFace = async function (videoEl, scoreThreshold) {
		const options = new faceapi.TinyFaceDetectorOptions({
			scoreThreshold: scoreThreshold || 0.5,
		});
		return await faceapi
			.detectSingleFace(videoEl, options)
			.withFaceLandmarks()
			.withFaceDescriptor();
	};

	ns.captureSnapshot = function (videoEl) {
		const canvas = document.createElement("canvas");
		canvas.width = videoEl.videoWidth;
		canvas.height = videoEl.videoHeight;
		canvas.getContext("2d").drawImage(videoEl, 0, 0, canvas.width, canvas.height);
		return canvas.toDataURL("image/jpeg", 0.85);
	};

	ns.startCamera = function () {
		return navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
	};

	ns.stopCamera = function (stream) {
		if (stream) stream.getTracks().forEach((t) => t.stop());
	};
})(laundry_cloud.face_capture);
