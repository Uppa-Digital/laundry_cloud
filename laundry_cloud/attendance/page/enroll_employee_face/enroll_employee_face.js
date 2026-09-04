frappe.pages["enroll-employee-face"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Enroll Employee Face",
		single_column: true,
	});

	new EnrollEmployeeFace(page);
};

// HR/Attendance Manager tool: call each employee up to this device (once,
// during onboarding or a "photo day"), pick them from the list, capture
// their face, save. No personal login is required for the employee —
// this is the primary way most staff get enrolled, since they'll only
// ever use the shared kiosk (/kiosk) to check in/out afterwards.

class EnrollEmployeeFace {
	constructor(page) {
		this.page = page;
		this.stream = null;
		this.unenrolled = [];

		this.render();
		this.init();
	}

	render() {
		this.page.main.html(`
			<div class="enroll-employee-face">
				<div class="row">
					<div class="col-md-5">
						<div class="camera-box text-center">
							<video id="eef-video" autoplay muted playsinline
								style="width:100%; max-width:420px; border-radius:8px; background:#111;"></video>
						</div>
						<div class="text-muted small" style="margin-top:8px;">
							Camera: <span id="eef-status-camera">initializing...</span> ·
							Face recognition: <span id="eef-status-model">loading models...</span>
						</div>
					</div>
					<div class="col-md-7">
						<div id="eef-employee-field"></div>
						<button class="btn btn-primary" id="eef-btn-capture" disabled style="margin-top: 14px;">
							Capture &amp; Save Face
						</button>
						<div id="eef-result" style="margin-top: 16px;"></div>

						<hr>

						<div style="display:flex; align-items:center; justify-content:space-between;">
							<h5 style="margin:0;">Not yet enrolled</h5>
							<span class="text-muted small" id="eef-remaining-count"></span>
						</div>
						<div id="eef-unenrolled-list" style="max-height: 320px; overflow-y: auto; margin-top: 10px;"></div>
					</div>
				</div>
			</div>
		`);

		this.$video = this.page.main.find("#eef-video");
		this.$status_camera = this.page.main.find("#eef-status-camera");
		this.$status_model = this.page.main.find("#eef-status-model");
		this.$btn_capture = this.page.main.find("#eef-btn-capture");
		this.$result = this.page.main.find("#eef-result");
		this.$unenrolled_list = this.page.main.find("#eef-unenrolled-list");
		this.$remaining_count = this.page.main.find("#eef-remaining-count");

		this.employee_field = frappe.ui.form.make_control({
			parent: this.page.main.find("#eef-employee-field"),
			df: {
				fieldtype: "Link",
				fieldname: "employee",
				label: __("Employee"),
				options: "Employee",
				reqd: 1,
				get_query: () => ({ filters: { status: "Active" } }),
			},
			render_input: true,
		});
		this.employee_field.refresh();

		this.$btn_capture.on("click", () => this.handle_capture());
	}

	async init() {
		await Promise.all([this.start_camera(), this.load_face_api(), this.load_unenrolled()]);
		this.maybe_enable_button();
		this.apply_route_prefill();
	}

	apply_route_prefill() {
		// Set via the Employee form's "Enroll Attendance Face" button.
		const employee = frappe.route_options && frappe.route_options.employee;
		if (employee) {
			this.employee_field.set_value(employee);
			frappe.route_options = null;
		}
	}

	start_camera() {
		return laundry_cloud.face_capture
			.startCamera()
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
		return laundry_cloud.face_capture
			.loadModels()
			.then(() => this.$status_model.text("ready"))
			.catch((err) => {
				this.$status_model.text("failed to load (" + err.message + ")");
			});
	}

	maybe_enable_button() {
		if (this.stream && laundry_cloud.face_capture.isReady()) {
			this.$btn_capture.prop("disabled", false);
		}
	}

	load_unenrolled() {
		return frappe.call({ method: "laundry_cloud.attendance.api.get_unenrolled_employees" }).then((r) => {
			this.unenrolled = r.message || [];
			this.render_unenrolled_list();
		});
	}

	render_unenrolled_list() {
		this.$remaining_count.text(`${this.unenrolled.length} remaining`);

		if (!this.unenrolled.length) {
			this.$unenrolled_list.html(
				`<div class="text-muted small">Everyone active is enrolled. 🎉</div>`
			);
			return;
		}

		this.$unenrolled_list.html(
			this.unenrolled
				.map(
					(emp) => `
						<div class="eef-row" data-employee="${frappe.utils.escape_html(emp.name)}"
							style="padding:8px 10px; border-radius:6px; cursor:pointer; display:flex; justify-content:space-between;">
							<span>${frappe.utils.escape_html(emp.employee_name)}</span>
							<span class="text-muted small">${frappe.utils.escape_html(emp.department || emp.designation || "")}</span>
						</div>
					`
				)
				.join("")
		);

		this.$unenrolled_list.find(".eef-row").on("mouseenter", function () {
			$(this).css("background", "#f5f7fa");
		});
		this.$unenrolled_list.find(".eef-row").on("mouseleave", function () {
			$(this).css("background", "");
		});
		this.$unenrolled_list.find(".eef-row").on("click", (e) => {
			const employee = $(e.currentTarget).attr("data-employee");
			this.employee_field.set_value(employee);
		});
	}

	async handle_capture() {
		const employee = this.employee_field.get_value();
		if (!employee) {
			frappe.msgprint(__("Select an employee first."));
			return;
		}

		this.$btn_capture.prop("disabled", true);
		this.$result.empty();

		try {
			frappe.show_alert({ message: __("Detecting face..."), indicator: "blue" });
			const detection = await laundry_cloud.face_capture.detectFace(this.$video.get(0));
			if (!detection) {
				frappe.msgprint({
					title: __("No Face Detected"),
					message: __("Ask them to look directly at the camera and try again."),
					indicator: "orange",
				});
				return;
			}

			const image = laundry_cloud.face_capture.captureSnapshot(this.$video.get(0));

			await frappe.call({
				method: "laundry_cloud.attendance.api.enroll_face",
				args: {
					employee: employee,
					descriptor: JSON.stringify(Array.from(detection.descriptor)),
					image: image,
				},
				freeze: true,
				freeze_message: __("Saving face profile..."),
			});

			frappe.show_alert({ message: __("Face enrolled successfully"), indicator: "green" });
			this.$result.html(
				`<div class="alert alert-success">Enrolled <b>${frappe.utils.escape_html(
					employee
				)}</b>. Ready for the next employee.</div>`
			);
			this.employee_field.set_value("");
			this.load_unenrolled();
		} catch (err) {
			frappe.msgprint({
				title: __("Enrollment failed"),
				message: err.message || String(err),
				indicator: "red",
			});
		} finally {
			this.$btn_capture.prop("disabled", false);
		}
	}
}
