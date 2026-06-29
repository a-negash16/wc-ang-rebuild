alter table group_comments
  drop constraint if exists group_comments_body_check;

alter table group_comments
  add constraint group_comments_body_check
  check (char_length(body) between 1 and 30);
