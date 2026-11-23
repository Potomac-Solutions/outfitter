// The landing page: what a guest sees at `/`. A full-screen photograph of the lake and a few
// words, one button (book a day out), then what the shop rents with a photograph and a price
// for each, today's note from the dock, and how it works.
//
// The words are in src/shop.js (`site`); the fleets and prices are the shop's own (`fleets`);
// the photographs are files in public/photos/.
import { escape, art } from './layout.js';
import { photo } from './assets.js';
import { site } from './shop.js';

const picture = (name, alt, { eager = false, cls = '' } = {}) => (photo(name) ? `<img${cls ? ` class="${cls}"` : ''} src="${photo(name)}" alt="${escape(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">` : '');

/** `fleets` are what the shop rents; `mine` this guest's rentals, already as list items; `note` today's conditions, rendered. */
export function landing({ shop, fleets, money, mine = '', note = '' }) {
  const { hero, dock, fleet, story, steps, visit } = site;
  const book = (cls = 'go lg') => `<a class="${cls}" href="#fleet">${escape(site.cta)}</a>`;

  return `<section class="hero">${picture('hero', '', { eager: true, cls: 'bg' })}
  <div class="wrap hero-words">
    <p class="kicker">${escape(hero.kicker)}</p>
    <h1>${escape(hero.title)} <em>${escape(hero.titleSoft)}</em></h1>
    <p class="lede">${escape(hero.lede)}</p>
    <div class="actions">${book()}<a class="button ghost lg" href="#how">${escape(hero.secondary)}</a></div>
  </div>
  <div class="hero-strip"><div class="wrap"><p>${escape(shop.hours)}</p><p>From ${money(Math.min(...fleets.map((one) => one.cents)))} a day</p></div></div>
</section>
${mine ? `<div class="wrap mine"><section class="panel"><h2>Your rentals</h2><ul>${mine}</ul></section></div>` : ''}
<div class="wrap today">${note}</div>

<div class="sec menu" id="fleet"><div class="wrap">
  <header class="head center"><p class="kicker">${escape(fleet.kicker)}</p><h2 class="big">${escape(fleet.heading)}</h2><p>${escape(fleet.lede)}</p></header>
  <ul class="cards">${fleets
    .map((one) => `<li class="card fleet"><div class="pic">${picture(one.id, one.name)}<span class="when">${one.units.length} to rent</span></div><div class="body"><h2>${escape(one.name)}</h2><p>${escape(one.blurb)}</p><p class="price">${money(one.cents)} a day <small>${money(one.weekend)} weekends</small></p><a class="go" href="/rent/${one.id}">Book ${escape(one.name.toLowerCase())}</a></div></li>`)
    .join('')}</ul>
</div></div>

<section class="split"><div class="wrap">
  <div class="pic">${picture('shed', 'The dock shed, with life jackets on pegs and a kayak on the dock')}</div>
  <div class="words"><p class="kicker">${escape(dock.kicker)}</p><h2>${escape(dock.heading)}</h2><p>${escape(dock.text)}</p><p>${book('go lg')}</p></div>
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
