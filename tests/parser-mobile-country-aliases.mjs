import { readFile } from "node:fs/promises";
import { parseCart } from "../src/parser.mjs";

const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));

const mobileCart = String.raw`Shopping Cart
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
0,28 €`;

const parsed = parseCart(mobileCart, shippingData);

if (parsed.sellerCount !== 3) {
  throw new Error(`Expected 3 seller blocks, received ${parsed.sellerCount}.`);
}

const [germanySeller, italyPostaSeller, italyCorriereSeller] = parsed.sellers;

if (germanySeller.sellerCountry !== "Germany") {
  throw new Error(`Expected Deutschland-Deal to infer Germany, received ${germanySeller.sellerCountry}.`);
}

if (italyPostaSeller.sellerCountry !== "Italy") {
  throw new Error(`Expected Postamail Internazionale to infer Italy, received ${italyPostaSeller.sellerCountry}.`);
}

if (italyCorriereSeller.sellerCountry !== "Italy") {
  throw new Error(`Expected Corriere Espresso to infer Italy, received ${italyCorriereSeller.sellerCountry}.`);
}

console.log(JSON.stringify(parsed.sellers.map((seller) => ({
  shippingMethod: seller.shippingMethod,
  sellerCountry: seller.sellerCountry,
  countrySource: seller.countrySource
})), null, 2));
