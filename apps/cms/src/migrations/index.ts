import * as migration_20261105_101546_initial from './20261105_101546_initial';

export const migrations = [
  {
    up: migration_20261105_101546_initial.up,
    down: migration_20261105_101546_initial.down,
    name: '20261105_101546_initial'
  },
];
