-- Optional question customers can ask during signup (shown to staff at approval).

alter table public.profiles add column if not exists signup_question text;

comment on column public.profiles.signup_question is 'Optional question the customer entered during signup for staff review.';
