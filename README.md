# laundry_cloud
A comprehensive laundry management app built on Frappe Framework.

## WhatsApp Action Notifications

Email and the in-app bell get missed. This app forwards the notifications
that already mean "you have something to do" — task assignments,
@mentions, document shares, and (optionally) energy points/alerts — to the
recipient's WhatsApp, plus an hourly reminder digest for anyone still
sitting on open ToDos.

It hooks into Frappe's own `Notification Log` doctype, so it works for any
Frappe or ERPNext v13+ site without touching core code — no per-doctype
wiring needed.

### Setup

1. Install the app on your bench: `bench get-app laundry_cloud <this-repo-url> && bench --site <site> install-app laundry_cloud`.
2. In a [Meta WhatsApp Business (Cloud API)](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)
   account, grab the **Phone Number ID** and a permanent **Access Token**.
3. Open **WhatsApp Settings** in the desk, enable it, paste in those two
   values, and choose which event types should trigger a message.
4. On each **User** record, under the "WhatsApp Notifications" tab, tick
   **Enable WhatsApp Notifications** (requires a Mobile No on the user).
5. Use the **Send Test Message** button on WhatsApp Settings to confirm
   delivery, then check **WhatsApp Notification Log** for the audit trail.

### How it works

- `laundry_cloud/whatsapp_notifications/notification_hooks.py` listens for
  new `Notification Log` rows (Frappe already creates these for
  assignments, mentions, shares, and energy points) and, if the recipient
  has opted in, queues a WhatsApp message.
- An hourly scheduled job sends a reminder digest to users with open
  ToDos, throttled by the "Reminder Frequency" set on WhatsApp Settings.
- `laundry_cloud/whatsapp_notifications/utils.py` sends the message via the
  Meta WhatsApp Cloud API in a background job and records the outcome in
  **WhatsApp Notification Log**.
