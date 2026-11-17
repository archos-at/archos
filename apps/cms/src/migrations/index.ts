import * as migration_20261105_101546_initial from './20261105_101546_initial';
import * as migration_20261111_105912_social_sending_status from './20261111_105912_social_sending_status';

export const migrations = [
  {
    up: migration_20261105_101546_initial.up,
    down: migration_20261105_101546_initial.down,
    name: '20261105_101546_initial',
  },
  {
    up: migration_20261111_105912_social_sending_status.up,
    down: migration_20261111_105912_social_sending_status.down,
    name: '20261111_105912_social_sending_status'
  },
];
