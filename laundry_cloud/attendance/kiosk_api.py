import frappe
from frappe import _
from frappe.utils import get_datetime, now_datetime

from laundry_cloud.attendance import utils
from laundry_cloud.attendance.api import create_attendance_checkin, get_settings

# A shared kiosk device account (role "Attendance Kiosk") has zero doctype
# permissions by design; managers can also hit these endpoints, mainly to
# preview/test the kiosk flow from the desk.
KIOSK_ROLES = {"Attendance Kiosk", "System Manager", "Attendance Manager"}

# If the best and second-best face matches are both within the match
# threshold and closer to each other than this margin, treat the result as
# ambiguous rather than risk mis-identifying someone (e.g. similar-looking
# staff, twins, poor lighting).
AMBIGUITY_MARGIN = 0.08


def require_kiosk_access():
	if frappe.session.user == "Guest":
		frappe.throw(_("Please sign in on this device first."), frappe.AuthenticationError)
	roles = set(frappe.get_roles(frappe.session.user))
	if not (roles & KIOSK_ROLES):
		frappe.throw(
			_("This account is not authorized as an Attendance Kiosk device."), frappe.PermissionError
		)


def get_kiosk_device():
	return frappe.db.get_value(
		"Kiosk Device",
		{"user": frappe.session.user, "is_active": 1},
		["name", "device_name", "office_location"],
		as_dict=True,
	)


def touch_device(device_name):
	if not device_name:
		return
	frappe.db.set_value(
		"Kiosk Device",
		device_name,
		{"last_seen": now_datetime(), "last_seen_ip": getattr(frappe.local, "request_ip", None)},
		update_modified=False,
	)


@frappe.whitelist()
def get_device_context():
	"""Bootstrap info for the kiosk page: which device/location this is,
	so the UI can show "Checking in at <location>" and know it's live."""
	require_kiosk_access()
	device = get_kiosk_device()

	office_location = None
	if device and device.office_location:
		office_location = frappe.db.get_value(
			"Office Location", device.office_location, ["name", "location_name"], as_dict=True
		)

	if device:
		touch_device(device.name)

	return {
		"device": device.name if device else None,
		"device_name": device.device_name if device else None,
		"office_location": office_location,
		# A manager hitting this from the desk (no Kiosk Device row for
		# their user) can still preview the flow; the UI should say so.
		"is_registered_device": bool(device),
	}


@frappe.whitelist()
def identify_and_mark_attendance(latitude, longitude, descriptor, image, log_type):
	"""Shared-kiosk check-in/out: identify WHO this is purely from their
	face (1:N match against every enrolled profile), then record the
	action the employee tapped (Check In / Check Out)."""
	require_kiosk_access()

	if log_type not in ("IN", "OUT"):
		frappe.throw(_("Invalid log type."))

	descriptor = frappe.parse_json(descriptor)
	utils.validate_descriptor(descriptor)
	latitude = float(latitude)
	longitude = float(longitude)

	device = get_kiosk_device()
	touch_device(device.name if device else None)

	settings = get_settings()

	profiles = frappe.get_all(
		"Employee Face Profile",
		filters={"is_active": 1},
		fields=["name", "employee", "employee_name", "descriptor"],
	)
	if not profiles:
		frappe.throw(
			_("No employees have enrolled their face yet. Ask an admin to enroll staff first.")
		)

	best_profile, best_distance, runner_up_distance = find_best_match(descriptor, profiles)

	threshold = settings.face_match_threshold
	recognized = best_profile is not None and best_distance <= threshold
	ambiguous = (
		recognized
		and runner_up_distance is not None
		and runner_up_distance <= threshold
		and (runner_up_distance - best_distance) < AMBIGUITY_MARGIN
	)

	if not recognized or ambiguous:
		log_unrecognized_attempt(
			device=device.name if device else None,
			log_type=log_type,
			image=image,
			latitude=latitude,
			longitude=longitude,
			closest_employee=best_profile.employee if best_profile else None,
			closest_distance=best_distance,
		)
		if ambiguous:
			frappe.throw(_("Could not confidently identify you. Please try again with clearer lighting."))
		frappe.throw(_("Face not recognized. Please try again, or ask an admin to enroll your face."))

	checkin, result = create_attendance_checkin(
		employee=best_profile.employee,
		log_type=log_type,
		latitude=latitude,
		longitude=longitude,
		face_match_status="Verified",
		face_match_score=best_distance,
		kiosk_device=device.name if device else None,
		device_info=frappe.request.headers.get("User-Agent") if frappe.request else None,
	)

	selfie_url = None
	if image:
		selfie_url = utils.save_base64_image(
			image, "attendance-selfie", "Attendance Checkin", checkin.name, "selfie_image"
		)
		checkin.db_set("selfie_image", selfie_url, update_modified=False)

	if not selfie_url:
		selfie_url = frappe.db.get_value(
			"Employee Face Profile",
			{"employee": best_profile.employee, "is_active": 1},
			"reference_image",
		)

	hours_since_in = None
	if log_type == "OUT":
		last_in = frappe.get_all(
			"Attendance Checkin",
			filters={
				"employee": best_profile.employee,
				"log_type": "IN",
				"time": ["<", checkin.time],
			},
			fields=["time"],
			order_by="time desc",
			limit=1,
		)
		if last_in:
			seconds = (get_datetime(checkin.time) - get_datetime(last_in[0].time)).total_seconds()
			if seconds > 0:
				hours_since_in = round(seconds / 3600, 2)

	return {
		"status": "ok",
		"name": checkin.name,
		"employee": best_profile.employee,
		"employee_name": best_profile.employee_name,
		"log_type": log_type,
		"time": checkin.time,
		"selfie": selfie_url,
		"hours_since_in": hours_since_in,
		**result,
	}


def find_best_match(descriptor, profiles):
	"""Return (best_profile, best_distance, runner_up_distance)."""
	best_profile = None
	best_distance = None
	runner_up_distance = None

	for profile in profiles:
		try:
			stored = frappe.parse_json(profile.descriptor)
			distance = utils.euclidean_distance(descriptor, stored)
		except Exception:
			continue

		if best_distance is None or distance < best_distance:
			runner_up_distance = best_distance
			best_distance = distance
			best_profile = profile
		elif runner_up_distance is None or distance < runner_up_distance:
			runner_up_distance = distance

	return best_profile, best_distance, runner_up_distance


def log_unrecognized_attempt(
	device, log_type, image, latitude, longitude, closest_employee, closest_distance
):
	"""Best-effort audit trail for security review; never blocks the kiosk
	flow if it fails for any reason."""
	try:
		attempt = frappe.new_doc("Kiosk Unrecognized Attempt")
		attempt.kiosk_device = device
		attempt.time = now_datetime()
		attempt.attempted_log_type = log_type
		attempt.latitude = latitude
		attempt.longitude = longitude
		attempt.closest_employee = closest_employee
		attempt.closest_distance = closest_distance
		attempt.insert(ignore_permissions=True)

		if image:
			file_url = utils.save_base64_image(
				image, "unrecognized-attempt", "Kiosk Unrecognized Attempt", attempt.name, "image"
			)
			attempt.db_set("image", file_url, update_modified=False)
	except Exception:
		frappe.log_error(
			title="Failed to log unrecognized kiosk attempt", message=frappe.get_traceback()
		)
