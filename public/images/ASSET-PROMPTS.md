# Food Swipe — Photography Asset Manifest

54 images total: 9 cuisine hero shots + 45 catalog dish shots. Generate with whatever tool you like — the **style prefix/suffix below must be used verbatim on every single prompt** so all 54 read as one consistent shoot, regardless of which model actually makes them. This is the thing that will make or break whether the swipe deck feels designed vs. stock-photo-mismatched.

## Style prefix — prepend to every prompt, unchanged

> Editorial food photography, warm and moody, soft directional window light from the left, shallow depth of field with a softly blurred background, styled on a rustic warm-toned ceramic or stone surface with subtle terracotta clay and soft gold tones visible in the props (linen napkin, blurred side dishes in the background), natural and appetizing, high-end restaurant editorial style, light film-photography grain, true-to-life color.

## Style suffix — append to every prompt, unchanged

> No people, no hands, no text, no watermark, no logos, no plate rim awkwardly cropped, single dish as the hero subject.

## Technical spec (every image)

- **Aspect ratio**: 3:4 (portrait)
- **Resolution**: generate at the highest quality your tool offers, then downscale so the long edge is ~1200px before saving (keeps `public/` and page-weight sane — these are swipe cards, not hero banners)
- **Format**: `.jpg`, reasonable quality (~80-85%) — no need for lossless
- **File naming**: exact paths given below, relative to `public/images/`. Folders already exist.

## Cuisine hero images (9) — `cuisines/<id>.jpg`

Wider framing than the individual dish shots below — one signature dish plus a hint of the table setting, representing the whole cuisine, not a tight single-plate crop.

| Path | Subject |
|---|---|
| `cuisines/korean.jpg` | Bibimbap served in a hot sizzling stone bowl (dolsot) — rice, julienned vegetables, marinated beef, a fried egg on top, gochujang, a wisp of steam still rising, shot 3/4 overhead with a couple of small banchan side dishes softly blurred in the background |
| `cuisines/italian.jpg` | A creamy carbonara twirled on a fork resting over a plate of pasta, fresh cracked black pepper and grated pecorino visible, a glass of white wine and torn bread softly blurred in the background |
| `cuisines/mexican.jpg` | A trio of tacos al pastor on a wooden board, charred pineapple and cilantro visible, lime wedges and a small bowl of salsa softly blurred in the background |
| `cuisines/japanese.jpg` | An arranged sushi platter — nigiri and maki with visible grain texture and glossy fish, a small dish of soy sauce and pickled ginger softly blurred in the background |
| `cuisines/indian.jpg` | Chicken tikka masala in a copper karahi, visible steam, basmati rice and a torn piece of naan softly blurred in the background |
| `cuisines/thai.jpg` | Pad thai on a plate with visible shrimp, egg ribbons, bean sprouts and crushed peanuts, a lime wedge and chili flakes in view |
| `cuisines/greek.jpg` | A gyro plate with sliced meat, warm pita, and a dollop of tzatziki, olives and a small Greek salad softly blurred in the background |
| `cuisines/french.jpg` | Coq au vin in a rustic cast-iron pot, visible braised chicken and pearl onions in a deep wine sauce, a glass of red wine softly blurred in the background |
| `cuisines/vietnamese.jpg` | A bowl of pho with visible rice noodles, thin-sliced beef, and fresh herbs, steam rising, chopsticks resting on the bowl's edge |

## Dish images (45) — `dishes/<cuisine-id>/<slug>.jpg`

Tighter framing than the hero shots — a single close-up of just that dish, appetizing, minimal props.

### `dishes/italian/`
| Path | Subject |
|---|---|
| `margherita-pizza.jpg` | A wood-fired Margherita pizza slice being lifted, melted mozzarella stretching, fresh basil leaves, blistered crust |
| `carbonara.jpg` | A close-up bowl of spaghetti carbonara, glossy egg-and-cheese sauce coating the pasta, cracked black pepper, guanciale visible |
| `lasagna.jpg` | A cut slice of lasagna on a plate showing distinct layers of pasta, bolognese, and melted cheese, a little sauce pooling |
| `risotto.jpg` | A creamy mushroom risotto in a shallow bowl, glossy texture, shaved parmesan and a drizzle of truffle oil on top |
| `osso-buco.jpg` | A braised osso buco shank on a plate, rich glossy sauce, visible bone marrow, a sprinkle of gremolata |

### `dishes/mexican/`
| Path | Subject |
|---|---|
| `tacos-al-pastor.jpg` | Two street-style tacos al pastor, charred pineapple bits, fresh cilantro and diced onion, small char marks on the tortilla |
| `guacamole.jpg` | A rustic molcajete bowl of chunky guacamole, visible lime and cilantro flecks, a few tortilla chips propped at the edge |
| `enchiladas.jpg` | Rolled enchiladas covered in red sauce and melted cheese in a baking dish, a little sour cream drizzle and cilantro garnish |
| `mole-poblano.jpg` | Chicken mole poblano on a plate, deep glossy dark mole sauce, a sprinkle of sesame seeds |
| `chiles-rellenos.jpg` | A stuffed chile relleno cut open showing melted cheese inside, resting in a light tomato sauce |

### `dishes/japanese/`
| Path | Subject |
|---|---|
| `sushi-platter.jpg` | A tight arrangement of assorted nigiri and maki, glossy fresh fish, a small mound of pickled ginger |
| `tonkotsu-ramen.jpg` | A bowl of tonkotsu ramen, rich cloudy broth, a soft-boiled ajitama egg cut in half, chashu pork slices, scallions |
| `tempura.jpg` | A stack of golden crispy tempura (shrimp and vegetables) on a small rack, a dish of tentsuyu dipping sauce beside it |
| `udon-noodles.jpg` | A bowl of thick udon noodles in a light broth, a few slices of kamaboko and scallion, steam rising |
| `okonomiyaki.jpg` | A savory okonomiyaki pancake topped with a lattice of mayo and okonomiyaki sauce, bonito flakes visibly moving from rising heat |

### `dishes/indian/`
| Path | Subject |
|---|---|
| `chicken-tikka-masala.jpg` | A close bowl of chicken tikka masala, glossy orange-red sauce, visible cream swirl, fresh coriander on top |
| `biryani.jpg` | A mound of layered biryani rice with visible saffron strands, a piece of chicken, fried onions, mint leaves scattered |
| `samosa.jpg` | Two golden-fried samosas cut open showing spiced potato filling, a small dish of tamarind and mint chutney beside them |
| `palak-paneer.jpg` | A bowl of vibrant green palak paneer, visible cubes of paneer in the creamy spinach sauce, a light cream swirl |
| `rogan-josh.jpg` | A bowl of rogan josh lamb curry, deep red glossy sauce, tender lamb pieces, fresh coriander garnish |

### `dishes/thai/`
| Path | Subject |
|---|---|
| `pad-thai.jpg` | A close plate of pad thai, visible rice noodles, shrimp, egg ribbons, crushed peanuts, a lime wedge on the side |
| `tom-yum-goong.jpg` | A bowl of tom yum goong, clear spicy-sour broth, visible shrimp, lemongrass stalks, kaffir lime leaves, chili oil sheen |
| `green-curry.jpg` | A bowl of green curry with chicken, visible Thai eggplant and basil leaves, glossy coconut-milk sauce |
| `massaman-curry.jpg` | A bowl of massaman curry, tender beef and potato in a rich brown coconut sauce, roasted peanuts scattered on top |
| `som-tum.jpg` | A plate of som tum green papaya salad, visible shredded papaya strands, cherry tomatoes, crushed peanuts, a wedge of lime |

### `dishes/greek/`
| Path | Subject |
|---|---|
| `moussaka.jpg` | A cut square of moussaka on a plate, visible layers of eggplant, spiced meat, and golden béchamel top |
| `gyro.jpg` | A wrapped gyro cut open showing sliced meat, tzatziki, tomato and onion spilling slightly from warm pita |
| `souvlaki.jpg` | Grilled souvlaki skewers with char marks, a small dish of tzatziki and a lemon wedge beside them |
| `spanakopita.jpg` | A cut triangle of spanakopita showing flaky golden phyllo layers and visible spinach-feta filling |
| `greek-salad.jpg` | A rustic bowl of Greek salad, visible chunky tomato, cucumber, olives, and a thick slab of feta on top, drizzled olive oil |

### `dishes/french/`
| Path | Subject |
|---|---|
| `coq-au-vin.jpg` | A close plate of coq au vin, braised chicken in glossy red wine sauce, pearl onions and mushrooms visible |
| `boeuf-bourguignon.jpg` | A bowl of boeuf bourguignon, tender beef chunks in a deep wine sauce, carrots and pearl onions, fresh thyme sprig |
| `ratatouille.jpg` | A rustic dish of ratatouille, visible layered rounds of zucchini, eggplant, and tomato in a shallow baking dish |
| `souffle.jpg` | A risen golden cheese soufflé in a ramekin, visible light airy texture at the cracked top |
| `creme-brulee.jpg` | A ramekin of crème brûlée with a cracked caramelized sugar top, a spoon resting beside it having just broken the crust |

### `dishes/vietnamese/`
| Path | Subject |
|---|---|
| `pho.jpg` | A close bowl of pho, thin-sliced beef, rice noodles, fresh herbs and bean sprouts on the side, steam rising |
| `banh-mi.jpg` | A cut banh mi sandwich showing layers of pâté, pickled carrot and daikon, cilantro, and sliced chili in a crusty baguette |
| `goi-cuon-spring-rolls.jpg` | Fresh translucent spring rolls (goi cuon) showing visible shrimp, herbs, and vermicelli through the rice paper, a small dish of peanut sauce beside them |
| `bun-cha.jpg` | A bowl of bun cha, grilled pork patties in a light dipping broth beside a plate of vermicelli noodles and fresh herbs |
| `cao-lau.jpg` | A bowl of cao lau noodles, visible thick chewy noodles, slices of pork, fresh greens, and crispy croutons on top |

### `dishes/korean/`
| Path | Subject |
|---|---|
| `kimchi-jjigae.jpg` | A bubbling bowl of kimchi jjigae stew, visible kimchi and tofu cubes in a deep red broth, still simmering |
| `bulgogi.jpg` | A sizzling plate of bulgogi, thin-sliced marinated beef with visible caramelized edges, scallions and sesame seeds scattered |
| `bibimbap.jpg` | A close bowl of bibimbap, colorful arranged vegetables and marinated beef around a fried egg yolk, gochujang visible at the edge |
| `tteokbokki.jpg` | A pan of tteokbokki, glossy red rice cakes and fish cake in a spicy-sweet sauce, sesame seeds and scallion on top |
| `japchae.jpg` | A plate of japchae glass noodles, visible glossy sheen, colorful julienned vegetables and beef mixed through |

## When done

Drop all 54 files into the paths above (folders already exist under `public/images/`), then let me know — I'll wire them into `cuisine-card.tsx`/`dish-card.tsx` with the Ken Burns motion treatment, build the `dishName → catalog match → specific image, else cuisine hero` fallback lookup, and verify live via the two-user harness before moving to the match-reveal celebration work.
