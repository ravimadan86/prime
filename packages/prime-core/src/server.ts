import { ApolloServer } from 'apollo-server-express';
import cors from 'cors';
import debug from 'debug';
import express from 'express';
import http from 'http';
import { ResolverData } from 'type-graphql';
import { Container } from 'typedi';
import { useContainer } from 'typeorm';
import { Context } from './interfaces/Context';
import { ServerConfig } from './interfaces/ServerConfig';
import { createModules } from './modules';
import { createExternal } from './modules/external';
import { pubSub } from './modules/internal';
import { fields } from './utils/fields';

const log = debug('prime:server');

useContainer(Container);

export const createServer = async ({ port, connection }: ServerConfig) => {
  const app = express();
  const server = http.createServer(app);
  const { schema, context, subscriptions } = await createModules(connection);
  let external = await createExternal(connection);

  app.use(
    cors({
      credentials: true,
      origin: true,
    })
  );

  const externalServer: any = new ApolloServer({
    playground: true,
    context: external.context,
    schema: external.schema,
  });

  pubSub.subscribe('REBUILD_EXTERNAL', async payload => {
    log('schemas have changed', payload.name);
    external = await createExternal(connection);
    externalServer.schema = external.schema;
  });

  externalServer.applyMiddleware({ app });

  fields.forEach(
    field => field.ui && app.use(`/prime/field/${field.type}`, express.static(field.ui))
  );

  const apollo = new ApolloServer({
    playground: true,
    subscriptions: {
      ...subscriptions,
      onConnect: (params, ws, ctx) => ctx,
    },
    async context(ctx) {
      if (!ctx.req && ctx.connection) {
        return context({ req: ctx.connection.context.request });
      }
      return context(ctx);
    },
    schema,
    formatResponse(response: any, resolver: ResolverData<Context>) {
      Container.reset(resolver.context.requestId);
      return response;
    },
  });

  apollo.installSubscriptionHandlers(server);
  apollo.applyMiddleware({
    app,
    path: '/prime/graphql',
    cors: {
      origin: true,
    },
  });

  return server.listen(port, () => {
    log(`🚀 Server ready at http://localhost:${port}${apollo.graphqlPath}`);
    log(`🚀 Subscriptions ready at ws://localhost:${port}${apollo.subscriptionsPath}`);
  });
};