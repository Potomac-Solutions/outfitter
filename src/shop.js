// The shop Outfitter starts with. Everything here is data the owner will edit from an admin page
// (a later step); nothing else in the app knows what a kayak is.
//
// A made-up shop on a real lake, so the demo reads like the trade without being anyone's.

export const shop = {
  id: 'lakeside',
  name: 'Lakeside Paddle & Pedal',
  town: 'McHenry, Maryland',
  place: 'Deep Creek Lake',
  timeZone: 'America/New_York',
  hours: 'Open daily 8 am to 6 pm, May to October',
  concept: 'Concept by Potomac Solutions. Lakeside Paddle & Pedal is a made-up shop; nothing here is really for rent.',
  pickup: 'Pick up at the dock shed from 8 am; bring everything back by 6 pm.',
  waiver: [
    'Paddling and cycling carry risks, including capsizing, cold water, collisions and falls, that can lead to injury or death.',
    'Every rider will wear the life jacket or helmet the shop provides, and stay within the areas the staff point out.',
    'I am responsible for the equipment until it is returned, and for damage beyond normal wear.',
    'I have told the shop about anything that affects a rider’s ability to take part safely.',
  ],
};

/**
 * What the shop rents. `units` are the individual boats and bikes; a booking gets the same ones
 * on every day it covers. Prices are per unit per day, in cents, with a weekend price.
 * `sizing` is what the shop needs to know about each rider to hand out the right one.
 */
export const fleets = [
  {
    id: 'kayaks',
    name: 'Kayaks',
    one: 'kayak',
    blurb: 'Stable sit-on-top kayaks for the coves. Paddle and life jacket included.',
    units: ['K1', 'K2', 'K3', 'K4', 'K5', 'K6'],
    cents: 4000,
    weekend: 5000,
    sizing: { label: 'Paddler’s height', short: 'height', choices: ['Under 5 ft', '5 ft to 5 ft 8 in', '5 ft 9 in to 6 ft 2 in', 'Over 6 ft 2 in'] },
  },
  {
    id: 'boards',
    name: 'Paddleboards',
    one: 'paddleboard',
    blurb: 'All-round boards for calm mornings. Leash, paddle and life jacket included.',
    units: ['P1', 'P2', 'P3', 'P4'],
    cents: 3500,
    weekend: 4500,
    sizing: { label: 'Rider’s weight', short: 'weight', choices: ['Under 150 lb', '150 to 200 lb', '200 to 250 lb', 'Over 250 lb'] },
  },
  {
    id: 'bikes',
    name: 'Mountain bikes',
    one: 'bike',
    blurb: 'Hardtails for the state-park trails. Helmet and lock included.',
    units: ['B1', 'B2', 'B3', 'B4', 'B5'],
    cents: 3000,
    weekend: 4000,
    sizing: { label: 'Rider’s height (frame size)', short: 'height', choices: ['Under 5 ft 4 in (S)', '5 ft 4 in to 5 ft 9 in (M)', '5 ft 10 in to 6 ft 1 in (L)', 'Over 6 ft 1 in (XL)'] },
  },
];

/** How many days ahead can be booked. */
export const DAYS_AHEAD = 14;
