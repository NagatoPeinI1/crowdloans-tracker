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
  TokenCreateInput,
  TokenCreateManyArgs,
  TokenUpdateArgs,
  TokenWhereArgs,
  TokenWhereInput,
  TokenWhereUniqueInput,
  TokenOrderByEnum,
} from '../../warthog';

import { Token } from './token.model';
import { TokenService } from './token.service';

@ObjectType()
export class TokenEdge {
  @Field(() => Token, { nullable: false })
  node!: Token;

  @Field(() => String, { nullable: false })
  cursor!: string;
}

@ObjectType()
export class TokenConnection {
  @Field(() => Int, { nullable: false })
  totalCount!: number;

  @Field(() => [TokenEdge], { nullable: false })
  edges!: TokenEdge[];

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
export class TokenConnectionWhereArgs extends ConnectionPageInputOptions {
  @Field(() => TokenWhereInput, { nullable: true })
  where?: TokenWhereInput;

  @Field(() => TokenOrderByEnum, { nullable: true })
  orderBy?: [TokenOrderByEnum];
}

@Resolver(Token)
export class TokenResolver {
  constructor(@Inject('TokenService') public readonly service: TokenService) {}

  @Query(() => [Token])
  async tokens(
    @Args() { where, orderBy, limit, offset }: TokenWhereArgs,
    @Fields() fields: string[]
  ): Promise<Token[]> {
    return this.service.find<TokenWhereInput>(where, orderBy, limit, offset, fields);
  }

  @Query(() => Token, { nullable: true })
  async tokenByUniqueInput(
    @Arg('where') where: TokenWhereUniqueInput,
    @Fields() fields: string[]
  ): Promise<Token | null> {
    const result = await this.service.find(where, undefined, 1, 0, fields);
    return result && result.length >= 1 ? result[0] : null;
  }

  @Query(() => TokenConnection)
  async tokensConnection(
    @Args() { where, orderBy, ...pageOptions }: TokenConnectionWhereArgs,
    @Info() info: any
  ): Promise<TokenConnection> {
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
      result = await this.service.findConnection<TokenWhereInput>(where, orderBy, pageOptions, rawFields);
    } catch (err: any) {
      console.log(err);
      // TODO: should continue to return this on `Error: Items is empty` or throw the error
      if (!(err.message as string).includes('Items is empty')) throw err;
    }

    return result as Promise<TokenConnection>;
  }
}
