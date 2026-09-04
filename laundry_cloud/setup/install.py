import frappe


def after_install():
	"""Runs once, right after the app is installed on a site."""
	create_role("Attendance Manager", desk_access=1)
	create_role("Attendance Kiosk", desk_access=0)
	create_default_attendance_settings()


def create_role(role_name, desk_access=0):
	if frappe.db.exists("Role", role_name):
		return

	role = frappe.new_doc("Role")
	role.role_name = role_name
	role.desk_access = desk_access
	role.insert(ignore_permissions=True)


def create_default_attendance_settings():
	if not frappe.db.exists("DocType", "Attendance Settings"):
		return

	settings = frappe.get_single("Attendance Settings")
	if not settings.get("default_radius_meters"):
		settings.default_radius_meters = 150
	if settings.get("enforce_geofence") is None:
		settings.enforce_geofence = 1
	if settings.get("enforce_face_match") is None:
		settings.enforce_face_match = 1
	if not settings.get("face_match_threshold"):
		settings.face_match_threshold = 0.6
	settings.save(ignore_permissions=True)
