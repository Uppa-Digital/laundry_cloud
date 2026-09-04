import frappe
from frappe.model.document import Document


class OfficeLocation(Document):
	def validate(self):
		self.set_geolocation()

	def set_geolocation(self):
		if self.latitude is None or self.longitude is None:
			return

		self.geolocation = frappe.as_json(
			{
				"type": "FeatureCollection",
				"features": [
					{
						"type": "Feature",
						"properties": {},
						"geometry": {
							"type": "Point",
							"coordinates": [self.longitude, self.latitude],
						},
					}
				],
			}
		)
