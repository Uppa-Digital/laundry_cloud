# Copyright (c) 2026, Laundry Cloud and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class WhatsAppSettings(Document):
	def validate(self):
		if self.enabled and self.provider == "Meta WhatsApp Cloud API":
			if not self.phone_number_id or not self.access_token:
				frappe.throw(
					_("Phone Number ID and Access Token are required to enable WhatsApp Notifications.")
				)

	@frappe.whitelist()
	def send_test_message(self):
		frappe.only_for("System Manager")

		if not self.test_mobile_no:
			frappe.throw(_("Please enter a Test Mobile No first."))

		from laundry_cloud.whatsapp_notifications.utils import send_whatsapp_message

		send_whatsapp_message(
			self.test_mobile_no,
			_("This is a test message from Laundry Cloud WhatsApp Notifications.") ,
		)
		frappe.msgprint(_("Test message queued. Check the WhatsApp Notification Log for delivery status."))
