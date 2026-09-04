# laundry_cloud

A comprehensive laundry management app built on Frappe Framework.

## Attendance module

A Zoho-People-style attendance monitoring feature for staff, built on top of
**Frappe HR (`hrms`)** and ERPNext's existing `Employee` master, adding:

- A **Check In / Check Out kiosk** (single button that toggles based on the
  employee's last log) at the `/app/attendance-kiosk` desk page.
- **Facial recognition**: the browser captures a live camera frame, extracts
  a 128-point face descriptor with [face-api.js](https://github.com/justadudewhohacks/face-api.js)
  (loaded from CDN, no extra Python/system dependencies), and the server
  compares it against a descriptor enrolled once per employee.
- **Backend geolocation (geofencing)**: the browser reports GPS coordinates,
  and the server computes the distance (Haversine formula) to the nearest
  configured `Office Location`, flagging or blocking check-ins outside the
  allowed radius.
- Best-effort sync of every event into the standard `Employee Checkin`
  doctype so existing shift/attendance/payroll automation keeps working.

### DocTypes

| DocType | Purpose |
|---|---|
| `Office Location` | Geofenced site(s): name, lat/lng, allowed radius (meters). |
| `Employee Face Profile` | One enrolled face descriptor (JSON) + reference photo per `Employee`. |
| `Attendance Checkin` | Every check-in/check-out event: time, geolocation, matched office, distance, selfie, face match score/status. |
| `Attendance Settings` | Single doctype: toggle geofence/face enforcement, thresholds, whether to sync into `Employee Checkin`. |

### Backend API (`laundry_cloud.attendance.api`)

- `get_kiosk_context` — resolves the logged-in user's `Employee`, enrollment
  status, and the next expected action (IN/OUT).
- `enroll_face(descriptor, image)` — stores/replaces an employee's reference
  face descriptor. Employees enroll themselves; enrolling someone else
  requires an `Attendance Manager` / `HR Manager` / `System Manager` role.
- `mark_attendance(latitude, longitude, descriptor, image, log_type=None)` —
  validates geofence + face match per `Attendance Settings`, creates the
  `Attendance Checkin` record, and (if enabled) syncs it to `Employee Checkin`.

### Setup

This app depends on `hrms` (Frappe HR), since staff records are the standard
`Employee` doctype (linked to a `User` via its `user_id` field):

```bash
bench get-app hrms
bench get-app https://github.com/uppa-digital/laundry_cloud
bench --site <site> install-app hrms laundry_cloud
```

After install, configure at least one `Office Location` and review
`Attendance Settings` (enforcement toggles, face match threshold, geofence
radius), then have each employee open **Attendance Kiosk** and click
**Enroll My Face** once before checking in.

Facial recognition and geolocation both require the browser to be served
over **HTTPS** (or `localhost`), since `getUserMedia`/`navigator.geolocation`
are blocked on insecure origins.
