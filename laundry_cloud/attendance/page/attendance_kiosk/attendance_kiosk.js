const FACE_API_SRC = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const FACE_API_MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";
const FACE_DETECT_OPTIONS_SCORE_THRESHOLD = 0.5;

frappe.pages["attendance-kiosk"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "My Attendance",
		single_column: true,
	});

	new AttendanceKiosk(page);
};

// This is the personal, self-service page: you sign in as yourself and
// check yourself in/out (1:1 face verification against your own enrolled
// profile). It's also where you enroll your face in the first place.
// For a shared device mounted at a physical location where any staff
// member can walk up and check in/out (1:N face identification, no
// per-person login), see the installable kiosk app at /kiosk.

class AttendanceKiosk {
	constructor(page) {
		this.page = page;
		this.stream = null;
		this.models_loaded = false;
		this.context = null;

		this.render();
		this.init();
	}

	render() {
		this.page.main.html(`
			<div class="attendance-kiosk">
				<div class="row">
					<div class="col-md-6">
						<div class="camera-box text-center">
							<video id="ak-video" autoplay muted playsinline
								style="width:100%; max-width:480px; border-radius:8px; background:#111;"></video>
							<canvas id="ak-canvas" style="display:none;"></canvas>
						</div>
					</div>
					<div class="col-md-6">
						<div class="ak-status-panel">
							<h4 id="ak-employee-name">Loading...</h4>
							<div id="ak-status-list" class="text-muted small">
								<div>Camera: <span id="ak-status-camera">initializing...</span></div>
								<div>Face recognition: <span id="ak-status-model">loading models...</span></div>
								<div>Location: <span id="ak-status-geo">waiting...</span></div>
							</div>
							<div class="ak-actions" style="margin-top: 20px;">
								<button class="btn btn-success" id="ak-btn-in" disabled style="min-width: 140px;">
									Check In
								</button>
								<button class="btn btn-danger" id="ak-btn-out" disabled style="min-width: 140px; margin-left: 10px;">
									Check Out
								</button>
								<button class="btn btn-default" id="ak-btn-enroll" style="margin-left: 10px;">
									Enroll My Face
								</button>
							</div>
							<div id="ak-result" style="margin-top: 20px;"></div>
						</div>
					</div>
				</div>
			</div>
		`);

		this.$video = this.page.main.find("#ak-video");
		this.$canvas = this.page.main.find("#ak-canvas");
		this.$employee_name = this.page.main.find("#ak-employee-name");
		this.$status_camera = this.page.main.find("#ak-status-camera");
		this.$status_model = this.page.main.find("#ak-status-model");
		this.$status_geo = this.page.main.find("#ak-status-geo");
		this.$btn_in = this.page.main.find("#ak-btn-in");
		this.$btn_out = this.page.main.find("#ak-btn-out");
		this.$btn_enroll = this.page.main.find("#ak-btn-enroll");
		this.$result = this.page.main.find("#ak-result");

		this.$btn_in.on("click", () => this.handle_mark_attendance("IN"));
		this.$btn_out.on("click", () => this.handle_mark_attendance("OUT"));
		this.$btn_enroll.on("click", () => this.open_enroll_dialog());
	}

	async init() {
		this.load_kiosk_context();
		await Promise.all([this.start_camera(), this.load_face_api()]);
		this.maybe_enable_button();
	}

	load_kiosk_context() {
		frappe.call({
			method: "laundry_cloud.attendance.api.get_kiosk_context",
			callback: (r) => {
				if (!r.message) return;
				this.context = r.message;
				this.$employee_name.text(this.context.employee_name);
				if (this.context.last_log) {
					this.$status_geo.attr(
						"title",
						`Last recorded: ${this.context.last_log.log_type} at ${this.context.last_log.time}`
					);
				}
				if (!this.context.face_enrolled) {
					this.$result.html(
						`<div class="alert alert-warning">You have not enrolled your face yet. Click "Enroll My Face" first.</div>`
					);
				}
			},
			error: () => {
				this.$employee_name.text("No employee record linked to your account");
			},
		});
	}

	start_camera() {
		return navigator.mediaDevices
			.getUserMedia({ video: { facingMode: "user" }, audio: false })
			.then((stream) => {
				this.stream = stream;
				this.$video.get(0).srcObject = stream;
				this.$status_camera.text("ready");
			})
			.catch((err) => {
				this.$status_camera.text("unavailable (" + err.message + ")");
			});
	}

	load_face_api() {
		return this.load_script(FACE_API_SRC)
			.then(() =>
				Promise.all([
					faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL),
					faceapi.nets.faceLandmark68Net.loadFromUri(FACE_API_MODEL_URL),
					faceapi.nets.faceRecognitionNet.loadFromUri(FACE_API_MODEL_URL),
				])
			)
			.then(() => {
				this.models_loaded = true;
				this.$status_model.text("ready");
			})
			.catch((err) => {
				this.$status_model.text("failed to load (" + err.message + ")");
			});
	}

	load_script(src) {
		return new Promise((resolve, reject) => {
			if (document.querySelector(`script[src="${src}"]`)) {
				resolve();
				return;
			}
			const script = document.createElement("script");
			script.src = src;
			script.onload = resolve;
			script.onerror = () => reject(new Error("could not load " + src));
			document.head.appendChild(script);
		});
	}

	maybe_enable_button() {
		if (this.stream && this.models_loaded) {
			this.$btn_in.prop("disabled", false);
			this.$btn_out.prop("disabled", false);
		}
	}

	get_position() {
		this.$status_geo.text("locating...");
		return new Promise((resolve, reject) => {
			if (!navigator.geolocation) {
				reject(new Error("Geolocation is not supported by this browser."));
				return;
			}
			navigator.geolocation.getCurrentPosition(
				(pos) => {
					this.$status_geo.text(
						`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)} ` +
							`(±${Math.round(pos.coords.accuracy)}m)`
					);
					resolve(pos.coords);
				},
				(err) => {
					this.$status_geo.text("failed (" + err.message + ")");
					reject(err);
				},
				{ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
			);
		});
	}

	async detect_face() {
		const options = new faceapi.TinyFaceDetectorOptions({
			scoreThreshold: FACE_DETECT_OPTIONS_SCORE_THRESHOLD,
		});
		return await faceapi
			.detectSingleFace(this.$video.get(0), options)
			.withFaceLandmarks()
			.withFaceDescriptor();
	}

	capture_snapshot() {
		const video = this.$video.get(0);
		const canvas = this.$canvas.get(0);
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
		return canvas.toDataURL("image/jpeg", 0.85);
	}

	async handle_mark_attendance(log_type) {
		this.$btn_in.prop("disabled", true);
		this.$btn_out.prop("disabled", true);
		this.$result.empty();

		try {
			frappe.show_alert({ message: __("Detecting face..."), indicator: "blue" });
			const detection = await this.detect_face();
			if (!detection) {
				frappe.msgprint({
					title: __("No Face Detected"),
					message: __("Please position your face clearly in front of the camera and try again."),
					indicator: "orange",
				});
				return;
			}

			const image = this.capture_snapshot();
			const coords = await this.get_position();

			frappe.call({
				method: "laundry_cloud.attendance.api.mark_attendance",
				args: {
					latitude: coords.latitude,
					longitude: coords.longitude,
					log_type: log_type,
					descriptor: JSON.stringify(Array.from(detection.descriptor)),
					image: image,
				},
				freeze: true,
				freeze_message: __("Recording attendance..."),
				callback: (r) => {
					if (!r.message) return;
					this.show_result(r.message);
					this.load_kiosk_context();
				},
			});
		} catch (err) {
			frappe.msgprint({
				title: __("Could not record attendance"),
				message: err.message || String(err),
				indicator: "red",
			});
		} finally {
			this.$btn_in.prop("disabled", false);
			this.$btn_out.prop("disabled", false);
		}
	}

	show_result(result) {
		const location_color = result.location_status === "Within Range" ? "green" : "orange";
		const face_color = result.face_match_status === "Verified" ? "green" : "orange";

		this.$result.html(`
			<div class="alert alert-${result.location_status === "Within Range" ? "success" : "warning"}">
				<b>${result.log_type === "OUT" ? "Checked Out" : "Checked In"}</b> at
				${frappe.datetime.str_to_user(result.time)}
				<br>
				Location:
				<span class="indicator ${location_color}">${result.location_status}</span>
				${result.office_location ? `(${Math.round(result.distance_from_office)}m from ${result.office_location})` : ""}
				<br>
				Face match:
				<span class="indicator ${face_color}">${result.face_match_status}</span>
			</div>
		`);
	}

	open_enroll_dialog() {
		if (!this.stream || !this.models_loaded) {
			frappe.msgprint(__("Camera and face recognition must be ready before enrolling."));
			return;
		}

		const dialog = new frappe.ui.Dialog({
			title: __("Enroll My Face"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "preview",
					options: `<p>${__(
						"Look directly at the camera and click Capture. This reference is used to verify your identity on every check-in/check-out."
					)}</p>`,
				},
			],
			primary_action_label: __("Capture & Save"),
			primary_action: async () => {
				const $btn = dialog.get_primary_btn().prop("disabled", true).text(__("Detecting..."));
				try {
					const detection = await this.detect_face();
					if (!detection) {
						frappe.show_alert({ message: __("No face detected, try again"), indicator: "orange" });
						return;
					}
					const image = this.capture_snapshot();
					frappe.call({
						method: "laundry_cloud.attendance.api.enroll_face",
						args: {
							descriptor: JSON.stringify(Array.from(detection.descriptor)),
							image: image,
						},
						freeze: true,
						freeze_message: __("Saving face profile..."),
						callback: () => {
							frappe.show_alert({ message: __("Face enrolled successfully"), indicator: "green" });
							dialog.hide();
							this.load_kiosk_context();
						},
					});
				} catch (err) {
					frappe.msgprint({
						title: __("Enrollment failed"),
						message: err.message || String(err),
						indicator: "red",
					});
				} finally {
					$btn.prop("disabled", false).text(__("Capture & Save"));
				}
			},
		});
		dialog.show();
	}
}
