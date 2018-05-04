const deepMerge = require('deepmerge');
const Sort = require('./sort');
const Limit = require('./limit');

class Pagination {
  /**
   * Constructor.
   *
   * @param {Model} Model
   * @param {object} params
   * @param {object} options
   */
  constructor(Model, { criteria = {}, pagination = {}, sort = {} } = {}, options = {}) {
    // Set the Model to use for querying.
    this.Model = Model;

    // Set/merge any query criteria.
    this.criteria = deepMerge({}, criteria);

    // Set the limit and after cursor.
    const { first, after } = pagination;
    this.first = new Limit(first, options.limit);
    this.after = after;

    // Set the sort criteria.
    const { field, order } = sort;
    this.sort = new Sort(field, order, options.sort);
  }

  /**
   * Gets the total number of documents found.
   * Based on any initially set query criteria.
   *
   * @return {Promise}
   */
  getTotalCount() {
    return this.Model.find(this.criteria).comment(this.createComment('getTotalCount')).count();
  }

  /**
   * Gets the document edges for the current limit and sort.
   *
   * @return {Promise}
   */
  async getEdges() {
    const criteria = await this.getQueryCriteria();
    return this.Model.find(criteria)
      .sort(this.sort.value)
      .limit(this.limit.value)
      .collation(this.sort.collation)
      .comment(this.createComment('getEdges'));
  }

  /**
   * Gets the end cursor value of the current limit and sort.
   * In this case, the cursor will be the document id, non-obfuscated.
   *
   * @return {Promise}
   */
  async getEndCursor() {
    const criteria = await this.getQueryCriteria();
    const doc = await this.Model.findOne(criteria)
      .sort(this.sort.value)
      .limit(this.limit.value)
      .skip(this.limit.value - 1)
      .select({ _id: 1 })
      .collation(this.sort.collation)
      .comment(this.createComment('getEndCursor'));
    return doc ? doc.get('id') : null;
  }

  /**
   * Determines if another page is available.
   *
   * @return {Promise}
   */
  async hasNextPage() {
    const criteria = await this.getQueryCriteria();
    const count = await this.Model.find(criteria)
      .select({ _id: 1 })
      .sort(this.sort.value)
      .collation(this.sort.collation)
      .comment(this.createComment('hasNextPage'))
      .count();
    return Boolean(count > this.limit.value);
  }

  /**
   * @private
   * @param {string} id
   * @param {object} fields
   * @return {Promise}
   */
  async findCursorModel(id, fields) {
    const doc = await this.Model.findOne({ _id: id })
      .select(fields)
      .comment(this.createComment('findCursorModel'));
    if (!doc) throw new Error(`No record found for ID '${id}'`);
    return doc;
  }

  /**
   * @private
   * @return {Promise}
   */
  async getQueryCriteria() {
    if (this.filter) return this.filter;

    const { field, order } = this.sort;

    const filter = deepMerge({}, this.criteria);
    const limits = {};
    const ors = [];

    if (this.after) {
      let doc;
      const op = order === 1 ? '$gt' : '$lt';
      if (field === '_id') {
        // Sort by ID only.
        doc = await this.findCursorModel(this.after, { _id: 1 });
        filter._id = { [op]: doc.id };
      } else {
        doc = await this.findCursorModel(this.after, { [field]: 1 });
        limits[op] = doc[field];
        ors.push({
          [field]: doc[field],
          _id: { [op]: doc.id },
        });
        filter.$or = [{ [field]: limits }, ...ors];
      }
    }
    this.filter = filter;
    return this.filter;
  }

  /**
   * @private
   * @param {string} method
   * @return {string}
   */
  createComment(method) {
    return `Pagination: ${this.Model.modelName} - ${method}`;
  }
}

module.exports = Pagination;