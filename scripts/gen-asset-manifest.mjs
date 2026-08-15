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

// Indian refine-layer subcategories (0017_indian_subcuisines.sql). Ids and
// dish lists here MUST match that migration exactly -- these become the
// image paths src/lib/dish-images.ts (Phase C) will look up by id/slug.
// Reuses the same `cuisines/<id>.jpg` and `dishes/<id>/<slug>.jpg`
// conventions as the top-level 9 cuisines -- subcuisine ids (all
// "indian-<region>") share the same namespace without colliding, so no new
// top-level folder is needed.
const subcuisineHeroes = {
  "indian-north": "A rustic thali spread with paneer butter masala, dal, and buttered roti, evoking a North Indian home-style meal, steam rising.",
  "indian-south": "A banana-leaf-style spread of dosa, sambar, and coconut chutney, evoking a South Indian breakfast table.",
  "indian-mughlai": "A regal plate of mutton korma with saffron rice, rich glossy gravy, evoking Mughlai royal-kitchen dining.",
  "indian-biryani": "A large handi of dum biryani opened to reveal layered saffron rice and tender meat, steam escaping.",
  "indian-bengali": "A Bengali thali with fish curry, rice, and a small bowl of mishti doi, evoking a Bengali home meal.",
  "indian-gujarati": "A Gujarati thali platter with dhokla, kadhi, and thepla, evoking a vibrant vegetarian spread.",
  "indian-rajasthani": "A rustic Rajasthani thali with dal baati churma, evoking a desert-region feast.",
  "indian-street-food": "A vibrant street-food spread of pani puri and pav bhaji on a stainless steel plate, evoking Indian street food stalls.",
  "indian-tandoor": "A sizzling platter of assorted tandoori kebabs fresh off the grill, char marks visible, smoke rising.",
  "indian-hyderabadi": "A steaming plate of Hyderabadi haleem alongside a plate of biryani, evoking Hyderabad's Nizami cuisine.",
};

const subcuisineDishes = {
  "indian-north": [
    ["Paneer Butter Masala", "A bowl of paneer butter masala, glossy orange-red tomato-butter gravy, soft paneer cubes, a swirl of cream on top."],
    ["Rajma Chawal", "A plate of rajma chawal, red kidney bean curry ladled over steamed rice, a wedge of lemon and onion rings beside it."],
    ["Amritsari Kulcha", "A stuffed Amritsari kulcha cut open showing a spiced potato filling, golden char spots, a dollop of butter melting on top."],
    ["Sarson ka Saag with Makki Roti", "A bowl of sarson ka saag with a knob of butter melting on top, a makki roti and a small bowl of jaggery beside it."],
    ["Malai Kofta", "A bowl of malai kofta, soft fried dumplings in a creamy orange gravy, a swirl of cream and chopped coriander on top."],
    ["Kadhai Paneer", "A sizzling kadhai of paneer with bell peppers in a thick tomato-onion masala, fresh coriander scattered on top."],
    ["Aloo Paratha", "A golden aloo paratha cut open showing a spiced potato filling, a dollop of butter melting on top, a small bowl of curd and pickle beside it."],
    ["Paneer Tikka", "Skewers of grilled paneer tikka with charred edges and bell peppers, a mint chutney dip and lemon wedge beside them."],
  ],
  "indian-south": [
    ["Uttapam", "A thick uttapam pancake topped with chopped onion, tomato, and coriander, a small bowl of coconut chutney beside it."],
    ["Rava Dosa", "A lacy, crisp rava dosa folded on a plate, visible golden lattice texture, sambar and chutney in small bowls beside it."],
    ["Medu Vada", "A stack of golden medu vada donuts, crisp exterior, a small bowl of coconut chutney and sambar beside them."],
    ["Pongal", "A bowl of ven pongal, soft rice-lentil porridge topped with cashews and a drizzle of ghee, black pepper visible."],
    ["Chettinad Chicken Curry", "A bowl of Chettinad chicken curry, dark spiced gravy with visible curry leaves and whole spices, steam rising."],
    ["Appam with Stew", "A lacy bowl-shaped appam beside a small bowl of creamy coconut vegetable stew."],
    ["Rasam Rice", "A bowl of rasam poured over steamed rice, visible tamarind broth with curry leaves and mustard seeds floating on top."],
    ["Curd Rice", "A bowl of curd rice tempered with mustard seeds, curry leaves, and pomegranate seeds scattered on top."],
  ],
  "indian-mughlai": [
    ["Mutton Korma", "A bowl of mutton korma, rich glossy brown gravy with tender meat, fried onions and coriander scattered on top."],
    ["Shahi Paneer", "A bowl of shahi paneer, creamy cashew-based orange gravy with soft paneer cubes, a swirl of cream on top."],
    ["Nihari", "A bowl of nihari stew, deep reddish-brown slow-cooked meat gravy, a scatter of ginger julienne and coriander on top."],
    ["Chicken Rezala", "A bowl of chicken rezala, pale creamy white gravy with visible whole spices, a hint of saffron color."],
    ["Galouti Kebab", "A plate of soft galouti kebabs, delicately charred, resting on a thin roomali roti with mint chutney beside them."],
    ["Nawabi Biryani", "A platter of nawabi biryani, layered saffron rice with tender meat, fried onions and boiled egg halves visible."],
    ["Sheermal", "A golden saffron-tinted sheermal bread, slightly sweet crust, torn to reveal a soft interior, resting on a plate."],
    ["Murgh Musallam", "A whole roasted murgh musallam chicken glazed in a rich spiced gravy, garnished with fried onions and boiled eggs."],
  ],
  "indian-biryani": [
    ["Hyderabadi Chicken Biryani", "A plate of Hyderabadi chicken biryani, layered saffron rice with visible chicken pieces, fried onions, and a boiled egg half."],
    ["Mutton Biryani", "A mound of mutton biryani, fragrant saffron rice with tender mutton pieces, mint leaves and fried onions scattered on top."],
    ["Veg Dum Biryani", "A plate of vegetable dum biryani, colorful saffron rice with visible vegetables and paneer cubes, fried onions on top."],
    ["Kolkata Biryani", "A plate of Kolkata-style biryani, saffron rice with a whole potato and egg visible, a lighter aromatic style."],
    ["Lucknowi Biryani", "A plate of Lucknowi-style dum biryani, delicately layered rice with tender meat, subtle golden hue, fried onions on top."],
    ["Ambur Biryani", "A plate of Ambur-style biryani, short-grain seeraga samba rice with meat pieces, a side of brinjal gravy and raita."],
    ["Tehri", "A plate of tehri, turmeric-yellow vegetable rice with visible potato and pea pieces, a wedge of lemon beside it."],
    ["Prawn Biryani", "A plate of prawn biryani, saffron rice with visible pink prawns, fried onions and coriander scattered on top."],
  ],
  "indian-bengali": [
    ["Shorshe Ilish", "A piece of hilsa fish in a pungent yellow mustard gravy, mustard seeds visible, a green chili resting on top."],
    ["Chingri Malai Curry", "A bowl of chingri malai curry, prawns in a rich coconut-cashew gravy, a light golden hue."],
    ["Kosha Mangsho", "A bowl of kosha mangsho, dark slow-cooked mutton in a thick spiced gravy, glossy oil sheen on top."],
    ["Aloo Posto", "A bowl of aloo posto, potatoes cooked in a poppy seed paste, a pale creamy texture with a green chili on top."],
    ["Luchi with Aloo Dum", "Puffed golden luchi bread beside a bowl of spiced aloo dum, steam still rising from the potatoes."],
    ["Fish Kabiraji", "A golden fish kabiraji cutlet coated in a fluffy egg-net batter, sliced open to show flaky fish inside."],
    ["Cholar Dal", "A bowl of cholar dal, Bengal gram lentils with visible coconut slivers and raisins, a bay leaf resting on top."],
    ["Mishti Doi", "A clay pot of mishti doi, set caramel-brown sweetened yogurt with a glossy surface, a spoon resting beside it."],
  ],
  "indian-gujarati": [
    ["Dhokla", "A plate of steamed yellow dhokla squares, topped with mustard seeds, curry leaves, and grated coconut."],
    ["Undhiyu", "A bowl of undhiyu, a mixed vegetable medley with visible surti beans and fenugreek dumplings, a rustic green-brown color."],
    ["Khandvi", "Tightly rolled yellow khandvi spirals on a plate, garnished with mustard seeds and coriander."],
    ["Gujarati Kadhi", "A bowl of Gujarati kadhi, pale yellow tangy-sweet yogurt curry, tempered with curry leaves and mustard seeds on top."],
    ["Thepla", "A stack of folded thepla flatbreads, visible fenugreek flecks, a small bowl of pickle and curd beside them."],
    ["Handvo", "A cut wedge of handvo, a savory lentil-rice cake with a crisp golden top studded with sesame seeds."],
    ["Fafda with Jalebi", "Crisp golden fafda strips beside a coil of glistening orange jalebi, a small bowl of green chutney beside them."],
    ["Gujarati Dal", "A bowl of Gujarati dal, a sweet-and-tangy yellow lentil soup, tempered with cumin and curry leaves on top."],
  ],
  "indian-rajasthani": [
    ["Dal Baati Churma", "Round baked baati balls beside a bowl of dal and a mound of sweet churma, ghee glistening on top."],
    ["Laal Maas", "A bowl of laal maas, fiery red Rajasthani mutton curry, glossy oil sheen with whole red chilies visible."],
    ["Gatte ki Sabji", "A bowl of gatte ki sabji, gram-flour dumplings in a tangy yellow yogurt gravy, coriander scattered on top."],
    ["Ker Sangri", "A bowl of ker sangri, a dry desert-bean and berry preparation, dark reddish-brown with visible whole spices."],
    ["Pyaaz Kachori", "A golden fried pyaaz kachori cut open showing a spiced onion filling, flaky crisp layers visible."],
    ["Mirchi Vada", "Golden fried mirchi vada, large stuffed chilies in a crisp gram-flour batter, a wedge of lemon beside them."],
    ["Rajasthani Kadhi", "A bowl of Rajasthani kadhi, tangy yellow gravy with small pakoda fritters floating in it."],
    ["Bajre ki Roti with Lehsun Chutney", "A round bajre ki roti with a knob of white butter melting on top, a small bowl of fiery red garlic chutney beside it."],
  ],
  "indian-street-food": [
    ["Pani Puri", "A plate of crisp pani puri shells filled with spiced potato, one shell being filled with tangy tamarind water mid-pour."],
    ["Pav Bhaji", "A sizzling plate of mashed pav bhaji topped with a knob of butter, toasted buttered pav buns and chopped onion beside it."],
    ["Sev Puri", "A plate of sev puri, crisp puris topped with chutneys, chopped onion, and fine sev noodles scattered on top."],
    ["Vada Pav", "A vada pav sandwich, a spiced potato fritter in a soft bun, green chutney visible at the edge, a fried green chili beside it."],
    ["Bhel Puri", "A bowl of bhel puri, puffed rice tossed with tangy chutneys, sev, and chopped vegetables, coriander on top."],
    ["Aloo Tikki Chaat", "A plate of aloo tikki chaat, crisp potato patties topped with yogurt, chutneys, and sev, coriander scattered on top."],
    ["Dahi Puri", "A plate of dahi puri, crisp puris filled with potato and topped with whipped yogurt and tangy chutneys."],
    ["Misal Pav", "A bowl of spicy misal curry topped with crunchy farsan, toasted pav buns and a lemon wedge beside it."],
  ],
  "indian-tandoor": [
    ["Tandoori Chicken", "A plate of tandoori chicken, char-marked red-orange marinated pieces, a wedge of lemon and sliced onion beside them."],
    ["Seekh Kebab", "Skewers of minced seekh kebab with visible char marks, resting on a bed of sliced onion, mint chutney beside them."],
    ["Chicken Malai Tikka", "Skewers of pale creamy chicken malai tikka with light char marks, a mint chutney dip beside them."],
    ["Hariyali Paneer Tikka", "Skewers of paneer tikka coated in a vibrant green herb marinade, char marks visible, bell peppers between the cubes."],
    ["Reshmi Kebab", "Skewers of soft reshmi kebab, pale golden and lightly charred, resting on a plate with a lemon wedge."],
    ["Tandoori Prawns", "Skewers of char-marked tandoori prawns, red-orange marinade visible, a wedge of lemon beside them."],
    ["Mutton Seekh Kebab", "Skewers of mutton seekh kebab with a deep char, resting on sliced onion rings, mint chutney beside them."],
    ["Fish Tikka", "Skewers of char-marked fish tikka chunks in a red marinade, a wedge of lemon and mint chutney beside them."],
  ],
  "indian-hyderabadi": [
    ["Haleem", "A bowl of haleem, a thick shredded-meat and lentil porridge, garnished with fried onions, mint, and a wedge of lemon."],
    ["Baghara Baingan", "A bowl of baghara baingan, whole baby eggplants in a peanut-sesame gravy, a rich brown-orange color."],
    ["Mirchi ka Salan", "A bowl of mirchi ka salan, long green chilies in a tangy peanut-sesame gravy, glossy oil sheen on top."],
    ["Double ka Meetha", "A dish of double ka meetha, golden fried bread slices soaked in sweetened milk, garnished with nuts and saffron strands."],
    ["Hyderabadi Khichdi", "A bowl of Hyderabadi khichdi, soft rice-lentil mixture, a side of baghara baingan and boiled egg beside it."],
    ["Bagara Rice", "A plate of bagara rice, fragrant tempered rice with whole spices and fried onions visible."],
    ["Boti Kebab", "Skewers of boti kebab, tender char-marked meat chunks, resting on sliced onion, mint chutney beside them."],
    ["Qubani ka Meetha", "A bowl of qubani ka meetha, glossy stewed apricots topped with a dollop of cream, garnished with almond slivers."],
  ],
};

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

189 images total: 9 cuisine hero shots + 90 dish shots (10 per cuisine, all nine cuisines) **plus** a dedicated Indian refine layer — 10 regional-style hero shots + 80 dish shots (8 per style: North, South, Mughlai, Biryani & Rice, Bengali, Gujarati, Rajasthani, Street Food & Chaat, Tandoor & Kebabs, Hyderabadi), researched against real Zomato/Swiggy category taxonomy and their most-ordered-dish data. Every prompt below is **complete and self-contained** — the style prefix and suffix are already baked into each one. Copy-paste a single cell straight into your image tool, nothing to assemble.

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

md += `## Indian refine layer — regional style hero images (10) — \`cuisines/<subcuisine-id>.jpg\`

After a room matches on Indian, they swipe once more on which regional style to narrow down to (supabase/migrations/0017_indian_subcuisines.sql) before restaurant discovery. These share the same \`cuisines/\` folder and file convention as the 9 top-level cuisine heroes above — the ids just happen to all start with \`indian-\`, so there's no separate folder to create.

| Path | Prompt (complete — copy/paste as-is) |
|---|---|
`;

for (const [id, subject] of Object.entries(subcuisineHeroes)) {
  md += `| \`cuisines/${id}.jpg\` | ${full(subject)} |\n`;
}

md += `
## Indian refine layer — dish images (80, 8 per style) — \`dishes/<subcuisine-id>/<slug>.jpg\`

Same \`dishes/<id>/\` convention as the 9 top-level cuisines — \`<subcuisine-id>\` is e.g. \`indian-hyderabadi\`, a sibling folder to \`dishes/indian/\`, not nested inside it. None of these 80 dishes overlap with the 10 already in \`dishes/indian/\` (verified programmatically when this migration was written) — this is genuinely new content, not a re-shoot.

`;

for (const [subcuisine, list] of Object.entries(subcuisineDishes)) {
  md += `### \`dishes/${subcuisine}/\`\n\n| Dish | Path | Prompt (complete — copy/paste as-is) |\n|---|---|---|\n`;
  for (const [name, subject] of list) {
    md += `| ${name} | \`${slugify(name)}.jpg\` | ${full(subject)} |\n`;
  }
  md += `\n`;
}

md += `## When done

Drop all 189 files into the paths above, then let me know — I'll wire them into \`cuisine-card.tsx\`/\`dish-card.tsx\`/\`subcuisine-card.tsx\` with the Ken Burns motion treatment, build the \`dishName → catalog match → specific image, else cuisine hero\` fallback lookup, and verify live via the two-user harness before moving to the match-reveal celebration work.

Two migrations are pending, independent of when the images land (the app already tolerates a dish/subcuisine string with no matching image, see the fallback rule above):
- \`supabase/migrations/0016_expand_cuisine_dishes.sql\` — expands \`cuisines.dishes\` to 10 per cuisine.
- \`supabase/migrations/0017_indian_subcuisines.sql\` — adds the Indian refine layer (10 regional styles, 8 dishes each) and its matching mechanics.
`;

// Verify the "genuinely new content, not a re-shoot" claim made in the
// manifest text above, rather than asserting it without checking.
{
  const flatIndian = new Set(dishes.indian.map(([name]) => name));
  const subcuisineNames = Object.values(subcuisineDishes).flatMap((list) => list.map(([name]) => name));
  const overlap = subcuisineNames.filter((n) => flatIndian.has(n));
  if (overlap.length > 0) {
    throw new Error(`Subcuisine dishes overlap with the flat indian.dishes catalog: ${overlap.join(", ")}`);
  }
  const dupWithinSubcuisines = subcuisineNames.length !== new Set(subcuisineNames).size;
  if (dupWithinSubcuisines) {
    throw new Error("Duplicate dish name across two different Indian subcuisines -- check subcuisineDishes.");
  }
  console.log(`Verified: ${subcuisineNames.length} subcuisine dishes, zero overlap with flat indian.dishes, zero internal duplicates.`);
}

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
