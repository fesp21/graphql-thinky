import {connectionDefinitions, connectionArgs} from 'graphql-relay';
import {GraphQLEnumType, GraphQLList} from 'graphql';
import simplifyAST from '../simplifyAst';
import {base64, unbase64} from './../base64.js';

const cursorSeparator = '$',
  cursorPrefix = `arrayconnection${cursorSeparator}`;

/**
 * Creates a cursor based on the item and the
 * index of where is located on the result set.
 * needed to identify edges
 *
 * @param item
 * @param index
 * @returns {*}
 */
function toCursor(item, index) {
  const id = item.id;
  return base64(cursorPrefix + id + cursorSeparator + index);
}

/**
 * Decode a cursor into its component parts
 *
 * @param cursor
 * @returns {{id, index}}
 */
function fromCursor(cursor) {
  cursor = unbase64(cursor);
  cursor = cursor.substring(cursorPrefix.length, cursor.length);
  const [id, index] = cursor.split(cursorSeparator);

  return {
    id,
    index
  };
}

/**
 * Resolve an edge within it's
 * cursor, node and source
 *
 * @param item
 * @param index
 * @param queriedCursor
 * @param args
 * @param source
 * @returns {{cursor: *, node: *, source: *}}
 */
function resolveEdge(item, index, queriedCursor, args = {}, source) {
  if (queriedCursor) {
    index = parseInt(queriedCursor.index, 10) + index;
    if (index === 0) {
      index = 1;
    } else {
      index++;
    }
  }
  return {
    cursor: toCursor(item, index),
    node: item,
    source
  };
}

/**
 * Return location information
 * of an edge
 *
 * @param resultset
 * @param offset
 * @param cursor
 * @returns {{hasMorePages: boolean, hasPreviousPage: boolean}}
 */
function createEdgeInfo(resultset, offset, index) {
  const limit = offset - index;
  // retrieve full count from the first edge
  // or default 10
  let fullCount = resultset[0] &&
      resultset[0].fullCount &&
      parseInt(resultset[0].fullCount, 10);

  if (!resultset[0]) {
    fullCount = 0;
  }

  let hasNextPage = false;
  let hasPreviousPage = false;

  if (offset) {
    const requested = (index + 1) * limit;

    hasNextPage = requested < fullCount;
    hasPreviousPage = (requested > limit);
  }
  return {
    hasNextPage,
    hasPreviousPage
  };
}
/**
 * Resolve a relay connection
 *
 * @param Node
 * @returns {{connectionType, edgeType, nodeType: *, resolveEdge: resolveEdge, connectionArgs: {orderBy: {type}}, resolve: resolver}}
 */
export default (Node, resolveOpts) => {
  const connectionOpts = Node.connection,
    connectionName = connectionOpts.name,
    nodeType = connectionOpts.type,
    userParms = connectionOpts.params || {};

  connectionOpts.before = connectionOpts.before || (options => options);
  connectionOpts.after = connectionOpts.after || (options => options);

  const {
      edgeType,
      connectionType
  } = connectionDefinitions({
    nodeType,
    name: connectionName,
    connectionFields: connectionOpts.connectionFields,
    edgeFields: connectionOpts.edgeFields
  });

  // Define the order of the connection
  // To have always a guranteed set of data
  // (if not provided)
  let orderByEnum;
  if (userParms.orderBy === undefined) {
    orderByEnum = new GraphQLEnumType({
      name: `${connectionName}ConnectionOrder`,
      values: {
        ID: {value: ['id', 'ASC']}
      }
    });
  } else {
    orderByEnum = userParms.orderBy;
  }

  // Assign the connection arguments
  const $connectionArgs = {
    ...connectionArgs,
    orderBy: {
      type: new GraphQLList(orderByEnum)
    }
  };

  // We are going to give instruction on how
  // the resolver has to retrieve information from
  // rethink, then returning it with in the edges,node pattern.
  const $resolver = require('./../resolver').default(Node, {
    ...resolveOpts,
    list: true,
    handleConnection: false,
    thinky: Node.thinky,
    before: (options, parent, args, context) => {
      if (args.first || args.last) {
        const offset = parseInt(args.first || args.last, 10);

        if (options.count === undefined) {
          options.count = true;
        }

        if (args.before || args.after) {
          const cursor = fromCursor(args.after || args.before);
          const startIndex = parseInt(cursor.index, 10);
          options.offset = offset + startIndex;
          options.index = startIndex;
        } else {
          options.offset = offset;
          options.index = 0;
        }
      }

      // attach the order into the composition
      // stack
      let order;
      if (!args.orderBy) {
        order = [orderByEnum._values[0].value];
      } else if (typeof args.orderBy === 'string') {
        order = [orderByEnum._nameLookup[args.orderBy].value];
      } else {
        order = args.orderBy;
      }

      const orderAttribute = order[0][0]; // Order Attribute
      let orderDirection = order[0][1]; // Order Direction

      // Depending on the direction requested
      // we sort the result accordently
      if (args.last) {
        orderDirection = orderDirection === 'ASC' ? 'DESC' : 'ASC';
      }

      // Assign order
      options.order = [
        orderAttribute, orderDirection
      ];

      return connectionOpts.before(options, args, root, context);
    },
    after: (resultset, {offset, index}, parent, args, root, {source}) => {
      let cursor = null;

      // Once we have the result set we decode the cursor
      // if given
      if (args.after || args.before) {
        cursor = fromCursor(args.after || args.before);
      }

      // create edges array
      const edges = resultset.map((value, idx) => {
        // console.log("RESOLVE EDGE", idx);
        return resolveEdge(value, idx, cursor, args, source);
      });

      const firstEdge = edges[0],
        lastEdge = edges[edges.length - 1];

      const edgeInfo = createEdgeInfo(resultset, offset, index);
      const {hasNextPage, hasPreviousPage} = edgeInfo;

      return {
        source,
        args,
        edges,
        pageInfo: {
          startCursor: firstEdge ? firstEdge.cursor : null,
          endCursor: lastEdge ? lastEdge.cursor : null,
          hasPreviousPage,
          hasNextPage
        }
      };
    }
  });

  // Create a wrapper around our custom resolver
  // So that it will be executed only if edges are
  // returned.
  const resolver = (source, args, context, info) => {
    if (simplifyAST(info.fieldNodes[0], info).fields.edges) {
      return $resolver(source, args, context, info);
    }

    return {
      source,
      args
    };
  };

  return {
    connectionType,
    edgeType,
    nodeType,
    resolveEdge,
    connectionArgs: $connectionArgs,
    resolve: resolver
  };
};
