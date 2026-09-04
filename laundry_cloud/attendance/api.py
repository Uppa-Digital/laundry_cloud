import frappe
from frappe import _
from frappe.utils import now_datetime

from laundry_cloud.attendance import utils

MANAGER_ROLES = {"System Manager", "Attendance Manager", "HR Manager"}


def get_employee_for_user(user=None):
	user = user or frappe.session.user
	employee = frappe.db.get_value(
		"Employee",
		{"user_id": user, "status": "Active"},
		["name", "employee_name"],
		as_dict=True,
	)
	return employee


def has_manager_role(user=None):
	roles = set(frappe.get_roles(user or frappe.session.user))
	return bool(roles & MANAGER_ROLES)


def get_settings():
	return frappe.get_cached_doc("Attendance Settings")


def get_last_log(employee, before=None):
	filters = {"employee": employee}
	if before:
		filters["time"] = ["<", before]
	logs = frappe.get_all(
		"Attendance Checkin",
		filters=filters,
		fields=["log_type", "time"],
		order_by="time desc",
		limit=1,
	)
	return logs[0] if logs else None


@frappe.whitelist()
def get_kiosk_context():
	"""Everything the personal (self-service, logged in as yourself) kiosk
	page needs to render for the current user: their Employee record,
	enrollment status, and their last recorded log."""
	employee = get_employee_for_user()
	if not employee:
		frappe.throw(_("No active Employee record is linked to your user account."))

	face_enrolled = bool(
		frappe.db.exists(
			"Employee Face Profile", {"employee": employee.name, "is_active": 1}
		)
	)

	last_log = get_last_log(employee.name)

	return {
		"employee": employee.name,
		"employee_name": employee.employee_name,
		"face_enrolled": face_enrolled,
		"last_log": last_log,
	}


@frappe.whitelist()
def enroll_face(descriptor, image, employee=None):
	"""Store (or replace) the reference face descriptor for an employee.
	Employees may enroll themselves; enrolling someone else requires a
	manager role. This always runs under a real, individually-authenticated
	login — never from a shared kiosk session — since it establishes the
	ground truth identity used for later 1:N recognition."""
	descriptor = frappe.parse_json(descriptor)
	utils.validate_descriptor(descriptor)

	target_employee = employee
	if target_employee:
		if not has_manager_role():
			frappe.throw(_("Not permitted to enroll another employee's face."))
		if not frappe.db.exists("Employee", target_employee):
			frappe.throw(_("Employee {0} not found.").format(target_employee))
	else:
		self_employee = get_employee_for_user()
		if not self_employee:
			frappe.throw(_("No active Employee record is linked to your user account."))
		target_employee = self_employee.name

	profile_name = frappe.db.exists("Employee Face Profile", {"employee": target_employee})
	if profile_name:
		profile = frappe.get_doc("Employee Face Profile", profile_name)
	else:
		profile = frappe.new_doc("Employee Face Profile")
		profile.employee = target_employee

	profile.descriptor = frappe.as_json(descriptor)
	profile.is_active = 1
	profile.enrolled_on = now_datetime()
	profile.enrolled_by = frappe.session.user
	profile.save(ignore_permissions=True)

	if image:
		file_url = utils.save_base64_image(
			image, "face-enrollment", "Employee Face Profile", profile.name, "reference_image"
		)
		frappe.db.set_value("Employee Face Profile", profile.name, "reference_image", file_url)

	return {"status": "ok", "employee": target_employee}


def build_duplicate_remark(employee, log_type, time):
	last_log = get_last_log(employee, before=time)
	if not last_log:
		if log_type == "OUT":
			return "Note: no earlier Check In found for this employee today or before."
		return None
	if last_log.log_type == log_type:
		return f"Note: the previous recorded action for this employee was also {log_type}."
	return None


def create_attendance_checkin(
	*,
	employee,
	log_type,
	latitude,
	longitude,
	face_match_status,
	face_match_score,
	kiosk_device=None,
	device_info=None,
):
	settings = get_settings()
	time = now_datetime()

	location_status = "Unknown"
	office_location = None
	distance = None
	pinned_location = None

	if kiosk_device:
		pinned_location = frappe.db.get_value("Kiosk Device", kiosk_device, "office_location")

	nearest, nearest_distance = utils.resolve_office_and_distance(
		latitude, longitude, pinned_location=pinned_location
	)
	if nearest:
		office_location = nearest.name
		distance = nearest_distance
		radius = nearest.allowed_radius_meters or settings.default_radius_meters
		location_status = "Within Range" if nearest_distance <= radius else "Out of Range"

	if (
		settings.enforce_geofence
		and settings.block_checkin_out_of_range
		and location_status == "Out of Range"
	):
		frappe.throw(
			_("You are {0}m away from {1}, which is outside the allowed range.").format(
				round(distance or 0), office_location
			)
		)

	if (
		settings.enforce_face_match
		and settings.block_checkin_on_face_mismatch
		and face_match_status in ("Not Verified", "No Profile", "No Face Detected")
	):
		frappe.throw(_("Face verification failed ({0}).").format(face_match_status))

	checkin = frappe.new_doc("Attendance Checkin")
	checkin.employee = employee
	checkin.log_type = log_type
	checkin.time = time
	checkin.latitude = latitude
	checkin.longitude = longitude
	checkin.office_location = office_location
	checkin.distance_from_office = distance
	checkin.location_status = location_status
	checkin.face_match_score = face_match_score
	checkin.face_match_status = face_match_status
	checkin.kiosk_device = kiosk_device
	checkin.device_info = device_info
	checkin.ip_address = getattr(frappe.local, "request_ip", None)
	checkin.remarks = build_duplicate_remark(employee, log_type, time)
	checkin.insert(ignore_permissions=True)

	synced_checkin = None
	if settings.sync_to_employee_checkin:
		synced_checkin = sync_to_employee_checkin(checkin)

	return checkin, {
		"location_status": location_status,
		"office_location": office_location,
		"distance_from_office": distance,
		"employee_checkin": synced_checkin,
	}


@frappe.whitelist()
def mark_attendance(latitude, longitude, log_type, descriptor=None, image=None):
	"""Self-service check-in/out: the logged-in user marks attendance for
	themselves (1:1 face verification against their own enrolled profile).
	Used by the personal Attendance Kiosk desk page."""
	employee = get_employee_for_user()
	if not employee:
		frappe.throw(_("No active Employee record is linked to your user account."))

	if log_type not in ("IN", "OUT"):
		frappe.throw(_("Invalid log type."))

	latitude = float(latitude)
	longitude = float(longitude)
	descriptor = frappe.parse_json(descriptor) if descriptor else None
	settings = get_settings()

	face_match_status = "No Profile"
	face_match_score = None

	if descriptor is None:
		face_match_status = "No Face Detected"
	else:
		utils.validate_descriptor(descriptor)
		profile_name = frappe.db.exists(
			"Employee Face Profile", {"employee": employee.name, "is_active": 1}
		)
		if profile_name:
			stored_descriptor = frappe.parse_json(
				frappe.db.get_value("Employee Face Profile", profile_name, "descriptor")
			)
			face_match_score = utils.euclidean_distance(descriptor, stored_descriptor)
			face_match_status = (
				"Verified" if face_match_score <= settings.face_match_threshold else "Not Verified"
			)

	checkin, result = create_attendance_checkin(
		employee=employee.name,
		log_type=log_type,
		latitude=latitude,
		longitude=longitude,
		face_match_status=face_match_status,
		face_match_score=face_match_score,
		device_info=frappe.request.headers.get("User-Agent") if frappe.request else None,
	)

	if image:
		file_url = utils.save_base64_image(
			image, "attendance-selfie", "Attendance Checkin", checkin.name, "selfie_image"
		)
		checkin.db_set("selfie_image", file_url, update_modified=False)

	return {
		"status": "ok",
		"name": checkin.name,
		"log_type": log_type,
		"time": checkin.time,
		"face_match_status": face_match_status,
		"face_match_score": face_match_score,
		**result,
	}


def sync_to_employee_checkin(checkin):
	"""Best-effort: mirror this event into the standard Frappe HR
	'Employee Checkin' doctype so shift/attendance/payroll automation
	picks it up. Never blocks the kiosk flow if it fails or the doctype
	isn't installed / has a different schema than expected."""
	if not frappe.db.exists("DocType", "Employee Checkin"):
		return None

	try:
		meta = frappe.get_meta("Employee Checkin")
		doc = frappe.new_doc("Employee Checkin")
		doc.employee = checkin.employee
		doc.log_type = checkin.log_type
		doc.time = checkin.time

		for fieldname, value in (
			("latitude", checkin.latitude),
			("longitude", checkin.longitude),
			("geolocation", checkin.geolocation),
		):
			if meta.has_field(fieldname) and value is not None:
				doc.set(fieldname, value)

		doc.insert(ignore_permissions=True)

		checkin.db_set("employee_checkin", doc.name, update_modified=False)
		if meta.has_field("attendance") and doc.get("attendance"):
			checkin.db_set("attendance", doc.attendance, update_modified=False)

		return doc.name
	except Exception:
		frappe.log_error(
			title="Attendance Checkin -> Employee Checkin sync failed",
			message=frappe.get_traceback(),
		)
		return None
