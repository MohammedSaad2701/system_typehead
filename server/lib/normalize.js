function normalizeQuery(value) {
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function validateSearchQuery(value, maxLength) {
  if (typeof value !== 'string') {
    return { valid: false, error: 'query must be a string' };
  }
  const displayQuery = value.trim().replace(/\s+/g, ' ');
  if (!displayQuery) return { valid: false, error: 'query is required' };
  if (displayQuery.length > maxLength) {
    return { valid: false, error: `query must be at most ${maxLength} characters` };
  }
  return {
    valid: true,
    displayQuery,
    normalizedQuery: normalizeQuery(displayQuery)
  };
}

module.exports = { normalizeQuery, validateSearchQuery };
