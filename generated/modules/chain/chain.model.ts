import { BaseModel, Model, StringField, JSONField } from '@subsquid/warthog';

import * as jsonTypes from '../jsonfields/jsonfields.model';

@Model({ api: {} })
export class Chain extends BaseModel {
  @StringField({})
  tokenId!: string;

  @StringField({})
  chainName!: string;

  @StringField({
    nullable: true,
  })
  relayId?: string;

  @StringField({
    nullable: true,
  })
  relayChain?: string;

  constructor(init?: Partial<Chain>) {
    super();
    Object.assign(this, init);
  }
}
