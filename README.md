# laundry_cloud
A comprehensive laundry management app built on Frappe Framework.

## WhatsApp Action Notifications

WhatsApp action notifications (task assignments, mentions, shares, and
pending ToDo reminders — so pending actions don't get missed the way they
do with email/in-app alerts alone) are provided by a separate, reusable
app: [whatsapp_notifications](https://github.com/Uppa-Digital/frappe-whatsapp-notifier).

It's declared as a dependency in `hooks.py`, so installing laundry_cloud
on a bench that has it available pulls it in automatically:

```
bench get-app whatsapp_notifications https://github.com/Uppa-Digital/frappe-whatsapp-notifier
bench get-app laundry_cloud <this-repo-url>
bench --site <site-name> install-app laundry_cloud
```

See that repo's README for setup (Meta WhatsApp Cloud API credentials,
per-user opt-in, etc.).
