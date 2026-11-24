-- Anonymous browsing evaluates the source read policy, which calls the
-- membership check. Both functions return false when nobody is signed in.
grant execute on function public.has_source_role(uuid,text[]) to anon;
grant execute on function public.is_source_member(uuid) to anon;
