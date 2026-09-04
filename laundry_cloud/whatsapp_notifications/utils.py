# Copyright (c) 2026, Laundry Cloud and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _


def get_settings():
	return frappe.get_cached_doc("WhatsApp Settings")


def normalize_mobile_no(mobile_no):
	"""Meta's Cloud API wants digits only (country code + number, no +/spaces)."""
	if not mobile_no:
		return None
	digits = re.sub(r"\D", "", mobile_no)
	return digits or None


def send_whatsapp_message(mobile_no, message, user=None, reference_doctype=None, reference_name=None):
	"""Queue a WhatsApp text message for background delivery.

	Safe to call from doc events / schedulers: it never raises, it just logs
	a Failed row if something goes wrong so a bad number or expired token
	can't break the request that triggered it.
	"""
	mobile_no = normalize_mobile_no(mobile_no)
	if not mobile_no:
		return None

	settings = get_settings()
	if settings.message_footer:
		message = f"{message}\n\n{settings.message_footer}"

	log = frappe.get_doc(
		{
			"doctype": "WhatsApp Notification Log",
			"user": user or frappe.session.user,
			"mobile_no": mobile_no,
			"message": message,
			"reference_doctype": reference_doctype,
			"reference_name": reference_name,
			"status": "Queued",
		}
	).insert(ignore_permissions=True)

	frappe.enqueue(
		"laundry_cloud.whatsapp_notifications.utils.deliver_whatsapp_message",
		queue="short",
		enqueue_after_commit=True,
		log_name=log.name,
	)
	return log.name


def deliver_whatsapp_message(log_name):
	log = frappe.get_doc("WhatsApp Notification Log", log_name)
	settings = get_settings()

	if not settings.enabled:
		log.db_set({"status": "Failed", "error": "WhatsApp Notifications are disabled."})
		return

	try:
		if settings.provider == "Meta WhatsApp Cloud API":
			_send_via_meta_cloud_api(settings, log.mobile_no, log.message)
		else:
			raise frappe.ValidationError(_("Unsupported WhatsApp provider: {0}").format(settings.provider))

		log.db_set({"status": "Sent", "sent_on": frappe.utils.now_datetime(), "error": None})
	except Exception:
		error = frappe.get_traceback()
		log.db_set({"status": "Failed", "error": error})
		frappe.log_error(title="WhatsApp message delivery failed", message=error)


def _send_via_meta_cloud_api(settings, mobile_no, message):
	import requests

	access_token = settings.get_password("access_token")
	url = f"https://graph.facebook.com/{settings.api_version}/{settings.phone_number_id}/messages"
	payload = {
		"messaging_product": "whatsapp",
		"to": mobile_no,
		"type": "text",
		"text": {"preview_url": False, "body": message},
	}
	headers = {
		"Authorization": f"Bearer {access_token}",
		"Content-Type": "application/json",
	}

	response = requests.post(url, json=payload, headers=headers, timeout=15)
	if not response.ok:
		frappe.throw(
			_("WhatsApp API request failed ({0}): {1}").format(response.status_code, response.text)
		)
