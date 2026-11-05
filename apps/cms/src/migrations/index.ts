import * as migration_20261105_101035_initial from './20261105_101035_initial';

export const migrations = [
  {
    up: migration_20261105_101035_initial.up,
    down: migration_20261105_101035_initial.down,
    name: '20261105_101035_initial'
  },
];
