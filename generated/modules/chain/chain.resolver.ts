import {
  Arg,
  Args,
  Mutation,
  Query,
  Root,
  Resolver,
  FieldResolver,
  ObjectType,
  Field,
  Int,
  ArgsType,
  Info,
  Ctx,
} from 'type-graphql';
import graphqlFields from 'graphql-fields';
import { Inject } from 'typedi';
import { Min } from 'class-validator';
import {
  Fields,
  StandardDeleteResponse,
  UserId,
  PageInfo,
  RawFields,
  NestedFields,
  BaseContext,
} from '@subsquid/warthog';

import {
  ChainCreateInput,
  ChainCreateManyArgs,
  ChainUpdateArgs,
  ChainWhereArgs,
  ChainWhereInput,
  ChainWhereUniqueInput,
  ChainOrderByEnum,
} from '../../warthog';

import { Chain } from './chain.model';
import { ChainService } from './chain.service';

@ObjectType()
export class ChainEdge {
  @Field(() => Chain, { nullable: false })
  node!: Chain;

  @Field(() => String, { nullable: false })
  cursor!: string;
}

@ObjectType()
export class ChainConnection {
  @Field(() => Int, { nullable: false })
  totalCount!: number;

  @Field(() => [ChainEdge], { nullable: false })
  edges!: ChainEdge[];

  @Field(() => PageInfo, { nullable: false })
  pageInfo!: PageInfo;
}

@ArgsType()
export class ConnectionPageInputOptions {
  @Field(() => Int, { nullable: true })
  @Min(0)
  first?: number;

  @Field(() => String, { nullable: true })
  after?: string; // V3: TODO: should we make a RelayCursor scalar?

  @Field(() => Int, { nullable: true })
  @Min(0)
  last?: number;

  @Field(() => String, { nullable: true })
  before?: string;
}

@ArgsType()
export class ChainConnectionWhereArgs extends ConnectionPageInputOptions {
  @Field(() => ChainWhereInput, { nullable: true })
  where?: ChainWhereInput;

  @Field(() => ChainOrderByEnum, { nullable: true })
  orderBy?: [ChainOrderByEnum];
}

@Resolver(Chain)
export class ChainResolver {
  constructor(@Inject('ChainService') public readonly service: ChainService) {}

  @Query(() => [Chain])
  async chains(
    @Args() { where, orderBy, limit, offset }: ChainWhereArgs,
    @Fields() fields: string[]
  ): Promise<Chain[]> {
    return this.service.find<ChainWhereInput>(where, orderBy, limit, offset, fields);
  }

  @Query(() => Chain, { nullable: true })
  async chainByUniqueInput(
    @Arg('where') where: ChainWhereUniqueInput,
    @Fields() fields: string[]
  ): Promise<Chain | null> {
    const result = await this.service.find(where, undefined, 1, 0, fields);
    return result && result.length >= 1 ? result[0] : null;
  }

  @Query(() => ChainConnection)
  async chainsConnection(
    @Args() { where, orderBy, ...pageOptions }: ChainConnectionWhereArgs,
    @Info() info: any
  ): Promise<ChainConnection> {
    const rawFields = graphqlFields(info, {}, { excludedFields: ['__typename'] });

    let result: any = {
      totalCount: 0,
      edges: [],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
    // If the related database table does not have any records then an error is thrown to the client
    // by warthog
    try {
      result = await this.service.findConnection<ChainWhereInput>(where, orderBy, pageOptions, rawFields);
    } catch (err: any) {
      console.log(err);
      // TODO: should continue to return this on `Error: Items is empty` or throw the error
      if (!(err.message as string).includes('Items is empty')) throw err;
    }

    return result as Promise<ChainConnection>;
  }
}
