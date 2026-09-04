app_name = "laundry_cloud"
app_title = "Laundry Cloud"
app_publisher = "Laundry Cloud"
app_description = "A comprehensive laundry management app built on Frappe Framework, with WhatsApp action notifications."
app_email = "okhaweremike@gmail.com"
app_license = "mit"
required_apps = ["frappe"]

# Fixtures
# ------------------
# Ship a "WhatsApp Notifications" checkbox on the core User doctype so any
# Frappe/ERPNext user can opt in without a core modification.
fixtures = [
	{
		"doctype": "Custom Field",
		"filters": [["name", "in", ["User-whatsapp_notification_tab", "User-enable_whatsapp_notifications"]]],
	}
]

# Document Events
# ---------------
# Frappe already writes a "Notification Log" row for assignments, mentions,
# shares, energy points and document alerts. Hooking into its creation is a
# single choke point that covers all of those "you have something to do"
# moments without touching core doctypes.
doc_events = {
	"Notification Log": {
		"after_insert": "laundry_cloud.whatsapp_notifications.notification_hooks.on_notification_log_insert"
	}
}

# Scheduled Tasks
# ---------------
scheduler_events = {
	"cron": {
		# Runs on the hour; the reminder frequency itself is controlled from
		# WhatsApp Settings so this just needs to be frequent enough.
		"0 * * * *": [
			"laundry_cloud.whatsapp_notifications.notification_hooks.send_pending_action_reminders"
		]
	}
}
