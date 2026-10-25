export const publicPageRoutes = ['contact', 'privacy', 'terms', 'refunds', 'about'].map(
  page => ({ source: '/' + page, destination: '/' + page + '/index.html' }),
)
