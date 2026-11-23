// The page around the components: the shop's frame, its colours, and the connection to the log.
import { CHART_CSS } from '@potomac-solutions/kit/charts';

export const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STYLE = `
  :root {
    --background: #f4f8f9; --foreground: #15262d; --card: #ffffff; --border: #c9d6dc; --muted: #e8eff2;
    --muted-foreground: #5b6b73; --primary: #1f6f8b; --primary-foreground: #ffffff; --ring: #1f6f8b;
    --accent: #e9a23b; --input: #c9d6dc; --radius: 0.75rem; --note: #e6f2f7;
    color-scheme: light;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 1.0625rem; line-height: 1.5; background: var(--background); color: var(--foreground); }
  a:not(.action-button, .go, .button) { color: inherit; }
  :focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .concept { margin: 0; padding: 0.45rem 1rem; background: var(--accent); color: #1f1a10; font-size: 0.85rem; font-weight: 600; text-align: center; }
  .site-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 1rem; padding: 1rem clamp(1rem, 4vw, 2.5rem); background: var(--primary); color: var(--primary-foreground); }
  .site-head a { font-size: 1.35rem; font-weight: 800; text-decoration: none; }
  .site-head span { opacity: 0.85; font-size: 0.9rem; }
  main { width: min(60rem, 100% - 2 * clamp(1rem, 4vw, 2.5rem)); margin: 0 auto; padding: 2rem 0 3rem; display: grid; gap: 1.75rem; }
  h1 { margin: 0; font-size: clamp(1.9rem, 5vw, 2.75rem); line-height: 1.1; }
  h2 { margin: 0; font-size: 1.3rem; }
  .lede { margin: 0.4rem 0 0; color: var(--muted-foreground); }
  .fleets { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1rem; margin: 0; padding: 0; list-style: none; }
  .fleet { display: grid; gap: 0.5rem; align-content: start; padding: 1.1rem 1.2rem; border-radius: var(--radius); background: var(--card); box-shadow: 0 0 0 1px var(--border); }
  .fleet p { margin: 0; color: var(--muted-foreground); }
  .price { color: var(--foreground) !important; font-weight: 700; }
  .go { justify-self: start; padding: 0.55rem 1rem; border-radius: 0.5rem; background: var(--primary); color: var(--primary-foreground); font-weight: 700; text-decoration: none; }
  .panel { display: grid; gap: 0.9rem; align-content: start; padding: 1.1rem 1.2rem; border-radius: var(--radius); background: var(--card); box-shadow: 0 0 0 1px var(--border); }
  .panel ul { margin: 0; padding-left: 1.2rem; }
  .notice { margin: 0; padding: 0.6rem 0.9rem; border-radius: 0.5rem; background: #fde4e1; color: #7a1f17; }
  .ok { margin: 0; padding: 0.6rem 0.9rem; border-radius: 0.5rem; background: #dff3e6; color: #13472a; }
  label { display: grid; gap: 0.3rem; font-weight: 600; }
  input, select, textarea { font: inherit; padding: 0.55rem 0.7rem; border-radius: 0.5rem; border: 1px solid var(--border); background: #fff; color: inherit; }
  .check { display: flex; gap: 0.5rem; align-items: start; font-weight: 400; }
  .rider { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 0.75rem; padding: 0.75rem 0; border-top: 1px solid var(--border); }
  button, .button { font: inherit; font-weight: 700; padding: 0.65rem 1.1rem; border: 0; border-radius: 0.5rem; background: var(--primary); color: var(--primary-foreground); cursor: pointer; text-decoration: none; justify-self: start; }
  .button.light { background: var(--muted); color: var(--foreground); }
  .code { width: min(16rem, 100%); padding: 0.6rem; border-radius: var(--radius); background: #fff; box-shadow: 0 0 0 1px var(--border); }
  .code svg { display: block; width: 100%; height: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
  .site-head nav { margin-left: auto; display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; }
  .site-head nav a { font-size: 0.95rem; font-weight: 600; text-decoration: none; opacity: 0.92; }
  .site-head nav a:hover, .site-head nav a[aria-current] { text-decoration: underline; opacity: 1; }
  main.wide { width: min(76rem, 100% - 2 * clamp(1rem, 4vw, 2.5rem)); }
  .hero { display: grid; gap: 1rem; padding: clamp(1.5rem, 5vw, 3rem); border-radius: var(--radius); background: linear-gradient(135deg, #1f6f8b, #15485c); color: #fff; }
  .hero h1 { font-size: clamp(2.2rem, 6vw, 3.5rem); }
  .hero .lede { color: #d9ecf3; font-size: 1.15rem; max-width: 40rem; }
  .hero .actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }
  .hero .go { background: var(--accent); color: #1f1a10; }
  .hero .button.light { background: rgba(255,255,255,0.15); color: #fff; }
  .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 1rem; margin: 0; padding: 0; list-style: none; counter-reset: step; }
  .steps li { padding: 1rem 1.2rem; border-radius: var(--radius); background: var(--card); box-shadow: 0 0 0 1px var(--border); counter-increment: step; }
  .steps li::before { content: counter(step); display: inline-grid; place-items: center; width: 2rem; height: 2rem; margin-bottom: 0.5rem; border-radius: 50%; background: var(--note); color: var(--primary); font-weight: 800; }
  .steps h3, .faq h3 { margin: 0 0 0.25rem; font-size: 1.05rem; }
  .steps p, .faq p { margin: 0; color: var(--muted-foreground); }
  .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: 1rem; }
  .faq { display: grid; gap: 0.9rem; }
  .admin { display: grid; grid-template-columns: 13rem 1fr; gap: 1.5rem; align-items: start; }
  .admin-nav { position: sticky; top: 1rem; display: grid; gap: 0.15rem; padding: 0.75rem; border-radius: var(--radius); background: var(--card); box-shadow: 0 0 0 1px var(--border); }
  .admin-nav a { padding: 0.45rem 0.6rem; border-radius: 0.4rem; text-decoration: none; font-weight: 600; }
  .admin-nav a[aria-current] { background: var(--note); color: var(--primary); }
  .admin-nav small { padding: 0.6rem 0.6rem 0.2rem; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.72rem; }
  .admin-body { display: grid; gap: 1.25rem; min-width: 0; }
  @media (max-width: 52rem) { .admin { grid-template-columns: 1fr; } .admin-nav { position: static; grid-auto-flow: column; overflow-x: auto; } .admin-nav small { display: none; } }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.75rem; }
  .tile { padding: 0.9rem 1rem; border-radius: var(--radius); background: var(--card); box-shadow: 0 0 0 1px var(--border); }
  .tile span { display: block; color: var(--muted-foreground); font-size: 0.85rem; font-weight: 600; }
  .tile strong { display: block; font-size: 1.7rem; line-height: 1.2; }
  .tile small { color: var(--muted-foreground); }
  .filters { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: end; }
  .filters label { font-size: 0.9rem; }
  .table-wrap { overflow-x: auto; }
  .badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; background: var(--muted); font-size: 0.8rem; font-weight: 700; }
  .badge.out { background: #fff1d6; color: #6b4300; }
  .badge.booked { background: var(--note); color: #134a5e; }
  .badge.returned { background: #dff3e6; color: #13472a; }
  .badge.off { background: #fde4e1; color: #7a1f17; }
  .muted { color: var(--muted-foreground); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .pager { display: flex; gap: 1rem; align-items: center; }
  form.inline { display: inline; }
  .stack { display: grid; gap: 0.75rem; }
  dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 1rem; margin: 0; }
  dl.facts dt { color: var(--muted-foreground); font-weight: 600; }
  dl.facts dd { margin: 0; }
  .site-foot { padding: 1.5rem clamp(1rem, 4vw, 2.5rem) 2.5rem; color: var(--muted-foreground); font-size: 0.9rem; }
`;

/**
 * `nav`: who is looking, for the links in the header: `customer` (signed in, with a name),
 * `staff` (on the staff). `wide` gives the admin pages more room.
 */
export function layout({ title, shop, body, nav = {}, wide = false, here = '' }) {
  const link = (href, words) => `<a href="${href}"${here === href ? ' aria-current="page"' : ''}>${words}</a>`;
  const links = [link('/#rent', 'Rent'), nav.customer ? link('/account', `Your account`) : link('/account/sign-in', 'Sign in'), ...(nav.staff ? [link('/admin', 'Admin')] : [])].join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escape(title)} · ${escape(shop.name)}</title>
  <style>${STYLE}${CHART_CSS}</style>
</head>
<body>
  <p class="concept">${escape(shop.concept)}</p>
  <header class="site-head"><a href="/">${escape(shop.name)}</a><span>${escape(shop.place)} · ${escape(shop.town)}</span><nav aria-label="Site">${links}</nav></header>
  <main${wide ? ' class="wide"' : ''}>
    ${body}
  </main>
  <footer class="site-foot"><a href="/">Rentals</a> · <a href="/account">Your account</a> · <a href="/counter">The counter (staff)</a> · <a href="/admin">Admin (staff)</a></footer>
  <script type="module">
    import { connect } from '@zubra/sync/connect';
    connect();
  </script>
</body>
</html>`;
}
