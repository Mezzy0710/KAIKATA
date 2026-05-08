import { readFile } from "node:fs/promises";
import { parseCart } from "../src/parser.mjs";

const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));

const mobileCart = String.raw`Shopping Cart
Summary
Contents
4 Articles
Article Value
48,81 €
Shipping
6,40 €
Trustee Service
0,25 €
Total
55,46 €
Select shipping method
Azul Internacional - Tracked delivered on mailbox (6,40 €) max. Weight: 100g
Tracked
Estimated arrival date 17.05.2026
Trustee Service
Yes
No
Use Trustee service
Information on our Trustee Service.
Magic the Gathering Singles (4)
Info. Price
1x
Herald of Secret Streams
NM
7,56 €
1x
Rejuvenating Springs
NM
9,61 €
1x
Beau Token (Blue */*)
NM
1,08 €
1x
Battle Angels of Tyr
NM
30,56 €
Summary
Contents
5 Articles
Article Value
64,96 €
Shipping
7,45 €
Trustee Service
0,33 €
Total
72,74 €
Select shipping method
Tracked DPD Parcel (7,45 €) max. Weight: 1000g
Tracked
Estimated arrival date 16.05.2026
Trustee Service
Yes
No
Use Trustee service
Information on our Trustee Service.
Magic the Gathering Singles (5)
Info. Price
1x
Undergrowth Stadium
NM
14,27 €
1x
Herald of Secret Streams
NM
6,57 €
1x
Battle Angels of Tyr
NM
32,49 €
1x
Rejuvenating Springs
NM
10,16 €
1x
Beau Token (Blue */*)
NM
1,47 €
Cart overview
128,20 €
magictuga
55,46 €
AryaCards
72,74 €
Number of orders
2 Sellers`;

const parsed = parseCart(mobileCart, shippingData);
const magictuga = parsed.sellers.find((seller) => seller.sellerName === "magictuga");
const aryaCards = parsed.sellers.find((seller) => seller.sellerName === "AryaCards");

if (parsed.itemCount !== 9) {
  throw new Error(`Expected 9 item rows from the mobile cart snippet, received ${parsed.itemCount}.`);
}

if (!magictuga) {
  throw new Error("Expected magictuga seller to be parsed from the mobile cart.");
}

if (!aryaCards) {
  throw new Error("Expected AryaCards seller to be parsed from the mobile cart.");
}

if (magictuga.sellerCountry !== "Portugal") {
  throw new Error(`Expected magictuga to infer Portugal, received ${magictuga.sellerCountry}.`);
}

if (aryaCards.shippingMethod !== "Tracked DPD Parcel") {
  throw new Error(`Expected AryaCards shipping method to parse, received ${aryaCards.shippingMethod || "empty string"}.`);
}

if (aryaCards.trackingStatus !== "tracked") {
  throw new Error(`Expected AryaCards tracking status to be tracked, received ${aryaCards.trackingStatus}.`);
}

console.log(JSON.stringify({
  magictuga: {
    country: magictuga.sellerCountry,
    source: magictuga.countrySource,
    method: magictuga.shippingMethod
  },
  aryaCards: {
    shippingMethod: aryaCards.shippingMethod,
    trackingStatus: aryaCards.trackingStatus
  }
}, null, 2));
