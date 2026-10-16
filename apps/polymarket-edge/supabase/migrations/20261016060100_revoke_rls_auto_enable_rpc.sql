-- Advisor 0028/0029: the project's pre-existing event-trigger function public.rls_auto_enable()
-- (SECURITY DEFINER) was executable by anon/authenticated through /rest/v1/rpc.
-- Event triggers do not need EXECUTE for these roles, so revoking it keeps the trigger working.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
