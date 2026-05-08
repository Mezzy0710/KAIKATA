import { readFile } from "node:fs/promises";
import { parseCart } from "../src/parser.mjs";

const shippingData = JSON.parse(await readFile(new URL("../shipping_data.json", import.meta.url), "utf8"));

const raw = String.raw`Summary
Contents
1 Articles
Article Value
25,00 €
Shipping
10,70 €
Trustee Service
0,13 €
Total
35,83 €
Select shipping method
Posta Raccomandata Internazionale (International Registered Mail) (10,70 €) max. Weight: 50g
Tracked
Estimated arrival date 21.05.2026
Trustee Service
Yes
No
Use Trustee service
Information on our Trustee Service.
Magic the Gathering Singles (1)
Info. Price
1x
Battle Angels of Tyr
NM
Toploader Shipping 1KIT3
25,00 €
Cart overview
35,83 €
Alessietto22
35,83 €
Number of orders
1 Sellers`;

const parsed = parseCart(raw, shippingData);
const seller = parsed.sellers[0];

if (seller.sellerName !== "Alessietto22") {
  throw new Error(`Expected seller name Alessietto22, received ${seller.sellerName}.`);
}

console.log(JSON.stringify({
  sellerName: seller.sellerName,
  sellerNameSource: seller.sellerNameSource || null
}, null, 2));
