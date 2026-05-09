import { readFile } from "node:fs/promises";
import { parseCart } from "../src/parser.mjs";

const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));

const mobileCart = String.raw`Shopping Cart
Summary
Contents
3 Articles
Article Value
3,00 €
Shipping
1,25 €
Total
4,25 €
Select shipping method
Standardbrief (1,25 €) max. Weight: 20g
No tracking
Magic the Gathering Singles (3)
Info. Price
1x
Shade's Form
NM
0,05 €
1x
Twinflame
NM
1,45 €
1x
Goblin Bombardment
NM
1,50 €
Summary
Contents
1 Articles
Article Value
27,99 €
Shipping
3,95 €
Trustee Service
0,28 €
Total
32,22 €
Select shipping method
Kompaktbrief + Einschreiben EINWURF (3,95 €) max. Weight: 50g
Tracked
Magic the Gathering Singles (1)
Info. Price
1x
Ragavan, Nimble Pilferer
NM
27,99 €
Summary
Contents
1 Articles
Article Value
54,00 €
Shipping
3,95 €
Trustee Service
0,54 €
Total
58,49 €
Select shipping method
Kompaktbrief + Einschreiben EINWURF (3,95 €) max. Weight: 50g
Tracked
Magic the Gathering Singles (1)
Info. Price
1x
Disharmony
NM
54,00 €
Summary
Contents
6 Articles
Article Value
0,92 €
Shipping
1,40 €
Total
2,32 €
Select shipping method
Kompaktbrief (1,40 €) max. Weight: 50g
No tracking
Magic the Gathering Singles (6)
Info. Price
2x
Conquering Manticore
NM
m/nm direkt aus dem deck/ right out of the deck
0,18 €
2x
Traitorous Blood
NM
nm - Karte in Schutzhülle/ card in protective sleeve (x)
0,09 €
2x
Zealous Conscripts
NM
nm || english | [LotrC]
0,19 €
Summary
Contents
1 Articles
Article Value
1,40 €
Shipping
1,25 €
Total
2,65 €
Select shipping method
Standardbrief (1,25 €) max. Weight: 20g
No tracking
Magic the Gathering Singles (1)
Info. Price
1x
Boggart Trawler // Boggart Bog
NM
1,40 €
Summary
Contents
5 Articles
Article Value
14,05 €
Shipping
1,70 €
Total
15,75 €
Select shipping method
Deutschland-Deal (1,70 €) max. Weight: 49g
No tracking
Magic the Gathering Singles (5)
Info. Price
1x
Sacrifice
EX
4,99 €
1x
Sothera, the Supervoid (V.2)
EX
1,49 €
1x
Angrath, the Flame-Chained
EX
2,62 €
1x
Pitiless Plunderer
EX
2,95 €
1x
Ruthless Technomancer (V.1)
EX
2,00 €
Summary
Contents
3 Articles
Article Value
24,35 €
Shipping
3,35 €
Total
27,70 €
Select shipping method
Priority Letter (3,35 €) max. Weight: 20g
No tracking
Magic the Gathering Singles (3)
Info. Price
1x
Ashnod's Altar
NM
8,50 €
1x
Warren Soultrader
NM
14,00 €
1x
Burnt Offering
NM
1,85 €
Summary
Contents
5 Articles
Article Value
23,30 €
Shipping
1,40 €
Total
24,70 €
Select shipping method
Kompaktbrief (1,40 €) max. Weight: 50g
No tracking
Magic the Gathering Singles (5)
Info. Price
1x
Forerunner of the Coalition
NM
AD_65
0,34 €
1x
Moonsilver Key
NM
MHA_73
0,67 €
1x
Jet Medallion
NM
Y_12
9,83 €
1x
Mob Rule
NM
MHB_33
1,49 €
1x
Ruby Medallion
NM
Y_12
10,97 €
Summary
Contents
1 Articles
Article Value
40,00 €
Shipping
3,95 €
Trustee Service
0,40 €
Total
44,35 €
Select shipping method
Kompaktbrief + Einschreiben EINWURF (3,95 €) max. Weight: 50g
Tracked
Magic the Gathering Singles (1)
Info. Price
1x
Deflecting Swat
EX
40,00 €
Summary
Contents
4 Articles
Article Value
16,60 €
Shipping
3,60 €
Total
20,20 €
Select shipping method
Postamail Internazionale (3,60 €) max. Weight: 50g
No tracking
Magic the Gathering Singles (4)
Info. Price
1x
Burnt Offering
EX
UB
1,20 €
1x
Warren Soultrader
NM
12,50 €
1x
Sothera, the Supervoid (V.2)
NM
1,50 €
1x
Goblin Bombardment
NM
1,40 €
Summary
Contents
5 Articles
Article Value
13,08 €
Shipping
1,40 €
Total
14,48 €
Select shipping method
Kompaktbrief (1,40 €) max. Weight: 50g
No tracking
Magic the Gathering Singles (5)
Info. Price
1x
Moonsilver Key
NM
#129
0,53 €
1x
Séance Board
NM
#005
1,71 €
1x
Hurl Through Hell
NM
1a
1,89 €
1x
Prized Statue
NM
1a
0,54 €
1x
Jet Medallion
NM
1a
8,41 €
Summary
Contents
5 Articles
Article Value
11,00 €
Shipping
6,90 €
Trustee Service
0,06 €
Total
17,96 €
Select shipping method
Corriere Espresso (6,90 €) max. Weight: 10000g
Tracked
Magic the Gathering Singles (5)
Info. Price
1x
Gisa, Glorious Resurrector
NM
1,79 €
1x
Insurrection
EX
3,86 €
1x
Molten Primordial
EX
2,24 €
1x
Angrath, the Flame-Chained
EX
2,83 €
1x
Prized Statue
NM
0,28 €
Summary
Contents
2 Articles
Article Value
2,80 €
Shipping
1,25 €
Total
4,05 €
Select shipping method
Standardbrief (1,25 €) max. Weight: 20g
No tracking
Magic the Gathering Singles (2)
Info. Price
1x
Mob Rule
EX
V
1,00 €
1x
Impact Tremors
EX
V
1,80 €
Summary
Contents
2 Articles
Article Value
7,95 €
Shipping
1,25 €
Total
9,20 €
Select shipping method
Standardbrief (1,25 €) max. Weight: 20g
No tracking
Magic the Gathering Singles (2)
Info. Price
1x
Gisa, Glorious Resurrector
NM
1,70 €
1x
Tevesh Szat, Doom of Fools
NM
6,25 €
Summary
Contents
1 Articles
Article Value
9,00 €
Shipping
3,75 €
Total
12,75 €
Select shipping method
Prednostno - navadno pismo (Priority Letter) (3,75 €) max. Weight: 20g
No tracking
Magic the Gathering Singles (1)
Info. Price
1x
Molten Duplication (V.1)
NM
Promo stamped
9,00 €
Summary
Contents
2 Articles
Article Value
9,65 €
Shipping
1,25 €
Total
10,90 €
Select shipping method
Standardbrief (1,25 €) max. Weight: 20g
No tracking
Magic the Gathering Singles (2)
Info. Price
1x
Culling the Weak (V.1)
NM
6,96 €
1x
Pitiless Plunderer
NM
2,69 €
Summary
Contents
2 Articles
Article Value
5,80 €
Shipping
1,25 €
Total
7,05 €
Select shipping method
Standardbrief (1,25 €) max. Weight: 20g
No tracking
Magic the Gathering Singles (2)
Info. Price
1x
Sacrifice
EX
4,00 €
1x
Impact Tremors
EX
1,80 €
Cart overview
309,02 €
Kolja49
4,25 €
PulpSlayer
32,22 €
Serafin
58,49 €
Shadwell
2,32 €
Miehen
2,65 €
ThreeForOne-AT
15,75 €
Haksu
27,70 €
SchrottosCCGs
24,70 €
Dakohunter
44,35 €
Fantamagus-Monza
20,20 €
SaltyCards
14,48 €
CardGameCorner
17,96 €
CelVal
4,05 €
Hyro93
9,20 €
hera11
12,75 €
Swagnemite
10,90 €
Magestore
7,05 €
Number of orders
17 Sellers`;

const parsed = parseCart(mobileCart, shippingData);

if (parsed.sellerCount !== 17) {
  throw new Error(`Expected 17 seller blocks, received ${parsed.sellerCount}.`);
}

if (parsed.itemCount !== 46) {
  throw new Error(`Expected 46 item rows from the mobile cart snippet, received ${parsed.itemCount}.`);
}

const expectedNames = [
  "Kolja49",
  "PulpSlayer",
  "Serafin",
  "Shadwell",
  "Miehen",
  "ThreeForOne-AT",
  "Haksu",
  "SchrottosCCGs",
  "Dakohunter",
  "Fantamagus-Monza",
  "SaltyCards",
  "CardGameCorner",
  "CelVal",
  "Hyro93",
  "hera11",
  "Swagnemite",
  "Magestore"
];

const actualNames = parsed.sellers.map((seller) => seller.sellerName);

if (actualNames.some((name) => /^Seller \d+$/i.test(name))) {
  throw new Error(`Expected all seller names to resolve from cart overview, received ${JSON.stringify(actualNames)}.`);
}

if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
  throw new Error(`Expected seller names ${JSON.stringify(expectedNames)}, received ${JSON.stringify(actualNames)}.`);
}

console.log(JSON.stringify({
  sellerCount: parsed.sellerCount,
  itemCount: parsed.itemCount,
  names: actualNames
}, null, 2));
