import frappe


def get_context(context):
	# Fully custom, standalone page (no website navbar/footer, no desk
	# chrome) so it can be installed as a full-screen PWA kiosk.
	context.no_cache = 1

	is_logged_in = frappe.session.user != "Guest"
	context.is_logged_in = is_logged_in
	context.csrf_token = ""

	if is_logged_in:
		session_data = getattr(frappe.local.session, "data", None) or {}
		context.csrf_token = session_data.get("csrf_token", "")

	return context
