-- Replace values before running.
-- Generate a hash with: node scripts/hash-pin.mjs 12345

update managers
set pin_hash = 'sha256:replace_with_generated_hash'
where manager_code = 'M001'
  and group_id = (select id from groups where slug = 'squad');
