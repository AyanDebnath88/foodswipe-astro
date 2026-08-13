-- 0004_room_dietary_filter.sql
-- Phase 2, Task 2 (dietary filter): seeds real dietary_tags onto the 9 rows
-- inserted by 0002_seed_cuisines.sql, which intentionally left dietary_tags
-- empty. Vocabulary (per build-log SKILL.md): vegetarian, vegan, halal,
-- gluten-free, nut-free, dairy-free, shellfish-free.
--
-- Semantics: dietary_tags is the set of restrictions a cuisine can
-- confidently satisfy (i.e. a diner following that restriction can find a
-- suitable dish in the cuisine without a fight). A room excludes a cuisine
-- from the swipeable deck when dietary_tags is NOT a superset of the union
-- of all participants' profiles.dietary_restrictions (see
-- src/lib/dietary.ts for where that comparison actually runs).
--
-- Tags below are honest, per-cuisine judgment calls about tradition/default
-- preparation, not a guarantee about any specific restaurant or dish. Where
-- a cuisine's defining, hard-to-substitute ingredients conflict with a
-- restriction (e.g. shrimp paste in Thai curry pastes, butter/cream as the
-- backbone of French sauces, pork in Vietnamese banh mi), that tag is left
-- off rather than assumed. `vegan` is only applied where it's also
-- accompanied by `vegetarian` and `dairy-free` (vegan dishes are trivially
-- both), so the tag set stays internally consistent for the filter's plain
-- string-membership check.
--
--   italian     - Rich vegetarian tradition (pizza margherita, risotto,
--                 caprese); not vegan/dairy-free by default (cheese/cream
--                 are structural, not garnish); not gluten-free by default
--                 (pasta/pizza dough are the cuisine's core starches); pork
--                 (prosciutto, pancetta) and wine are traditional enough
--                 that a blanket halal claim would be dishonest; pine nuts
--                 in pesto are avoidable, not structural, and seafood is
--                 optional regionally, not the cuisine's backbone -> nut-free
--                 and shellfish-free both included.
--   mexican     - Corn tortillas, beans, rice, and salsas give it genuine
--                 vegetarian/vegan/gluten-free/dairy-free range (cheese and
--                 sour cream are toppings, not structural); mole sauces
--                 commonly include peanuts/pumpkin seeds, so no nut-free;
--                 carnitas/chorizo (pork) are traditional staples, so no
--                 halal; coastal shellfish dishes are regional, not the
--                 default, so shellfish-free stays in.
--   japanese    - Vegetable tempura, agedashi tofu, and edamame keep
--                 vegetarian on the table, though bonito-based dashi
--                 underlies enough dishes that a blanket vegan claim would
--                 overreach; traditionally very light on dairy and tree
--                 nuts -> dairy-free/nut-free included; sushi/tempura are
--                 built around fish and shellfish, and pork ramen/sake are
--                 common, so no shellfish-free, no halal; wheat is in soy
--                 sauce and the noodle dishes (ramen, udon) that define a
--                 lot of the everyday menu, so no gluten-free.
--   indian      - The cuisine most famous for accommodating restrictions:
--                 deep vegetarian and vegan traditions (dal, chana masala,
--                 aloo gobi cooked in oil, not ghee), a large halal-observant
--                 culinary tradition (biryani, kebabs), and rice as the
--                 default starch alongside naturally gluten-free curries.
--                 Cashew/almond-thickened gravies (korma, several
--                 restaurant-style curries) are common enough that nut-free
--                 is left off; shrimp/fish curries are a regional subset,
--                 not the default, so shellfish-free stays in.
--   thai        - Genuine vegetarian menus are common (tofu pad thai,
--                 vegetable curries); fish sauce and shrimp paste are
--                 foundational to the base curry pastes and everyday
--                 seasoning (harder to substitute out than a single
--                 ingredient), so no vegan and no shellfish-free; rice and
--                 rice noodles are the primary starch (not wheat), so
--                 gluten-free stays in, as does dairy-free (coconut milk,
--                 not dairy, is the traditional richness); peanuts are
--                 structural to pad thai, satay, and many curries, so no
--                 nut-free; pork and fish sauce are pervasive enough that a
--                 halal claim would be dishonest.
--   greek       - Mediterranean mezze culture gives it real vegetarian and
--                 vegan range (dolmades, greek salad, hummus-adjacent dips)
--                 -> dairy-free included alongside vegan for the same
--                 internal-consistency reason noted above; walnuts/pistachios
--                 are confined to desserts (baklava) rather than savory
--                 mains, so nut-free stays in; shellfish (calamari, shrimp)
--                 is a regional coastal option, not the default, so
--                 shellfish-free stays in; phyllo/pita bread are too central
--                 for a gluten-free claim, and pork gyro plus wine are
--                 traditional enough to rule out halal.
--   french      - Classic vegetarian dishes exist (ratatouille, soufflé,
--                 salade niçoise minus the anchovy), but butter, cream, and
--                 cheese are the technique itself, not an optional
--                 ingredient, ruling out vegan/dairy-free; baguette, pastry,
--                 and roux-thickened sauces are just as structural, ruling
--                 out gluten-free; pork charcuterie and wine deglazing are
--                 traditional enough to rule out halal; nuts are confined to
--                 specific desserts (not savory cooking) and most classic
--                 dishes (coq au vin, boeuf bourguignon, ratatouille) have no
--                 shellfish, so nut-free and shellfish-free are included.
--   vietnamese  - "Chay" (vegetarian) versions of classic dishes are a real,
--                 widely available tradition -> vegetarian included; fish
--                 sauce is the default seasoning in most non-chay dishes, so
--                 no vegan; rice noodles, rice paper, and rice are the
--                 cuisine's primary starch (pho, goi cuon), a genuine
--                 strength for gluten-free; traditionally light on dairy
--                 (condensed-milk coffee is the exception, not the savory
--                 menu) -> dairy-free included; peanuts are a standard
--                 topping/dipping-sauce ingredient (goi cuon, bun cha), and
--                 pork (banh mi, cha lua) and shrimp are everyday proteins,
--                 so no nut-free, no halal, no shellfish-free.
--   korean      - Temple cuisine and tofu/vegetable-forward dishes (some
--                 bibimbap, japchae without meat) give it a real, if
--                 careful, vegetarian range; traditionally light on dairy
--                 -> dairy-free included; sesame/pine-nut garnishes are
--                 present but not structural -> nut-free included; core
--                 dishes like bulgogi, bibimbap, and japchae have no
--                 shellfish, even though seafood pancakes/some banchan do,
--                 so shellfish-free stays in; soy sauce/gochujang (wheat)
--                 season most everyday dishes, so no gluten-free; and pork
--                 (samgyeopsal) plus fish-sauce-based kimchi are traditional
--                 enough to rule out both vegan and halal.

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'nut-free', 'shellfish-free']
  where id = 'italian';

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'shellfish-free']
  where id = 'mexican';

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'dairy-free', 'nut-free']
  where id = 'japanese';

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'vegan', 'halal', 'gluten-free', 'dairy-free', 'shellfish-free']
  where id = 'indian';

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'gluten-free', 'dairy-free']
  where id = 'thai';

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'vegan', 'dairy-free', 'nut-free', 'shellfish-free']
  where id = 'greek';

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'nut-free', 'shellfish-free']
  where id = 'french';

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'gluten-free', 'dairy-free']
  where id = 'vietnamese';

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'dairy-free', 'nut-free', 'shellfish-free']
  where id = 'korean';
