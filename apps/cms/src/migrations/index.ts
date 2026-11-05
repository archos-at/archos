import * as migration_20261105_100541_initial from './20261105_100541_initial';

export const migrations = [
  {
    up: migration_20261105_100541_initial.up,
    down: migration_20261105_100541_initial.down,
    name: '20261105_100541_initial'
  },
];
