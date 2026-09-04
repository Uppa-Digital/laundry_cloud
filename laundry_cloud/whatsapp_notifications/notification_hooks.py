# Copyright (c) 2026, Laundry Cloud and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from laundry_cloud.whatsapp_notifications.utils import get_settings, send_whatsapp_message

# Maps Frappe's core "Notification Log" type to the corresponding toggle on
# WhatsApp Settings. Types not listed here (e.g. "Alert") are left alone.
NOTIFICATION_TYPE_SETTING = {
	"Mention": "notify_on_mention",
	"Assignment": "notify_on_assignment",
	"Share": "notify_on_share",
	"Energy Point": "notify_on_energy_point",
}


def on_notification_log_insert(doc, method=None):
	"""Forward eligible in-app notifications to the recipient's WhatsApp."""
	settings = get_settings()
	if not settings.enabled:
		return

	setting_field = NOTIFICATION_TYPE_SETTING.get(doc.type)
	if not setting_field or not settings.get(setting_field):
		return

	if not doc.for_user:
		return

	user = _get_whatsapp_eligible_user(doc.for_user)
	if not user:
		return

	send_whatsapp_message(
		user.mobile_no,
		_build_message(doc),
		user=doc.for_user,
		reference_doctype=doc.document_type,
		reference_name=doc.document_name,
	)


def send_pending_action_reminders():
	"""Scheduled job: nudge users who still have open ToDos waiting on them."""
	settings = get_settings()
	if not settings.enabled or not settings.reminder_enabled:
		return

	frequency_hours = settings.reminder_frequency_hours or 24

	rows = frappe.db.sql(
		"""
		select allocated_to as user, count(*) as count
		from `tabToDo`
		where status = 'Open' and ifnull(allocated_to, '') != ''
		group by allocated_to
		""",
		as_dict=True,
	)

	for row in rows:
		if not row.count:
			continue

		user = _get_whatsapp_eligible_user(row.user)
		if not user:
			continue

		cache_key = f"whatsapp_reminder_last_sent:{row.user}"
		if frappe.cache().get_value(cache_key):
			continue

		message = _("Hi, you have {0} pending task(s) waiting for your action.").format(row.count)
		send_whatsapp_message(user.mobile_no, message, user=row.user, reference_doctype="ToDo")
		frappe.cache().set_value(cache_key, 1, expires_in_sec=frequency_hours * 3600)


def _get_whatsapp_eligible_user(user):
	if not user:
		return None

	user_row = frappe.db.get_value(
		"User",
		user,
		["mobile_no", "enable_whatsapp_notifications", "enabled"],
		as_dict=True,
	)
	if not user_row or not user_row.enabled:
		return None
	if not user_row.enable_whatsapp_notifications or not user_row.mobile_no:
		return None
	return user_row


def _build_message(notification_log):
	lines = [frappe.utils.strip_html(notification_log.subject or "").strip()]

	if notification_log.document_type and notification_log.document_name:
		try:
			lines.append(frappe.utils.get_url_to_form(notification_log.document_type, notification_log.document_name))
		except Exception:
			pass

	return "\n".join(line for line in lines if line)
