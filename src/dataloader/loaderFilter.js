import { chain, isObject } from 'lodash';
import {
  connectionFromArray
} from 'graphql-relay';
import { NodeAttributes } from './../node';

class LoaderFilter {

  constructor(results:Array|Object, filtering?: NodeAttributes = {}|undefined) {

    this.results = results;
    this.filtering = {
      limit: 40,
      orderBy: {},
      filter: {},
      ...filtering || {},
    };
  }

  toObject() {
    if (isObject(this.results)) {
      return this.results;
    }
    if (Array.isArray(this.results)) {
      const result = this.toArray();
      return result[0] || {};
    }

    throw new Error("Couldn't transform result to Object");
  }

  /**
   * Resolve results with filtering
   * applayed
   * @returns {Array|*}
   */
  toArray() {
    let results;
    if (!Array.isArray(this.results)) {
      results = [this.results];
    } else {
      results = this.results;
    }
    const { index, offset, orderBy, filter } = this.filtering;
    let resultFiltered = chain(results);

    if (orderBy && Object.keys(orderBy).length > 0) {
      resultFiltered = resultFiltered.orderBy(orderBy);
    }

    if (filter && Object.keys(filter).length > 0) {
      resultFiltered = resultFiltered.filter(filter);
    }

    resultFiltered = resultFiltered.take(offset - index);

    return resultFiltered.value();
  }

  /**
   * Returned a connection from
   * array
   */
  toConnectionArray(args:Object):Object {
    const results = this.toArray();
    return connectionFromArray(results, args);
  }

  /**
   * Limit
   * @param limit
   * @returns {LoaderFilter}
   */
  limit(limit):this {
    this.filtering.limit = limit || this.filtering.limit;
    return this;
  }

  /**
   * Set order by
   * @param field
   * @param direction
   */
  orderBy(field:string, direction:string) {
    this.filtering.orderBy[field] = direction;
    return this;
  }

  /**
   *
   * @param filterDef
   */
  filter(filterDef:Object):this {
    this.filtering.filter = {
      ...this.filtering.filter,
      ...filterDef
    };
    return this;
  }

  /**
   * Filter if helper
   * @param condition
   * @param filter
   * @returns {LoaderFilter}
   */
  filterIf(condition:boolean, filter:Object):this {
    return this.when(condition, () => this.filter(filter));
  }

  /**
   * Sometime we use optional
   * arguments into our GraphQL queries
   * to keep the chain of filters
   * we use this function to evaluate
   * any filtering if the value is not
   * undefined
   * @param value
   * @param fnEvaluation
   * @returns {LoaderFilter}
   */
  when(value:any, fnEvaluation:func) {
    if (value !== undefined) {
      fnEvaluation(this);
      return this;
    }
    return this;
  }

  /**
   * From node args
   *
   * @param args
   * @returns {LoaderFilter}
   */
  fromNodeArgs(args:NodeAttributes) {
    this.filter(args.filter);

    this.when(args.orderBy, () => {
      this.orderBy.apply(this, args.orderBy);
    });

    this.limit(args.offset);

    return this;
  }
}

export default LoaderFilter;
