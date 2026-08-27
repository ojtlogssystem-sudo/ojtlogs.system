# Guest evaluation setup

The coordinator page uses the existing EmailJS service and template ID `template_1hohaig`.
Update that template's email body to include these variables:

```text
Hello,

The final internship evaluation for {{company_name}} is ready.
There are {{intern_count}} intern(s) in this department.

Open the guest evaluation form:
{{evaluation_link}}
```

The guest page reads `guestEvaluationAccess`, `attendance`, and writes to `evaluations`. The deployed Firestore rules must permit those operations for the guest page. For a production system, move guest-link validation and task-history lookup to a Firebase Cloud Function (or issue Firebase email-link authentication) instead of allowing anonymous client access to attendance records.
