import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


class EmployeeFaceProfile(Document):
	def validate(self):
		if not self.enrolled_on:
			self.enrolled_on = now_datetime()
		if not self.enrolled_by:
			self.enrolled_by = frappe.session.user
