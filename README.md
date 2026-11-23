# Outfitter

Rent and book, for a shop that rents things by the day: kayaks, paddleboards, bikes, skis. A guest picks days and how many, says who's riding and signs the waiver, pays once, and gets a pickup code. The counter hands rentals out and takes them back, and the guest's phone follows. A Potomac Solutions platform, built on the [kit](https://github.com/Potomac-Solutions/kit) and [Zubra](https://github.com/zubra-js/zubra).

The shop it starts with, Lakeside Paddle & Pedal on Deep Creek Lake, is made up. Nothing here is really for rent, and payments are in test mode.

## Try it

`npm install`, then `npm start`, and open http://localhost:3000. Two browser windows side by side (one private, so it's another person) show the live parts best.

**Staff sign in with their own accounts.** The first time, nobody has one, so the server prints a setup link: open it to make the owner (your email, name and a password). The owner's **People** page invites the rest of the staff (an invite is a link to send them), resets passwords and turns people off.

1. **Book.** Choose Kayaks, tick two days (a Saturday shows the weekend price) and how many, and **Hold**. You get the same kayaks every day you booked.
2. **Riders and waiver.** Press **Book**: name each rider and their size, agree to the waiver, and sign with your full name. You can't pay without it.
3. **Pay** with any card number (`4000 0000 0000 0002` is declined, to see that; your hold stays). You get the rental with its pickup code, and it's listed on the home page.
4. **At the counter.** In the other window, open **The counter (staff)** from the footer and sign in. Today's pickups show each rider and size. **Hand out** a rental (or type its code): the guest's page shows **Out** without a reload. **Take back** marks it returned.
5. **Today's note.** Post one at the counter ("Calm until noon, water 66°F"). Every open home page shows it at once.
6. **Without JavaScript** (turn it off in the browser's settings), all of it works the same.

## How it is put together

| Piece | Job |
| --- | --- |
| [Potomac kit](https://github.com/Potomac-Solutions/kit) (private) | `hold` (who has which boat, and when a hold ends), `reserve` (the same boats on every day of a booking, priced, paid once), `pay` (charged at most once; its test provider), `stages` (a rental: booked, out, returned), `price` (the weekend rule), `staff` and `staff/pages` (the owner and staff: passwords, sessions, invites, roles, and their pages), `auth` (the guest and counter cookies), `store` (the Sync log). The kit's `slot-picker`, `booking-summary` and `checkout-form`, from its package |
| `@zubra/server` | Renders every page before any JavaScript runs |
| `@zubra/sync` | The log (one SQLite file). The conditions note and each rental's status are documents only the server writes; pages follow them live, and read only the note and their own rentals |
| [symbology](https://github.com/journey-to-code-org/symbology) | Draws the pickup code (the rental's code) |
| `src/shop.js` | The shop, what it rents, prices, sizing questions and waiver, as data |
| `src/rentals.js` | The shop's side: which days and boats exist, riders and waivers, the counter, the note, and the words |

## Run it

```sh
npm install      # needs read access to the private Potomac-Solutions/kit repository
npm start        # http://localhost:3000
npm test         # needs Chrome or Playwright's Chromium
```

Node 22.13 or later. `SESSION_SECRET` is required in production; `DATA_DIR` says where the database file goes. Behind a proxy (Railway, Fly, a load balancer), set `TRUST_PROXIES` to how many add to `X-Forwarded-For` (usually `1`), so a wrong-password lockout falls on the device guessing and not on everyone; left unset, no header is trusted and every sign-in counts as the proxy's address.

## What the tests prove

1. Without JavaScript: two days, two kayaks, the same boats both days, weekend prices; riders, sizes and the waiver; paying; the pickup code (symbology's drawing of the rental's code); those boats gone for everyone on those days; the rental on the home page.
2. The waiver comes first: each missing piece is refused with its own message, and paying before signing goes back to it.
3. The last bike on a day goes to one person, even when two ask at the same moment; a booking gets the same bikes every day or none; letting go frees them.
4. A declined card keeps the hold for another try, and the same booking is paid on the second. Another guest can't pay for it or see it. A hold that runs out books nothing.
5. The counter needs a staff sign-in; it sees riders and sizes; it hands a rental out once and takes it back once, and the guest sees each step live.
6. The note the counter posts reaches every open page at once, and is in the page without JavaScript.
7. A page reads the note and its own rentals, nothing else, even when it asks; it writes nothing; another site's post is refused.
8. With JavaScript, the whole booking in the browser; the kit's components come from its package.

Every behaviour was broken on purpose once to check a test fails (19 caught). One can't be: the rule letting pages write collections the app doesn't list is also refused by Sync's scope, which is checked first.

## How it looks

- **The landing page** (`/`) is photo-led: the lake at sunrise, one line and one button (**Book a day out**), then each fleet as a card with its photograph, its price and its own button, today's note from the dock, how it works, and where to find the shed. Its words are `site` in `src/shop.js`; `src/site.js` lays it out.
- **Photographs** are files in `public/photos/`: `hero`, `shed`, `lake`, and one per fleet named by its id (`kayaks`, `boards`, `bikes`), as `.jpg` or `.webp`. Replace a file and restart. The ones here were generated for this made-up shop; see `public/photos/README.md`.
- **Type** is Outfit and DM Sans, self-hosted from `@fontsource`. The colours are tokens at the top of `public/base.css`.
- **The counter** has its own page frame (`src/shell.js`): a sidebar at a desk, a bar and a sheet on a phone, light or dark following the device. Rentals going out today are counted beside its link. Tables become cards on a phone (`src/tables.js`).
- **Checks.** With the app running and an owner set up, `OWNER=email,password npm run design-check` walks every page, books a paddleboard on the way, and checks five widths in light and dark.

## Not yet

- The owner's admin: fleets, prices, the waiver and the season, now in `src/shop.js`.
- A ski-shop season (rentals by the season, boot fitting), lessons and guided trips, which are the same hold with other units.
- Accounts for staff, and a real payment provider.
