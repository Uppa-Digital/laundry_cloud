import frappe
from frappe.utils import add_days, flt, get_datetime, getdate, today


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = get_columns()
	data = get_data(filters)
	return columns, data


def get_columns():
	return [
		{"label": "Date", "fieldname": "date", "fieldtype": "Date", "width": 100},
		{"label": "Employee", "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 120},
		{"label": "Employee Name", "fieldname": "employee_name", "fieldtype": "Data", "width": 160},
		{"label": "First Check-in", "fieldname": "first_in", "fieldtype": "Datetime", "width": 160},
		{"label": "Last Check-out", "fieldname": "last_out", "fieldtype": "Datetime", "width": 160},
		{"label": "Hours Worked", "fieldname": "hours_worked", "fieldtype": "Float", "precision": 2, "width": 110},
		{"label": "Total Logs", "fieldname": "total_logs", "fieldtype": "Int", "width": 90},
		{"label": "Face Verified", "fieldname": "face_verified_count", "fieldtype": "Int", "width": 100},
		{"label": "Face Issues", "fieldname": "face_issue_count", "fieldtype": "Int", "width": 100},
		{"label": "Out of Range Logs", "fieldname": "out_of_range_count", "fieldtype": "Int", "width": 130},
	]


def get_data(filters):
	from_date = filters.get("from_date") or add_days(today(), -7)
	to_date = filters.get("to_date") or today()

	conditions = ["DATE(time) BETWEEN %(from_date)s AND %(to_date)s"]
	params = {"from_date": getdate(from_date), "to_date": getdate(to_date)}

	if filters.get("employee"):
		conditions.append("employee = %(employee)s")
		params["employee"] = filters.get("employee")

	rows = frappe.db.sql(
		f"""
		select
			employee, employee_name, log_type, time,
			face_match_status, location_status
		from `tabAttendance Checkin`
		where {" and ".join(conditions)}
		order by employee, time asc
		""",
		params,
		as_dict=True,
	)

	groups = {}
	for row in rows:
		key = (row.employee, getdate(row.time))
		group = groups.setdefault(
			key,
			{
				"date": key[1],
				"employee": row.employee,
				"employee_name": row.employee_name,
				"first_in": None,
				"last_out": None,
				"total_logs": 0,
				"face_verified_count": 0,
				"face_issue_count": 0,
				"out_of_range_count": 0,
			},
		)
		group["total_logs"] += 1
		if row.log_type == "IN" and not group["first_in"]:
			group["first_in"] = row.time
		if row.log_type == "OUT":
			group["last_out"] = row.time

		if row.face_match_status == "Verified":
			group["face_verified_count"] += 1
		elif row.face_match_status in ("Not Verified", "No Profile", "No Face Detected"):
			group["face_issue_count"] += 1

		if row.location_status == "Out of Range":
			group["out_of_range_count"] += 1

	data = []
	for group in groups.values():
		if group["first_in"] and group["last_out"]:
			seconds = (get_datetime(group["last_out"]) - get_datetime(group["first_in"])).total_seconds()
			group["hours_worked"] = flt(seconds / 3600, 2) if seconds > 0 else 0
		else:
			group["hours_worked"] = 0
		data.append(group)

	data.sort(key=lambda d: (d["date"], d["employee"]), reverse=True)
	return data
