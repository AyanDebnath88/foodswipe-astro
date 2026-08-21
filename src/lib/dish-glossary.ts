// Per-dish "what is this" glossary for the swipe deck's dish-guide section
// (user feedback: swiping past "Vietnamese" with no idea what pho or banh mi
// actually are). Keyed by the EXACT dish name strings seeded in
// supabase/migrations/0016_expand_cuisine_dishes.sql -- the same 90 dishes
// (9 cuisines x 10) that public/images/ASSET-PROMPTS.md photographed, so
// every entry here always has a real photo via getDishImage() in
// dish-images.ts. One short factual sentence each: what it is, plus a real
// origin/history detail, not a full essay -- this renders as a small pill,
// not an article.
export const DISH_GLOSSARY: Record<string, string> = {
  // Italian
  "Margherita Pizza": "Naples' original pizza, just tomato, mozzarella, and basil, named for Queen Margherita in 1889.",
  "Carbonara": "Roman pasta of egg, pecorino, guanciale, and black pepper, no cream despite what most recipes claim.",
  "Lasagna": "Layered baked pasta with ragu, bechamel, and cheese, an Emilia-Romagna Sunday dish turned worldwide staple.",
  "Risotto": "Northern Italian rice slow-stirred in broth until creamy, a technique more than a single recipe.",
  "Osso Buco": "Milanese braised veal shanks with marrow, traditionally finished with a lemon-garlic gremolata.",
  "Penne Arrabbiata": "Penne in a fiery tomato sauce, arrabbiata literally means angry in Italian.",
  "Fettuccine Alfredo": "Rome-born ribbon pasta tossed with butter and parmesan, richer American versions add cream.",
  "Fusilli Pesto": "Corkscrew pasta built to catch Genoa's basil, pine nut, and parmesan pesto in every twist.",
  "Spaghetti Aglio e Olio": "Naples' pantry pasta of garlic slow-cooked in olive oil with chili flakes, nothing else needed.",
  "Garlic Bread with Cheese": "Toasted bread rubbed with garlic and butter, melted cheese a modern add-on to an old side.",

  // Mexican
  "Tacos al Pastor": "Marinated pork shaved off a spinning vertical spit, a Mexico City classic born from Lebanese shawarma.",
  "Guacamole": "Mashed avocado with lime, onion, and chili, an Aztec dish whose name comes straight from Nahuatl.",
  "Enchiladas": "Corn tortillas rolled around a filling and bathed in chili sauce, then baked until the edges crisp.",
  "Mole Poblano": "Puebla's dark, complex sauce built from dozens of chilies, spices, and a touch of chocolate.",
  "Chiles Rellenos": "Poblano peppers stuffed with cheese or meat, battered, and fried until the shell puffs golden.",
  "Fajitas": "Grilled skirt steak or chicken sliced thin and served sizzling with peppers, onions, and warm tortillas.",
  "Quesadillas": "A tortilla folded around melted cheese and griddled crisp, one of Mexico's simplest street staples.",
  "Nachos": "Fried tortilla chips piled with cheese and toppings, invented in 1943 by Ignacio Nacho Anaya.",
  "Burrito Bowl": "A burrito's fillings served over rice without the tortilla, a modern fast-casual invention, not traditional Mexican.",
  "Tamales": "Masa dough steamed in a corn husk or banana leaf around a savory or sweet filling.",

  // Japanese
  "Sushi Platter": "Vinegared rice paired with raw fish or vegetables, a preservation method turned centuries-old craft.",
  "Tonkotsu Ramen": "Fukuoka's ramen style, pork bones simmered for hours into a cloudy, collagen-rich broth.",
  "Tempura": "Seafood and vegetables in a light batter, flash-fried, a technique Portuguese traders introduced in the 1500s.",
  "Udon Noodles": "Thick wheat noodles served hot in broth or cold with dipping sauce, chewy by design.",
  "Okonomiyaki": "A savory griddled pancake of cabbage and batter, its name means grilled as you like it.",
  "Gyoza": "Pan-fried dumplings with a crisp seared base and steamed top, Japan's take on Chinese jiaozi.",
  "Katsu Curry": "Breaded fried pork or chicken cutlet over Japanese curry rice, a British-influenced dish now everywhere.",
  "Teriyaki Chicken": "Chicken glazed in a sweet soy, mirin, and sake sauce cooked down until sticky and shiny.",
  "Miso Soup": "Fermented soybean paste dissolved into dashi broth, usually with tofu and seaweed, a daily staple.",
  "Dynamite Sushi Roll": "A modern maki roll of tempura shrimp and spicy mayo, an American-Japanese fusion creation.",

  // Indian
  "Chicken Tikka Masala": "Grilled marinated chicken in a creamy tomato sauce, likely invented in a British-Indian kitchen.",
  "Biryani": "Layered spiced rice and meat cooked together, a Mughal-era dish with dozens of regional versions.",
  "Samosa": "A fried pastry triangle stuffed with spiced potatoes or meat, brought to India via Persian traders.",
  "Palak Paneer": "Fresh paneer cheese simmered in a pureed spinach and spice gravy, a North Indian vegetarian staple.",
  "Rogan Josh": "Kashmiri braised lamb in a red chili and yogurt gravy, its color, not heat, gives it the name.",
  "Butter Chicken": "Delhi's tandoori chicken simmered in a buttery tomato sauce, invented in the 1950s at Moti Mahal.",
  "Masala Dosa": "A crisp fermented rice-lentil crepe folded around spiced potato filling, South India's iconic breakfast.",
  "Idli Sambar": "Steamed rice-lentil cakes served with a tangy lentil-vegetable stew, a Tamil Nadu breakfast staple.",
  "Chole Bhature": "Spiced chickpea curry with deep-fried leavened bread, a Punjabi favorite now a Delhi street classic.",
  "Dal Makhani": "Black lentils and kidney beans simmered overnight with butter and cream, Punjab's slow-cooked comfort dish.",

  // Thai
  "Pad Thai": "Stir-fried rice noodles with egg, tamarind, and peanuts, popularized nationally as a 1930s patriotic dish.",
  "Tom Yum Goong": "A hot and sour shrimp soup built on lemongrass, galangal, and kaffir lime, Thailand's signature broth.",
  "Green Curry": "Coconut milk curry colored by fresh green chilies, one of the spicier curries on a Thai menu.",
  "Massaman Curry": "A mild, nutty curry with Persian and Indian roots, cinnamon and cardamom set it apart from the rest.",
  "Som Tum": "Pounded green papaya salad with lime, chili, and fish sauce, Isan region's fiery signature dish.",
  "Tom Kha Soup": "Coconut milk soup with galangal and lemongrass, gentler and creamier than its cousin tom yum.",
  "Khao Suey": "Coconut curry noodle soup with crunchy toppings, adopted from Burmese cooking into Thai regional menus.",
  "Pad Krapow (Thai Basil Stir Fry)": "Minced meat stir-fried with holy basil and chili, usually served over rice with a fried egg.",
  "Mango Sticky Rice": "Sweet sticky rice with coconut cream and fresh mango, a beloved Thai dessert best in mango season.",
  "Thai Spring Rolls": "Crisp fried rolls of vegetables and glass noodles, served with a sweet chili dipping sauce.",

  // Greek
  "Moussaka": "Layered eggplant, spiced ground meat, and bechamel baked into a casserole, Greece's answer to lasagna.",
  "Gyro": "Spit-roasted meat shaved into warm pita with tomato, onion, and tzatziki, Greece's take on the kebab tradition.",
  "Souvlaki": "Skewered grilled meat, usually pork or chicken, one of Greece's oldest and simplest street foods.",
  "Spanakopita": "Flaky phyllo pastry filled with spinach and feta, a savory pie found at nearly every Greek table.",
  "Greek Salad": "Tomato, cucumber, olives, and feta with olive oil, deliberately served without lettuce in its home country.",
  "Dolmades": "Grape leaves rolled around rice and herbs, sometimes meat, shared across the Ottoman-influenced Mediterranean.",
  "Baklava": "Layered phyllo, chopped nuts, and honey syrup, a dessert claimed by nearly every former Ottoman kitchen.",
  "Hummus with Pita": "Blended chickpeas, tahini, and lemon scooped up with warm pita, a Levantine dish common on Greek menus.",
  "Tzatziki Dip": "Strained yogurt with cucumber, garlic, and dill, served as a dip or a cooling sauce for grilled meat.",
  "Loukoumades": "Deep-fried dough balls soaked in honey syrup, often called Greece's original doughnut.",

  // French
  "Coq au Vin": "Chicken braised slowly in red wine with mushrooms and lardons, a rustic Burgundy farmhouse dish.",
  "Boeuf Bourguignon": "Beef stewed in red wine with carrots and onions, Burgundy's peasant dish elevated to French classic.",
  "Ratatouille": "A Provencal stew of eggplant, zucchini, and peppers, simmered together until soft and deeply savory.",
  "Souffle": "Egg yolks and whipped whites baked until they rise dramatically, notoriously unforgiving of a slammed oven door.",
  "Creme Brulee": "Vanilla custard topped with a torched sugar crust, the crack of the shell is the whole point.",
  "French Onion Soup": "Caramelized onions in beef broth, topped with toasted bread and melted gruyere under the broiler.",
  "Croque Monsieur": "A grilled ham and cheese sandwich finished with bechamel, Paris cafe comfort food since the early 1900s.",
  "Quiche Lorraine": "An open egg custard tart with bacon and cheese, named for the Lorraine region in northeast France.",
  "Chocolate Eclair": "Choux pastry piped long, filled with cream, and glazed in chocolate, a 19th-century Parisian invention.",
  "Macarons": "Almond meringue shells sandwiching a filling, Paris perfected the technique after the recipe arrived from Italy.",

  // Vietnamese
  "Pho": "A beef or chicken noodle soup with a slow-simmered spiced broth, Vietnam's most recognized national dish.",
  "Banh Mi": "A baguette sandwich of pork, pate, and pickled vegetables, French bread meeting Vietnamese flavor under colonial rule.",
  "Goi Cuon (Spring Rolls)": "Fresh rice-paper rolls of herbs, noodles, and shrimp or pork, served cold with a peanut or fish-sauce dip.",
  "Bun Cha": "Grilled pork patties served over rice noodles with herbs and a sweet-sour dipping broth, a Hanoi favorite.",
  "Cao Lau": "Thick chewy noodles with pork and greens, a Hoi An specialty said to need water from the town's own wells.",
  "Bun Bo Hue": "A spicy lemongrass beef and pork noodle soup from the former imperial city of Hue, bolder than pho.",
  "Banh Xeo": "A crisp turmeric rice-flour crepe folded around pork, shrimp, and bean sprouts, its name means sizzling cake.",
  "Cha Gio (Fried Spring Rolls)": "Crispy fried rolls of pork, mushroom, and vermicelli, southern Vietnam's version of the spring roll.",
  "Bun Thit Nuong": "Grilled marinated pork over rice vermicelli with herbs and pickled vegetables, a common lunch order across Vietnam.",
  "Com Tam (Broken Rice)": "Rice made from broken grains once considered a byproduct, now a Saigon staple served with grilled pork.",

  // Korean
  "Kimchi Jjigae": "A bubbling stew built around aged kimchi, pork, and tofu, sour and spicy by design.",
  "Bulgogi": "Thin marinated beef grilled or pan-seared, its soy-pear marinade dates back to Korea's Goguryeo era.",
  "Bibimbap": "Rice topped with seasoned vegetables, meat, and a fried egg, mixed together with gochujang before eating.",
  "Tteokbokki": "Chewy rice cakes simmered in a sweet-spicy gochujang sauce, a Korean street food staple.",
  "Japchae": "Stir-fried glass noodles with vegetables and beef, sesame oil giving it a glossy, savory finish.",
  "Korean Fried Chicken": "Double-fried for extra crunch, then coated in a sweet, spicy, or soy-garlic glaze.",
  "Kimchi Fried Rice": "Day-old rice stir-fried with kimchi and its juices, often topped with a fried egg.",
  "Galbi (Korean BBQ Short Ribs)": "Marinated short ribs grilled tableside, sweetened with pear and soy in the classic marinade.",
  "Kimbap": "Rice and vegetables rolled in seaweed, seasoned with sesame oil rather than vinegar, unlike Japanese sushi rolls.",
  "Sundubu Jjigae": "A soft-tofu stew served bubbling hot in its own stone pot, often with a raw egg cracked in.",
};

/** The blurb for a dish, or undefined for anything outside the 90-dish seeded catalog. */
export function getDishBlurb(dishName: string): string | undefined {
  return DISH_GLOSSARY[dishName];
}
