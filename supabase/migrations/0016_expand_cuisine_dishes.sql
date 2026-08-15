-- 0016_expand_cuisine_dishes.sql
--
-- Expands each cuisine's dishes catalog from 5 to 10 entries. The extra 5
-- per cuisine were researched against what's actually served on Indian
-- restaurant menus for that cuisine today (Zomato/Swiggy-adjacent sources,
-- food-press coverage), not just generic Western-menu defaults -- e.g.
-- Indian cuisine's additions span North (Butter Chicken, Chole Bhature, Dal
-- Makhani) and South (Masala Dosa, Idli Sambar) rather than only adding
-- more North Indian dishes on top of the existing catalog.
--
-- Purely additive to the existing 5 per cuisine -- nothing removed, nothing
-- reordered at the front, so any code or content that assumed the original
-- 5-item lists (e.g. the first published asset manifest) still finds those
-- same dishes at the same names. dietary_tags is untouched by this
-- migration; a cuisine's dietary_tags describe the cuisine as a whole, not
-- any specific dish, so a longer dish list doesn't change what it means.
--
-- Companion asset manifest: public/images/ASSET-PROMPTS.md (99 images: 9
-- cuisine heroes + 90 dishes, 10 per cuisine matching this exact list).

update public.cuisines set dishes = ARRAY['Margherita Pizza', 'Carbonara', 'Lasagna', 'Risotto', 'Osso Buco', 'Penne Arrabbiata', 'Fettuccine Alfredo', 'Fusilli Pesto', 'Spaghetti Aglio e Olio', 'Garlic Bread with Cheese'] where id = 'italian';
update public.cuisines set dishes = ARRAY['Tacos al Pastor', 'Guacamole', 'Enchiladas', 'Mole Poblano', 'Chiles Rellenos', 'Fajitas', 'Quesadillas', 'Nachos', 'Burrito Bowl', 'Tamales'] where id = 'mexican';
update public.cuisines set dishes = ARRAY['Sushi Platter', 'Tonkotsu Ramen', 'Tempura', 'Udon Noodles', 'Okonomiyaki', 'Gyoza', 'Katsu Curry', 'Teriyaki Chicken', 'Miso Soup', 'Dynamite Sushi Roll'] where id = 'japanese';
update public.cuisines set dishes = ARRAY['Chicken Tikka Masala', 'Biryani', 'Samosa', 'Palak Paneer', 'Rogan Josh', 'Butter Chicken', 'Masala Dosa', 'Idli Sambar', 'Chole Bhature', 'Dal Makhani'] where id = 'indian';
update public.cuisines set dishes = ARRAY['Pad Thai', 'Tom Yum Goong', 'Green Curry', 'Massaman Curry', 'Som Tum', 'Tom Kha Soup', 'Khao Suey', 'Pad Krapow (Thai Basil Stir Fry)', 'Mango Sticky Rice', 'Thai Spring Rolls'] where id = 'thai';
update public.cuisines set dishes = ARRAY['Moussaka', 'Gyro', 'Souvlaki', 'Spanakopita', 'Greek Salad', 'Dolmades', 'Baklava', 'Hummus with Pita', 'Tzatziki Dip', 'Loukoumades'] where id = 'greek';
update public.cuisines set dishes = ARRAY['Coq au Vin', 'Boeuf Bourguignon', 'Ratatouille', 'Souffle', 'Creme Brulee', 'French Onion Soup', 'Croque Monsieur', 'Quiche Lorraine', 'Chocolate Eclair', 'Macarons'] where id = 'french';
update public.cuisines set dishes = ARRAY['Pho', 'Banh Mi', 'Goi Cuon (Spring Rolls)', 'Bun Cha', 'Cao Lau', 'Bun Bo Hue', 'Banh Xeo', 'Cha Gio (Fried Spring Rolls)', 'Bun Thit Nuong', 'Com Tam (Broken Rice)'] where id = 'vietnamese';
update public.cuisines set dishes = ARRAY['Kimchi Jjigae', 'Bulgogi', 'Bibimbap', 'Tteokbokki', 'Japchae', 'Korean Fried Chicken', 'Kimchi Fried Rice', 'Galbi (Korean BBQ Short Ribs)', 'Kimbap', 'Sundubu Jjigae'] where id = 'korean';
