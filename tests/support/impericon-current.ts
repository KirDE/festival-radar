import { IMPERICON_HOME, IMPERICON_DOCUMENTS } from '../../lib/ingestion/adapters/impericon-current.ts';
export const impericonCurrentSource = { festivalSlug: 'impericon', url: IMPERICON_HOME, editionYear: 2027, strategies: ['official_markup' as const], refreshPolicy: 'daily' as const, enabled: true };
export function impericonFixture(newName = 'Beartooth', day = '25', year = 2027) {
  const base = 'https://www.impericon.com/blogs/festival/impericon-festival-' + year;
  const first = base + '-new-headliner', second = base + '-new-line-up-wave', ticket = base + '-ticket-update';
  const page = (url: string, title: string, body: string) => `<html><head><link rel="canonical" href="${url}"></head><body><nav><a href="https://www.impericon.com/collections/not-playing">Merch artist</a></nav><h1>${title}</h1><div class="article__content"><div class="rte">${body}</div></div><div class="article__content about-author-wrapper"><b>Author favourite</b></div></body></html>`;
  const articles = [
    { url: first, html: page(first, `Impericon Festival ${year}: Another Headliner Announced!`, `<p><a href="https://www.impericon.com/collections/new-headliner">${newName}</a> will hit the stage as our next headliner!</p><p>As headliners alongside <a href="https://www.impericon.com/collections/sample-artist">Sample Artist</a>, they join our lineup.</p><p>Our previous band wave already saw <strong>Support One</strong> join the bill. More will follow from <strong>June ${day}–26, ${year}</strong>!</p>`) },
    { url: second, html: page(second, `Impericon Festival ${year}: New Line-Up Wave!`, '<p>Our headliners <a href="https://www.impericon.com/collections/sample-artist">Sample Artist</a> are getting company at the festival.</p><p>Officially joining the bill: <b>Support One</b> – with new single <strong>“Not an artist”</strong> and album <strong><i>Not A Band</i></strong>.</p>') },
    { url: ticket, html: page(ticket, `Impericon Festival ${year}: Ticket Update`, '<p>Weekend passes are on sale.</p>') },
  ];
  const home = `<html><head><link rel="canonical" href="${IMPERICON_HOME}"></head><body><header><b>Wrong Band</b></header><span class="product-item-meta__title">${day}/26.06.${year} Tier 2 - Weekend Ticket</span><article-list>${articles.map(a => `<a href="${a.url}">${a.html.match(/<h1>(.*?)<\/h1>/)![1]}</a>`).join('')}</article-list><footer>Old Festival 2026</footer></body></html>`;
  return { kind: IMPERICON_DOCUMENTS, home, articles };
}
