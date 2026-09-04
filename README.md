# laundry_cloud

A comprehensive laundry management app built on Frappe Framework.

## Attendance module

A Zoho-People-style attendance monitoring feature for staff, built on top of
**Frappe HR (`hrms`)** and ERPNext's existing `Employee` master. Two ways to
check in/out:

1. **Shared kiosk app** (`/kiosk`) — an installable PWA for a tablet/device
   mounted at a physical location. Any staff member walks up, taps **Check
   In** or **Check Out**, and is identified purely by face (1:N match
   against every enrolled profile) — no per-person login needed each time.
2. **Personal self-service page** (desk → *My Attendance*) — an individual
   employee, logged in as themselves, checks themselves in/out (1:1 face
   verification against their own profile). Optional — most staff won't
   need this if they only ever use the shared kiosk.

Both flows share the same verification pipeline:

- **Facial recognition**: the browser captures a live camera frame, extracts
  a 128-point face descriptor with [face-api.js](https://github.com/justadudewhohacks/face-api.js)
  (loaded from CDN, no extra Python/system dependencies), and the server
  compares it against enrolled descriptor(s).
- **Backend geolocation (geofencing)**: the browser reports GPS coordinates,
  and the server computes the distance (Haversine formula) to the relevant
  `Office Location` — the kiosk's pinned location, or the nearest active one
  — flagging or blocking check-ins outside the allowed radius.
- Best-effort sync of every event into the standard `Employee Checkin`
  doctype so existing shift/attendance/payroll automation keeps working.

### The shared kiosk app (`/kiosk`)

This is the "install it on our location devices" piece: a full-screen,
installable Progressive Web App (manifest + service worker, no browser
chrome) meant to live permanently on a tablet at each site — mirroring the
location-picker → Check In/Check Out → scanning → confirmation flow of
apps like Zoho People's kiosk mode.

**Security model.** A shared device can't rely on "whoever is logged in is
the employee" — anyone can walk up to it. So instead:

- Each physical device logs in **once** as a dedicated `Kiosk Device`
  account (a `User` with the `Attendance Kiosk` role and **no other
  permissions** — it cannot read staff data, list records, or reach the
  Desk UI at all). The session then just stays signed in on that tablet.
- Whoever is checking in/out is identified **by face** (1:N search across
  all enrolled `Employee Face Profile` records), not by who is logged in.
- If no enrolled face matches confidently — including an *ambiguous* case
  where two people's faces are nearly equidistant — the attempt is
  rejected and logged to `Kiosk Unrecognized Attempt` (with the captured
  photo, GPS, and the closest-but-not-confident match) for admin review,
  rather than silently guessing.
- Face **enrollment** itself never happens from the kiosk — only from the
  personal self-service page, under a real login, so the reference data
  used for 1:N identification always traces back to a verified identity.

### How HR enrolls an employee

This is the important part, since it's how everyone actually gets onto the
platform. **An employee does not need a personal Frappe login at all** —
most laundry staff won't have one, and don't need one, if they'll only ever
use the shared kiosk. HR enrolls them directly, in person:

1. HR (any `System Manager` / `Attendance Manager` / `HR Manager`) opens
   desk → **Attendance workspace → Enroll Employee Face** (or, from any
   `Employee` record, the **Enroll Attendance Face** button on the form).
2. The page shows a live camera preview, an Employee picker, and a running
   checklist of every active employee who **hasn't** been enrolled yet.
3. Pick their name — or just click them in the checklist — then get a face
   in one of three ways:
   - **Capture from Camera** — call the employee over and take their photo.
   - **Upload Photo** — pick an existing image file (e.g. an ID photo).
   - **Use Existing Employee Photo** — one click, if their `Employee`
     record already has a photo on file.
   All three run the same face-detection pipeline and produce an
   identical reference — there's no camera-only requirement, since
   nothing about this app does "liveness" detection at enrollment or
   check-in either way; a photo is just as valid a reference as a live
   frame.
4. The page clears itself and is immediately ready for the next employee.
   The checklist shrinks as people get enrolled, so HR can see progress at
   a glance during onboarding or a "photo day" for existing staff.

That single enrollment is then used both ways: it's the reference an
employee is matched against on the shared kiosk (1:N), and — if they ever
do get a personal login — for their own self-service check-in (1:1).

Re-enrolling (e.g. after a haircut/beard change causes mismatches, or a new
hire) works the same way — capturing again simply replaces the stored
reference for that employee.

An employee can alternatively enroll **themselves** from desk → *My
Attendance* → **Enroll My Face**, if they do have a personal login — this
just isn't the primary path, since most staff won't have one.

### DocTypes

| DocType | Purpose |
|---|---|
| `Office Location` | Geofenced site(s): name, lat/lng, allowed radius (meters). |
| `Kiosk Device` | A shared device's login (`User`) and the `Office Location` it's pinned to. |
| `Employee Face Profile` | One enrolled face descriptor (JSON) + reference photo per `Employee`. |
| `Attendance Checkin` | Every check-in/check-out event: time, geolocation, matched office, distance, selfie, face match score/status, originating kiosk device. |
| `Kiosk Unrecognized Attempt` | Audit log of kiosk scans that couldn't be confidently matched to anyone. |
| `Attendance Settings` | Single doctype: toggle geofence/face enforcement, thresholds, whether to sync into `Employee Checkin`. |

### Backend API

`laundry_cloud.attendance.api` (personal, self-authenticated):
- `get_kiosk_context` — the logged-in user's `Employee`, enrollment status, last log.
- `enroll_face(descriptor, image, employee=None)` — store/replace a face
  descriptor. Self-enrollment always allowed; passing `employee` (HR
  enrolling someone else) requires a manager role.
- `get_unenrolled_employees()` — active employees with no face profile yet
  (manager-only); powers the checklist on **Enroll Employee Face**.
- `mark_attendance(latitude, longitude, log_type, descriptor, image)` — 1:1
  verified self check-in/out.

`laundry_cloud.attendance.kiosk_api` (shared device, `Attendance Kiosk` role):
- `get_device_context` — which `Kiosk Device`/`Office Location` this session is.
- `identify_and_mark_attendance(latitude, longitude, descriptor, image, log_type)`
  — 1:N face identification + verified check-in/out, or a logged
  `Kiosk Unrecognized Attempt` if nobody matches confidently.

### Setup

This app depends on `hrms` (Frappe HR), since staff records are the standard
`Employee` doctype (linked to a `User` via its `user_id` field):

```bash
bench get-app hrms
bench get-app https://github.com/uppa-digital/laundry_cloud
bench --site <site> install-app hrms laundry_cloud
```

Then:

1. Create at least one **Office Location** and review **Attendance
   Settings** (enforcement toggles, face match threshold, geofence radius).
2. Enroll staff faces via desk → **Enroll Employee Face** (see *How HR
   enrolls an employee* above) — do this before anyone tries the shared
   kiosk, since an unenrolled face is always rejected.
3. To set up a shared kiosk device:
   - Create a `User` with **User Type = Website User** and only the
     **Attendance Kiosk** role (no other roles — this account must never
     see staff data or reach `/app`).
   - Create a `Kiosk Device` record pointing at that `User`, pinned to its
     `Office Location`.
   - On the tablet, open `https://<your-site>/kiosk`, sign in once with
     that device account, then **install it** (browser's "Add to Home
     Screen" / install prompt, or the in-app "Install App" button) so it
     runs full-screen like a native app.

Facial recognition and geolocation both require the browser to be served
over **HTTPS** (or `localhost`), since `getUserMedia`/`navigator.geolocation`
are blocked on insecure origins — this also applies to installing the PWA.
