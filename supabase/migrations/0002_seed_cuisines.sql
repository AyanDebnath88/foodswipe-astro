-- 0002_seed_cuisines.sql
-- Cuisine reference/catalog data, ported from the reference Next.js project's
-- src/lib/cuisines.ts. The old `description` and `imageId` fields are not
-- carried over here since they are outside the target schema given for this
-- migration; cuisine artwork is expected to move to Supabase Storage keyed
-- by cuisine id in a later phase.

create table if not exists public.cuisines (
  id text primary key,
  name text not null,
  dishes text[] not null default '{}',
  dietary_tags text[] not null default '{}'
);

-- Reference data is public, read-only from the client's perspective: enable
-- RLS so anon/authenticated users can browse cuisines but cannot mutate the
-- catalog (writes are expected to happen via migrations / the dashboard).
alter table public.cuisines enable row level security;

create policy "cuisines: public read"
  on public.cuisines
  for select
  using (true);

insert into public.cuisines (id, name, dishes) values
  ('italian', 'Italian', ARRAY['Margherita Pizza', 'Carbonara', 'Lasagna', 'Risotto', 'Osso Buco']),
  ('mexican', 'Mexican', ARRAY['Tacos al Pastor', 'Guacamole', 'Enchiladas', 'Mole Poblano', 'Chiles Rellenos']),
  ('japanese', 'Japanese', ARRAY['Sushi Platter', 'Tonkotsu Ramen', 'Tempura', 'Udon Noodles', 'Okonomiyaki']),
  ('indian', 'Indian', ARRAY['Chicken Tikka Masala', 'Biryani', 'Samosa', 'Palak Paneer', 'Rogan Josh']),
  ('thai', 'Thai', ARRAY['Pad Thai', 'Tom Yum Goong', 'Green Curry', 'Massaman Curry', 'Som Tum']),
  ('greek', 'Greek', ARRAY['Moussaka', 'Gyro', 'Souvlaki', 'Spanakopita', 'Greek Salad']),
  ('french', 'French', ARRAY['Coq au Vin', 'Boeuf Bourguignon', 'Ratatouille', 'Souffle', 'Creme Brulee']),
  ('vietnamese', 'Vietnamese', ARRAY['Pho', 'Banh Mi', 'Goi Cuon (Spring Rolls)', 'Bun Cha', 'Cao Lau']),
  ('korean', 'Korean', ARRAY['Kimchi Jjigae', 'Bulgogi', 'Bibimbap', 'Tteokbokki', 'Japchae'])
on conflict (id) do update
  set name = excluded.name,
      dishes = excluded.dishes;
