frappe.ui.form.on("Employee", {
	refresh(frm) {
		if (frm.is_new()) return;

		const manager_roles = ["System Manager", "Attendance Manager", "HR Manager"];
		if (!frappe.user_roles.some((role) => manager_roles.includes(role))) return;

		frm.add_custom_button(
			__("Enroll Attendance Face"),
			() => {
				frappe.route_options = { employee: frm.doc.name };
				frappe.set_route("enroll-employee-face");
			},
			__("Attendance")
		);

		frappe.db
			.exists("Employee Face Profile", frm.doc.name)
			.then((exists) => {
				frm.dashboard.clear_headline();
				if (exists) {
					frm.dashboard.set_headline_alert(
						`<i class="fa fa-check-circle text-success"></i> ${__("Attendance face profile enrolled.")}`
					);
				} else {
					frm.dashboard.set_headline_alert(
						`<i class="fa fa-exclamation-triangle text-warning"></i> ${__(
							"No attendance face profile yet — use \"Enroll Attendance Face\" above."
						)}`
					);
				}
			})
			.catch(() => {
				/* Employee Face Profile may not be readable for this role; ignore */
			});
	},
});
