// The public side: the landing page, and a customer's account pages.
import { escape } from './layout.js';
import { dayLabel } from './rentals.js';

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const exact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
/** $40, $39.50, $21,050: whole dollars without cents. */
export const money = (cents) => (cents % 100 ? exact : dollars).format(cents / 100);
const plural = (rental) => `${rental.units.length} ${escape(rental.units.length === 1 ? rental.fleet.one : rental.fleet.name.toLowerCase())}`;
const status = (rental) => `<span class="badge ${rental.status}">${{ booked: 'Booked', out: 'Out', returned: 'Returned' }[rental.status] ?? escape(rental.status)}</span>`;

/** The landing page: what the shop rents, how booking works, where it is, and the day's note. */
export function landing({ p, desk, guest, customer, conditions }) {
  const { shop } = desk;
  const mine = desk.rentalsFor(guest).filter((rental) => rental.status !== 'returned');
  const from = Math.min(...desk.fleets.map((fleet) => fleet.cents));
  return `<section class="hero">
  <h1>Out on ${escape(shop.place)}</h1>
  <p class="lede">Kayaks, paddleboards and mountain bikes by the day, from ${money(from)}. Book online, sign the waiver from your phone, and pick up at the dock. ${escape(shop.hours)}.</p>
  <div class="actions"><a class="go" href="#rent">Book a rental</a>${customer ? `<a class="button light" href="/account">Your rentals</a>` : `<a class="button light" href="/account/sign-up">Make an account</a>`}</div>
</section>
${conditions}
${mine.length ? `<section class="panel"><h2>Your rentals</h2><ul>${mine.map((rental) => `<li><a href="/rental/${rental.key}">${plural(rental)}, ${rental.days.map(dayLabel).join(', ')}</a>${rental.status === 'booked' ? '' : ` · ${rental.status === 'out' ? 'out' : 'returned'}`}</li>`).join('')}</ul></section>` : ''}
<section id="rent" class="stack"><h2>What we rent</h2>
<ul class="fleets">${desk.fleets
    .map(
      (fleet) => `<li class="fleet"><h2>${escape(fleet.name)}</h2><p>${escape(fleet.blurb)}</p><p class="price">${money(fleet.cents)} a day, ${money(fleet.weekend)} weekends</p><p>${fleet.units.length} in the fleet</p><a class="go" href="/rent/${fleet.id}">Book ${escape(fleet.name.toLowerCase())}</a></li>`,
    )
    .join('')}</ul></section>
<section class="stack"><h2>How it works</h2>
<ol class="steps">
  <li><h3>Pick your days</h3><p>Choose a fleet, tick the days and how many. They’re held for you while you finish, and you get the same ones every day.</p></li>
  <li><h3>Sign the waiver</h3><p>Name each rider and their size, so the right boat or bike is ready, and sign once for everyone.</p></li>
  <li><h3>Pay and pick up</h3><p>Pay once for the whole booking. Show the code on your phone at the dock shed; your page updates when you’re out and when you’re back.</p></li>
</ol></section>
<section class="two">
  <div class="panel"><h2>Visit</h2><dl class="facts"><dt>Where</dt><dd>${escape(shop.place)}, ${escape(shop.town)}</dd><dt>Hours</dt><dd>${escape(shop.hours)}</dd><dt>Pickup</dt><dd>${escape(shop.pickup)}</dd></dl></div>
  <div class="panel faq"><h2>Questions</h2>
    <div><h3>What’s included?</h3><p>A paddle and life jacket with every boat and board; a helmet and lock with every bike.</p></div>
    <div><h3>Do I need an account?</h3><p>No. With one, your rentals follow you to any device, and your name and email are filled in next time.</p></div>
    <div><h3>What about the weather?</h3><p>The note at the top of this page is posted by the staff each morning: the water, the wind, the trails.</p></div>
  </div>
</section>`;
}

/** Sign in, sign up, forgot and reset: one small form each. */
export function signIn({ problem = '', email = '' } = {}) {
  return `<section><h1>Sign in</h1><p class="lede">See your rentals on any device. No account? <a href="/account/sign-up">Make one</a>.</p></section>
${problem}
<form class="panel" method="post" action="/account/sign-in">
  <label>Email<input name="email" type="email" autocomplete="email" required value="${escape(email)}"></label>
  <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">Sign in</button>
  <p><a href="/account/forgot">Forgot your password?</a></p>
</form>`;
}

export function signUp({ problem = '', form = null } = {}) {
  return `<section><h1>Make an account</h1><p class="lede">Your rentals follow you, and checkout fills itself in. Rentals you’ve booked from this browser join your account.</p></section>
${problem}
<form class="panel" method="post" action="/account/sign-up">
  <label>Your name<input name="name" autocomplete="name" required maxlength="80" value="${escape(form?.get('name') ?? '')}"></label>
  <label>Email<input name="email" type="email" autocomplete="email" required value="${escape(form?.get('email') ?? '')}"></label>
  <label>Password (at least 10 characters)<input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
  <button type="submit">Make my account</button>
  <p>Already have one? <a href="/account/sign-in">Sign in</a>.</p>
</form>`;
}

export function forgot({ problem = '', sent = false } = {}) {
  return `<section><h1>Reset your password</h1><p class="lede">We’ll email a link that works once, for an hour.</p></section>
${problem}${sent ? '<p class="ok" role="status">If there’s an account with that email, a link is on its way.</p>' : ''}
<form class="panel" method="post" action="/account/forgot">
  <label>Email<input name="email" type="email" autocomplete="email" required></label>
  <button type="submit">Send the link</button>
</form>`;
}

export function reset({ token, problem = '', works = true }) {
  if (!works) return `<section><h1>That link has expired</h1><p class="lede">It may have been used already. <a href="/account/forgot">Ask for a new one</a>.</p></section>`;
  return `<section><h1>Choose a new password</h1></section>
${problem}
<form class="panel" method="post" action="/account/reset">
  <input type="hidden" name="token" value="${escape(token)}">
  <label>New password (at least 10 characters)<input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
  <button type="submit">Save and sign in</button>
</form>`;
}

/** The customer's own page: their rentals, now and past, and their details. */
export function account({ desk, guest, customer, said }) {
  const rentals = desk.rentalsFor(guest);
  const coming = rentals.filter((rental) => rental.status !== 'returned');
  const past = rentals.filter((rental) => rental.status === 'returned').reverse();
  const spent = rentals.reduce((sum, rental) => sum + rental.cents, 0);
  const row = (rental) => `<tr><td><a href="/rental/${rental.key}">${escape(rental.fleet.name)}</a><br><small class="muted">${escape(rental.key)}</small></td><td>${rental.days.map(dayLabel).join(', ')}</td><td>${plural(rental)}</td><td>${status(rental)}</td><td class="num">${money(rental.cents)}</td></tr>`;
  const table = (list) => `<div class="table-wrap"><table><thead><tr><th scope="col">Rental</th><th scope="col">Days</th><th scope="col">What</th><th scope="col">Status</th><th scope="col" class="num">Paid</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>`;
  return `<section><h1>Hello, ${escape(customer.name.split(' ')[0])}</h1><p class="lede">${rentals.length ? `${rentals.length} rental${rentals.length === 1 ? '' : 's'} with us, ${money(spent)} in all.` : 'No rentals yet.'} <a href="/#rent">Book another</a>.</p></section>
${said}
<section class="panel"><h2>Coming up</h2>${coming.length ? table(coming) : '<p>Nothing booked. <a href="/#rent">Pick some days</a>.</p>'}</section>
${past.length ? `<section class="panel"><h2>Past rentals</h2>${table(past)}</section>` : ''}
<section class="two">
  <form class="panel" method="post" action="/account/profile"><h2>Your details</h2><label>Name<input name="name" autocomplete="name" required maxlength="80" value="${escape(customer.name)}"></label><p class="muted">Email: ${escape(customer.email)}</p><button type="submit">Save</button></form>
  <div class="panel"><h2>Signing in</h2><p><a href="/account/forgot">Change your password</a> by email.</p><form method="post" action="/account/sign-out"><button class="button light" type="submit">Sign out</button></form></div>
</section>`;
}
