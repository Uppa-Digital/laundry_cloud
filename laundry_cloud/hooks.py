app_name = "laundry_cloud"
app_title = "Laundry Cloud"
app_publisher = "Laundry Cloud"
app_description = "A comprehensive laundry management app built on Frappe Framework, including staff attendance monitoring with facial recognition and geolocation."
app_email = "okhaweremike@gmail.com"
app_license = "mit"

# Staff records are the standard "Employee" doctype from Frappe HR (hrms),
# so this app requires hrms (which in turn requires erpnext) to be installed
# on the site. Attendance events are also best-effort synced into the
# standard "Employee Checkin" doctype so they flow into ERPNext's existing
# shift/attendance/payroll automation.
required_apps = ["hrms"]

# Includes in <head>
# ------------------
# include js, css files in header of desk.html

# app_include_css = "/assets/laundry_cloud/css/laundry_cloud.css"
# app_include_js = "/assets/laundry_cloud/js/laundry_cloud.js"

# Installation
# ------------

after_install = "laundry_cloud.setup.install.after_install"

# Fixtures
# --------

fixtures = [
	{
		"doctype": "Role",
		"filters": [["name", "in", ["Attendance Manager"]]],
	}
]
