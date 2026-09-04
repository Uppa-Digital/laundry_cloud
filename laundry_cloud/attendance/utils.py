import base64
import binascii
import math
import re

import frappe

EARTH_RADIUS_METERS = 6371000
EXPECTED_DESCRIPTOR_LENGTH = 128


def haversine_distance_meters(lat1, lon1, lat2, lon2):
	"""Great-circle distance between two lat/lng points, in meters."""
	phi1, phi2 = math.radians(lat1), math.radians(lat2)
	d_phi = math.radians(lat2 - lat1)
	d_lambda = math.radians(lon2 - lon1)

	a = (
		math.sin(d_phi / 2) ** 2
		+ math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
	)
	c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
	return EARTH_RADIUS_METERS * c


def find_nearest_office_location(latitude, longitude):
	"""Return (office_location_doc_dict, distance_in_meters) for the closest
	active Office Location, or (None, None) if none are configured."""
	locations = frappe.get_all(
		"Office Location",
		filters={"is_active": 1},
		fields=["name", "latitude", "longitude", "allowed_radius_meters"],
	)
	if not locations:
		return None, None

	nearest = None
	nearest_distance = None
	for loc in locations:
		distance = haversine_distance_meters(latitude, longitude, loc.latitude, loc.longitude)
		if nearest_distance is None or distance < nearest_distance:
			nearest = loc
			nearest_distance = distance

	return nearest, nearest_distance


def euclidean_distance(descriptor_a, descriptor_b):
	if len(descriptor_a) != len(descriptor_b):
		frappe.throw("Face descriptor length mismatch.")

	total = 0.0
	for a, b in zip(descriptor_a, descriptor_b):
		total += (float(a) - float(b)) ** 2
	return math.sqrt(total)


def validate_descriptor(descriptor):
	if not isinstance(descriptor, list) or len(descriptor) != EXPECTED_DESCRIPTOR_LENGTH:
		frappe.throw(
			f"Invalid face descriptor. Expected a list of {EXPECTED_DESCRIPTOR_LENGTH} numbers."
		)
	for value in descriptor:
		if not isinstance(value, (int, float)):
			frappe.throw("Invalid face descriptor: all values must be numbers.")


DATA_URI_RE = re.compile(r"^data:image/(png|jpeg|jpg|webp);base64,")


def save_base64_image(data_uri, filename, doctype, docname, fieldname):
	"""Decode a base64 data URI captured from the browser camera and attach
	it as a private file on the given document, returning the file url."""
	match = DATA_URI_RE.match(data_uri or "")
	if not match:
		frappe.throw("Invalid image data.")

	extension = match.group(1)
	content = data_uri[match.end() :]

	try:
		decoded = base64.b64decode(content)
	except (binascii.Error, ValueError):
		frappe.throw("Could not decode image data.")

	from frappe.utils.file_manager import save_file

	file_doc = save_file(
		f"{filename}.{extension}",
		decoded,
		doctype,
		docname,
		is_private=1,
	)
	return file_doc.file_url
