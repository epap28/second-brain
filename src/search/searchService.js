class SearchService {
  constructor(model) {
    this.model = model;
  }

  /**
   * Maintains the existing category-name search behaviour while keeping
   * the implementation isolated so that vector-based search can be wired
   * in later without touching the API layer.
   */
  searchCategories(query) {
    return this.model.searchCategoriesByName(query);
  }

  /**
   * Full-text search implementation backed by the current data model.
   */
  searchContent(query) {
    return this.model.searchByContent(query);
  }

  /**
   * Placeholder for future vector search support. Leaving an explicit
   * method makes it clear where embedding-powered retrieval will slot in.
   * For now it simply states that the capability is unavailable.
   */
  async searchVector(/* query, options = {} */) {
    return {
      available: false,
      results: [],
      message: 'Vector search is not implemented yet. Add embeddings to enable it.',
    };
  }
}

function createSearchService(model) {
  return new SearchService(model);
}

module.exports = {
  createSearchService,
};