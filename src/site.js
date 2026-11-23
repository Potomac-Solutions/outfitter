// The public side: the landing page, and a customer's account pages.
import { escape, art } from './layout.js';
import { photo } from './assets.js';
import { site as words } from './shop.js';
import { dayLabel } from './rentals.js';

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const exact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
/** $40, $39.50, $21,050: whole dollars without cents. */
export const money = (cents) => (cents % 100 ? exact : dollars).format(cents / 100);
const picture = (name, alt, { eager = false, cls = '' } = {}) => (photo(name) ? `<img${cls ? ` class="${cls}"` : ''} src="${photo(name)}" alt="${escape(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">` : '');
const plural = (rental) => `${rental.units.length} ${escape(rental.units.length === 1 ? rental.fleet.one : rental.fleet.name.toLowerCase())}`;
const status = (rental) => `<span class="badge ${rental.status}">${{ booked: 'Booked', out: 'Out', returned: 'Returned' }[rental.status] ?? escape(rental.status)}</span>`;

/**
 * The landing page: a full-screen photograph of the lake and one button (book a day out), then
 * what the shop rents with a photograph and a price for each, today's note from the dock, and
 * how it works. Its words are `site` in src/shop.js; the photographs are files in public/photos/.
 */
export function landing({ desk, guest, customer, conditions }) {
  const { shop } = desk;
  const { hero, dock, fleet, story, steps, visit } = words;
  const mine = desk.rentalsFor(guest).filter((rental) => rental.status !== 'returned');
  const from = Math.min(...desk.fleets.map((one) => one.cents));
  const book = (cls = 'go lg') => `<a class="${cls}" href="#fleet">${escape(words.cta)}</a>`;
  return `<section class="hero">${picture('hero', '', { eager: true, cls: 'bg' })}
  <div class="wrap hero-words">
    <p class="kicker">${escape(hero.kicker)}</p>
    <h1>${escape(hero.title)} <em>${escape(hero.titleSoft)}</em></h1>
    <p class="lede">${escape(hero.lede)}</p>
    <div class="actions">${book()}<a class="button ghost lg" href="#how">${escape(hero.secondary)}</a></div>
  </div>
  <div class="hero-strip"><div class="wrap"><p>${escape(shop.hours)}</p><p>From ${money(from)} a day</p></div></div>
</section>
${mine.length ? `<div class="wrap mine"><section class="panel"><h2>Your rentals</h2><ul>${mine.map((rental) => `<li><a href="/rental/${rental.key}">${plural(rental)}, ${rental.days.map(dayLabel).join(', ')}<span>${rental.status === 'out' ? 'out' : 'booked'}</span></a></li>`).join('')}</ul></section></div>` : ''}
<div class="wrap today">${conditions}</div>

<div class="sec menu" id="fleet"><div class="wrap">
  <header class="head center"><p class="kicker">${escape(fleet.kicker)}</p><h2 class="big">${escape(fleet.heading)}</h2><p>${escape(fleet.lede)}</p></header>
  <ul class="cards">${desk.fleets
    .map((one) => `<li class="card fleet"><div class="pic">${picture(one.id, one.name)}<span class="when">${one.units.length} to rent</span></div><div class="body"><h2>${escape(one.name)}</h2><p>${escape(one.blurb)}</p><p class="price">${money(one.cents)} a day, ${money(one.weekend)} weekends</p><a class="go" href="/rent/${one.id}">Book ${escape(one.name.toLowerCase())}</a></div></li>`)
    .join('')}</ul>
</div></div>

<section class="split"><div class="wrap">
  <div class="pic">${picture('shed', 'The dock shed, with life jackets on pegs and a kayak on the dock')}</div>
  <div class="words"><p class="kicker">${escape(dock.kicker)}</p><h2>${escape(dock.heading)}</h2><p>${escape(dock.text)}</p><p>${book()}${customer ? '' : ' <a class="button light lg" href="/account/sign-up">Make an account</a>'}</p></div>
</div></section>

<section class="banner" id="story">${picture('lake', '', { cls: 'bg' })}<div class="wrap"><p class="kicker">${escape(story.kicker)}</p><h2>${escape(story.heading)}</h2>${story.paragraphs.map((text) => `<p>${escape(text)}</p>`).join('')}${book()}</div></section>

<div class="sec how" id="how"><div class="wrap">
  <h2 class="big">${escape(steps.heading)}</h2>
  <ol class="steps">${steps.list.map(([title, text]) => `<li><h3>${escape(title)}</h3><p>${escape(text)}</p></li>`).join('')}</ol>
</div></div>

<div class="sec dark" id="visit"><div class="wrap">
  <header class="head"><p class="kicker">${escape(visit.kicker)}</p><h2 class="big">${escape(visit.heading)}</h2></header>
  <div class="visit">
    <div>${art.clock}<h3>Hours</h3><p><strong>${escape(shop.hours)}</strong></p></div>
    <div>${art.pin}<h3>The dock</h3><p><strong>${escape(shop.place)} · ${escape(shop.town)}</strong></p><p>${escape(visit.where)}</p></div>
    <div>${art.clock}<h3>Pick up and return</h3><p>${escape(shop.pickup)}</p></div>
  </div>
  <p class="visit-cta">${book()}</p>
</div></div>`;
}

/** Sign in, sign up, forgot and reset: one small form each. */
export function signIn({ problem = '', email = '' } = {}) {
  return `<div class="auth"><section class="page-head"><h1>Sign in</h1><p class="lede">See your rentals on any device. No account? <a href="/account/sign-up">Make one</a>.</p></section>
${problem}
<form class="panel" method="post" action="/account/sign-in">
  <label>Email<input name="email" type="email" autocomplete="email" required value="${escape(email)}"></label>
  <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">Sign in</button>
  <p><a href="/account/forgot">Forgot your password?</a></p>
</form></div>`;
}

export function signUp({ problem = '', form = null } = {}) {
  return `<div class="auth"><section class="page-head"><h1>Make an account</h1><p class="lede">Your rentals follow you, and checkout fills itself in. Rentals you’ve booked from this browser join your account.</p></section>
${problem}
<form class="panel" method="post" action="/account/sign-up">
  <label>Your name<input name="name" autocomplete="name" required maxlength="80" value="${escape(form?.get('name') ?? '')}"></label>
  <label>Email<input name="email" type="email" autocomplete="email" required value="${escape(form?.get('email') ?? '')}"></label>
  <label>Password (at least 10 characters)<input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
  <button type="submit">Make my account</button>
  <p>Already have one? <a href="/account/sign-in">Sign in</a>.</p>
</form></div>`;
}

export function forgot({ problem = '', sent = false } = {}) {
  return `<div class="auth"><section class="page-head"><h1>Reset your password</h1><p class="lede">We’ll email a link that works once, for an hour.</p></section>
${problem}${sent ? '<p class="ok" role="status">If there’s an account with that email, a link is on its way.</p>' : ''}
<form class="panel" method="post" action="/account/forgot">
  <label>Email<input name="email" type="email" autocomplete="email" required></label>
  <button type="submit">Send the link</button>
</form></div>`;
}

export function reset({ token, problem = '', works = true }) {
  if (!works) return `<div class="auth"><section class="page-head"><h1>That link has expired</h1><p class="lede">It may have been used already. <a href="/account/forgot">Ask for a new one</a>.</p></section></div>`;
  return `<div class="auth"><section class="page-head"><h1>Choose a new password</h1></section>
${problem}
<form class="panel" method="post" action="/account/reset">
  <input type="hidden" name="token" value="${escape(token)}">
  <label>New password (at least 10 characters)<input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
  <button type="submit">Save and sign in</button>
</form></div>`;
}

/** The customer's own page: their rentals, now and past, and their details. */
export function account({ desk, guest, customer, said }) {
  const rentals = desk.rentalsFor(guest);
  const coming = rentals.filter((rental) => rental.status !== 'returned');
  const past = rentals.filter((rental) => rental.status === 'returned').reverse();
  const spent = rentals.reduce((sum, rental) => sum + rental.cents, 0);
  const row = (rental) => `<tr><td><a href="/rental/${rental.key}">${escape(rental.fleet.name)}</a><br><small class="muted">${escape(rental.key)}</small></td><td>${rental.days.map(dayLabel).join(', ')}</td><td>${plural(rental)}</td><td>${status(rental)}</td><td class="num">${money(rental.cents)}</td></tr>`;
  const table = (list) => `<div class="table-wrap"><table><thead><tr><th scope="col">Rental</th><th scope="col">Days</th><th scope="col">What</th><th scope="col">Status</th><th scope="col" class="num">Paid</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>`;
  return `<section class="page-head"><h1>Hello, ${escape(customer.name.split(' ')[0])}</h1><p class="lede">${rentals.length ? `${rentals.length} rental${rentals.length === 1 ? '' : 's'} with us, ${money(spent)} in all.` : 'No rentals yet.'} <a href="/#rent">Book another</a>.</p></section>
${said}
<section class="panel"><h2>Coming up</h2>${coming.length ? table(coming) : '<p>Nothing booked. <a href="/#rent">Pick some days</a>.</p>'}</section>
${past.length ? `<section class="panel"><h2>Past rentals</h2>${table(past)}</section>` : ''}
<section class="two">
  <form class="panel" method="post" action="/account/profile"><h2>Your details</h2><label>Name<input name="name" autocomplete="name" required maxlength="80" value="${escape(customer.name)}"></label><p class="muted">Email: ${escape(customer.email)}</p><button type="submit">Save</button></form>
  <div class="panel"><h2>Signing in</h2><p><a href="/account/forgot">Change your password</a> by email.</p><form method="post" action="/account/sign-out"><button class="button light" type="submit">Sign out</button></form></div>
</section>`;
}
