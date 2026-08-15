// One-off generator for public/images/ASSET-PROMPTS.md and the dish-expansion
// migration SQL. Not part of the app runtime -- run once, inspect output, delete
// or keep for the next expansion round.
import { writeFileSync, mkdirSync } from "node:fs";

const PREFIX =
  "Editorial food photography, warm and moody, soft directional window light from the left, shallow depth of field with a softly blurred background, styled on a rustic warm-toned ceramic or stone surface with subtle terracotta clay and soft gold tones visible in the props (linen napkin, blurred side dishes in the background), natural and appetizing, high-end restaurant editorial style, light film-photography grain, true-to-life color.";
const SUFFIX =
  "No people, no hands, no text, no watermark, no logos, no plate rim awkwardly cropped, single dish as the hero subject.";

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function full(subject) {
  return `${PREFIX} ${subject} ${SUFFIX}`;
}

const heroes = {
  korean:
    "Bibimbap served in a hot sizzling stone bowl (dolsot) — rice, julienned vegetables, marinated beef, a fried egg on top, gochujang sauce, still sizzling with a wisp of steam. Shot from a 3/4 overhead angle with a couple of small banchan side dishes softly blurred in the background.",
  italian:
    "A creamy carbonara twirled on a fork resting over a plate of pasta, fresh cracked black pepper and grated pecorino visible, a glass of white wine and torn bread softly blurred in the background.",
  mexican:
    "A trio of tacos al pastor on a wooden board, charred pineapple and cilantro visible, lime wedges and a small bowl of salsa softly blurred in the background.",
  japanese:
    "An arranged sushi platter — nigiri and maki with visible grain texture and glossy fish, a small dish of soy sauce and pickled ginger softly blurred in the background.",
  indian:
    "Chicken tikka masala in a copper karahi, visible steam, basmati rice and a torn piece of naan softly blurred in the background.",
  thai: "Pad thai on a plate with visible shrimp, egg ribbons, bean sprouts and crushed peanuts, a lime wedge and chili flakes in view.",
  greek:
    "A gyro plate with sliced meat, warm pita, and a dollop of tzatziki, olives and a small Greek salad softly blurred in the background.",
  french:
    "Coq au vin in a rustic cast-iron pot, visible braised chicken and pearl onions in a deep wine sauce, a glass of red wine softly blurred in the background.",
  vietnamese:
    "A bowl of pho with visible rice noodles, thin-sliced beef, and fresh herbs, steam rising, chopsticks resting on the bowl's edge.",
};

// name -> subject description. Order matters: first 5 per cuisine are the
// original 0002_seed_cuisines.sql catalog (unchanged), next 5 are the
// India-menu-researched expansion.
const dishes = {
  italian: [
    ["Margherita Pizza", "A wood-fired Margherita pizza slice being lifted, melted mozzarella stretching, fresh basil leaves, blistered crust."],
    ["Carbonara", "A close-up bowl of spaghetti carbonara, glossy egg-and-cheese sauce coating the pasta, cracked black pepper, guanciale visible."],
    ["Lasagna", "A cut slice of lasagna on a plate showing distinct layers of pasta, bolognese, and melted cheese, a little sauce pooling."],
    ["Risotto", "A creamy mushroom risotto in a shallow bowl, glossy texture, shaved parmesan and a drizzle of truffle oil on top."],
    ["Osso Buco", "A braised osso buco shank on a plate, rich glossy sauce, visible bone marrow, a sprinkle of gremolata."],
    ["Penne Arrabbiata", "A bowl of penne arrabbiata, glossy spicy red chili-tomato sauce coating the pasta, a few red chili flakes and basil leaf on top."],
    ["Fettuccine Alfredo", "A plate of fettuccine alfredo, thick creamy white sauce coating ribbons of pasta, cracked black pepper and parmesan shavings."],
    ["Fusilli Pesto", "A bowl of fusilli pasta tossed in vivid green basil pesto, pine nuts and shaved parmesan scattered on top."],
    ["Spaghetti Aglio e Olio", "A twirl of spaghetti aglio e olio on a fork, visible golden garlic slivers and red chili flakes glistening in olive oil."],
    ["Garlic Bread with Cheese", "Slices of garlic bread with melted golden cheese pulling apart, herbs visible, resting on a wooden board."],
  ],
  mexican: [
    ["Tacos al Pastor", "Two street-style tacos al pastor, charred pineapple bits, fresh cilantro and diced onion, small char marks on the tortilla."],
    ["Guacamole", "A rustic molcajete bowl of chunky guacamole, visible lime and cilantro flecks, a few tortilla chips propped at the edge."],
    ["Enchiladas", "Rolled enchiladas covered in red sauce and melted cheese in a baking dish, a little sour cream drizzle and cilantro garnish."],
    ["Mole Poblano", "Chicken mole poblano on a plate, deep glossy dark mole sauce, a sprinkle of sesame seeds."],
    ["Chiles Rellenos", "A stuffed chile relleno cut open showing melted cheese inside, resting in a light tomato sauce."],
    ["Fajitas", "A sizzling cast-iron skillet of chicken fajitas, charred bell pepper and onion strips, visible steam rising, warm tortillas softly blurred beside it."],
    ["Quesadillas", "A quesadilla cut into wedges, melted cheese stretching between the pieces, grill marks on the tortilla."],
    ["Nachos", "A loaded plate of nachos with melted cheese, jalapeños, and salsa drizzled over crisp tortilla chips."],
    ["Burrito Bowl", "A colorful burrito bowl with rice, black beans, grilled chicken, pico de gallo, and a dollop of guacamole, shot from directly above."],
    ["Tamales", "Two unwrapped tamales on a plate showing soft masa and a visible meat filling, corn husks resting beside them."],
  ],
  japanese: [
    ["Sushi Platter", "A tight arrangement of assorted nigiri and maki, glossy fresh fish, a small mound of pickled ginger."],
    ["Tonkotsu Ramen", "A bowl of tonkotsu ramen, rich cloudy broth, a soft-boiled ajitama egg cut in half, chashu pork slices, scallions."],
    ["Tempura", "A stack of golden crispy tempura (shrimp and vegetables) on a small rack, a dish of tentsuyu dipping sauce beside it."],
    ["Udon Noodles", "A bowl of thick udon noodles in a light broth, a few slices of kamaboko and scallion, steam rising."],
    ["Okonomiyaki", "A savory okonomiyaki pancake topped with a lattice of mayo and okonomiyaki sauce, bonito flakes visibly moving from rising heat."],
    ["Gyoza", "A row of pan-fried gyoza dumplings with a crispy golden base, a small dish of soy-vinegar dipping sauce beside them."],
    ["Katsu Curry", "A plate of chicken katsu curry, crispy breaded cutlet sliced and fanned out over rice, glossy brown curry sauce pooling beside it."],
    ["Teriyaki Chicken", "Glazed teriyaki chicken pieces with a glossy dark sauce, sesame seeds and scallion scattered on top, over a bed of rice."],
    ["Miso Soup", "A small lacquered bowl of miso soup, visible tofu cubes and wakame seaweed suspended in the cloudy broth."],
    ["Dynamite Sushi Roll", "A close-up of dynamite sushi rolls topped with a creamy spicy sauce, torched slightly with visible char, sesame seeds on top."],
  ],
  indian: [
    ["Chicken Tikka Masala", "A close bowl of chicken tikka masala, glossy orange-red sauce, visible cream swirl, fresh coriander on top."],
    ["Biryani", "A mound of layered biryani rice with visible saffron strands, a piece of chicken, fried onions, mint leaves scattered."],
    ["Samosa", "Two golden-fried samosas cut open showing spiced potato filling, a small dish of tamarind and mint chutney beside them."],
    ["Palak Paneer", "A bowl of vibrant green palak paneer, visible cubes of paneer in the creamy spinach sauce, a light cream swirl."],
    ["Rogan Josh", "A bowl of rogan josh lamb curry, deep red glossy sauce, tender lamb pieces, fresh coriander garnish."],
    ["Butter Chicken", "A bowl of butter chicken, rich glossy orange-red tomato-butter gravy, visible cream swirl, a few pieces of tandoori chicken, coriander garnish."],
    ["Masala Dosa", "A crisp golden-brown masala dosa rolled open showing spiced potato filling, a small steel bowl of sambar and coconut chutney beside it."],
    ["Idli Sambar", "Soft steamed idlis on a plate resting in a pool of glossy sambar, coconut chutney visible in a small dish beside them."],
    ["Chole Bhature", "A plate of spiced chole (chickpea curry) beside a large puffed golden bhatura, a few onion rings and a lemon wedge on the side."],
    ["Dal Makhani", "A bowl of dal makhani, deep brown creamy lentils with a swirl of butter melting on top, a light char visible on the surface."],
  ],
  thai: [
    ["Pad Thai", "A close plate of pad thai, visible rice noodles, shrimp, egg ribbons, crushed peanuts, a lime wedge on the side."],
    ["Tom Yum Goong", "A bowl of tom yum goong, clear spicy-sour broth, visible shrimp, lemongrass stalks, kaffir lime leaves, chili oil sheen."],
    ["Green Curry", "A bowl of green curry with chicken, visible Thai eggplant and basil leaves, glossy coconut-milk sauce."],
    ["Massaman Curry", "A bowl of massaman curry, tender beef and potato in a rich brown coconut sauce, roasted peanuts scattered on top."],
    ["Som Tum", "A plate of som tum green papaya salad, visible shredded papaya strands, cherry tomatoes, crushed peanuts, a wedge of lime."],
    ["Tom Kha Soup", "A bowl of tom kha soup, creamy coconut-milk broth, visible mushroom slices and galangal, a scatter of cilantro on top."],
    ["Khao Suey", "A bowl of khao suey, curried coconut broth over noodles, small bowls of crispy garlic, lime, and chili crumb arranged around it."],
    ["Pad Krapow (Thai Basil Stir Fry)", "A sizzling plate of pad krapow minced meat stir-fried with holy basil, a fried egg with a runny yolk on top, steam rising."],
    ["Mango Sticky Rice", "A plate of mango sticky rice, glossy sliced ripe mango fanned beside a mound of coconut sticky rice, a drizzle of coconut cream."],
    ["Thai Spring Rolls", "A stack of crispy golden Thai spring rolls sliced diagonally, a small dish of sweet chili dipping sauce beside them."],
  ],
  greek: [
    ["Moussaka", "A cut square of moussaka on a plate, visible layers of eggplant, spiced meat, and golden béchamel top."],
    ["Gyro", "A wrapped gyro cut open showing sliced meat, tzatziki, tomato and onion spilling slightly from warm pita."],
    ["Souvlaki", "Grilled souvlaki skewers with char marks, a small dish of tzatziki and a lemon wedge beside them."],
    ["Spanakopita", "A cut triangle of spanakopita showing flaky golden phyllo layers and visible spinach-feta filling."],
    ["Greek Salad", "A rustic bowl of Greek salad, visible chunky tomato, cucumber, olives, and a thick slab of feta on top, drizzled olive oil."],
    ["Dolmades", "A small plate of dolmades (stuffed grape leaves), glossy olive-oil sheen, a wedge of lemon and a dollop of yogurt beside them."],
    ["Baklava", "A cut piece of baklava showing flaky golden layers and chopped nuts, glossy honey syrup pooling on the plate."],
    ["Hummus with Pita", "A shallow bowl of hummus with a swirl of olive oil and a sprinkle of paprika, warm pita triangles fanned beside it."],
    ["Tzatziki Dip", "A small bowl of tzatziki, visible flecks of cucumber and dill, a drizzle of olive oil on top, a few pita wedges beside it."],
    ["Loukoumades", "A small plate of loukoumades (Greek honey puffs), glossy honey syrup dripping down, a scatter of crushed walnuts and cinnamon on top."],
  ],
  french: [
    ["Coq au Vin", "A close plate of coq au vin, braised chicken in glossy red wine sauce, pearl onions and mushrooms visible."],
    ["Boeuf Bourguignon", "A bowl of boeuf bourguignon, tender beef chunks in a deep wine sauce, carrots and pearl onions, fresh thyme sprig."],
    ["Ratatouille", "A rustic dish of ratatouille, visible layered rounds of zucchini, eggplant, and tomato in a shallow baking dish."],
    ["Souffle", "A risen golden cheese soufflé in a ramekin, visible light airy texture at the cracked top."],
    ["Creme Brulee", "A ramekin of crème brûlée with a cracked caramelized sugar top, a spoon resting beside it having just broken the crust."],
    ["French Onion Soup", "A crock of French onion soup, deep caramel broth topped with melted bubbling cheese over a crouton, steam rising."],
    ["Croque Monsieur", "A cut croque monsieur sandwich showing melted cheese and ham layers, golden grilled bread, béchamel visible on top."],
    ["Quiche Lorraine", "A cut slice of quiche Lorraine on a plate, visible egg custard studded with bacon, a flaky golden crust."],
    ["Chocolate Eclair", "A glossy chocolate éclair sliced to reveal a smooth cream filling, dark chocolate glaze reflecting soft light."],
    ["Macarons", "A small stack of pastel macarons on a plate, visible ruffled edges and cream filling, soft natural light catching their shells."],
  ],
  vietnamese: [
    ["Pho", "A close bowl of pho, thin-sliced beef, rice noodles, fresh herbs and bean sprouts on the side, steam rising."],
    ["Banh Mi", "A cut banh mi sandwich showing layers of pâté, pickled carrot and daikon, cilantro, and sliced chili in a crusty baguette."],
    ["Goi Cuon (Spring Rolls)", "Fresh translucent spring rolls (goi cuon) showing visible shrimp, herbs, and vermicelli through the rice paper, a small dish of peanut sauce beside them."],
    ["Bun Cha", "A bowl of bun cha, grilled pork patties in a light dipping broth beside a plate of vermicelli noodles and fresh herbs."],
    ["Cao Lau", "A bowl of cao lau noodles, visible thick chewy noodles, slices of pork, fresh greens, and crispy croutons on top."],
    ["Bun Bo Hue", "A bowl of bun bo hue, deep red spicy-savory broth, visible thick rice noodles and sliced beef, fresh herbs on the side."],
    ["Banh Xeo", "A folded golden banh xeo pancake, visible bean sprouts and shrimp peeking from inside, fresh lettuce and herbs beside it."],
    ["Cha Gio (Fried Spring Rolls)", "A stack of crispy fried Vietnamese spring rolls (cha gio) sliced diagonally, a small dish of nuoc cham dipping sauce beside them."],
    ["Bun Thit Nuong", "A bowl of bun thit nuong, grilled lemongrass pork over vermicelli noodles, fresh herbs and crushed peanuts on top."],
    ["Com Tam (Broken Rice)", "A plate of com tam, grilled pork chop over broken rice, a fried egg and pickled vegetables arranged beside it."],
  ],
  korean: [
    ["Kimchi Jjigae", "A bubbling bowl of kimchi jjigae stew, visible kimchi and tofu cubes in a deep red broth, still simmering."],
    ["Bulgogi", "A sizzling plate of bulgogi, thin-sliced marinated beef with visible caramelized edges, scallions and sesame seeds scattered."],
    ["Bibimbap", "A close bowl of bibimbap, colorful arranged vegetables and marinated beef around a fried egg yolk, gochujang visible at the edge."],
    ["Tteokbokki", "A pan of tteokbokki, glossy red rice cakes and fish cake in a spicy-sweet sauce, sesame seeds and scallion on top."],
    ["Japchae", "A plate of japchae glass noodles, visible glossy sheen, colorful julienned vegetables and beef mixed through."],
    ["Korean Fried Chicken", "A plate of Korean fried chicken, glossy sticky-glazed pieces, sesame seeds and scallion scattered on top, visible crispy texture."],
    ["Kimchi Fried Rice", "A pan of kimchi fried rice, visible flecks of red kimchi through the rice, a fried egg with a runny yolk on top."],
    ["Galbi (Korean BBQ Short Ribs)", "Grilled galbi short ribs with visible char marks and glossy marinade, sesame seeds scattered, a small dish of dipping sauce beside them."],
    ["Kimbap", "Sliced kimbap rolls arranged on a plate, visible colorful vegetable and egg filling spiraled inside the seaweed wrap."],
    ["Sundubu Jjigae", "A bubbling stone pot of sundubu jjigae, visible soft silken tofu in a fiery red broth, a raw egg just cracked on top, still simmering."],
  ],
};

// --- Build markdown -----------------------------------------------------
let md = `# Food Swipe — Photography Asset Manifest (expanded, India-menu researched)

99 images total: 9 cuisine hero shots + 90 dish shots (10 per cuisine — the original 5-dish catalog plus 5 more researched from what's actually served at Italian/Mexican/Japanese/Indian/Thai/Greek/French/Vietnamese/Korean restaurants in India today, via Zomato/Swiggy-adjacent sources and food-press coverage). Every prompt below is **complete and self-contained** — the style prefix and suffix are already baked into each one. Copy-paste a single cell straight into your image tool, nothing to assemble.

## Technical spec (every image)

- **Aspect ratio**: 3:4 (portrait)
- **Resolution**: generate at the highest quality your tool offers, then downscale so the long edge is ~1200px before saving
- **Format**: \`.jpg\`, ~80-85% quality
- **File naming**: exact paths given below, relative to \`public/images/\`. Folders already exist.

## Cuisine hero images (9) — \`cuisines/<id>.jpg\`

Wider framing than the dish shots below — one signature dish plus a hint of the table setting.

| Path | Prompt (complete — copy/paste as-is) |
|---|---|
`;

for (const [id, subject] of Object.entries(heroes)) {
  md += `| \`cuisines/${id}.jpg\` | ${full(subject)} |\n`;
}

md += `
## Dish images (90, 10 per cuisine) — \`dishes/<cuisine-id>/<slug>.jpg\`

Tighter framing — a single close-up of just that dish. First 5 rows per cuisine are the original catalog (unchanged from the first manifest); next 5 are the India-menu-researched additions.

`;

for (const [cuisine, list] of Object.entries(dishes)) {
  md += `### \`dishes/${cuisine}/\`\n\n| Dish | Path | Prompt (complete — copy/paste as-is) |\n|---|---|---|\n`;
  for (const [name, subject] of list) {
    md += `| ${name} | \`${slugify(name)}.jpg\` | ${full(subject)} |\n`;
  }
  md += `\n`;
}

md += `## When done

Drop all 99 files into the paths above, then let me know — I'll wire them into \`cuisine-card.tsx\`/\`dish-card.tsx\` with the Ken Burns motion treatment, build the \`dishName → catalog match → specific image, else cuisine hero\` fallback lookup, and verify live via the two-user harness before moving to the match-reveal celebration work.

Migration \`supabase/migrations/0016_expand_cuisine_dishes.sql\` expands the \`cuisines.dishes\` catalog in Postgres to match this 10-per-cuisine list — run it in the SQL editor whenever convenient, independent of when the images land (the app already tolerates a dish string with no matching image, see the fallback rule above).
`;

mkdirSync("public/images", { recursive: true });
writeFileSync("public/images/ASSET-PROMPTS.md", md, "utf-8");
console.log("Wrote public/images/ASSET-PROMPTS.md,", md.length, "chars");

// --- Build migration SQL -------------------------------------------------
function sqlArray(names) {
  return "ARRAY[" + names.map((n) => `'${n.replace(/'/g, "''")}'`).join(", ") + "]";
}

let sql = `-- 0016_expand_cuisine_dishes.sql
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

update public.cuisines set dishes =
`;

const entries = Object.entries(dishes);
entries.forEach(([id, list], i) => {
  const names = list.map(([n]) => n);
  sql += `  ${sqlArray(names)}\nwhere id = '${id}'${i === entries.length - 1 ? ";" : ""}\n`;
  if (i < entries.length - 1) {
    // separate statements per cuisine (simplest to read/debug, matches the
    // migration style already used elsewhere in this project)
    sql = sql.slice(0, -1); // remove trailing where-clause newline join artifact fix below
  }
});

// The loop above is awkward for multi-statement SQL; rebuild cleanly instead.
sql = `-- 0016_expand_cuisine_dishes.sql
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

`;
for (const [id, list] of entries) {
  const names = list.map(([n]) => n);
  sql += `update public.cuisines set dishes = ${sqlArray(names)} where id = '${id}';\n`;
}

writeFileSync("supabase/migrations/0016_expand_cuisine_dishes.sql", sql, "utf-8");
console.log("Wrote supabase/migrations/0016_expand_cuisine_dishes.sql");

// Print slug list for verification
console.log("\n--- slug check ---");
for (const [cuisine, list] of Object.entries(dishes)) {
  for (const [name] of list) console.log(`${cuisine}/${slugify(name)}.jpg  <-  ${name}`);
}
