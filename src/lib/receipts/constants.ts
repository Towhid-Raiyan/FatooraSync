// Shared page size for receipt history pagination -- server pages, the API
// route, and the client's fallback state all need the same value, so it's
// defined once here instead of as a separate literal in each file.
export const PAGE_SIZE = 10;
