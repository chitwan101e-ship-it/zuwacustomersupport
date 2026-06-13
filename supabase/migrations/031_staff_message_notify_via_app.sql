-- Staff support_message notifications are created by the app (POST /api/customer/notify-staff-message)
-- using the service role, matching how customer support_reply alerts use notify-customer-reply.
-- Drop the insert trigger to avoid duplicate staff notifications when both paths run.

drop trigger if exists messages_notify_staff_after_insert on public.messages;
