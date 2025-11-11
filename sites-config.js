// Configuration for supported book sites
const SUPPORTED_SITES = {
  libraccio: {
    id: 'libraccio',
    name: 'Libraccio.it',
    country: 'IT',
    urlPattern: 'https://www.libraccio.it/libro/{isbn}',
    scraper: 'python', // Uses existing Python scraper
    icon: '📚',
    description: 'Large Italian used and new book retailer'
  },
  amazon_it: {
    id: 'amazon_it',
    name: 'Amazon.it',
    country: 'IT',
    urlPattern: 'https://www.amazon.it/dp/{isbn}',
    scraper: 'jina',
    icon: '📦',
    description: 'Amazon Italy - largest online retailer'
  },
  ibs: {
    id: 'ibs',
    name: 'IBS.it',
    country: 'IT',
    urlPattern: 'https://www.ibs.it/libri/{isbn}',
    scraper: 'jina',
    icon: '📖',
    description: 'Internet Bookshop Italia'
  },
  feltrinelli: {
    id: 'feltrinelli',
    name: 'La Feltrinelli',
    country: 'IT',
    urlPattern: 'https://www.lafeltrinelli.it/libri/{isbn}',
    scraper: 'jina',
    icon: '🏛️',
    description: 'Major Italian bookstore chain'
  },
  mondadori: {
    id: 'mondadori',
    name: 'Mondadori Store',
    country: 'IT',
    urlPattern: 'https://www.mondadoristore.it/libri/{isbn}',
    scraper: 'jina',
    icon: '📗',
    description: 'Mondadori publisher bookstore'
  },
  decitre: {
    id: 'decitre',
    name: 'Decitre',
    country: 'FR',
    urlPattern: 'https://www.decitre.fr/livres/title-{isbn}.html',
    scraper: 'decitre',
    icon: '📘',
    description: 'French bookstore chain'
  }
};

const DEFAULT_SITE = 'libraccio';

module.exports = {
  SUPPORTED_SITES,
  DEFAULT_SITE,
  getSite: (siteId) => SUPPORTED_SITES[siteId] || SUPPORTED_SITES[DEFAULT_SITE],
  getAllSites: () => Object.values(SUPPORTED_SITES),
  isSiteSupported: (siteId) => !!SUPPORTED_SITES[siteId]
};
