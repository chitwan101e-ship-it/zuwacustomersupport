-- Customer "support_reply" notifications are created by the app (POST /api/staff/notify-customer-reply)
-- using the service role, because trigger-time inserts into notifications often fail under RLS
-- while the originating messages row still commits.
--
-- If this trigger is still enabled, customers can receive duplicate notifications.

drop trigger if exists messages_notify_customer_after_insert on public.messages;
