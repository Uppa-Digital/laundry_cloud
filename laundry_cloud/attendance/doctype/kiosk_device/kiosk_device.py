import frappe
from frappe.model.document import Document


class KioskDevice(Document):
	def validate(self):
		self.check_user_is_restricted()

	def check_user_is_restricted(self):
		"""Warn (don't block) if the device's user isn't actually locked
		down, since that's the whole point of the kiosk role separation."""
		if not self.user:
			return

		user_type = frappe.db.get_value("User", self.user, "user_type")
		if user_type == "System User":
			frappe.msgprint(
				"This device's user is a System User with Desk access. For "
				"a shared kiosk, use a Website User with only the "
				"'Attendance Kiosk' role so the device cannot see staff data "
				"or the admin UI.",
				indicator="orange",
				alert=True,
			)
