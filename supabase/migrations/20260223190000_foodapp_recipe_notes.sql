alter table if exists foodapp_recipes_published
  add column if not exists recipe_notes text;
