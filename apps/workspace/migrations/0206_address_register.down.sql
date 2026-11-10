-- Down of 0206: the register tables go, with every imported release.
-- Nothing else reads them; a project's site keeps its stored facts and evidence.

DROP TABLE IF EXISTS address_register_entries;
DROP TABLE IF EXISTS address_register_releases;
