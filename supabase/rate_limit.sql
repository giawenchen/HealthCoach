-- 限流用的原子函数：检查"每人每日"和"全局每日"上限，未超则计数 +1。
-- 在 Supabase → SQL Editor 里粘贴运行一次即可。
create or replace function public.check_and_count(p_user uuid, p_user_max int, p_global_max int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_count int;
  v_global_count int;
begin
  select coalesce(sum(count), 0) into v_global_count from public.usage where day = current_date;
  select coalesce(count, 0) into v_user_count from public.usage where user_id = p_user and day = current_date;

  if v_user_count >= p_user_max then
    return jsonb_build_object('allowed', false, 'reason', 'user_limit');
  end if;
  if v_global_count >= p_global_max then
    return jsonb_build_object('allowed', false, 'reason', 'global_limit');
  end if;

  insert into public.usage(user_id, day, count) values (p_user, current_date, 1)
    on conflict (user_id, day) do update set count = public.usage.count + 1;

  return jsonb_build_object('allowed', true);
end;
$$;
