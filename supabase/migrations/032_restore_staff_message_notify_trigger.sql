-- Restore DB trigger for staff support_message alerts (reliable even if the app API path fails).
-- Desktop popups and the bell badge listen for notifications INSERT via Realtime.

drop trigger if exists messages_notify_staff_after_insert on public.messages;

create trigger messages_notify_staff_after_insert
  after insert on public.messages
  for each row execute function public.notify_staff_on_customer_message();
