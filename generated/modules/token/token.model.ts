import { BaseModel, Model, StringField, JSONField } from '@subsquid/warthog';

import * as jsonTypes from '../jsonfields/jsonfields.model';

@Model({ api: {} })
export class Token extends BaseModel {
  @StringField({})
  tokenName!: string;

  constructor(init?: Partial<Token>) {
    super();
    Object.assign(this, init);
  }
}
